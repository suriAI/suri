import cv2
import numpy as np
import onnxruntime as ort
from datetime import datetime
import os, json, pickle, sys
from sklearn.metrics.pairwise import cosine_similarity
from collections import defaultdict

# Import local enhanced utilities from prototype
from experiments.prototype.utils import (
    extract_pyramid_features, 
    enhance_face_preprocessing, 
    calculate_quality_score,
    get_adaptive_threshold,
    detect_conditions
)

YOLO_MODEL_PATH = "experiments/detection/models/wider300e+300e-unisets.onnx"
RECOG_MODEL_PATH = "experiments/recognition/models/edgeface-s.onnx"
FACE_DATABASE_DIR = "face_database"
ATTENDANCE_LOG = "attendance_log.json"

# ONNX sessions
yolo_sess = ort.InferenceSession(YOLO_MODEL_PATH, providers=["CPUExecutionProvider"])
recog_sess = ort.InferenceSession(RECOG_MODEL_PATH, providers=["CPUExecutionProvider"])

# Configs
input_size = 640
face_size = 112
conf_thresh = 0.4  # Lowered for better detection in difficult conditions
iou_thresh = 0.45
base_recognition_threshold = 0.20  # Will be dynamically adjusted

class Main:
    def __init__(self):
        self.face_database = {}
        self.attendance_log = []
        self.last_recognition = {}  # To prevent duplicate entries
        self.multi_templates = defaultdict(list)  # Enhanced multi-template storage
        self.recognition_stats = defaultdict(lambda: {'attempts': 0, 'successes': 0})
        self.setup_directories()
        self.load_face_database()
        self.load_multi_templates()
        self.load_attendance_log()
    
    def setup_directories(self):
        """Create necessary directories"""
        os.makedirs(FACE_DATABASE_DIR, exist_ok=True)
        
        # Create attendance log directory if needed
        attendance_dir = os.path.dirname(ATTENDANCE_LOG)
        if attendance_dir:  # Only create if there's a directory path
            os.makedirs(attendance_dir, exist_ok=True)
    
    def load_face_database(self):
        """Load legacy face embeddings for backward compatibility"""
        db_file = os.path.join(FACE_DATABASE_DIR, "embeddings.pkl")
        if os.path.exists(db_file):
            with open(db_file, 'rb') as f:
                self.face_database = pickle.load(f)
            print(f"[INFO] Loaded {len(self.face_database)} faces from legacy database")
        else:
            print("[INFO] No existing legacy face database found")
    
    def load_multi_templates(self):
        """Load enhanced multi-template database"""
        db_file = os.path.join(FACE_DATABASE_DIR, "multi_templates.pkl")
        stats_file = os.path.join(FACE_DATABASE_DIR, "template_stats.json")
        
        if os.path.exists(db_file):
            with open(db_file, 'rb') as f:
                templates_dict = pickle.load(f)
                self.multi_templates = defaultdict(list, templates_dict)
        
        if os.path.exists(stats_file):
            with open(stats_file, 'r') as f:
                stats_dict = json.load(f)
                self.recognition_stats = defaultdict(
                    lambda: {'attempts': 0, 'successes': 0}, 
                    stats_dict
                )
        
        total_templates = sum(len(templates) for templates in self.multi_templates.values())
        if total_templates > 0:
            print(f"[INFO] Loaded {total_templates} enhanced templates for {len(self.multi_templates)} people")
    
    def save_face_database(self):
        """Save face embeddings to file"""
        db_file = os.path.join(FACE_DATABASE_DIR, "embeddings.pkl")
        with open(db_file, 'wb') as f:
            pickle.dump(self.face_database, f)
    
    def save_multi_templates(self):
        """Save enhanced multi-template database"""
        db_file = os.path.join(FACE_DATABASE_DIR, "multi_templates.pkl")
        stats_file = os.path.join(FACE_DATABASE_DIR, "template_stats.json")
        
        templates_dict = dict(self.multi_templates)
        stats_dict = dict(self.recognition_stats)
        
        with open(db_file, 'wb') as f:
            pickle.dump(templates_dict, f)
        
        with open(stats_file, 'w') as f:
            json.dump(stats_dict, f, indent=2)
    
    def load_attendance_log(self):
        """Load attendance log with error recovery"""
        if os.path.exists(ATTENDANCE_LOG):
            try:
                with open(ATTENDANCE_LOG, 'r') as f:
                    self.attendance_log = json.load(f)
                print(f"[INFO] Loaded {len(self.attendance_log)} attendance records")
            except (json.JSONDecodeError, ValueError) as e:
                print(f"[WARNING] Corrupted attendance log detected: {e}")
                print("[INFO] Creating backup and starting fresh attendance log")
                
                # Create backup of corrupted file
                backup_file = ATTENDANCE_LOG + ".corrupted.backup"
                try:
                    import shutil
                    shutil.copy2(ATTENDANCE_LOG, backup_file)
                    print(f"[INFO] Backup saved as: {backup_file}")
                except Exception as backup_error:
                    print(f"[WARNING] Could not create backup: {backup_error}")
                
                # Start with fresh log
                self.attendance_log = []
                self.save_attendance_log()  # Save clean JSON file
                print("[INFO] Fresh attendance log created")
        else:
            print("[INFO] No existing attendance log found")
            self.attendance_log = []
    
    def save_attendance_log(self):
        """Save attendance log to file with error handling"""
        try:
            # Write to temporary file first
            temp_file = ATTENDANCE_LOG + ".tmp"
            with open(temp_file, 'w') as f:
                json.dump(self.attendance_log, f, indent=2)
            
            # If successful, replace the original file
            import shutil
            shutil.move(temp_file, ATTENDANCE_LOG)
            
        except Exception as e:
            print(f"[ERROR] Failed to save attendance log: {e}")
            # Clean up temp file if it exists
            temp_file = ATTENDANCE_LOG + ".tmp"
            if os.path.exists(temp_file):
                try:
                    os.remove(temp_file)
                except:
                    pass
    
    def add_new_face_enhanced(self, face_images, name):
        """Add new face using enhanced multi-template system"""
        if not isinstance(face_images, list):
            face_images = [face_images]
        
        embeddings = []
        qualities = []
        
        for face_img in face_images:
            # Enhanced preprocessing
            enhanced_face, quality = enhance_face_preprocessing(face_img, 0.8)
            
            # Extract multi-scale features
            embedding = extract_pyramid_features(enhanced_face, recog_sess, face_size)
            
            embeddings.append(embedding)
            qualities.append(quality)
        
        # Filter high-quality embeddings
        good_indices = [i for i, q in enumerate(qualities) if q > 0.4]
        
        if not good_indices:
            print(f"[WARNING] No good quality faces for {name}")
            return False
        
        # Create templates from good embeddings
        good_embeddings = [embeddings[i] for i in good_indices]
        good_qualities = [qualities[i] for i in good_indices]
        good_images = [face_images[i] for i in good_indices]
        
        # Simple clustering by similarity
        templates = []
        used_indices = set()
        
        for i, embedding in enumerate(good_embeddings):
            if i in used_indices:
                continue
                
            # Find similar embeddings for this template
            cluster_indices = [i]
            cluster_embeddings = [embedding]
            cluster_qualities = [good_qualities[i]]
            
            for j, other_embedding in enumerate(good_embeddings):
                if j == i or j in used_indices:
                    continue
                    
                similarity = cosine_similarity([embedding], [other_embedding])[0][0]
                if similarity > 0.7:  # Group similar faces
                    cluster_indices.append(j)
                    cluster_embeddings.append(other_embedding)
                    cluster_qualities.append(good_qualities[j])
                    used_indices.add(j)
            
            used_indices.add(i)
            
            # Create fused template
            weights = np.array(cluster_qualities)
            weights = weights / weights.sum()
            fused_embedding = np.average(cluster_embeddings, axis=0, weights=weights)
            
            template = {
                'embedding': fused_embedding,
                'cluster_size': len(cluster_embeddings),
                'avg_quality': np.mean(cluster_qualities),
                'created_date': datetime.now().isoformat(),
                'usage_count': 0,
                'success_rate': 0.5
            }
            
            templates.append(template)
        
        # Store templates
        self.multi_templates[name] = templates[:5]  # Max 5 templates per person
        
        # Also add to legacy database (best quality)
        best_idx = np.argmax(qualities)
        self.face_database[name] = {
            'embedding': embeddings[best_idx],
            'added_date': datetime.now().isoformat()
        }
        
        # Save face image
        face_img_path = os.path.join(FACE_DATABASE_DIR, f"{name}.jpg")
        cv2.imwrite(face_img_path, face_images[best_idx])
        
        self.save_face_database()
        self.save_multi_templates()
        print(f"[INFO] Added {len(templates)} enhanced templates for {name}")
        return True
    
    def add_new_face(self, face_img, name):
        """Legacy add face method for compatibility"""
        return self.add_new_face_enhanced([face_img], name)
    
    def identify_face_enhanced(self, face_img, bbox_conf=0.8, scene_crowding=1.0):
        """Enhanced identification with all advanced features"""
        
        try:
            # Validate input
            if face_img.size == 0:
                return None, 0.0, False, {'method': 'error', 'error': 'empty_image'}
            
            # Enhanced preprocessing
            enhanced_face, quality = enhance_face_preprocessing(face_img, bbox_conf)
            
            # Extract multi-scale features
            query_embedding = extract_pyramid_features(enhanced_face, recog_sess, face_size)
            
            # Check if we got a valid embedding
            if np.all(query_embedding == 0):
                print("[WARNING] Failed to extract valid features, falling back to legacy")
                return self.identify_face_legacy(enhanced_face, quality, base_recognition_threshold)
            
            # Detect conditions for adaptive thresholding
            conditions = detect_conditions(enhanced_face, quality, bbox_conf, scene_crowding)
            
            # Get adaptive threshold
            adaptive_threshold = get_adaptive_threshold(conditions, base_recognition_threshold)
            
            # Try enhanced template matching first
            best_person = None
            best_similarity = 0.0
            best_template_info = None
            
            for person_name, templates in self.multi_templates.items():
                if not templates:
                    continue
                    
                # Get similarities to all templates
                similarities = []
                for template in templates:
                    try:
                        similarity = cosine_similarity([query_embedding], [template['embedding']])[0][0]
                        similarities.append(similarity)
                    except Exception as e:
                        print(f"[WARNING] Error comparing with template for {person_name}: {e}")
                        similarities.append(0.0)
                
                if not similarities:
                    continue
                
                # Multi-template fusion
                if len(similarities) == 1:
                    final_sim = similarities[0]
                else:
                    # Weighted average by template quality and success rate
                    weights = []
                    for template in templates:
                        weight = template['avg_quality'] * (1 + template['success_rate'])
                        weights.append(weight)
                    
                    if sum(weights) > 0:
                        weights = np.array(weights) / sum(weights)
                        final_sim = np.average(similarities, weights=weights)
                    else:
                        final_sim = np.mean(similarities)
                
                # Update statistics
                self.recognition_stats[person_name]['attempts'] += 1
                
                if final_sim > best_similarity:
                    best_similarity = final_sim
                    best_person = person_name
                    best_template_info = {
                        'best_template_idx': np.argmax(similarities),
                        'num_templates': len(templates),
                        'individual_similarities': similarities
                    }
            
            # Check if match is confident enough
            is_match = best_similarity >= adaptive_threshold
            
            if is_match and best_person:
                # Update success statistics
                self.recognition_stats[best_person]['successes'] += 1
                
                # Update template usage
                template_idx = best_template_info['best_template_idx']
                self.multi_templates[best_person][template_idx]['usage_count'] += 1
                
                # Update success rate (simple moving average)
                stats = self.recognition_stats[best_person]
                success_rate = stats['successes'] / stats['attempts']
                self.multi_templates[best_person][template_idx]['success_rate'] = success_rate
                
                return best_person, best_similarity, True, {
                    'method': 'enhanced_templates',
                    'conditions': conditions,
                    'threshold_used': adaptive_threshold,
                    'quality': quality,
                    'template_info': best_template_info
                }
            
            # Fallback to legacy database
            return self.identify_face_legacy(enhanced_face, quality, adaptive_threshold)
            
        except Exception as e:
            print(f"[ERROR] Enhanced identification failed: {e}")
            # Emergency fallback to simple legacy identification
            try:
                return self.identify_face_legacy(face_img, 0.5, base_recognition_threshold)
            except Exception as e2:
                print(f"[ERROR] All identification methods failed: {e2}")
                return None, 0.0, False, {'method': 'error', 'error': str(e)}
    
    def identify_face_legacy(self, face_img, quality, threshold):
        """Legacy identification for backward compatibility"""
        if not self.face_database:
            return None, 0.0, False, {'method': 'legacy_fallback'}
        
        # Get embedding for input face
        embedding = extract_pyramid_features(face_img, recog_sess, face_size)
        
        best_match = None
        best_similarity = 0.0
        
        # Compare with all faces in legacy database
        for name, data in self.face_database.items():
            stored_embedding = data['embedding']
            similarity = cosine_similarity([embedding], [stored_embedding])[0][0]
            
            if similarity > best_similarity:
                best_similarity = similarity
                best_match = name
        
        # Return match if above threshold
        is_match = best_similarity >= threshold
        return best_match, best_similarity, is_match, {
            'method': 'legacy_database',
            'threshold_used': threshold,
            'quality': quality
        }
    
    def identify_face(self, face_img):
        """Legacy identify method for compatibility"""
        name, similarity, is_match, info = self.identify_face_enhanced(face_img)
        
        # Legacy format return
        if is_match:
            return name, similarity, True
        else:
            return None, similarity, False
    
    def log_attendance(self, name, confidence, additional_info=None):
        """Enhanced attendance logging with additional metadata"""
        current_time = datetime.now()
        timestamp = current_time.isoformat()
        
        # Check if this person was already logged recently (within 30 seconds)
        if name in self.last_recognition:
            time_diff = (current_time - self.last_recognition[name]).total_seconds()
            if time_diff < 30:  # 30 second cooldown
                return False
        
        # Log attendance
        attendance_entry = {
            'name': name,
            'timestamp': timestamp,
            'confidence': float(confidence),
            'date': current_time.strftime('%Y-%m-%d'),
            'time': current_time.strftime('%H:%M:%S')
        }
        
        # Add additional info if provided (with JSON serialization safety)
        if additional_info:
            attendance_entry['recognition_info'] = self._make_json_safe(additional_info)
        
        self.attendance_log.append(attendance_entry)
        self.last_recognition[name] = current_time
        self.save_attendance_log()
        
        print(f"[ATTENDANCE] {name} logged at {current_time.strftime('%H:%M:%S')} (confidence: {confidence:.3f})")
        return True
    
    def _make_json_safe(self, obj):
        """Convert numpy types and other non-JSON serializable objects to JSON-safe types"""
        if isinstance(obj, dict):
            return {key: self._make_json_safe(value) for key, value in obj.items()}
        elif isinstance(obj, list):
            return [self._make_json_safe(item) for item in obj]
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        elif isinstance(obj, (np.integer, np.int64, np.int32)):
            return int(obj)
        elif isinstance(obj, (np.floating, np.float64, np.float32)):
            return float(obj)
        elif isinstance(obj, np.bool_):
            return bool(obj)
        else:
            return obj
    
    def get_today_attendance(self):
        """Get today's attendance records"""
        today = datetime.now().strftime('%Y-%m-%d')
        today_records = [record for record in self.attendance_log if record['date'] == today]
        return today_records
    
    def get_person_summary(self, person_name):
        """Get summary of person's templates and performance"""
        summary = {
            'name': person_name,
            'num_templates': len(self.multi_templates.get(person_name, [])),
            'in_legacy': person_name in self.face_database,
        }
        
        if person_name in self.recognition_stats:
            stats = self.recognition_stats[person_name]
            summary.update({
                'total_attempts': stats['attempts'],
                'total_successes': stats['successes'],
                'overall_success_rate': stats['successes'] / max(stats['attempts'], 1)
            })
        
        return summary

