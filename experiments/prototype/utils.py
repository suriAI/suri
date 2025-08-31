# ============================================================================ #
# Local Enhanced Recognition Module
# Embedded in the main script to avoid import issues

import cv2
import numpy as np
from sklearn.preprocessing import normalize

def extract_pyramid_features(face_img, session, face_size=112):
    """Extract robust features with simplified approach"""
    
    # Validate input
    if face_img.size == 0:
        print("[WARNING] Empty face image provided")
        return np.zeros(512)
    
    h, w = face_img.shape[:2]
    if h < 20 or w < 20:
        print(f"[WARNING] Face too small ({h}x{w}), using zero vector")
        return np.zeros(512)
    
    try:
        # Single scale approach for reliability
        # Resize maintaining aspect ratio
        aspect_ratio = w / h
        if aspect_ratio > 1:
            new_w = face_size
            new_h = int(face_size / aspect_ratio)
        else:
            new_h = face_size
            new_w = int(face_size * aspect_ratio)
        
        # Ensure minimum dimensions
        new_h = max(new_h, 20)
        new_w = max(new_w, 20)
        
        resized = cv2.resize(face_img, (new_w, new_h))
        
        # Center pad to square
        cropped = np.zeros((face_size, face_size, 3), dtype=np.uint8)
        start_y = (face_size - new_h) // 2
        start_x = (face_size - new_w) // 2
        cropped[start_y:start_y + new_h, start_x:start_x + new_w] = resized
        
        # Extract features using EdgeFace-S
        blob = preprocess_face_enhanced(cropped, face_size)
        feature = session.run(None, {'input': blob})[0][0]
        
        # Validate feature vector
        if np.all(feature == 0) or np.any(np.isnan(feature)) or np.any(np.isinf(feature)):
            print("[WARNING] Invalid feature vector detected")
            return np.zeros(512)
        
        # EdgeFace-S specific: L2 normalization for better similarity computation
        feature_norm = np.linalg.norm(feature)
        if feature_norm > 0:
            feature = feature / feature_norm
        else:
            print("[WARNING] Zero-norm feature vector detected")
            return np.zeros(512)
        
        # Debug: Check feature quality
        if np.std(feature) < 0.01:
            print(f"[WARNING] Low variance in feature vector (std: {np.std(feature):.4f})")
        
        return feature
        
    except Exception as e:
        print(f"[ERROR] Feature extraction failed: {e}")
        return np.zeros(512)

def preprocess_face_enhanced(face_img, face_size=112):
    """EdgeFace-S specific preprocessing - CORRECT ImageNet normalization"""
    
    # Resize to exact target size first
    face = cv2.resize(face_img, (face_size, face_size))
    
    # Convert BGR to RGB (EdgeFace-S expects RGB)
    face_rgb = cv2.cvtColor(face, cv2.COLOR_BGR2RGB)
    
    # Convert to float32 and normalize to [0, 1]
    face_normalized = face_rgb.astype(np.float32) / 255.0
    
    # CORRECT: EdgeFace uses ImageNet normalization
    # ImageNet mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    face_normalized = (face_normalized - mean) / std
    
    # Transpose to CHW format (channels, height, width)
    face_chw = np.transpose(face_normalized, (2, 0, 1))
    
    # Add batch dimension and ensure float32
    face_batch = np.expand_dims(face_chw, axis=0).astype(np.float32)
    
    return face_batch

def calculate_quality_score(face_img, bbox_conf):
    """Calculate comprehensive quality score with improved metrics"""
    scores = []
    
    # Validate input
    if face_img.size == 0:
        return 0.0
    
    h, w = face_img.shape[:2]
    if h < 10 or w < 10:
        return 0.0
    
    gray = cv2.cvtColor(face_img, cv2.COLOR_BGR2GRAY)
    
    # 1. Sharpness (Laplacian variance) - improved scaling
    laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
    sharpness_score = min(laplacian_var / 800.0, 1.0)  # Better normalization
    scores.append(max(0.0, sharpness_score))
    
    # 2. Brightness consistency (improved range)
    brightness = np.mean(gray)
    if brightness < 30 or brightness > 225:
        brightness_score = 0.0  # Too dark or too bright
    else:
        brightness_score = 1.0 - abs(brightness - 127.5) / 97.5  # More reasonable range
    scores.append(max(0.0, brightness_score))
    
    # 3. Contrast (improved calculation)
    contrast = gray.std()
    if contrast < 15:
        contrast_score = 0.0  # Too low contrast
    else:
        contrast_score = min(contrast / 60.0, 1.0)  # Better scaling
    scores.append(max(0.0, contrast_score))
    
    # 4. Face size (minimum size requirement)
    min_face_area = 40 * 40  # Minimum viable face size
    current_area = h * w
    if current_area < min_face_area:
        size_score = 0.0
    else:
        size_score = min(current_area / (120 * 120), 1.0)  # Optimal size scaling
    scores.append(size_score)
    
    # 5. Detection confidence (more weight on high confidence)
    conf_score = min(bbox_conf * 1.2, 1.0)  # Boost high confidence
    scores.append(conf_score)
    
    # 6. Edge detection (face structure validation)
    edges = cv2.Canny(gray, 50, 150)
    edge_density = np.sum(edges > 0) / (h * w)
    edge_score = min(edge_density * 8.0, 1.0)  # Good faces have reasonable edge density
    scores.append(edge_score)
    
    # Weighted average with more emphasis on critical factors
    weights = [0.25, 0.20, 0.20, 0.15, 0.15, 0.05]
    quality_score = np.average(scores, weights=weights)
    
    return max(0.0, min(1.0, quality_score))

