"""
Face detection models package

Contains implementations of various face detection models including YuNet.
"""

from .yunet_detector import YuNet
from .antispoof_detector import AntiSpoof

__all__ = ["YuNet", "AntiSpoof"]