# Utils (same as before)
def preprocess_yolo(frame):
    h, w = frame.shape[:2]
    scale = min(input_size / w, input_size / h)
    new_w, new_h = int(w * scale), int(h * scale)
    
    resized = cv2.resize(frame, (new_w, new_h))
    
    padded = np.full((input_size, input_size, 3), 114, dtype=np.uint8)
    dx = (input_size - new_w) // 2
    dy = (input_size - new_h) // 2
    padded[dy:dy+new_h, dx:dx+new_w] = resized
    
    img = padded[:, :, ::-1].transpose(2, 0, 1).astype(np.float32)
    img /= 255.0
    
    return np.expand_dims(img, axis=0), scale, dx, dy

def preprocess_face(face_img):
    face = cv2.resize(face_img, (face_size, face_size))
    face = face[:, :, ::-1].astype(np.float32) / 255.0
    face = (face - 0.5) / 0.5
    face = np.transpose(face, (2, 0, 1))
    return np.expand_dims(face, axis=0)

def xywh2xyxy(x):
    y = np.copy(x)
    y[..., 0] = x[..., 0] - x[..., 2] / 2
    y[..., 1] = x[..., 1] - x[..., 3] / 2
    y[..., 2] = x[..., 0] + x[..., 2] / 2
    y[..., 3] = x[..., 1] + x[..., 3] / 2
    return y

