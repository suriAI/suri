"""
AES-256-GCM encryption for .suri backup files.

Blob layout: MAGIC(6) | SALT(16) | IV(12) | TAG(16) | CIPHERTEXT
Key derivation: PBKDF2-HMAC-SHA256, 480k iterations.
"""

import os
import hashlib
import hmac

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

SALT_SIZE = 16
IV_SIZE = 12
KEY_SIZE = 32
PBKDF2_ITERS = 480_000
SURI_MAGIC = b"SURI\x00\x01"


def _derive_key(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode(), salt, PBKDF2_ITERS, dklen=KEY_SIZE
    )


def encrypt_vault(plaintext: bytes, password: str) -> bytes:
    """Encrypt plaintext. Returns a self-contained blob ready to write to disk."""
    salt = os.urandom(SALT_SIZE)
    iv = os.urandom(IV_SIZE)
    encrypted = AESGCM(_derive_key(password, salt)).encrypt(iv, plaintext, None)
    return SURI_MAGIC + salt + iv + encrypted


def decrypt_vault(blob: bytes, password: str) -> bytes:
    """
    Decrypt a .suri blob. Raises ValueError on bad format,
    InvalidTag on wrong password or tampered data.
    """
    magic_len = len(SURI_MAGIC)
    if len(blob) < magic_len + SALT_SIZE + IV_SIZE + 16 + 1:
        raise ValueError("Not a valid .suri file.")
    if not hmac.compare_digest(blob[:magic_len], SURI_MAGIC):
        raise ValueError("Not a valid .suri file.")

    o = magic_len
    salt, iv = blob[o : o + SALT_SIZE], blob[o + SALT_SIZE : o + SALT_SIZE + IV_SIZE]
    ciphertext = blob[o + SALT_SIZE + IV_SIZE :]
    return AESGCM(_derive_key(password, salt)).decrypt(iv, ciphertext, None)
