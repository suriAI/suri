#!/usr/bin/env python3
"""
Suri Face Recognition Pipeline
SCRFD Detection + EdgeFace Recognition with ONNX Runtime
"""

import cv2
import argparse
import time
import numpy as np
import os
from typing import Optional

from models import SCRFD, EdgeFace, FaceDatabase


class FaceRecognitionPipeline:
    """Main face recognition pipeline using SCRFD + EdgeFace."""
    
    def __init__(
        self,
        detection_weights: str = "weights/det_500m.onnx",
        recognition_weights: str = "weights/edgeface-recognition.onnx",
        similarity_threshold: float = 0.6
    ):
        """Initialize the face recognition pipeline.
        
        Args:
            detection_weights (str): Path to SCRFD detection model
            recognition_weights (str): Path to EdgeFace recognition model
            similarity_threshold (float): Similarity threshold for face matching
        """
        print("Loading SCRFD face detection model...")
        self.detector = SCRFD(
            model_path=detection_weights,
            conf_thres=0.5,
            iou_thres=0.4
        )
        
        print("Loading EdgeFace recognition model...")
        self.recognizer = EdgeFace(model_path=recognition_weights)
        
        print("Initializing face database...")
        self.face_db = FaceDatabase(similarity_threshold=similarity_threshold)
        
        # Load any existing face database
        self._load_face_database()
        
        print("Pipeline initialized successfully!")

    def _load_face_database(self):
        """Load face database from disk if it exists."""
        # For now, we'll start with an empty database
        # In a real implementation, you could load from JSON/pickle file
        pass

    def process_frame(self, frame: np.ndarray) -> np.ndarray:
        """Process a single frame for face detection and recognition.
        
        Args:
            frame (np.ndarray): Input frame
            
        Returns:
            np.ndarray: Processed frame with bounding boxes and labels
        """
        # Detect faces
        detections, keypoints = self.detector.detect(frame)
        
        if detections is None or len(detections) == 0:
            return frame
            
        # Process each detected face
        for i, (detection, kps) in enumerate(zip(detections, keypoints)):
            x1, y1, x2, y2, conf = detection
            x1, y1, x2, y2 = map(int, [x1, y1, x2, y2])
            
            # Draw bounding box
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
            
            # Draw confidence score
            cv2.putText(
                frame, f"Conf: {conf:.2f}", (x1, y1 - 30),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2
            )
            
            # Perform face recognition if keypoints are available
            if kps is not None and len(kps) >= 5:
                try:
                    # Extract face embedding
                    embedding = self.recognizer(frame, kps)
                    
                    # Identify face
                    person_id, similarity = self.face_db.identify_face(embedding)
                    
                    if person_id is not None:
                        # Known person
                        label = f"{person_id} ({similarity:.2f})"
                        color = (0, 255, 0)  # Green for known faces
                    else:
                        # Unknown person
                        label = f"Unknown ({len(self.face_db.get_all_persons())})"
                        color = (0, 0, 255)  # Red for unknown faces
                        
                    # Draw label
                    cv2.putText(
                        frame, label, (x1, y1 - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2
                    )
                    
                    # Draw keypoints for debugging
                    self._draw_keypoints(frame, kps)
                    
                except Exception as e:
                    print(f"Recognition error: {e}")
                    cv2.putText(
                        frame, "Recognition Error", (x1, y1 - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2
                    )
        
        return frame

    def _draw_keypoints(self, frame: np.ndarray, keypoints: np.ndarray):
        """Draw facial keypoints on the frame."""
        colors = [
            (0, 0, 255),   # Red
            (0, 255, 0),   # Green  
            (255, 0, 0),   # Blue
            (0, 255, 255), # Yellow
            (255, 0, 255)  # Magenta
        ]
        
        for idx, point in enumerate(keypoints):
            point = point.astype(np.int32)
            color = colors[idx % len(colors)]
            cv2.circle(frame, tuple(point), 3, color, -1)

    def run_webcam(self, camera_id: int = 0):
        """Run face recognition on webcam feed.
        
        Args:
            camera_id (int): Camera device ID (0 for default camera)
        """
        cap = cv2.VideoCapture(camera_id)
        if not cap.isOpened():
            print(f"Failed to open camera {camera_id}")
            return

        print("Starting webcam feed. Press 'q' to quit, 'r' to register face...")
        
        frame_count = 0
        start_time = time.time()
        
        while True:
            ret, frame = cap.read()
            if not ret:
                print("Failed to read frame")
                break

            frame_start = time.time()
            
            # Process frame
            processed_frame = self.process_frame(frame)
            
            frame_time = time.time() - frame_start
            frame_count += 1
            
            # Calculate and display FPS
            elapsed_time = time.time() - start_time
            fps = frame_count / elapsed_time if elapsed_time > 0 else 0
            
            cv2.putText(
                processed_frame, f"FPS: {fps:.1f}", (10, 30),
                cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2
            )
            cv2.putText(
                processed_frame, f"Frame: {frame_time*1000:.1f}ms", (10, 70),
                cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2
            )
            cv2.putText(
                processed_frame, f"Faces in DB: {len(self.face_db.get_all_persons())}", (10, 110),
                cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 0), 2
            )

            cv2.imshow("Suri Face Recognition", processed_frame)
            
            key = cv2.waitKey(1) & 0xFF
            if key == ord('q'):
                break
            elif key == ord('r'):
                self._register_face_interactive(frame)

        cap.release()
        cv2.destroyAllWindows()

    def _register_face_interactive(self, frame: np.ndarray):
        """Interactive face registration from current frame."""
        detections, keypoints = self.detector.detect(frame)
        
        if detections is None or len(detections) == 0:
            print("No faces detected for registration")
            return
            
        if len(detections) > 1:
            print(f"Multiple faces detected ({len(detections)}). Using the largest face.")
            
        # Use the first (largest) detection
        detection, kps = detections[0], keypoints[0]
        
        try:
            # Extract embedding
            embedding = self.recognizer(frame, kps)
            
            # Get person ID from user
            person_id = input("Enter person ID/name: ").strip()
            if person_id:
                self.face_db.add_person(person_id, embedding)
                print(f"Registered face for '{person_id}'")
            else:
                print("Registration cancelled - no ID provided")
                
        except Exception as e:
            print(f"Failed to register face: {e}")

    def run_image(self, image_path: str, output_path: Optional[str] = None):
        """Run face recognition on a single image.
        
        Args:
            image_path (str): Path to input image
            output_path (Optional[str]): Path to save output image
        """
        frame = cv2.imread(image_path)
        if frame is None:
            print(f"Failed to load image: {image_path}")
            return

        print(f"Processing image: {image_path}")
        processed_frame = self.process_frame(frame)

        if output_path:
            cv2.imwrite(output_path, processed_frame)
            print(f"Output saved to: {output_path}")

        cv2.imshow("Suri Face Recognition", processed_frame)
        cv2.waitKey(0)
        cv2.destroyAllWindows()


def main():
    """Main function to run face recognition pipeline."""
    parser = argparse.ArgumentParser(description="Suri Face Recognition Pipeline")
    parser.add_argument(
        '--detection-weights',
        type=str,
        default="weights/det_500m.onnx",
        help='Path to SCRFD detection model'
    )
    parser.add_argument(
        '--recognition-weights',
        type=str,
        default="weights/edgeface-recognition.onnx",
        help='Path to EdgeFace recognition model'
    )
    parser.add_argument(
        '--source',
        type=str,
        default="0",
        help='Input source: camera ID (0, 1, ...) or image/video path'
    )
    parser.add_argument(
        '--output',
        type=str,
        help='Output path for processed image/video'
    )
    parser.add_argument(
        '--similarity-threshold',
        type=float,
        default=0.6,
        help='Similarity threshold for face matching (0.0-1.0)'
    )
    
    args = parser.parse_args()

    # Verify model files exist
    if not os.path.exists(args.detection_weights):
        print(f"Detection model not found: {args.detection_weights}")
        return
    if not os.path.exists(args.recognition_weights):
        print(f"Recognition model not found: {args.recognition_weights}")
        return

    # Initialize pipeline
    pipeline = FaceRecognitionPipeline(
        detection_weights=args.detection_weights,
        recognition_weights=args.recognition_weights,
        similarity_threshold=args.similarity_threshold
    )

    # Run based on source type
    if args.source.isdigit():
        # Camera input
        camera_id = int(args.source)
        pipeline.run_webcam(camera_id)
    elif args.source.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp')):
        # Image input
        pipeline.run_image(args.source, args.output)
    else:
        print(f"Unsupported source type: {args.source}")
        print("Supported: camera ID (0, 1, ...) or image file (.jpg, .png, etc.)")


if __name__ == "__main__":
    main()

