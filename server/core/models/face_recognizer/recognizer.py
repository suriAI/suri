import asyncio
import logging
import time
from typing import List, Dict, Tuple, Optional, Any

import numpy as np

from database.face import FaceDatabaseManager
from .session_utils import init_face_recognizer_session
from .preprocess import (
    align_face,
    preprocess_image,
    align_faces_batch,
    preprocess_batch,
)
from .postprocess import (
    normalize_embedding,
    normalize_embeddings_batch,
    find_best_match,
)

logger = logging.getLogger(__name__)


class FaceRecognizer:
    def __init__(
        self,
        model_path: str,
        input_size: Tuple[int, int],
        similarity_threshold: float,
        providers: Optional[List[str]],
        database_path: Optional[str],
        session_options: Optional[Dict[str, Any]],
    ):
        self.model_path = model_path
        self.input_size = input_size
        self.similarity_threshold = similarity_threshold
        self.providers = providers or ["CPUExecutionProvider"]
        self.database_path = database_path

        # Preprocessing constants
        self.INPUT_MEAN = 127.5
        self.INPUT_STD = 127.5
        self.EMBEDDING_DIM = 512

        # Session Layer: Initialize ONNX session
        self.session, self.input_name = init_face_recognizer_session(
            model_path, self.providers, session_options
        )

        # Database Layer: Initialize database manager
        if self.database_path:
            if self.database_path.endswith(".json"):
                sqlite_path = self.database_path.replace(".json", ".db")
            else:
                sqlite_path = self.database_path

            self.db_manager = FaceDatabaseManager(sqlite_path)
        else:
            self.db_manager = None
            logger.warning("No database path provided, running without persistence")

        # Cache Layer: Person database cache
        self._persons_cache = None
        self._cache_timestamp = 0
        self._cache_ttl = 1.0

    def _extract_embedding(self, image: np.ndarray, landmarks_5: List) -> np.ndarray:
        """
        Extract embedding from a single face.

        Pipeline: Align -> Preprocess -> Infer -> Normalize
        """
        landmarks = np.array(landmarks_5, dtype=np.float32)

        # Preprocessing Layer: Align and preprocess
        aligned_face = align_face(image, landmarks, self.input_size)
        input_tensor = preprocess_image(
            aligned_face, self.INPUT_MEAN, self.INPUT_STD
        )

        # Inference Layer: Run model
        feeds = {self.input_name: input_tensor}
        outputs = self.session.run(None, feeds)
        embedding = outputs[0][0]

        # Postprocessing Layer: Normalize embedding
        return normalize_embedding(embedding)

    def _extract_embeddings_batch(
        self, image: np.ndarray, face_data_list: List[Dict]
    ) -> List[np.ndarray]:
        """
        Extract embeddings for multiple faces in batch.

        Pipeline: Batch Align -> Batch Preprocess -> Batch Infer -> Batch Normalize
        """
        if not face_data_list:
            return []

        # Preprocessing Layer: Batch alignment
        aligned_faces = align_faces_batch(image, face_data_list, self.input_size)

        if not aligned_faces:
            return []

        # Preprocessing Layer: Batch preprocessing
        batch_input = preprocess_batch(
            aligned_faces, self.INPUT_MEAN, self.INPUT_STD
        )

        # Inference Layer: Batch inference
        feeds = {self.input_name: batch_input}
        outputs = self.session.run(None, feeds)
        embeddings = outputs[0]

        # Postprocessing Layer: Batch normalization
        return normalize_embeddings_batch(embeddings)

    def _get_database(self) -> Dict[str, np.ndarray]:
        """
        Get person database with caching.

        Returns:
            Dictionary mapping person_id to embedding
        """
        current_time = time.time()

        if (
            self._persons_cache is None
            or (current_time - self._cache_timestamp) > self._cache_ttl
        ):
            if self.db_manager:
                self._persons_cache = self.db_manager.get_all_persons()
            else:
                self._persons_cache = {}
            self._cache_timestamp = current_time

        return self._persons_cache

    def _find_best_match(
        self, embedding: np.ndarray, allowed_person_ids: Optional[List[str]] = None
    ) -> Tuple[Optional[str], float]:
        """
        Find best matching person using cached database.

        Uses Postprocessing Layer for similarity matching.
        """
        if not self.db_manager:
            return None, 0.0

        database = self._get_database()

        if not database:
            return None, 0.0

        # Postprocessing Layer: Find best match
        return find_best_match(
            embedding, database, self.similarity_threshold, allowed_person_ids
        )

    def _refresh_cache(self):
        """Refresh cache after database modifications"""
        if self.db_manager:
            self._persons_cache = self.db_manager.get_all_persons()
            self._cache_timestamp = time.time()
        else:
            self._persons_cache = None
            self._cache_timestamp = 0

    async def recognize_face(
        self,
        image: np.ndarray,
        landmarks_5: List,
        allowed_person_ids: Optional[List[str]] = None,
    ) -> Dict:
        """Async wrapper for face recognition"""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, self._recognize_face_sync, image, landmarks_5, allowed_person_ids
        )

    def _recognize_face_sync(
        self,
        image: np.ndarray,
        landmarks_5: List,
        allowed_person_ids: Optional[List[str]] = None,
    ) -> Dict:
        """
        Synchronous face recognition.

        Full pipeline: Extract Embedding -> Find Match -> Return Result
        """
        try:
            embedding = self._extract_embedding(image, landmarks_5)
            person_id, similarity = self._find_best_match(embedding, allowed_person_ids)

            if person_id:
                logger.info(
                    f"Recognized: {person_id} (similarity: {similarity:.3f})"
                )

            return {
                "person_id": person_id,
                "similarity": similarity,
                "success": True,
            }

        except Exception as e:
            logger.error(f"Face recognition error: {e}")
            return {
                "person_id": None,
                "similarity": 0.0,
                "success": False,
                "error": str(e),
            }

    async def register_person(
        self, person_id: str, image: np.ndarray, landmarks_5: List
    ) -> Dict:
        """Async wrapper for person registration"""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, self._register_person_sync, person_id, image, landmarks_5
        )

    def _register_person_sync(
        self, person_id: str, image: np.ndarray, landmarks_5: List
    ) -> Dict:
        """
        Register a new person in the database.

        Pipeline: Extract Embedding -> Save to Database -> Refresh Cache
        """
        try:
            embedding = self._extract_embedding(image, landmarks_5)

            if self.db_manager:
                save_success = self.db_manager.add_person(person_id, embedding)
                stats = self.db_manager.get_stats()
                total_persons = stats.get("total_persons", 0)
                self._refresh_cache()
            else:
                save_success = False
                total_persons = 0
                logger.warning("No database manager available for registration")

            return {
                "success": True,
                "person_id": person_id,
                "database_saved": save_success,
                "total_persons": total_persons,
            }

        except Exception as e:
            logger.error(f"Person registration failed: {e}")
            return {"success": False, "error": str(e), "person_id": person_id}

    def extract_embeddings_for_tracking(
        self, image: np.ndarray, face_detections: List[Dict]
    ) -> List[np.ndarray]:
        """
        Extract embeddings for face tracking.

        Used by face tracker to get appearance features.
        """
        try:
            if not face_detections:
                return []

            face_data_list = []
            for face in face_detections:
                bbox = face.get("bbox")

                if isinstance(bbox, dict):
                    bbox_list = [
                        bbox.get("x", 0),
                        bbox.get("y", 0),
                        bbox.get("width", 0),
                        bbox.get("height", 0),
                    ]
                elif isinstance(bbox, (list, tuple)):
                    bbox_list = list(bbox[:4])
                else:
                    logger.warning(f"Invalid bbox format: {bbox}")
                    continue

                face_data = {"bbox": bbox_list}

                if "landmarks_5" in face:
                    face_data["landmarks_5"] = face["landmarks_5"]

                face_data_list.append(face_data)

            embeddings = self._extract_embeddings_batch(image, face_data_list)

            return embeddings

        except Exception as e:
            logger.error(f"Embedding extraction for tracking failed: {e}")
            return []

    def remove_person(self, person_id: str) -> Dict:
        """Remove a person from the database"""
        try:
            if self.db_manager:
                remove_success = self.db_manager.remove_person(person_id)

                if remove_success:
                    self._refresh_cache()
                    stats = self.db_manager.get_stats()
                    total_persons = stats.get("total_persons", 0)

                    return {
                        "success": True,
                        "person_id": person_id,
                        "database_saved": True,
                        "total_persons": total_persons,
                    }
                else:
                    return {
                        "success": False,
                        "error": f"Person {person_id} not found in database",
                        "person_id": person_id,
                    }
            else:
                return {
                    "success": False,
                    "error": "No database manager available",
                    "person_id": person_id,
                }

        except Exception as e:
            logger.error(f"Person removal failed: {e}")
            return {"success": False, "error": str(e), "person_id": person_id}

    def get_all_persons(self) -> List[str]:
        """Get list of all registered person IDs"""
        if self.db_manager:
            all_persons = self.db_manager.get_all_persons()
            return list(all_persons.keys())
        return []

    def update_person_id(self, old_person_id: str, new_person_id: str) -> Dict:
        """Update a person's ID in the database"""
        try:
            if self.db_manager:
                updated_count = self.db_manager.update_person_id(
                    old_person_id, new_person_id
                )
                if updated_count > 0:
                    self._refresh_cache()
                    return {
                        "success": True,
                        "message": f"Person '{old_person_id}' renamed to '{new_person_id}' successfully",
                        "updated_records": updated_count,
                    }
                else:
                    return {
                        "success": False,
                        "error": f"Person '{old_person_id}' not found or '{new_person_id}' already exists",
                        "updated_records": 0,
                    }
            else:
                return {
                    "success": False,
                    "error": "No database manager available",
                    "updated_records": 0,
                }

        except Exception as e:
            logger.error(f"Person update failed: {e}")
            return {"success": False, "error": str(e), "updated_records": 0}

    def get_stats(self) -> Dict:
        """Get face recognition statistics"""
        total_persons = 0
        persons = []

        if self.db_manager:
            stats = self.db_manager.get_stats()
            total_persons = stats.get("total_persons", 0)
            persons = self.db_manager.get_all_persons_with_details()

        return {"total_persons": total_persons, "persons": persons}

    def set_similarity_threshold(self, threshold: float):
        """Update similarity threshold for recognition"""
        self.similarity_threshold = threshold

    def clear_database(self) -> Dict:
        """Clear all persons from the database"""
        try:
            if self.db_manager:
                clear_success = self.db_manager.clear_database()

                if clear_success:
                    self._refresh_cache()
                    return {"success": True, "database_saved": True, "total_persons": 0}
                else:
                    return {"success": False, "error": "Failed to clear database"}
            else:
                return {"success": False, "error": "No database manager available"}

        except Exception as e:
            logger.error(f"Database clearing failed: {e}")
            return {"success": False, "error": str(e)}

    def _invalidate_cache(self):
        """Invalidate cache without refreshing"""
        self._persons_cache = None
        self._cache_timestamp = 0

