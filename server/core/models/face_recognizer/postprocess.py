import numpy as np
from typing import List, Dict, Optional, Tuple


def normalize_embedding(embedding: np.ndarray) -> np.ndarray:
    """
    L2 normalize embedding vector.

    Args:
        embedding: Raw embedding vector

    Returns:
        Normalized embedding vector
    """
    norm = np.linalg.norm(embedding)
    if norm > 0:
        embedding = embedding / norm
    return embedding.astype(np.float32)


def normalize_embeddings_batch(embeddings: np.ndarray) -> List[np.ndarray]:
    """
    Normalize a batch of embeddings.

    Args:
        embeddings: Batch of embeddings [N, embedding_dim]

    Returns:
        List of normalized embeddings
    """
    normalized_embeddings = []
    for embedding in embeddings:
        normalized = normalize_embedding(embedding)
        normalized_embeddings.append(normalized)
    return normalized_embeddings


def compute_similarity(
    query_embedding: np.ndarray, database_embedding: np.ndarray
) -> float:
    """
    Compute cosine similarity between two normalized embeddings.

    Args:
        query_embedding: Query embedding (normalized)
        database_embedding: Database embedding (normalized)

    Returns:
        Similarity score in range [0, 1]
    """
    return float(np.dot(query_embedding, database_embedding))


def find_best_match(
    query_embedding: np.ndarray,
    database: Dict[str, np.ndarray],
    similarity_threshold: float,
    allowed_person_ids: Optional[List[str]] = None,
) -> Tuple[Optional[str], float]:
    """
    Find best matching person in database.

    Args:
        query_embedding: Query embedding (normalized)
        database: Dictionary mapping person_id to embedding
        similarity_threshold: Minimum similarity threshold for recognition
        allowed_person_ids: Optional list of allowed person IDs for filtering

    Returns:
        Tuple of (best_person_id, best_similarity)
        - best_person_id: Person ID if match found above threshold, else None
        - best_similarity: Best similarity score found
    """
    if not database:
        return None, 0.0

    # Filter by allowed person IDs if provided
    if allowed_person_ids is not None:
        database = {
            pid: emb for pid, emb in database.items() if pid in allowed_person_ids
        }
        if not database:
            return None, 0.0

    best_person_id = None
    best_similarity = 0.0

    for person_id, stored_embedding in database.items():
        similarity = compute_similarity(query_embedding, stored_embedding)

        if similarity > best_similarity:
            best_similarity = similarity
            best_person_id = person_id

    # Only return person_id if similarity meets threshold
    if best_similarity >= similarity_threshold:
        return best_person_id, best_similarity
    else:
        return None, best_similarity