def non_max_suppression(predictions, conf_thres=0.5, iou_thres=0.45, img_shape=None, input_shape=(640, 640), pad=(0, 0), scale=1.0):
    output = predictions
    
    if len(output.shape) == 3:
        if output.shape[1] == 5:
            output = output[0].transpose()
        else:
            output = output[0]
    
    conf_mask = output[:, 4] > conf_thres
    output = output[conf_mask]
    
    if len(output) == 0:
        return []
    
    boxes = xywh2xyxy(output[:, :4])
    confidences = output[:, 4]
    
    if img_shape is not None:
        h, w = img_shape
        dx, dy = pad
        
        if boxes.max() <= 1.0:
            boxes[:, [0, 2]] *= input_shape[1]
            boxes[:, [1, 3]] *= input_shape[0]
        
        boxes[:, [0, 2]] -= dx
        boxes[:, [1, 3]] -= dy
        boxes[:, :4] /= scale
        boxes[:, [0, 2]] = np.clip(boxes[:, [0, 2]], 0, w)
        boxes[:, [1, 3]] = np.clip(boxes[:, [1, 3]], 0, h)
    
    indices = cv2.dnn.NMSBoxes(boxes.tolist(), confidences.tolist(), conf_thres, iou_thres)
    
    keep_boxes = []
    if len(indices) > 0:
        indices = indices.flatten()
        for i in indices:
            x1, y1, x2, y2 = boxes[i]
            conf = confidences[i]
            keep_boxes.append([int(x1), int(y1), int(x2), int(y2), conf])
    
    return keep_boxes
    """Display the main menu and get user choice"""
    print("\n" + "="*70)
    print("🎯 ENTERPRISE-GRADE FACE RECOGNITION ATTENDANCE SYSTEM")
    print("="*70)
    print("📊 Advanced Features:")
    print("  • Multi-scale feature extraction")
    print("  • Enhanced preprocessing (CLAHE, deblurring)")
    print("  • Adaptive thresholding based on conditions")
    print("  • Multi-template identity management")
    print("  • Quality-based face assessment")
    print("  • Smart duplicate detection")
    print("="*70)
    print("🎛️  MAIN MENU:")
    print("  1. 📹 Live Camera Recognition (Real-time attendance)")
    print("  2. 🖼️  Single Image Recognition (Upload & detect)")
    print("  3. 📁 Batch Image Processing (Process folder)")
    print("  4. ⚙️  System Management")
    print("  5. 🚪 Exit")
    print("="*70)
    
    while True:
        try:
            choice = input("Enter your choice (1-5): ").strip()
            if choice in ['1', '2', '3', '4', '5']:
                return int(choice)
            else:
                print("❌ Invalid choice. Please enter 1-5.")
        except KeyboardInterrupt:
            return 5

