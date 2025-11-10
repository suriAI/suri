import asyncio
import logging
from typing import List, Dict, Tuple, Optional, Any
import os
import time

import cv2
import numpy as np
import onnxruntime as ort

from database.face import FaceDatabaseManager

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
        self.session_options = session_options

        self.INPUT_MEAN = 127.5
        self.INPUT_STD = 127.5
        self.EMBEDDING_DIM = 512

        self.session = None

        # Cache for persons to minimize database queries
        self._persons_cache = None
        self._cache_timestamp = 0
        self._cache_ttl = 1.0
        if self.database_path:
            # Convert .json extension to .db for SQLite
            if self.database_path.endswith(".json"):
                sqlite_path = self.database_path.replace(".json", ".db")
            else:
                sqlite_path = self.database_path

            self.db_manager = FaceDatabaseManager(sqlite_path)
        else:
            self.db_manager = None
            logger.warning("No database path provided, running without persistence")

        try:
            if not os.path.exists(self.model_path):
                raise FileNotFoundError(f"Model file not found: {self.model_path}")

            session_options = ort.SessionOptions()

            if self.session_options:
                for key, value in self.session_options.items():
                    if hasattr(session_options, key):
                        setattr(session_options, key, value)

            self.session = ort.InferenceSession(
                self.model_path, sess_options=session_options, providers=self.providers
            )

        except Exception as e:
            logger.error(f"Failed to initialize face recognizer model: {e}")
            raise

    def _align_face(self, image: np.ndarray, landmarks_5: List) -> np.ndarray:
        landmarks = np.array(landmarks_5, dtype=np.float32)
        aligned_face = self._create_aligned_face(image, landmarks)
        return aligned_face

    def _create_aligned_face(
        self, image: np.ndarray, landmarks: np.ndarray
    ) -> np.ndarray:
        """Align face using similarity transformation based on 5 landmarks."""
        try:
            reference_points = np.array(
                [
                    [38.2946, 51.6963],  # Left eye
                    [73.5318, 51.5014],  # Right eye
                    [56.0252, 71.7366],  # Nose tip
                    [41.5493, 92.3655],  # Left mouth corner
                    [70.7299, 92.2041],  # Right mouth corner
                ],
                dtype=np.float32,
            )

            src_points = landmarks.astype(np.float32)
            dst_points = reference_points.astype(np.float32)

            tform, _ = cv2.estimateAffinePartial2D(
                src_points,
                dst_points,
                method=cv2.LMEDS,
                maxIters=1,
                refineIters=0,
            )

            if tform is None:
                raise ValueError("Failed to compute similarity transformation matrix")

            # INTER_CUBIC: sharper images, better texture preservation, improves accuracy
            aligned_face = cv2.warpAffine(
                image,
                tform,
                self.input_size,
                flags=cv2.INTER_CUBIC,
                borderMode=cv2.BORDER_CONSTANT,
                borderValue=0,
            )

            return aligned_face

        except Exception as e:
            logger.error(f"Face alignment failed: {e}")
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
        try:
            rgb_image = cv2.cvtColor(aligned_face, cv2.COLOR_BGR2RGB)
            normalized = (
                rgb_image.astype(np.float32) - self.INPUT_MEAN
            ) / self.INPUT_STD
            input_tensor = np.transpose(normalized, (2, 0, 1))
            input_tensor = np.expand_dims(input_tensor, axis=0)

            return input_tensor

        except Exception as e:
            logger.error(f"Image preprocessing failed: {e}")
            raise

    def _extract_embedding(self, image: np.ndarray, landmarks_5: List) -> np.ndarray:
        try:
            aligned_face = self._align_face(image, landmarks_5)
            input_tensor = self._preprocess_image(aligned_face)
            feeds = {self.session.get_inputs()[0].name: input_tensor}
            outputs = self.session.run(None, feeds)
            embedding = outputs[0][0]

            # L2 normalization for cosine similarity
            norm = np.linalg.norm(embedding)
            if norm > 0:
                embedding = embedding / norm

            return embedding.astype(np.float32)

        except Exception as e:
            logger.error(f"Embedding extraction failed: {e}")
            raise

    def _extract_embeddings_batch(
        self, image: np.ndarray, face_data_list: List[Dict]
    ) -> List[np.ndarray]:
        """BATCH PROCESSING: Extract embeddings in single inference call"""
        try:
            if not face_data_list:
                return []

            aligned_faces = []

            for i, face_data in enumerate(face_data_list):
                try:
                    landmarks_5 = face_data.get("landmarks_5")
                    aligned_face = self._align_face(image, landmarks_5)
                    aligned_faces.append(aligned_face)
                except Exception as e:
                    logger.warning(f"Failed to align face {i}: {e}")
                    continue

            if not aligned_faces:
                return []

            batch_tensors = []
            for aligned_face in aligned_faces:
                rgb_image = cv2.cvtColor(aligned_face, cv2.COLOR_BGR2RGB)
                normalized = (
                    rgb_image.astype(np.float32) - self.INPUT_MEAN
                ) / self.INPUT_STD
                tensor = np.transpose(normalized, (2, 0, 1))
                batch_tensors.append(tensor)

            batch_input = np.stack(batch_tensors, axis=0)
            feeds = {self.session.get_inputs()[0].name: batch_input}
            outputs = self.session.run(None, feeds)

            embeddings = outputs[0]
            normalized_embeddings = []

            for embedding in embeddings:
                norm = np.linalg.norm(embedding)
                if norm > 0:
                    embedding = embedding / norm
                normalized_embeddings.append(embedding.astype(np.float32))

            return normalized_embeddings

        except Exception as e:
            logger.error(f"Batch embedding extraction failed: {e}")
            embeddings = []
            for face_data in face_data_list:
                try:
                    landmarks_5 = face_data.get("landmarks_5")
                    emb = self._extract_embedding(image, landmarks_5)
                    embeddings.append(emb)
                except Exception:
                    continue
            return embeddings

    def _calculate_similarity(
        self, embedding1: np.ndarray, embedding2: np.ndarray
    ) -> float:
        try:
            similarity = np.dot(embedding1, embedding2)
            return float(similarity)

        except Exception as e:
            logger.error(f"Similarity calculation failed: {e}")
            return 0.0

    def _find_best_match(
        self, embedding: np.ndarray, allowed_person_ids: Optional[List[str]] = None
    ) -> Tuple[Optional[str], float]:
        """OPTIMIZED: In-memory cache prevents database queries on every frame"""
        if not self.db_manager:
            return None, 0.0

        current_time = time.time()

        if (
            self._persons_cache is None
            or (current_time - self._cache_timestamp) > self._cache_ttl
        ):
            self._persons_cache = self.db_manager.get_all_persons()
            self._cache_timestamp = current_time

        all_persons = self._persons_cache

        if not all_persons:
            return None, 0.0

        if allowed_person_ids is not None:
            all_persons = {
                pid: emb
                for pid, emb in all_persons.items()
                if pid in allowed_person_ids
            }
            if not all_persons:
                return None, 0.0

        best_person_id = None
        best_similarity = 0.0

        for person_id, stored_embedding in all_persons.items():
            similarity = self._calculate_similarity(embedding, stored_embedding)

            if similarity > best_similarity:
                best_similarity = similarity
                best_person_id = person_id

        if best_similarity >= self.similarity_threshold:
            logger.info(
                f"Recognized: {best_person_id} (similarity: {best_similarity:.3f})"
            )
            return best_person_id, best_similarity
        else:
            return None, best_similarity

    def recognize_face(
        self,
        image: np.ndarray,
        bbox: List[float],
        landmarks_5: List,
        allowed_person_ids: Optional[List[str]] = None,
    ) -> Dict:
        try:
            embedding = self._extract_embedding(image, landmarks_5)
            person_id, similarity = self._find_best_match(embedding, allowed_person_ids)

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

    async def recognize_face_async(
        self,
        image: np.ndarray,
        bbox: List[float],
        landmarks_5: List,
        allowed_person_ids: Optional[List[str]] = None,
    ) -> Dict:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, self.recognize_face, image, bbox, landmarks_5, allowed_person_ids
        )

    def extract_embeddings_for_tracking(
        self, image: np.ndarray, face_detections: List[Dict]
    ) -> List[np.ndarray]:
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

    def register_person(
        self, person_id: str, image: np.ndarray, bbox: List[float], landmarks_5: List
    ) -> Dict:
        try:
            embedding = self._extract_embedding(image, landmarks_5)

            if self.db_manager:
                save_success = self.db_manager.add_person(person_id, embedding)
                stats = self.db_manager.get_stats()
                total_persons = stats.get("total_persons", 0)
                self._invalidate_cache()
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

    async def register_person_async(
        self, person_id: str, image: np.ndarray, bbox: List[float], landmarks_5: List
    ) -> Dict:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, self.register_person, person_id, image, bbox, landmarks_5
        )

    def remove_person(self, person_id: str) -> Dict:
        try:
            if self.db_manager:
                remove_success = self.db_manager.remove_person(person_id)

                if remove_success:
                    self._invalidate_cache()
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
        if self.db_manager:
            all_persons = self.db_manager.get_all_persons()
            return list(all_persons.keys())
        return []

    def update_person_id(self, old_person_id: str, new_person_id: str) -> Dict:
        try:
            if self.db_manager:
                updated_count = self.db_manager.update_person_id(
                    old_person_id, new_person_id
                )
                if updated_count > 0:
                    self._invalidate_cache()
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
        total_persons = 0
        persons = []

        if self.db_manager:
            stats = self.db_manager.get_stats()
            total_persons = stats.get("total_persons", 0)
            persons = self.db_manager.get_all_persons_with_details()

        return {"total_persons": total_persons, "persons": persons}

    def set_similarity_threshold(self, threshold: float):
        self.similarity_threshold = threshold

    def clear_database(self) -> Dict:
        try:
            if self.db_manager:
                clear_success = self.db_manager.clear_database()

                if clear_success:
                    self._invalidate_cache()
                    return {"success": True, "database_saved": True, "total_persons": 0}
                else:
                    return {"success": False, "error": "Failed to clear database"}
            else:
                return {"success": False, "error": "No database manager available"}

        except Exception as e:
            logger.error(f"Database clearing failed: {e}")
            return {"success": False, "error": str(e)}

    def _invalidate_cache(self):
        """Invalidate cache after database modifications"""
        self._persons_cache = None
        self._cache_timestamp = 0
