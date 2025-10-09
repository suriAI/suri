"""
SQLite Database Manager for Face Recognition System

This module provides a SQLite-based database manager for storing and retrieving
face embeddings, replacing the JSON-based storage system.
"""

import sqlite3
import json
import numpy as np
import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any
from contextlib import contextmanager
import threading

logger = logging.getLogger(__name__)


class FaceDatabaseManager:
    """SQLite-based face database manager for storing face embeddings"""
    
    def __init__(self, database_path: str):
        """
        Initialize the database manager
        
        Args:
            database_path: Path to the SQLite database file
        """
        self.database_path = Path(database_path)
        self.lock = threading.Lock()
        
        # Ensure directory exists
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Initialize database
        self._initialize_database()
        
    def _initialize_database(self):
        """Initialize the database schema"""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                
                # Create faces table
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS faces (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        person_id TEXT UNIQUE NOT NULL,
                        embedding BLOB NOT NULL,
                        embedding_dimension INTEGER NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                
                # Create index for faster lookups
                cursor.execute("""
                    CREATE INDEX IF NOT EXISTS idx_person_id ON faces(person_id)
                """)
                
                # Create trigger to update updated_at timestamp
                cursor.execute("""
                    CREATE TRIGGER IF NOT EXISTS update_faces_timestamp 
                    AFTER UPDATE ON faces
                    BEGIN
                        UPDATE faces SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
                    END
                """)
                
                conn.commit()
                
        except Exception as e:
            logger.error(f"Failed to initialize database: {e}")
            raise
    
    @contextmanager
    def _get_connection(self):
        """Get a database connection with proper error handling"""
        conn = None
        try:
            conn = sqlite3.connect(
                self.database_path,
                timeout=30.0,  # 30 second timeout
                check_same_thread=False
            )
            conn.row_factory = sqlite3.Row  # Enable column access by name
            yield conn
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Database connection error: {e}")
            raise
        finally:
            if conn:
                conn.close()
    
    def _embedding_to_blob(self, embedding: np.ndarray) -> bytes:
        """Convert numpy embedding to binary blob"""
        return embedding.astype(np.float32).tobytes()
    
    def _blob_to_embedding(self, blob: bytes) -> np.ndarray:
        """Convert binary blob back to numpy embedding"""
        return np.frombuffer(blob, dtype=np.float32)
    
    def add_person(self, person_id: str, embedding: np.ndarray) -> bool:
        """
        Add or update a person's face embedding
        
        Args:
            person_id: Unique identifier for the person
            embedding: Face embedding as numpy array
            
        Returns:
            bool: True if successful, False otherwise
        """
        try:
            with self.lock:
                with self._get_connection() as conn:
                    cursor = conn.cursor()
                    
                    embedding_blob = self._embedding_to_blob(embedding)
                    embedding_dim = len(embedding)
                    
                    # Use INSERT OR REPLACE to handle both new and existing persons
                    cursor.execute("""
                        INSERT OR REPLACE INTO faces (person_id, embedding, embedding_dimension)
                        VALUES (?, ?, ?)
                    """, (person_id, embedding_blob, embedding_dim))
                    
                    conn.commit()
                    return True
                    
        except Exception as e:
            logger.error(f"Failed to add person {person_id}: {e}")
            return False
    
    def get_person(self, person_id: str) -> Optional[np.ndarray]:
        """
        Get a person's face embedding
        
        Args:
            person_id: Unique identifier for the person
            
        Returns:
            numpy.ndarray or None: Face embedding if found, None otherwise
        """
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                
                cursor.execute("""
                    SELECT embedding FROM faces WHERE person_id = ?
                """, (person_id,))
                
                row = cursor.fetchone()
                if row:
                    return self._blob_to_embedding(row['embedding'])
                return None
                
        except Exception as e:
            logger.error(f"Failed to get person {person_id}: {e}")
            return None
    
    def remove_person(self, person_id: str) -> bool:
        """
        Remove a person from the database
        
        Args:
            person_id: Unique identifier for the person
            
        Returns:
            bool: True if person was removed, False if not found or error
        """
        try:
            with self.lock:
                with self._get_connection() as conn:
                    cursor = conn.cursor()
                    
                    cursor.execute("""
                        DELETE FROM faces WHERE person_id = ?
                    """, (person_id,))
                    
                    conn.commit()
                    
                    if cursor.rowcount > 0:
                        return True
                    else:
                        logger.warning(f"Person not found: {person_id}")
                        return False
                        
        except Exception as e:
            logger.error(f"Failed to remove person {person_id}: {e}")
            return False
    
    def get_all_persons(self) -> Dict[str, np.ndarray]:
        """
        Get all persons and their embeddings
        
        Returns:
            Dict[str, np.ndarray]: Dictionary mapping person_id to embedding
        """
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                
                cursor.execute("""
                    SELECT person_id, embedding FROM faces ORDER BY person_id
                """)
                
                result = {}
                for row in cursor.fetchall():
                    person_id = row['person_id']
                    embedding = self._blob_to_embedding(row['embedding'])
                    result[person_id] = embedding
                
                return result
                
        except Exception as e:
            logger.error(f"Failed to get all persons: {e}")
            return {}
    
    def list_persons(self) -> List[str]:
        """
        Get list of all person IDs
        
        Returns:
            List[str]: List of person IDs
        """
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                
                cursor.execute("""
                    SELECT person_id FROM faces ORDER BY person_id
                """)
                
                return [row['person_id'] for row in cursor.fetchall()]
                
        except Exception as e:
            logger.error(f"Failed to list persons: {e}")
            return []
    
    def clear_database(self) -> bool:
        """
        Clear all persons from the database
        
        Returns:
            bool: True if successful, False otherwise
        """
        try:
            with self.lock:
                with self._get_connection() as conn:
                    cursor = conn.cursor()
                    
                    cursor.execute("DELETE FROM faces")
                    conn.commit()
                    
                    return True
                    
        except Exception as e:
            logger.error(f"Failed to clear database: {e}")
            return False
    
    def get_stats(self) -> Dict[str, Any]:
        """
        Get database statistics
        
        Returns:
            Dict[str, Any]: Database statistics
        """
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                
                # Get total count
                cursor.execute("SELECT COUNT(*) as total FROM faces")
                total_count = cursor.fetchone()['total']
                
                # Get database file size
                db_size = self.database_path.stat().st_size if self.database_path.exists() else 0
                
                return {
                    "total_persons": total_count,
                    "database_path": str(self.database_path),
                    "database_size_bytes": db_size,
                    "database_size_mb": round(db_size / (1024 * 1024), 2)
                }
                
        except Exception as e:
            logger.error(f"Failed to get database stats: {e}")
            return {
                "total_persons": 0,
                "database_path": str(self.database_path),
                "database_size_bytes": 0,
                "database_size_mb": 0.0
            }
    
    def migrate_from_json(self, json_path: str) -> Tuple[bool, str]:
        """
        Migrate data from JSON file to SQLite database
        
        Args:
            json_path: Path to the JSON file
            
        Returns:
            Tuple[bool, str]: (Success status, message)
        """
        try:
            json_file = Path(json_path)
            if not json_file.exists():
                return False, f"JSON file not found: {json_path}"
            
            # Load JSON data
            with open(json_file, 'r') as f:
                data = json.load(f)
            
            if not isinstance(data, dict):
                return False, "Invalid JSON format: expected dictionary"
            
            # Migrate each person
            migrated_count = 0
            failed_count = 0
            
            with self.lock:
                with self._get_connection() as conn:
                    cursor = conn.cursor()
                    
                    for person_id, embedding_list in data.items():
                        try:
                            # Convert list to numpy array
                            embedding = np.array(embedding_list, dtype=np.float32)
                            embedding_blob = self._embedding_to_blob(embedding)
                            embedding_dim = len(embedding)
                            
                            cursor.execute("""
                                INSERT OR REPLACE INTO faces (person_id, embedding, embedding_dimension)
                                VALUES (?, ?, ?)
                            """, (person_id, embedding_blob, embedding_dim))
                            
                            migrated_count += 1
                            
                        except Exception as e:
                            logger.error(f"Failed to migrate person {person_id}: {e}")
                            failed_count += 1
                    
                    conn.commit()
            
            message = f"Migration completed: {migrated_count} persons migrated"
            if failed_count > 0:
                message += f", {failed_count} failed"
            
            return True, message
            
        except Exception as e:
            error_msg = f"Migration failed: {e}"
            logger.error(error_msg)
            return False, error_msg
    
    def get_all_persons_with_details(self) -> List[Dict[str, Any]]:
        """
        Get all persons with detailed information including embedding counts and last seen
        
        Returns:
            List[Dict[str, Any]]: List of person details with person_id, embedding_count, and last_seen
        """
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                
                # Get all persons with their embedding counts and last seen timestamps
                cursor.execute("""
                    SELECT 
                        person_id,
                        COUNT(*) as embedding_count,
                        MAX(updated_at) as last_seen
                    FROM faces 
                    GROUP BY person_id
                    ORDER BY last_seen DESC
                """)
                
                results = cursor.fetchall()
                
                persons = []
                for row in results:
                    persons.append({
                        "person_id": row["person_id"],
                        "embedding_count": row["embedding_count"],
                        "last_seen": row["last_seen"]
                    })
                
                return persons
                
        except Exception as e:
            logger.error(f"Failed to get persons with details: {e}")
            return []
    
    def get_total_embeddings(self) -> int:
        """
        Get total number of embeddings in the database
        
        Returns:
            int: Total number of embeddings
        """
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT COUNT(*) as total FROM faces")
                result = cursor.fetchone()
                return result['total'] if result else 0
                
        except Exception as e:
            logger.error(f"Failed to get total embeddings: {e}")
            return 0
    
    def update_person_id(self, old_person_id: str, new_person_id: str) -> int:
        """
        Update a person's ID in the database
        
        Args:
            old_person_id (str): Current person ID
            new_person_id (str): New person ID
            
        Returns:
            int: Number of records updated
        """
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                
                # Check if old person exists
                cursor.execute("SELECT COUNT(*) as count FROM faces WHERE person_id = ?", (old_person_id,))
                old_count = cursor.fetchone()['count']
                
                if old_count == 0:
                    logger.warning(f"Person '{old_person_id}' not found in database")
                    return 0
                
                # Check if new person ID already exists
                cursor.execute("SELECT COUNT(*) as count FROM faces WHERE person_id = ?", (new_person_id,))
                new_count = cursor.fetchone()['count']
                
                if new_count > 0:
                    logger.warning(f"Person '{new_person_id}' already exists in database")
                    return 0
                
                # Update the person_id
                cursor.execute(
                    "UPDATE faces SET person_id = ?, updated_at = CURRENT_TIMESTAMP WHERE person_id = ?",
                    (new_person_id, old_person_id)
                )
                
                updated_count = cursor.rowcount
                conn.commit()
                
                return updated_count
                
        except Exception as e:
            logger.error(f"Failed to update person ID from '{old_person_id}' to '{new_person_id}': {e}")
            return 0
    
    def close(self):
        """
        Close the database connection
        
        Note: This class uses context managers for connections,
        so there's no persistent connection to close.
        """
    
    def __del__(self):
        """Destructor to ensure proper cleanup"""
        self.close()