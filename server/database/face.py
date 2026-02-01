"""
Unified Database Manager for Face Recognition System

This module provides a bridge between the legacy FaceDatabaseManager API
and the new SQLAlchemy-based unified database.
"""

import os
import sqlite3
import numpy as np
import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

from database.session import AsyncSessionLocal
from database.repository import FaceRepository

logger = logging.getLogger(__name__)


class FaceDatabaseManager:
    """Async wrapper for Face database operations using SQLAlchemy"""

    def __init__(self, legacy_database_path: Optional[str] = None, organization_id: Optional[str] = None):
        """
        Initialize the database manager.

        Args:
            legacy_database_path: Path to the old SQLite face.db for migration.
            organization_id: Optional organization ID for multi-tenant isolation.
        """
        self.legacy_path = Path(legacy_database_path) if legacy_database_path else None
        self.organization_id = organization_id

        # Trigger migration in background or wait for it?
        # For a desktop app, we'll do it on first access or during startup check.
        # Here we just ensure we can connect.

    def _embedding_to_blob(self, embedding: np.ndarray) -> bytes:
        """Convert numpy embedding to binary blob"""
        return embedding.astype(np.float32).tobytes()

    def _blob_to_embedding(self, blob: bytes) -> np.ndarray:
        """Convert binary blob back to numpy embedding"""
        return np.frombuffer(blob, dtype=np.float32)

    async def add_person(
        self, person_id: str, embedding: np.ndarray, image_hash: Optional[str] = None
    ) -> bool:
        """Add or update a person's face embedding"""
        try:
            async with AsyncSessionLocal() as session:
                repo = FaceRepository(session, self.organization_id)
                embedding_blob = self._embedding_to_blob(embedding)
                await repo.upsert_face(
                    person_id, embedding_blob, len(embedding), image_hash
                )
                return True
        except Exception as e:
            logger.error(f"Failed to add person {person_id}: {e}")
            return False

    async def get_person(self, person_id: str) -> Optional[np.ndarray]:
        """Get a person's face embedding"""
        try:
            async with AsyncSessionLocal() as session:
                repo = FaceRepository(session, self.organization_id)
                face = await repo.get_face(person_id)
                if face:
                    return self._blob_to_embedding(face.embedding)
                return None
        except Exception as e:
            logger.error(f"Failed to get person {person_id}: {e}")
            return None

    async def remove_person(self, person_id: str) -> bool:
        """Remove a person from the database"""
        try:
            async with AsyncSessionLocal() as session:
                repo = FaceRepository(session, self.organization_id)
                return await repo.remove_face(person_id)
        except Exception as e:
            logger.error(f"Failed to remove person {person_id}: {e}")
            return False

    async def get_all_persons(self) -> Dict[str, np.ndarray]:
        """Get all persons and their embeddings"""
        try:
            async with AsyncSessionLocal() as session:
                repo = FaceRepository(session, self.organization_id)
                faces = await repo.get_all_faces()
                return {
                    f.person_id: self._blob_to_embedding(f.embedding) for f in faces
                }
        except Exception as e:
            logger.error(f"Failed to get all persons: {e}")
            return {}

    async def list_persons(self) -> List[str]:
        """Get list of all person IDs"""
        try:
            async with AsyncSessionLocal() as session:
                repo = FaceRepository(session, self.organization_id)
                faces = await repo.get_all_faces()
                return [f.person_id for f in faces]
        except Exception as e:
            logger.error(f"Failed to list persons: {e}")
            return []

    async def clear_database(self) -> bool:
        """Clear all persons from the database"""
        try:
            async with AsyncSessionLocal() as session:
                repo = FaceRepository(session, self.organization_id)
                return await repo.clear_faces()
        except Exception as e:
            logger.error(f"Failed to clear database: {e}")
            return False

    async def get_stats(self) -> Dict[str, Any]:
        """Get database statistics"""
        try:
            async with AsyncSessionLocal() as session:
                repo = FaceRepository(session, self.organization_id)
                stats = await repo.get_stats()
                return {
                    "total_persons": stats["total_faces"],
                    "database_type": "unified_sqlalchemy",
                }
        except Exception as e:
            logger.error(f"Failed to get database stats: {e}")
            return {"total_persons": 0}

    async def get_all_persons_with_details(self) -> List[Dict[str, Any]]:
        """Get all persons with detailed information"""
        try:
            async with AsyncSessionLocal() as session:
                repo = FaceRepository(session, self.organization_id)
                faces = await repo.get_all_faces()
                return [
                    {
                        "person_id": f.person_id,
                        "embedding_count": 1,  # Unified schema is 1 per person for now
                        "last_seen": (
                            f.last_modified_at.isoformat()
                            if f.last_modified_at
                            else None
                        ),
                    }
                    for f in faces
                ]
        except Exception as e:
            logger.error(f"Failed to get persons with details: {e}")
            return []

    async def update_person_id(self, old_person_id: str, new_person_id: str) -> int:
        """Update a person's ID in the database"""
        try:
            async with AsyncSessionLocal() as session:
                repo = FaceRepository(session, self.organization_id)
                success = await repo.update_person_id(old_person_id, new_person_id)
                return 1 if success else 0
        except Exception as e:
            logger.error(f"Failed to update person ID: {e}")
            return 0

    async def migrate_legacy_data(self) -> Tuple[bool, str]:
        """Migrate data from legacy face.db to matching SQLAlchemy model"""
        if not self.legacy_path or not self.legacy_path.exists():
            return False, "No legacy database found"

        try:
            logger.info(f"Starting legacy migration from {self.legacy_path}")

            # Connect to legacy SQLite
            conn = sqlite3.connect(str(self.legacy_path))
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            cursor.execute(
                "SELECT person_id, embedding, embedding_dimension FROM faces"
            )
            rows = cursor.fetchall()

            migrated_count = 0
            async with AsyncSessionLocal() as session:
                repo = FaceRepository(session, self.organization_id)
                for row in rows:
                    await repo.upsert_face(
                        row["person_id"], row["embedding"], row["embedding_dimension"]
                    )
                    migrated_count += 1

            conn.close()

            # Archive legacy database
            backup_path = self.legacy_path.with_suffix(".db.bak")
            os.replace(self.legacy_path, backup_path)

            return True, f"Migrated {migrated_count} records from legacy database."

        except Exception as e:
            logger.error(f"Migration failed: {e}")
            return False, f"Migration failed: {str(e)}"

    def close(self):
        pass
