"""
EdgeFace Recognition Model Implementation
Based on EdgeFace research paper and optimized for production deployment
"""

import asyncio
import logging
import time
from typing import List, Dict, Tuple, Optional, Union, Any
import os

import cv2
import numpy as np
import onnxruntime as ort

from utils.database_manager import FaceDatabaseManager
from .facemesh_detector import FaceMeshDetector

logger = logging.getLogger(__name__)

class EdgeFaceDetector:
    """
    EdgeFace recognition model wrapper with async support and database management
    """
    
    def __init__(
        self,
        model_path: str,
        input_size: Tuple[int, int] = (112, 112),
        similarity_threshold: float = 0.45,  # Lowered from 0.6 to match config
        providers: Optional[List[str]] = None,
        database_path: Optional[str] = None,
        session_options: Optional[Dict[str, Any]] = None,
        facemesh_alignment: bool = False,  # Enable FaceMesh-based alignment
        facemesh_detector: Optional['FaceMeshDetector'] = None,  # External FaceMesh detector instance
        facemesh_model_path: Optional[str] = None,  # DEPRECATED: Path to FaceMesh ONNX model
        facemesh_config: Optional[Dict[str, Any]] = None  # DEPRECATED: FaceMesh configuration
    ):
        """
        Initialize EdgeFace detector
        
        Args:
            model_path: Path to the ONNX model file
            input_size: Input size (width, height) - EdgeFace uses 112x112
            similarity_threshold: Similarity threshold for recognition
            providers: ONNX runtime providers
            database_path: Path to face database JSON file
            session_options: ONNX runtime session options for optimization
            facemesh_alignment: Enable FaceMesh-based alignment instead of simple similarity transform
            facemesh_detector: External FaceMesh detector instance (recommended for performance)
            facemesh_model_path: DEPRECATED - Path to FaceMesh ONNX model file
            facemesh_config: DEPRECATED - Configuration dictionary for FaceMesh detector
        """
        self.model_path = model_path
        self.input_size = input_size
        self.similarity_threshold = similarity_threshold
        self.providers = providers or ['CPUExecutionProvider']
        self.database_path = database_path
        self.session_options = session_options
        
        # FaceMesh alignment parameters
        self.facemesh_alignment = facemesh_alignment
        self.facemesh_model_path = facemesh_model_path
        self.facemesh_config = facemesh_config or {}
        self.facemesh_detector = None
        
        # Model specifications (matching EdgeFace research paper)
        self.INPUT_MEAN = 127.5
        self.INPUT_STD = 127.5
        self.EMBEDDING_DIM = 512
        
        # Model components
        self.session = None
        
        # Initialize SQLite database manager
        if self.database_path:
            # Convert .json extension to .db for SQLite
            if self.database_path.endswith('.json'):
                sqlite_path = self.database_path.replace('.json', '.db')
            else:
                sqlite_path = self.database_path
            
            self.db_manager = FaceDatabaseManager(sqlite_path)
            logger.info(f"Initialized SQLite database: {sqlite_path}")
        else:
            self.db_manager = None
            logger.warning("No database path provided, running without persistence")
        
        # Initialize the model
        self._initialize_model()
        
        # Initialize FaceMesh detector if alignment is enabled
        if self.facemesh_alignment:
            if facemesh_detector is not None:
                # Use external FaceMesh detector (recommended for performance)
                self.facemesh_detector = facemesh_detector
                logger.info("Using external FaceMesh detector for EdgeFace alignment")
            elif self.facemesh_model_path:
                # Fallback: create internal FaceMesh detector (DEPRECATED)
                logger.warning("Creating internal FaceMesh detector - consider using external instance for better performance")
                try:
                    # Extract only valid FaceMeshDetector parameters from config
                    valid_params = {}
                    if 'input_size' in self.facemesh_config:
                        valid_params['input_size'] = self.facemesh_config['input_size']
                    if 'score_threshold' in self.facemesh_config:
                        valid_params['score_threshold'] = self.facemesh_config['score_threshold']
                    if 'margin_ratio' in self.facemesh_config:
                        valid_params['margin_ratio'] = self.facemesh_config['margin_ratio']
                    
                    self.facemesh_detector = FaceMeshDetector(
                        model_path=self.facemesh_model_path,
                        providers=self.providers,
                        session_options=self.session_options,
                        **valid_params
                    )
                    logger.info(f"Internal FaceMesh detector initialized for EdgeFace alignment")
                except Exception as e:
                    logger.error(f"Failed to initialize FaceMesh detector: {e}")
                    self.facemesh_alignment = False
                    self.facemesh_detector = None
            else:
                logger.warning("FaceMesh alignment enabled but no detector instance or model path provided")
                self.facemesh_alignment = False
                self.facemesh_detector = None
        
    def _initialize_model(self):
        """Initialize the ONNX model with optimized session options"""
        try:
            # Check if model file exists
            if not os.path.exists(self.model_path):
                raise FileNotFoundError(f"Model file not found: {self.model_path}")
            
            # Create optimized session options
            session_options = ort.SessionOptions()
            
            # Apply optimized session options if available
            if hasattr(self, 'session_options') and self.session_options:
                for key, value in self.session_options.items():
                    if hasattr(session_options, key):
                        setattr(session_options, key, value)
                        logger.debug(f"Applied session option: {key} = {value}")
            
            # Create ONNX session with optimized options
            self.session = ort.InferenceSession(
                self.model_path,
                sess_options=session_options,
                providers=self.providers
            )
            
            # Get model info
            input_info = self.session.get_inputs()[0]
            output_info = self.session.get_outputs()[0]
            
        except Exception as e:
            logger.error(f"Failed to initialize EdgeFace model: {e}")
            raise
    
    
    def _align_face(self, image: np.ndarray, bbox: List[float], facemesh_landmarks_5: Optional[List] = None) -> np.ndarray:
        """
        Align face using FaceMesh detector for high-quality alignment
        
        Args:
            image: Input image
            bbox: Face bounding box [x, y, width, height] for FaceMesh (required)
            facemesh_landmarks_5: Pre-computed 5-point landmarks from FaceMesh (optional, avoids recomputation)
            
        Returns:
            Aligned face crop (112x112)
        """
        # Use FaceMesh alignment (required)
        if self.facemesh_alignment and self.facemesh_detector is not None:
            # OPTIMIZATION: Use pre-computed landmarks if available
            if facemesh_landmarks_5 is not None and len(facemesh_landmarks_5) > 0:
                facemesh_landmarks = np.array(facemesh_landmarks_5, dtype=np.float32)
                logger.debug("Using pre-computed FaceMesh landmarks for alignment (optimization)")
            else:
                # Fallback: Compute landmarks if not provided
                # Convert bbox from [x, y, width, height] to [x1, y1, x2, y2] format for FaceMesh
                x, y, width, height = bbox
                facemesh_bbox = [x, y, x + width, y + height]
                
                # Get FaceMesh landmarks
                facemesh_result = self.facemesh_detector.detect_landmarks(image, facemesh_bbox)
                if facemesh_result['success'] and facemesh_result['landmarks_5']:
                    facemesh_landmarks = np.array(facemesh_result['landmarks_5'], dtype=np.float32)
                    logger.debug("Using FaceMesh landmarks for alignment")
                else:
                    raise ValueError("FaceMesh detection failed - unable to detect landmarks")
            
            # Create aligned face using FaceMesh landmarks and similarity transform
            aligned_face = self._create_aligned_face(image, facemesh_landmarks)
            return aligned_face
        else:
            raise ValueError("FaceMesh alignment is disabled or not available")
    
    def _create_aligned_face(self, image: np.ndarray, landmarks: np.ndarray) -> np.ndarray:
        """
        Create aligned face using similarity transform with reference points
        
        Args:
            image: Input image
            landmarks: 5-point landmarks [[x1,y1], [x2,y2], ...]
            
        Returns:
            Aligned face crop (112x112)
        """
        try:
            # Define reference points for 112x112 face alignment (standard EdgeFace)
            reference_points = np.array([
                [38.2946, 51.6963],    # left eye
                [73.5318, 51.5014],    # right eye  
                [56.0252, 71.7366],    # nose tip
                [41.5493, 92.3655],    # left mouth corner
                [70.7299, 92.2041]     # right mouth corner
            ], dtype=np.float32)
            
            # Ensure landmarks are in correct format
            if landmarks.shape != (5, 2):
                raise ValueError(f"Expected landmarks shape (5, 2), got {landmarks.shape}")
            
            src_points = landmarks.astype(np.float32)
            dst_points = reference_points.astype(np.float32)
            
            # Estimate similarity transformation
            tform = cv2.estimateAffinePartial2D(src_points, dst_points)[0]
            
            if tform is None:
                raise ValueError("Failed to estimate transformation matrix")
            
            # Apply transformation
            aligned_face = cv2.warpAffine(
                image,
                tform,
                self.input_size,
                flags=cv2.INTER_LINEAR,
                borderMode=cv2.BORDER_CONSTANT,
                borderValue=0
            )
            
            return aligned_face
            
        except Exception as e:
            logger.error(f"Similarity transform alignment failed: {e}")
            # Fallback to simple crop
            h, w = image.shape[:2]
            center_x, center_y = w // 2, h // 2
            size = min(w, h) // 2
            
            x1 = max(0, center_x - size)
            y1 = max(0, center_y - size)
            x2 = min(w, center_x + size)
            y2 = min(h, center_y + size)
            
            face_crop = image[y1:y2, x1:x2]
            return cv2.resize(face_crop, self.input_size)
    


    def _preprocess_image(self, aligned_face: np.ndarray) -> np.ndarray:
        """
        Preprocess aligned face for EdgeFace model
        
        Args:
            aligned_face: Aligned face image (112x112)
            
        Returns:
            Preprocessed tensor ready for inference
        """
        try:
            # Convert BGR to RGB
            rgb_image = cv2.cvtColor(aligned_face, cv2.COLOR_BGR2RGB)
            
            # Normalize to [-1, 1] range (EdgeFace preprocessing)
            normalized = (rgb_image.astype(np.float32) - self.INPUT_MEAN) / self.INPUT_STD
            
            # Transpose to CHW format and add batch dimension
            input_tensor = np.transpose(normalized, (2, 0, 1))  # HWC to CHW
            input_tensor = np.expand_dims(input_tensor, axis=0)  # Add batch dimension
            
            return input_tensor
            
        except Exception as e:
            logger.error(f"Image preprocessing failed: {e}")
            raise
    
    def _extract_embedding(self, image: np.ndarray, bbox: List[float], facemesh_landmarks_5: Optional[List] = None) -> np.ndarray:
        """
        Extract face embedding from image using FaceMesh alignment
        
        Args:
            image: Input image
            bbox: Bounding box [x, y, width, height] from face detection (required)
            facemesh_landmarks_5: Pre-computed 5-point landmarks from FaceMesh (optional, avoids recomputation)
            
        Returns:
            Normalized face embedding (512-dim)
        """
        try:
            # Align face using FaceMesh (with optional pre-computed landmarks)
            aligned_face = self._align_face(image, bbox, facemesh_landmarks_5)
            
            # Preprocess for model
            input_tensor = self._preprocess_image(aligned_face)
            
            # Run inference
            feeds = {self.session.get_inputs()[0].name: input_tensor}
            outputs = self.session.run(None, feeds)
            
            # Extract embedding
            embedding = outputs[0][0]  # Remove batch dimension
            
            # L2 normalization (critical for cosine similarity)
            norm = np.linalg.norm(embedding)
            if norm > 0:
                embedding = embedding / norm
            
            return embedding.astype(np.float32)
            
        except Exception as e:
            logger.error(f"Embedding extraction failed: {e}")
            raise
    
    def _extract_embeddings_batch(self, image: np.ndarray, face_data_list: List[Dict]) -> List[np.ndarray]:
        """
        BATCH PROCESSING: Extract embeddings for multiple faces in a single inference call
        
        Args:
            image: Input image
            face_data_list: List of dicts with 'bbox' and optional 'landmarks_5' keys
            
        Returns:
            List of normalized face embeddings (512-dim each)
        """
        try:
            if not face_data_list:
                return []
            
            # Align all faces and collect tensors
            aligned_faces = []
            valid_indices = []
            
            for i, face_data in enumerate(face_data_list):
                try:
                    bbox = face_data.get('bbox')
                    landmarks_5 = face_data.get('landmarks_5')
                    
                    # Align face
                    aligned_face = self._align_face(image, bbox, landmarks_5)
                    aligned_faces.append(aligned_face)
                    valid_indices.append(i)
                except Exception as e:
                    logger.warning(f"Failed to align face {i}: {e}")
                    continue
            
            if not aligned_faces:
                return []
            
            # Batch preprocess all faces
            batch_tensors = []
            for aligned_face in aligned_faces:
                # Preprocess individual face (without batch dimension)
                rgb_image = cv2.cvtColor(aligned_face, cv2.COLOR_BGR2RGB)
                normalized = (rgb_image.astype(np.float32) - self.INPUT_MEAN) / self.INPUT_STD
                tensor = np.transpose(normalized, (2, 0, 1))  # HWC to CHW
                batch_tensors.append(tensor)
            
            # Stack into batch (N, C, H, W)
            batch_input = np.stack(batch_tensors, axis=0)
            
            # Run batched inference
            feeds = {self.session.get_inputs()[0].name: batch_input}
            outputs = self.session.run(None, feeds)
            
            # Extract and normalize embeddings
            embeddings = outputs[0]  # Shape: (N, 512)
            normalized_embeddings = []
            
            for embedding in embeddings:
                # L2 normalization
                norm = np.linalg.norm(embedding)
                if norm > 0:
                    embedding = embedding / norm
                normalized_embeddings.append(embedding.astype(np.float32))
            
            logger.debug(f"Batch processed {len(normalized_embeddings)} face embeddings")
            return normalized_embeddings
            
        except Exception as e:
            logger.error(f"Batch embedding extraction failed: {e}")
            # Fallback to sequential processing
            logger.info("Falling back to sequential embedding extraction")
            embeddings = []
            for face_data in face_data_list:
                try:
                    bbox = face_data.get('bbox')
                    landmarks_5 = face_data.get('landmarks_5')
                    emb = self._extract_embedding(image, bbox, landmarks_5)
                    embeddings.append(emb)
                except:
                    continue
            return embeddings
    


    def _calculate_similarity(self, embedding1: np.ndarray, embedding2: np.ndarray) -> float:
        """Calculate cosine similarity between two embeddings"""
        try:
            # Cosine similarity (since embeddings are L2 normalized)
            similarity = np.dot(embedding1, embedding2)
            return float(similarity)
            
        except Exception as e:
            logger.error(f"Similarity calculation failed: {e}")
            return 0.0
    
    def _find_best_match(self, embedding: np.ndarray, landmarks: Optional[np.ndarray] = None) -> Tuple[Optional[str], float]:
        """
        Find best matching person in database using fixed similarity threshold
        
        Args:
            embedding: Query embedding
            landmarks: Optional landmarks (not used in simplified version)
            
        Returns:
            Tuple of (person_id, similarity_score)
        """
        if not self.db_manager:
            return None, 0.0
        
        # Get all persons from SQLite database
        all_persons = self.db_manager.get_all_persons()
        
        if not all_persons:
            return None, 0.0
        
        best_person_id = None
        best_similarity = 0.0
        
        for person_id, stored_embedding in all_persons.items():
            similarity = self._calculate_similarity(embedding, stored_embedding)
            
            if similarity > best_similarity:
                best_similarity = similarity
                best_person_id = person_id
        
        # Use fixed threshold - no pose-based adjustments
        if best_similarity >= self.similarity_threshold:
            return best_person_id, best_similarity
        else:
            return None, best_similarity
    
    def recognize_face(self, image: np.ndarray, bbox: List[float], facemesh_landmarks_5: Optional[List] = None) -> Dict:
        """
        Recognize face in image using FaceMesh alignment (synchronous)
        
        Args:
            image: Input image as numpy array (BGR format)
            bbox: Bounding box [x, y, width, height] from face detection (required)
            facemesh_landmarks_5: Pre-computed 5-point landmarks from FaceMesh (optional, avoids recomputation)
            
        Returns:
            Recognition result with person_id and similarity
        """
        try:
            # Extract embedding using FaceMesh alignment (with optional pre-computed landmarks)
            embedding = self._extract_embedding(image, bbox, facemesh_landmarks_5)
            
            # Find best match
            person_id, similarity = self._find_best_match(embedding)
            
            return {
                "person_id": person_id,
                "similarity": similarity,
                "embedding": embedding.tolist(),  # For potential storage
                "success": True
            }
            
        except Exception as e:
            logger.error(f"Face recognition error: {e}")
            return {
                "person_id": None,
                "similarity": 0.0,
                "embedding": None,
                "success": False,
                "error": str(e)
            }
    
    async def recognize_face_async(self, image: np.ndarray, bbox: List[float], facemesh_landmarks_5: Optional[List] = None) -> Dict:
        """
        Recognize face in image using FaceMesh alignment (asynchronous)
        
        Args:
            image: Input image as numpy array (BGR format)
            bbox: Bounding box [x, y, width, height] from face detection (required)
            facemesh_landmarks_5: Pre-computed 5-point landmarks from FaceMesh (optional, avoids recomputation)
            
        Returns:
            Recognition result with person_id and similarity
        """
        # Run recognition in thread pool to avoid blocking
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.recognize_face, image, bbox, facemesh_landmarks_5)
    
    def recognize_faces_batch(self, image: np.ndarray, face_data_list: List[Dict]) -> List[Dict]:
        """
        BATCH PROCESSING: Recognize multiple faces in a single inference call
        
        Args:
            image: Input image
            face_data_list: List of dicts with 'bbox' and optional 'landmarks_5' keys
            
        Returns:
            List of recognition results with person_id and similarity for each face
        """
        try:
            if not face_data_list:
                return []
            
            # Extract all embeddings in batch
            embeddings = self._extract_embeddings_batch(image, face_data_list)
            
            # Find best matches for all embeddings
            results = []
            for i, embedding in enumerate(embeddings):
                try:
                    person_id, similarity = self._find_best_match(embedding)
                    results.append({
                        "person_id": person_id,
                        "similarity": similarity,
                        "embedding": embedding.tolist(),
                        "success": True,
                        "face_index": i
                    })
                except Exception as e:
                    logger.error(f"Face {i} matching failed: {e}")
                    results.append({
                        "person_id": None,
                        "similarity": 0.0,
                        "embedding": None,
                        "success": False,
                        "error": str(e),
                        "face_index": i
                    })
            
            logger.debug(f"Batch recognized {len(results)} faces")
            return results
            
        except Exception as e:
            logger.error(f"Batch face recognition error: {e}")
            # Fallback to sequential processing
            logger.info("Falling back to sequential recognition")
            results = []
            for i, face_data in enumerate(face_data_list):
                bbox = face_data.get('bbox')
                landmarks_5 = face_data.get('landmarks_5')
                result = self.recognize_face(image, bbox, landmarks_5)
                result['face_index'] = i
                results.append(result)
            return results
    
    async def recognize_faces_batch_async(self, image: np.ndarray, face_data_list: List[Dict]) -> List[Dict]:
        """
        BATCH PROCESSING: Recognize multiple faces asynchronously
        
        Args:
            image: Input image
            face_data_list: List of dicts with 'bbox' and optional 'landmarks_5' keys
            
        Returns:
            List of recognition results
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.recognize_faces_batch, image, face_data_list)
    
    def register_person(self, person_id: str, image: np.ndarray, bbox: List[float], facemesh_landmarks_5: Optional[List] = None) -> Dict:
        """
        Register a new person in the database using FaceMesh alignment
        
        Args:
            person_id: Unique identifier for the person
            image: Input image
            bbox: Bounding box [x, y, width, height] from face detection (required)
            facemesh_landmarks_5: Pre-computed 5-point landmarks from FaceMesh (optional, avoids recomputation)
            
        Returns:
            Registration result
        """
        try:
            # Extract embedding using FaceMesh alignment (with optional pre-computed landmarks)
            embedding = self._extract_embedding(image, bbox, facemesh_landmarks_5)
            
            # Store in SQLite database
            if self.db_manager:
                save_success = self.db_manager.add_person(person_id, embedding)
                stats = self.db_manager.get_stats()
                total_persons = stats.get("total_persons", 0)
            else:
                save_success = False
                total_persons = 0
                logger.warning("No database manager available for registration")
            
            logger.info(f"Registered person: {person_id}")
            
            return {
                "success": True,
                "person_id": person_id,
                "database_saved": save_success,
                "total_persons": total_persons
            }
            
        except Exception as e:
            logger.error(f"Person registration failed: {e}")
            return {
                "success": False,
                "error": str(e),
                "person_id": person_id
            }
    
    async def register_person_async(self, person_id: str, image: np.ndarray, bbox: List[float], facemesh_landmarks_5: Optional[List] = None) -> Dict:
        """Register person asynchronously using FaceMesh alignment"""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.register_person, person_id, image, bbox, facemesh_landmarks_5)
    
    def remove_person(self, person_id: str) -> Dict:
        """
        Remove person from database
        
        Args:
            person_id: Person to remove
            
        Returns:
            Removal result
        """
        try:
            if self.db_manager:
                remove_success = self.db_manager.remove_person(person_id)
                
                if remove_success:
                    stats = self.db_manager.get_stats()
                    total_persons = stats.get("total_persons", 0)
                    
                    logger.info(f"Removed person: {person_id}")
                    
                    return {
                        "success": True,
                        "person_id": person_id,
                        "database_saved": True,
                        "total_persons": total_persons
                    }
                else:
                    return {
                        "success": False,
                        "error": f"Person {person_id} not found in database",
                        "person_id": person_id
                    }
            else:
                return {
                    "success": False,
                    "error": "No database manager available",
                    "person_id": person_id
                }
                
        except Exception as e:
            logger.error(f"Person removal failed: {e}")
            return {
                "success": False,
                "error": str(e),
                "person_id": person_id
            }
    
    def get_all_persons(self) -> List[str]:
        """Get list of all registered persons"""
        if self.db_manager:
            all_persons = self.db_manager.get_all_persons()
            return list(all_persons.keys())
        return []

    def update_person_id(self, old_person_id: str, new_person_id: str) -> Dict:
        """Update a person's ID in the database"""
        try:
            if self.db_manager:
                updated_count = self.db_manager.update_person_id(old_person_id, new_person_id)
                if updated_count > 0:
                    return {
                        "success": True,
                        "message": f"Person '{old_person_id}' renamed to '{new_person_id}' successfully",
                        "updated_records": updated_count
                    }
                else:
                    return {
                        "success": False,
                        "error": f"Person '{old_person_id}' not found or '{new_person_id}' already exists",
                        "updated_records": 0
                    }
            else:
                return {
                    "success": False,
                    "error": "No database manager available",
                    "updated_records": 0
                }
                
        except Exception as e:
            logger.error(f"Person update failed: {e}")
            return {
                "success": False,
                "error": str(e),
                "updated_records": 0
            }

    def get_stats(self) -> Dict:
        """Get database statistics"""
        total_persons = 0
        total_embeddings = 0
        persons = []
        
        if self.db_manager:
            # Get basic stats
            stats = self.db_manager.get_stats()
            total_persons = stats.get("total_persons", 0)
            
            # Get total embeddings
            total_embeddings = self.db_manager.get_total_embeddings()
            
            # Get detailed person information
            persons = self.db_manager.get_all_persons_with_details()
            
        return {
            "total_persons": total_persons,
            "total_embeddings": total_embeddings,
            "persons": persons
        }
    
    def set_similarity_threshold(self, threshold: float):
        """Set similarity threshold for recognition"""
        self.similarity_threshold = threshold
        logger.info(f"Updated similarity threshold to: {threshold}")
    
    def clear_database(self) -> Dict:
        """Clear all persons from database"""
        try:
            if self.db_manager:
                clear_success = self.db_manager.clear_database()
                
                if clear_success:
                    logger.info("Cleared face database")
                    
                    return {
                        "success": True,
                        "database_saved": True,
                        "total_persons": 0
                    }
                else:
                    return {
                        "success": False,
                        "error": "Failed to clear database"
                    }
            else:
                return {
                    "success": False,
                    "error": "No database manager available"
                }
            
        except Exception as e:
            logger.error(f"Database clearing failed: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    def get_model_info(self) -> Dict:
        """Get model information"""
        return {
            "name": "EdgeFace",
            "model_path": self.model_path,
            "input_size": self.input_size,
            "embedding_dimension": self.EMBEDDING_DIM,
            "similarity_threshold": self.similarity_threshold,
            "providers": self.providers,
            "description": "EdgeFace recognition model for face identification",
            "version": "production",
            "supported_formats": ["jpg", "jpeg", "png", "bmp", "webp"],
            "requires_landmarks": False,
            "landmark_count": 0
        }