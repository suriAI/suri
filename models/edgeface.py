import cv2
import numpy as np
import onnxruntime
from typing import List, Optional, Tuple
from skimage.transform import SimilarityTransform

__all__ = ['EdgeFace']


# Reference facial landmarks for alignment
reference_alignment = np.array(
    [[
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [70.7299, 92.2041]
    ]],
    dtype=np.float32
)


class EdgeFace:
    """EdgeFace face recognition model with ONNX Runtime."""
    
    def __init__(self, model_path: str) -> None:
        """Initialize EdgeFace model.
        
        Args:
            model_path (str): Path to EdgeFace ONNX model file.
        """
        self.input_mean = 127.5
        self.input_std = 127.5
        self.taskname = "recognition"
        
        self._initialize_model(model_path)

    def _initialize_model(self, model_path: str):
        """Initialize the ONNX model from the given path."""
        try:
            self.session = onnxruntime.InferenceSession(
                model_path,
                providers=["CPUExecutionProvider"]  # CPU-only for performance consistency
            )
            
            input_cfg = self.session.get_inputs()[0]
            input_shape = input_cfg.shape
            input_name = input_cfg.name
            
            self.input_size = tuple(input_shape[2:4][::-1])
            self.input_shape = input_shape
            self.input_name = input_name
            
            outputs = self.session.get_outputs()
            output_names = [output.name for output in outputs]
            self.output_names = output_names
            
            assert len(self.output_names) == 1
            self.output_shape = outputs[0].shape
            
        except Exception as e:
            print(f"Failed to load EdgeFace model: {e}")
            raise

    def get_feat(self, images: np.ndarray) -> np.ndarray:
        """Extract features from aligned face images."""
        if not isinstance(images, list):
            images = [images]

        input_size = self.input_size
        blob = cv2.dnn.blobFromImages(
            images,
            1.0 / self.input_std,
            input_size,
            (self.input_mean, self.input_mean, self.input_mean),
            swapRB=True
        )
        outputs = self.session.run(self.output_names, {self.input_name: blob})[0]
        return outputs

    def __call__(self, image: np.ndarray, keypoints: np.ndarray) -> np.ndarray:
        """Extract face embedding from image using facial landmarks.
        
        Args:
            image (np.ndarray): Input image
            keypoints (np.ndarray): Facial landmarks (5 points)
            
        Returns:
            np.ndarray: Face embedding vector
        """
        aligned_image = self.norm_crop_image(image, keypoints)
        embedding = self.get_feat(aligned_image).flatten()
        # Normalize embedding
        embedding = embedding / np.linalg.norm(embedding)
        return embedding

    def norm_crop_image(self, image: np.ndarray, landmark: np.ndarray, image_size: int = 112) -> np.ndarray:
        """Normalize and crop face image using landmarks."""
        M, _ = self.estimate_norm(landmark, image_size)
        warped = cv2.warpAffine(image, M, (image_size, image_size), borderValue=0.0)
        return warped

    def estimate_norm(self, landmark: np.ndarray, image_size: int = 112) -> Tuple[np.ndarray, int]:
        """Estimate normalization transformation matrix for facial landmarks."""
        assert landmark.shape == (5, 2)
        min_matrix = []
        min_index = []
        min_error = float('inf')

        landmark_transform = np.insert(landmark, 2, values=np.ones(5), axis=1)
        transform = SimilarityTransform()

        if image_size == 112:
            alignment = reference_alignment
        else:
            alignment = float(image_size) / 112 * reference_alignment

        for i in np.arange(alignment.shape[0]):
            transform.estimate(landmark, alignment[i])
            matrix = transform.params[0:2, :]
            results = np.dot(matrix, landmark_transform.T)
            results = results.T
            error = np.sum(np.sqrt(np.sum((results - alignment[i]) ** 2, axis=1)))
            if error < min_error:
                min_error = error
                min_matrix = matrix
                min_index = i
        return min_matrix, min_index


class FaceDatabase:
    """Simple face database for storing and matching face embeddings."""
    
    def __init__(self, similarity_threshold: float = 0.6):
        """Initialize face database.
        
        Args:
            similarity_threshold (float): Threshold for face matching (0.6 = 60% similarity)
        """
        self.embeddings = {}  # person_id -> embedding
        self.similarity_threshold = similarity_threshold
        
    def add_person(self, person_id: str, embedding: np.ndarray):
        """Add a person's face embedding to the database."""
        self.embeddings[person_id] = embedding
        
    def identify_face(self, embedding: np.ndarray) -> Tuple[Optional[str], float]:
        """Identify a face by comparing with stored embeddings.
        
        Args:
            embedding (np.ndarray): Face embedding to identify
            
        Returns:
            Tuple[Optional[str], float]: (person_id, similarity_score) or (None, 0.0) if no match
        """
        if not self.embeddings:
            return None, 0.0
            
        best_match = None
        best_similarity = 0.0
        
        for person_id, stored_embedding in self.embeddings.items():
            # Calculate cosine similarity
            similarity = np.dot(embedding, stored_embedding)
            
            if similarity > best_similarity and similarity >= self.similarity_threshold:
                best_similarity = similarity
                best_match = person_id
                
        return best_match, best_similarity
        
    def get_all_persons(self) -> List[str]:
        """Get list of all registered persons."""
        return list(self.embeddings.keys())
        
    def remove_person(self, person_id: str) -> bool:
        """Remove a person from the database."""
        if person_id in self.embeddings:
            del self.embeddings[person_id]
            return True
        return False

