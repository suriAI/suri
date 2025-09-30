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
        enable_temporal_smoothing: bool = True,  # Enabled by default for stability
        recognition_smoothing_factor: float = 0.3,  # Reduced for faster response
        recognition_hysteresis_margin: float = 0.05,  # Reduced for less strict switching
        min_consecutive_recognitions: int = 1,  # Reduced to 1 for immediate recognition
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
            enable_temporal_smoothing: Enable temporal smoothing for recognition stability
            recognition_smoothing_factor: Smoothing factor for recognition results
            recognition_hysteresis_margin: Margin for recognition stability
            min_consecutive_recognitions: Minimum consecutive recognitions for new person
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
        
        # Temporal smoothing parameters
        self.enable_temporal_smoothing = enable_temporal_smoothing
        self.recognition_smoothing_factor = recognition_smoothing_factor
        self.recognition_hysteresis_margin = recognition_hysteresis_margin
        self.min_consecutive_recognitions = min_consecutive_recognitions
        
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
        
        # Temporal smoothing tracking (only if enabled)
        if self.enable_temporal_smoothing:
            self.recognition_history = {}  # face_id -> list of recent recognition results
            self.max_history = 3  # Reduced from 5 to 3 for faster response
            self.consecutive_recognitions = {}  # face_id -> count of consecutive recognitions
        
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
    
    
    def _align_face(self, image: np.ndarray, bbox: List[float]) -> np.ndarray:
        """
        Align face using FaceMesh detector for high-quality alignment
        
        Args:
            image: Input image
            bbox: Face bounding box [x, y, width, height] for FaceMesh (required)
            
        Returns:
            Aligned face crop (112x112)
        """
        # Use FaceMesh alignment (required)
        if self.facemesh_alignment and self.facemesh_detector is not None:
            # Convert bbox from [x, y, width, height] to [x1, y1, x2, y2] format for FaceMesh
            x, y, width, height = bbox
            facemesh_bbox = [x, y, x + width, y + height]
            
            # Get FaceMesh landmarks
            facemesh_result = self.facemesh_detector.detect_landmarks(image, facemesh_bbox)
            if facemesh_result['success'] and facemesh_result['landmarks_5']:
                # Use FaceMesh-derived 5-point landmarks for alignment
                facemesh_landmarks = np.array(facemesh_result['landmarks_5'], dtype=np.float32)
                
                # Create aligned face using FaceMesh landmarks and similarity transform
                aligned_face = self._create_aligned_face(image, facemesh_landmarks)
                logger.debug("Using FaceMesh landmarks for alignment")
                return aligned_face
            else:
                raise ValueError("FaceMesh detection failed - unable to detect landmarks")
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
    
    def _extract_embedding(self, image: np.ndarray, bbox: List[float]) -> np.ndarray:
        """
        Extract face embedding from image using FaceMesh alignment
        
        Args:
            image: Input image
            bbox: Bounding box [x, y, width, height] from face detection (required)
            
        Returns:
            Normalized face embedding (512-dim)
        """
        try:
            # Align face using FaceMesh
            aligned_face = self._align_face(image, bbox)
            
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
    
    def recognize_face(self, image: np.ndarray, bbox: List[float]) -> Dict:
        """
        Recognize face in image using FaceMesh alignment (synchronous)
        
        Args:
            image: Input image as numpy array (BGR format)
            bbox: Bounding box [x, y, width, height] from face detection (required)
            
        Returns:
            Recognition result with person_id and similarity
        """
        try:
            # Extract embedding using FaceMesh alignment
            embedding = self._extract_embedding(image, bbox)
            
            # Find best match
            person_id, similarity = self._find_best_match(embedding)
            
            # Apply temporal smoothing if enabled
            if self.enable_temporal_smoothing:
                # Generate stable face ID from bbox for temporal smoothing
                stable_face_id = f"bbox_{bbox[0]:.1f}_{bbox[1]:.1f}_{bbox[2]:.1f}_{bbox[3]:.1f}"
                person_id, similarity = self._apply_recognition_temporal_smoothing(
                    stable_face_id, person_id, similarity
                )
            
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
    
    async def recognize_face_async(self, image: np.ndarray, bbox: List[float]) -> Dict:
        """
        Recognize face in image using FaceMesh alignment (asynchronous)
        
        Args:
            image: Input image as numpy array (BGR format)
            bbox: Bounding box [x, y, width, height] from face detection (required)
            
        Returns:
            Recognition result with person_id and similarity
        """
        # Run recognition in thread pool to avoid blocking
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.recognize_face, image, bbox)
    
    def register_person(self, person_id: str, image: np.ndarray, bbox: List[float]) -> Dict:
        """
        Register a new person in the database using FaceMesh alignment
        
        Args:
            person_id: Unique identifier for the person
            image: Input image
            bbox: Bounding box [x, y, width, height] from face detection (required)
            
        Returns:
            Registration result
        """
        try:
            # Extract embedding using FaceMesh alignment
            embedding = self._extract_embedding(image, bbox)
            
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
    
    async def register_person_async(self, person_id: str, image: np.ndarray, bbox: List[float]) -> Dict:
        """Register person asynchronously using FaceMesh alignment"""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.register_person, person_id, image, bbox)
    
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
    
    def _generate_stable_face_id(self, landmarks: np.ndarray) -> str:
        """Generate a stable face ID based on landmark positions for temporal tracking"""
        try:
            if landmarks is not None and len(landmarks) >= 2:
                # Use eye positions for stable tracking (most reliable landmarks)
                left_eye = landmarks[0]
                right_eye = landmarks[1]
                
                # Calculate center point and eye distance for stable tracking
                center_x = (left_eye[0] + right_eye[0]) / 2
                center_y = (left_eye[1] + right_eye[1]) / 2
                eye_distance = np.linalg.norm(right_eye - left_eye)
                
                # Use grid-based approach for stable ID generation
                grid_size = 20  # Grid size for position quantization
                size_grid = 10  # Grid size for scale quantization
                
                # Create a hash based on center position and scale
                grid_x = int(center_x // grid_size)
                grid_y = int(center_y // grid_size)
                grid_scale = int(eye_distance // size_grid)
                
                return f"face_{grid_x}_{grid_y}_{grid_scale}"
            else:
                # Fallback for invalid landmarks
                return f"face_unknown_{hash(str(landmarks)) % 10000}"
        except Exception as e:
            logger.warning(f"Error generating stable face ID: {e}")
            return f"face_error_{hash(str(landmarks)) % 10000}"

    def _apply_recognition_temporal_smoothing(self, face_id: str, person_id: Optional[str], similarity: float) -> Tuple[Optional[str], float]:
        """Apply temporal smoothing to recognition results for stability"""
        if not self.enable_temporal_smoothing:
            return person_id, similarity
        
        try:
            # Initialize history if not exists
            if face_id not in self.recognition_history:
                self.recognition_history[face_id] = []
                self.consecutive_recognitions[face_id] = {}
            
            # Add current result to history
            self.recognition_history[face_id].append({
                'person_id': person_id,
                'similarity': similarity,
                'timestamp': time.time()
            })
            
            # Keep only recent history
            if len(self.recognition_history[face_id]) > self.max_history:
                self.recognition_history[face_id] = self.recognition_history[face_id][-self.max_history:]
            
            # Apply smoothing if we have previous results
            if len(self.recognition_history[face_id]) > 1:
                # Count consecutive recognitions for each person
                recent_results = self.recognition_history[face_id]
                person_counts = {}
                
                for result in recent_results:
                    pid = result['person_id']
                    if pid is not None:
                        person_counts[pid] = person_counts.get(pid, 0) + 1
                
                # Find most frequent person in recent history
                if person_counts:
                    most_frequent_person = max(person_counts.items(), key=lambda x: x[1])
                    most_frequent_id, count = most_frequent_person
                    
                    # Simple majority voting with immediate response (min_consecutive = 1)
                    if person_id == most_frequent_id and count >= self.min_consecutive_recognitions:
                        # Current recognition matches most frequent, apply similarity smoothing
                        similarities = [r['similarity'] for r in recent_results if r['person_id'] == person_id]
                        if len(similarities) > 1:
                            # Weighted average with more weight on recent results
                            weights = np.linspace(0.5, 1.0, len(similarities))
                            smoothed_similarity = np.average(similarities, weights=weights)
                            
                            # Blend current with smoothed (less aggressive smoothing)
                            final_similarity = (
                                similarity * (1 - self.recognition_smoothing_factor) +
                                smoothed_similarity * self.recognition_smoothing_factor
                            )
                            
                            logger.debug(f"Face {face_id}: Similarity smoothed {similarity:.3f} -> {final_similarity:.3f}")
                            return person_id, final_similarity
                    
                    # Handle switching between persons with hysteresis
                    elif person_id is not None and most_frequent_id != person_id:
                        # Only apply hysteresis if we have enough history
                        if len(recent_results) >= 2:
                            prev_result = recent_results[-2]
                            # If switching from a recognized person, require higher confidence
                            if prev_result['person_id'] is not None:
                                required_similarity = self.similarity_threshold + self.recognition_hysteresis_margin
                                if similarity >= required_similarity:
                                    return person_id, similarity  # Allow switch with high confidence
                                else:
                                    # Stay with most frequent if current confidence is low
                                    return most_frequent_id, np.mean([r['similarity'] for r in recent_results if r['person_id'] == most_frequent_id])
                    
                    # Default: use most frequent person if it has enough occurrences
                    elif most_frequent_id is not None and count >= self.min_consecutive_recognitions:
                        similarities = [r['similarity'] for r in recent_results if r['person_id'] == most_frequent_id]
                        avg_similarity = np.mean(similarities) if similarities else similarity
                        return most_frequent_id, avg_similarity
            
            # Return original result if no smoothing applied
            return person_id, similarity
            
        except Exception as e:
            logger.error(f"Error applying recognition temporal smoothing: {e}")
            return person_id, similarity
    
    def clear_temporal_cache(self):
        """Clear all temporal smoothing cache"""
        if self.enable_temporal_smoothing:
            self.recognition_history.clear()
            self.consecutive_recognitions.clear()
            logger.info("Recognition temporal cache cleared")

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