def detect_blur(image):
    """Detect blur using FFT analysis"""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    # Apply FFT
    f_transform = np.fft.fft2(gray)
    f_shift = np.fft.fftshift(f_transform)
    magnitude_spectrum = np.log(np.abs(f_shift) + 1)
    
    # Calculate blur metric
    blur_metric = np.mean(magnitude_spectrum)
    return blur_metric < 10.0  # Threshold for blur detection

def deblur_face(face_img):
    """Simple deblurring using sharpening kernel"""
    if detect_blur(face_img):
        # Unsharp masking
        gaussian = cv2.GaussianBlur(face_img, (9, 9), 2.0)
        unsharp = cv2.addWeighted(face_img, 2.0, gaussian, -1.0, 0)
        return np.clip(unsharp, 0, 255).astype(np.uint8)
    return face_img

def enhance_face_preprocessing(face_img, bbox_conf):
    """EdgeFace-S optimized preprocessing pipeline"""
    
    # 1. Quality assessment
    quality_score = calculate_quality_score(face_img, bbox_conf)
    
    # 2. Conservative enhancement only for very poor quality
    enhanced_img = face_img.copy()
    
    # Only apply enhancements if quality is very poor
    if quality_score < 0.3:
        # Very subtle CLAHE for extreme lighting only
        brightness = np.mean(cv2.cvtColor(face_img, cv2.COLOR_BGR2GRAY))
        if brightness < 60 or brightness > 200:  # Only extreme cases
            lab = cv2.cvtColor(face_img, cv2.COLOR_BGR2LAB)
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
            lab[:,:,0] = clahe.apply(lab[:,:,0])
            enhanced_img = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
        
        # Very light denoising for very blurry images
        if detect_blur(face_img):
            enhanced_img = cv2.bilateralFilter(enhanced_img, 5, 20, 20)
    
    return enhanced_img, quality_score

def get_adaptive_threshold(conditions, base_threshold=0.75):
    """BALANCED - EdgeFace-S adaptive threshold for accurate recognition"""
    condition_modifiers = {
        'low_light': +0.05,      # Moderate increase for low light
        'motion_blur': +0.04,    # Moderate increase for motion blur
        'partial_occlusion': +0.05,  # Moderate increase for occlusion
        'high_quality': -0.02,   # Small bonus for high quality
        'crowded_scene': +0.03   # Moderate increase for crowded scenes
    }
    
    threshold = base_threshold
    
    for condition in conditions:
        if condition in condition_modifiers:
            threshold += condition_modifiers[condition]
    
    # BALANCED range - reasonable for accurate recognition
    return max(0.65, min(0.90, threshold))

def validate_face_region(face_img):
    """Validate if the extracted region actually contains a face - RELAXED for better recognition"""
    if face_img.size == 0:
        return False
    
    h, w = face_img.shape[:2]
    if h < 20 or w < 20:  # More relaxed size requirement
        return False
    
    # Convert to grayscale
    gray = cv2.cvtColor(face_img, cv2.COLOR_BGR2GRAY)
    
    # More permissive validation - only basic checks
    
    # 1. Variance check (faces have some texture variation)
    variance = gray.var()
    if variance < 50:  # Much more relaxed - was 200
        return False
    
    # 2. Basic brightness check (not completely black or white)
    mean_brightness = np.mean(gray)
    if mean_brightness < 10 or mean_brightness > 245:
        return False
    
    # Skip the complex edge density and symmetry checks that were too strict
    return True

def detect_conditions(face_img, face_quality, detection_conf, scene_crowding=1.0):
    """Automatically detect conditions affecting recognition"""
    conditions = []
    
    # Lighting conditions
    brightness = np.mean(cv2.cvtColor(face_img, cv2.COLOR_BGR2GRAY))
    if brightness < 80 or brightness > 200:
        conditions.append('low_light')
    
    # BEST OF THE BEST quality-based conditions
    if face_quality < 0.55:
        conditions.append('motion_blur')
    
    if face_quality > 0.80:
        conditions.append('high_quality')
    
    # Detection confidence as proxy for occlusion
    if detection_conf < 0.6:
        conditions.append('partial_occlusion')
    
    # Scene crowding
    if scene_crowding > 3:  # More than 3 faces detected
        conditions.append('crowded_scene')
    
    return conditions