def process_single_image(app, image_path):
    """Process a single image for face recognition"""
    try:
        # Load the image
        frame = cv2.imread(image_path)
        if frame is None:
            print(f"❌ Error: Could not load image from {image_path}")
            return
        
        print(f"📸 Processing image: {image_path}")
        orig = frame.copy()
        h, w = frame.shape[:2]
        
        # Preprocess for YOLO
        input_blob, scale, dx, dy = preprocess_yolo(frame)
        
        # Run YOLO inference
        preds = yolo_sess.run(None, {'images': input_blob})[0]
        faces = non_max_suppression(preds, conf_thresh, iou_thresh, 
                                   img_shape=(h, w), input_shape=(input_size, input_size), 
                                   pad=(dx, dy), scale=scale)

        scene_crowding = len(faces)
        recognized_faces = []
        
        print(f"🔍 Found {len(faces)} face(s) in the image")
        
        # Process each detected face
        for i, box in enumerate(faces):
            x1, y1, x2, y2, conf = box
            
            if x2 <= x1 or y2 <= y1:
                continue

            face_img = orig[y1:y2, x1:x2]
            if face_img.size == 0:
                continue
            
            # Calculate quality score
            quality = calculate_quality_score(face_img, conf)
            
            # Enhanced identification
            identified_name, similarity, should_log, info = app.identify_face_enhanced(
                face_img, conf, scene_crowding
            )
            
            # Store results
            face_result = {
                'bbox': (x1, y1, x2, y2),
                'confidence': conf,
                'quality': quality,
                'name': identified_name,
                'similarity': similarity,
                'should_log': should_log,
                'info': info
            }
            recognized_faces.append(face_result)
            
            # Log attendance if recognized
            if identified_name and should_log:
                app.log_attendance(identified_name, similarity, info)
                print(f"✅ Recognized: {identified_name} (confidence: {similarity:.3f})")
            elif identified_name:
                print(f"⚠️  Possible match: {identified_name} (confidence: {similarity:.3f}) - Below threshold")
            else:
                print(f"❓ Unknown face #{i+1} (quality: {quality:.2f})")
            
            # Visualize results
            if identified_name and should_log:
                color = (0, 255, 0)  # Green for recognized
                method_text = info.get('method', 'unknown')[:8]
                
                # Check data types
                person_summary = app.get_person_summary(identified_name)
                data_types = []
                if person_summary['in_legacy']:
                    data_types.append("L")
                if person_summary['num_templates'] > 0:
                    data_types.append(f"T{person_summary['num_templates']}")
                
                data_indicator = "+".join(data_types) if data_types else "?"
                label = f"{identified_name} ({similarity:.3f}) [{method_text}|{data_indicator}]"
            elif identified_name:
                color = (0, 255, 255)  # Yellow for low confidence
                label = f"{identified_name}? ({similarity:.3f})"
            else:
                color = (0, 0, 255)  # Red for unknown
                label = f"Unknown #{i+1} (Q:{quality:.2f})"
            
            # Draw bounding box and label
            cv2.rectangle(orig, (x1, y1), (x2, y2), color, 3)
            cv2.putText(orig, label, (x1, y1 - 10), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
        
        # Show results
        cv2.imshow("Image Recognition Results", orig)
        print(f"\n📊 Processing complete! Press any key to continue...")
        cv2.waitKey(0)
        cv2.destroyAllWindows()
        
        return recognized_faces
        
    except Exception as e:
        print(f"❌ Error processing image: {e}")
        return []

def process_batch_images(app, folder_path):
    """Process all images in a folder"""
    try:
        import glob
        
        # Supported image formats
        image_extensions = ['*.jpg', '*.jpeg', '*.png', '*.bmp', '*.tiff']
        image_files = []
        
        for ext in image_extensions:
            image_files.extend(glob.glob(os.path.join(folder_path, ext)))
            image_files.extend(glob.glob(os.path.join(folder_path, ext.upper())))
        
        if not image_files:
            print(f"❌ No image files found in {folder_path}")
            return
        
        print(f"📁 Found {len(image_files)} image(s) to process")
        
        total_faces = 0
        total_recognized = 0
        results = []
        
        for i, image_path in enumerate(image_files, 1):
            print(f"\n📸 Processing {i}/{len(image_files)}: {os.path.basename(image_path)}")
            
            faces = process_single_image(app, image_path)
            if faces:
                total_faces += len(faces)
                recognized_count = sum(1 for face in faces if face['should_log'])
                total_recognized += recognized_count
                
                results.append({
                    'image': image_path,
                    'faces': faces,
                    'recognized_count': recognized_count
                })
        
        # Summary
        print(f"\n📊 BATCH PROCESSING SUMMARY:")
        print(f"  • Images processed: {len(image_files)}")
        print(f"  • Total faces detected: {total_faces}")
        print(f"  • Total faces recognized: {total_recognized}")
        print(f"  • Recognition rate: {(total_recognized/max(total_faces,1)*100):.1f}%")
        
        return results
        
    except Exception as e:
        print(f"❌ Error processing batch: {e}")
        return []

def system_management(app):
    """System management menu"""
    while True:
        print("\n" + "="*50)
        print("⚙️  SYSTEM MANAGEMENT")
        print("="*50)
        print("1. 👤 Add new person (single capture)")
        print("2. 👥 Add new person (multi-capture templates)")
        print("3. 📋 Show today's attendance")
        print("4. 📊 Show system statistics")
        print("5. 🗑️  Clear attendance log")
        print("6. 🔍 Search person details")
        print("7. 🔙 Back to main menu")
        print("="*50)
        
        choice = input("Enter choice (1-7): ").strip()
        
        if choice == "1":
            add_person_single(app)
        elif choice == "2":
            add_person_multi(app)
        elif choice == "3":
            show_attendance(app)
        elif choice == "4":
            show_statistics(app)
        elif choice == "5":
            clear_attendance(app)
        elif choice == "6":
            search_person(app)
        elif choice == "7":
            break
        else:
            print("❌ Invalid choice. Please enter 1-7.")

def add_person_single(app):
    """Add a person using camera (single capture)"""
    name = input("👤 Enter person's name: ").strip()
    if not name:
        print("❌ Invalid name.")
        return
    
    # Check for duplicates
    summary = app.get_person_summary(name)
    if summary['in_legacy'] or summary['num_templates'] > 0:
        print(f"\n⚠️  DUPLICATE DETECTED: '{name}' already exists!")
        print(f"   - Legacy database: {'✓' if summary['in_legacy'] else '✗'}")
        print(f"   - Enhanced templates: {summary['num_templates']}")
        
        choice = input("Replace existing? (y/N): ").strip().lower()
        if choice != 'y':
            print("❌ Operation cancelled.")
            return
        
        # Clear existing data
        if name in app.face_database:
            del app.face_database[name]
        if name in app.multi_templates:
            del app.multi_templates[name]
        if name in app.recognition_stats:
            del app.recognition_stats[name]
    
    # Start camera for capture
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("❌ Could not open camera")
        return
    
    print(f"📹 Position {name}'s face in the camera. Press SPACE to capture or 'q' to quit.")
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        
        # Show preview
        cv2.putText(frame, f"Adding: {name}", (10, 30), 
                   cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
        cv2.putText(frame, "Press SPACE to capture, 'q' to quit", (10, 70), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        cv2.imshow("Add Person", frame)
        
        key = cv2.waitKey(1) & 0xFF
        if key == ord(' '):  # Space to capture
            # Detect face in current frame
            input_blob, scale, dx, dy = preprocess_yolo(frame)
            preds = yolo_sess.run(None, {'images': input_blob})[0]
            faces = non_max_suppression(preds, conf_thresh, iou_thresh, 
                                       img_shape=frame.shape[:2], input_shape=(input_size, input_size), 
                                       pad=(dx, dy), scale=scale)
            
            if faces:
                # Take the largest face
                largest_face = max(faces, key=lambda x: (x[2] - x[0]) * (x[3] - x[1]))
                x1, y1, x2, y2, conf = largest_face
                face_img = frame[y1:y2, x1:x2]
                
                success = app.add_new_face(face_img, name)
                if success:
                    print(f"✅ {name} added successfully!")
                else:
                    print(f"❌ Failed to add {name}")
                break
            else:
                print("❌ No face detected. Try again.")
        elif key == ord('q'):
            print("❌ Capture cancelled.")
            break
    
    cap.release()
    cv2.destroyAllWindows()

def add_person_multi(app):
    """Add a person using camera (multi-capture for templates)"""
    name = input("👥 Enter person's name for multi-capture: ").strip()
    if not name:
        print("❌ Invalid name.")
        return
    
    # Check for duplicates
    summary = app.get_person_summary(name)
    if summary['in_legacy'] or summary['num_templates'] > 0:
        print(f"\n⚠️  DUPLICATE DETECTED: '{name}' already exists!")
        print(f"   - Legacy database: {'✓' if summary['in_legacy'] else '✗'}")
        print(f"   - Enhanced templates: {summary['num_templates']}")
        
        print("Options: 1=Replace, 2=Enhance existing, 3=Cancel")
        choice = input("Enter choice: ").strip()
        
        if choice == "1":
            # Clear existing data
            if name in app.face_database:
                del app.face_database[name]
            if name in app.multi_templates:
                del app.multi_templates[name]
            if name in app.recognition_stats:
                del app.recognition_stats[name]
        elif choice != "2":
            print("❌ Operation cancelled.")
            return
    
    # Start camera for multi-capture
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("❌ Could not open camera")
        return
    
    print(f"📹 Multi-capture mode for {name}. Move your face around for different angles.")
    print("Auto-capturing high quality faces. Press 'q' when done or after 10 captures.")
    
    captured_faces = []
    frame_count = 0
    
    while len(captured_faces) < 10:
        ret, frame = cap.read()
        if not ret:
            break
        
        frame_count += 1
        
        # Detect faces
        input_blob, scale, dx, dy = preprocess_yolo(frame)
        preds = yolo_sess.run(None, {'images': input_blob})[0]
        faces = non_max_suppression(preds, conf_thresh, iou_thresh, 
                                   img_shape=frame.shape[:2], input_shape=(input_size, input_size), 
                                   pad=(dx, dy), scale=scale)
        
        # Show preview
        for box in faces:
            x1, y1, x2, y2, conf = box
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
            
            face_img = frame[y1:y2, x1:x2]
            if face_img.size > 0:
                quality = calculate_quality_score(face_img, conf)
                cv2.putText(frame, f"Q: {quality:.2f}", (x1, y1-10), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)
                
                # Auto-capture good quality faces
                if quality > 0.6 and frame_count % 15 == 0:  # Every 15 frames
                    captured_faces.append(face_img.copy())
                    print(f"📸 Captured {len(captured_faces)}/10 (Quality: {quality:.3f})")
        
        cv2.putText(frame, f"Multi-capture: {name}", (10, 30), 
                   cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
        cv2.putText(frame, f"Captured: {len(captured_faces)}/10", (10, 70), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        cv2.putText(frame, "Press 'q' when done", (10, 110), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        cv2.imshow("Multi-capture", frame)
        
        key = cv2.waitKey(1) & 0xFF
        if key == ord('q'):
            break
    
    cap.release()
    cv2.destroyAllWindows()
    
    if captured_faces:
        success = app.add_new_face_enhanced(captured_faces, name)
        if success:
            print(f"✅ {name} added with {len(captured_faces)} templates!")
        else:
            print(f"❌ Failed to add {name}")
    else:
        print("❌ No faces captured.")

def show_attendance(app):
    """Show today's attendance"""
    today_records = app.get_today_attendance()
    print(f"\n📋 TODAY'S ATTENDANCE ({len(today_records)} records)")
    print("-" * 60)
    for record in today_records:
        method = record.get('recognition_info', {}).get('method', 'legacy')
        print(f"{record['time']} - {record['name']} (conf: {record['confidence']:.3f}, method: {method})")
    print("-" * 60)

def show_statistics(app):
    """Show system statistics"""
    print(f"\n📊 SYSTEM STATISTICS")
    print("-" * 50)
    print(f"Enhanced templates: {len(app.multi_templates)} people")
    print(f"Legacy database: {len(app.face_database)} people")
    
    for person_name in list(app.multi_templates.keys())[:10]:
        summary = app.get_person_summary(person_name)
        print(f"\n{person_name}:")
        print(f"  Templates: {summary['num_templates']}")
        if 'total_attempts' in summary:
            print(f"  Attempts: {summary['total_attempts']}")
            print(f"  Success rate: {summary['overall_success_rate']:.1%}")
    print("-" * 50)

def clear_attendance(app):
    """Clear attendance log"""
    confirm = input("⚠️  Clear ALL attendance records? (type 'YES' to confirm): ")
    if confirm == "YES":
        app.attendance_log = []
        app.save_attendance_log()
        print("✅ Attendance log cleared!")
    else:
        print("❌ Operation cancelled.")

def search_person(app):
    """Search for a person's details"""
    name = input("🔍 Enter person's name to search: ").strip()
    if not name:
        return
    
    summary = app.get_person_summary(name)
    if summary['in_legacy'] or summary['num_templates'] > 0:
        print(f"\n👤 PERSON DETAILS: {name}")
        print("-" * 30)
        print(f"Legacy database: {'✓' if summary['in_legacy'] else '✗'}")
        print(f"Enhanced templates: {summary['num_templates']}")
        if 'total_attempts' in summary:
            print(f"Recognition attempts: {summary['total_attempts']}")
            print(f"Success rate: {summary['overall_success_rate']:.1%}")
        
        # Show recent attendance
        today_records = [r for r in app.get_today_attendance() if r['name'] == name]
        if today_records:
            print(f"Today's attendance: {len(today_records)} entries")
            for record in today_records[-3:]:  # Last 3 entries
                print(f"  {record['time']} (conf: {record['confidence']:.3f})")
    else:
        print(f"❌ Person '{name}' not found in database.")

def live_camera_recognition(app):
    """Live camera recognition mode"""
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("❌ Could not open camera")
        return
    
    print("\n📹 LIVE CAMERA RECOGNITION MODE")
    print("="*50)
    print("Controls:")
    print("  'a' - Add new face (single capture) with duplicate detection")
    print("  'A' - Add new face (multi-capture templates) with duplicate detection")
    print("  't' - Show today's attendance")
    print("  's' - Show system statistics")
    print("  'c' - Clear attendance log")
    print("  'q' - Quit to main menu")
    print("="*50)
    
    # Show existing database
    if app.face_database:
        print(f"Legacy database: {len(app.face_database)} faces")
    
    template_count = sum(len(templates) for templates in app.multi_templates.values())
    if template_count > 0:
        print(f"Enhanced templates: {template_count} templates for {len(app.multi_templates)} people")
    
    mode = "recognition"  # "recognition", "adding", "multi_adding"
    add_name = ""
    add_countdown = 0
    multi_capture_buffer = []
    frame_count = 0
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        orig = frame.copy()
        h, w = frame.shape[:2]
        frame_count += 1
        
        # Preprocess for YOLO
        input_blob, scale, dx, dy = preprocess_yolo(frame)
        
        # Run YOLO inference
        preds = yolo_sess.run(None, {'images': input_blob})[0]
        faces = non_max_suppression(preds, conf_thresh, iou_thresh, 
                                   img_shape=(h, w), input_shape=(input_size, input_size), 
                                   pad=(dx, dy), scale=scale)

        scene_crowding = len(faces)
        
        # Process each detected face
        for box in faces:
            x1, y1, x2, y2, conf = box
            
            if x2 <= x1 or y2 <= y1:
                continue

            face_img = orig[y1:y2, x1:x2]
            if face_img.size == 0:
                continue
            
            # Calculate quality score
            quality = calculate_quality_score(face_img, conf)
            
            if mode == "recognition":
                # Enhanced identification
                identified_name, similarity, should_log, info = app.identify_face_enhanced(
                    face_img, conf, scene_crowding
                )
                
                if identified_name and should_log:
                    # Log attendance with enhanced info
                    app.log_attendance(identified_name, similarity, info)
                
                # Visualization based on confidence and method
                if identified_name and should_log:
                    # High confidence - green box
                    color = (0, 255, 0)
                    method_text = info.get('method', 'unknown')[:8]  # Truncate for display
                    label = f"{identified_name} ({similarity:.3f}) [{method_text}]"
                elif identified_name:
                    # Low confidence - yellow box
                    color = (0, 255, 255)
                    label = f"{identified_name}? ({similarity:.3f})"
                else:
                    # Unknown - red box
                    color = (0, 0, 255)
                    label = f"Unknown (Q:{quality:.2f})"
                
                # Draw enhanced bounding box
                cv2.rectangle(orig, (x1, y1), (x2, y2), color, 2)
                
                # Multi-line label with enhanced info
                cv2.putText(orig, label, (x1, y1 - 35), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
                
                if 'conditions' in info and info['conditions']:
                    conditions_text = ", ".join(info['conditions'][:2])  # Show first 2 conditions
                    cv2.putText(orig, f"Cond: {conditions_text}", (x1, y1 - 20), 
                               cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)
                
                # Quality and threshold info
                threshold_used = info.get('threshold_used', base_recognition_threshold)
                cv2.putText(orig, f"Q:{quality:.2f} T:{threshold_used:.2f}", (x1, y1 - 5), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)
            
            elif mode == "adding":
                # Single capture mode
                cv2.rectangle(orig, (x1, y1), (x2, y2), (255, 0, 0), 2)
                cv2.putText(orig, f"Adding: {add_name}", (x1, y1 - 30), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 0, 0), 2)
                cv2.putText(orig, f"Countdown: {add_countdown}", (x1, y1 - 10), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 0, 0), 2)
                
                if add_countdown <= 0:
                    # Add the face using legacy method
                    app.add_new_face(face_img, add_name)
                    mode = "recognition"
                    add_name = ""
                    print(f"[INFO] Face added successfully! Returning to recognition mode.")
            
            elif mode == "multi_adding":
                # Multi-capture mode for advanced templates
                cv2.rectangle(orig, (x1, y1), (x2, y2), (255, 165, 0), 2)  # Orange
                cv2.putText(orig, f"Multi-capture: {add_name}", (x1, y1 - 50), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 165, 0), 2)
                cv2.putText(orig, f"Captured: {len(multi_capture_buffer)}/10", (x1, y1 - 30), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 165, 0), 2)
                cv2.putText(orig, f"Quality: {quality:.2f}", (x1, y1 - 10), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 165, 0), 2)
                
                # Auto-capture high quality faces
                if quality > 0.5 and frame_count % 10 == 0:  # Every 10 frames
                    multi_capture_buffer.append(face_img.copy())
                    print(f"[INFO] Captured face {len(multi_capture_buffer)}/10 (Quality: {quality:.3f})")
                
                # Complete multi-capture
                if len(multi_capture_buffer) >= 10:
                    success = app.add_new_face_enhanced(multi_capture_buffer, add_name)
                    if success:
                        print(f"[INFO] Enhanced templates created for {add_name}!")
                    mode = "recognition"
                    add_name = ""
                    multi_capture_buffer = []

        # Enhanced UI overlay
        mode_text = f"Mode: {mode.upper()}"
        cv2.putText(orig, mode_text, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        
        # Performance metrics
        fps_text = f"Faces: {len(faces)} | Crowding: {scene_crowding}"
        cv2.putText(orig, fps_text, (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        
        if mode == "adding":
            add_countdown -= 1
        
        # Show today's attendance count
        today_count = len(app.get_today_attendance())
        cv2.putText(orig, f"Today's Attendance: {today_count}", (10, h - 20), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

        cv2.imshow("Enterprise Face Recognition System", orig)
        
        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break
        elif key == ord("a") and mode == "recognition":
            # Start adding new face (single capture)
            add_name = input("\nEnter name for new face (single capture): ").strip()
            if add_name:
                mode = "adding"
                add_countdown = 30  # 3 second countdown
                print(f"[INFO] Single capture mode activated for '{add_name}'. Position face in frame...")
            else:
                print("[INFO] Invalid name. Staying in recognition mode.")
        elif key == ord("A") and mode == "recognition":
            # Start multi-capture for enhanced templates
            add_name = input("\nEnter name for new face (multi-capture templates): ").strip()
            if add_name:
                mode = "multi_adding"
                multi_capture_buffer = []
                print(f"[INFO] Multi-capture mode activated for '{add_name}'. Move your face around for diverse angles...")
            else:
                print("[INFO] Invalid name. Staying in recognition mode.")
        elif key == ord("t"):
            # Show today's attendance
            show_attendance(app)
        elif key == ord("s"):
            # Show system statistics
            show_statistics(app)
        elif key == ord("c"):
            # Clear attendance log
            clear_attendance(app)

    cap.release()
    cv2.destroyAllWindows()
    print("[INFO] Live camera recognition closed")