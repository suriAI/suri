still in development...

<!-- <h3 align="center"><img width="120" alt="Suri AI Attendance Tracker: Real-time face recognition attendance tracking that runs 100% offline" src="app/public/icons/icon-1024.png"></h3>

<h3 align="center">AI-Powered Attendance Tracking. Local-First, Privacy-Focused</h3>

Suri is a desktop application for automated attendance tracking using Artificial Intelligence.

---

## Features

### Intelligent Face Recognition
- **Multi-stage AI Pipeline**: Optimized cascade of detection → tracking → liveness → recognition
- **Deep SORT Tracking**: Maintains consistent identity across frames using appearance and motion features
- **Anti-Spoofing Protection**: 3-class liveness detection (live, print attack, replay attack) with confidence thresholding
- **Adaptive Recognition**: Group-based filtering for multi-classroom scenarios
- **Quality Assurance**: Automatic face size validation and quality checks

### Attendance Management
- **Real-time Tracking**: Instant attendance recording with configurable cooldown periods
- **Smart Sessions**: Automatic session computation with late arrival detection
- **Flexible Groups**: Multi-group support with independent settings
- **Comprehensive Reports**: Export attendance data (CSV/PDF) with detailed analytics
- **Bulk Operations**: Mass face registration and member import

### Privacy & Security
- **Local-First Architecture**: Core face recognition and attendance tracking run entirely on your machine
- **Local Storage**: SQLite databases for face data and attendance records stored locally
- **Privacy-Focused**: No telemetry or usage analytics collected by default
- **ULID-based IDs**: Cryptographically secure, collision-resistant identifiers

---

## Architecture

### Technology Stack

**Frontend (Desktop)**
- **Framework**: React 19 + Electron 37 with TypeScript
- **UI**: TailwindCSS 4 with custom components
- **State**: Real-time WebSocket + REST API integration
- **Build**: Vite with optimized bundling

**Backend (AI Engine)**
- **Server**: FastAPI (Python 3.10+) with async/await
- **AI Models**: ONNX Runtime with GPU acceleration (CUDA/DirectML/CPU fallback)
- **Database**: SQLite with optimized indexing
- **Communication**: Binary WebSocket for detection, HTTP/2 for recognition

**AI Pipeline**
```
Camera Frame
    ↓
Face Detection (Compact CNN architecture)
    ↓
Face Tracking (Deep SORT with appearance + motion)
    ↓
Liveness Detection (3-class anti-spoofing)
    ↓
Face Recognition (512-dim embeddings with cosine similarity)
    ↓
Attendance Recording (with cooldown + deduplication)
```

### System Components

#### 1. **Face Detection Module**
- Lightweight CNN-based architecture optimized for real-time performance
- Configurable input size (640×640 default for distant face detection)
- NMS (Non-Maximum Suppression) for overlapping face elimination
- Outputs: bounding boxes, confidence scores, 5-point facial landmarks
- Minimum face size filtering (80px default for liveness compatibility)

#### 2. **Face Tracking System**
- **Deep SORT Algorithm**: 
  - Kalman filter for motion prediction
  - Appearance-based matching with face embeddings (512-dim)
  - Cascade matching prioritizing recent tracks
  - Configurable weights: 70% appearance + 30% motion
- **Track Confirmation**: Requires 2 consecutive detections
- **Track Lifetime**: Maintains tracks for 30 frames without detection
- **Benefits**: Reduces false positives, maintains identity during occlusions

#### 3. **Liveness Detection**
- **3-Class Model**: Live, Print Attack, Replay Attack
- **CONFIDENCE Strategy**: 
  ```
  is_real = (live_score > spoof_score) AND (confidence >= threshold)
  ```
- **Adaptive Thresholding**: Default 0.50, adjustable per deployment
- **Attack Analysis**: Detailed statistics on attack types and distributions
- **Safety-first**: Rejects low confidence cases as spoof to prevent false positives

#### 4. **Face Recognition**
- **Embedding Extraction**: 
  - Similarity transform alignment using 5-point landmarks
  - 512-dimensional normalized embeddings (L2 normalization)
  - Batch processing support for efficiency
- **Matching Algorithm**:
  - Cosine similarity with configurable threshold (0.6 default)
  - Group-based filtering (restricts matching to specific groups)
  - Best match selection with confidence scoring
- **Database Integration**: 
  - SQLite storage with indexed lookups
  - Automatic ID updates and duplicate prevention

#### 5. **Attendance Database**
- **Schema Design**:
  - `attendance_groups`: Group metadata with settings
  - `attendance_members`: Person-to-group mapping
  - `attendance_records`: Individual check-in events
  - `attendance_sessions`: Daily attendance summaries
  - `attendance_settings`: Global configuration
- **Performance**: Indexed queries, connection pooling, thread-safe operations
- **Features**: 
  - Automatic session computation from records
  - Late arrival tracking with configurable thresholds
  - Bulk import/export support
  - Data cleanup utilities

---

## Getting Started

### Prerequisites

**System Requirements**
- **OS**: Windows 10/11, macOS 10.14+, or Linux (Ubuntu 20.04+)
- **RAM**: 4GB minimum, 8GB recommended
- **Storage**: 2GB free space
- **Camera**: USB webcam or built-in camera
- **GPU** (Optional): NVIDIA CUDA, AMD/Intel DirectML, or CPU fallback

**Software Dependencies**
- Node.js 18+ and pnpm
- Python 3.10 or 3.11
- Git

### Installation

**1. Clone Repository**
```bash
git clone https://github.com/yourusername/Suri.git
cd Suri
```

**2. Setup Backend (Python)**
```bash
cd server

# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

**3. Setup Frontend (Electron + React)**
```bash
cd app
pnpm install
```

**4. Place AI Models**
Download the ONNX model files and place them in the server weights directory:
- Face detection model
- Face recognition model
- Liveness detection model

> **Model Sources**: Contact the repository maintainer for pre-trained models, or train your own using the provided architectures.

### Running the Application

**Development Mode**
```bash
# Terminal 1 - Backend
cd server
python run.py

# Terminal 2 - Frontend
cd app
pnpm dev
```

**Production Build**
```bash
# Build backend executable
cd server
python build_backend.py

# Build Electron app
cd app
pnpm dist:win   # Windows
pnpm dist:mac   # macOS
pnpm dist:linux # Linux
```

Installer will be created in `app/dist/`

---

## 📖 Usage Guide

### First Time Setup

1. **Launch Application**: Double-click the Suri executable
2. **Create Group**: Navigate to "Groups" → "Create New Group"
   - Enter group name (e.g., "CS101 - Fall 2025")
   - Configure settings (late threshold, class start time)
3. **Add Members**: 
   - Click "Add Member" → Enter name and details
   - Optionally assign roles and emails
4. **Register Faces**:
   - Select member → "Register Face"
   - Position face in frame, ensure good lighting
   - Wait for green confirmation

### Daily Attendance Tracking

1. **Select Active Group**: Choose from group dropdown
2. **Start Camera**: Click "Start Tracking"
3. **Automatic Detection**: 
   - Faces are detected and tracked in real-time
   - Liveness check prevents photo/video spoofing
   - Recognized faces trigger attendance recording
   - Green box = recognized, Red box = unknown, Yellow = processing
4. **Monitor Dashboard**: View real-time attendance statistics
5. **Generate Reports**: Export daily/weekly/monthly reports

### Advanced Features

**Bulk Registration**
- Import CSV with member details
- Upload multiple photos (up to 50)
- Automatic face detection and quality validation
- Batch processing for efficiency

**Group Settings**
- **Late Threshold**: Minutes after class start to mark as late (default: 15)
- **Class Start Time**: Daily class start time for late calculation
- **Cooldown Period**: Seconds between repeated check-ins (default: 10)
- **Confidence Threshold**: Minimum similarity for recognition (default: 0.6)

**Export Options**
- **CSV**: Import into Excel/Google Sheets
- **PDF**: Professional reports with analytics
- **JSON**: Full database export for backup

---

## ⚙️ Configuration

### Backend Configuration

**Server Settings**
```python
SERVER_CONFIG = {
    "host": "127.0.0.1",
    "port": 8700,
    "workers": 1
}
```

**GPU Acceleration**
- **Auto-detection**: Automatically selects best available:
  1. NVIDIA CUDA (primary)
  2. AMD/Intel DirectML (fallback)
  3. CPU (final fallback)
- **Manual Override**: Set providers in `FACE_RECOGNIZER_CONFIG`

**Model Tuning**
```python
# Face Detection
FACE_DETECTOR_CONFIG = {
    "score_threshold": 0.7,      # Detection confidence
    "nms_threshold": 0.3,        # Overlap suppression
    "min_face_size": 80          # Minimum pixels
}

# Liveness Detection
LIVENESS_DETECTOR_CONFIG = {
    "confidence_threshold": 0.50  # Anti-spoofing sensitivity
}

# Face Recognition
FACE_RECOGNIZER_CONFIG = {
    "similarity_threshold": 0.6   # Match confidence
}

# Face Tracking
FACE_TRACKER_CONFIG = {
    "track_thresh": 0.5,         # Detection confidence threshold
    "match_thresh": 0.8,         # Matching threshold for association
    "track_buffer": 30,          # Buffer size for lost tracks
    "frame_rate": 30,            # Default frame rate (auto-detected per client)
    "max_iou_distance": 0.7      # Maximum IoU distance for matching
}
```

### Performance Optimization

**For High Accuracy (Labs/Offices)**
```python
FACE_DETECTOR_CONFIG["score_threshold"] = 0.8
FACE_RECOGNIZER_CONFIG["similarity_threshold"] = 0.7
LIVENESS_DETECTOR_CONFIG["confidence_threshold"] = 0.60
```

**For Speed (Large Classrooms)**
```python
FACE_DETECTOR_CONFIG["input_size"] = (480, 480)  # Smaller input
FACE_TRACKER_CONFIG["max_age"] = 20              # Faster cleanup
STREAMING_CONFIG["fps_limit"] = 10               # Lower FPS
```

**For Distant Faces (Auditoriums)**
```python
FACE_DETECTOR_CONFIG["input_size"] = (800, 800)  # Larger input
FACE_DETECTOR_CONFIG["min_face_size"] = 60       # Smaller minimum
```

---

## 🔬 Technical Deep Dive

### Face Detection Pipeline

**Stage 1: Preprocessing**
- Convert camera frame to 640×640 (maintaining aspect ratio)
- Normalize pixel values to model input range
- Color space: BGR (OpenCV native)

**Stage 2: Neural Network Inference**
- Lightweight CNN architecture
- Outputs: `[N, 15]` tensor per detection
  - `[0:4]` - Bounding box (x, y, w, h)
  - `[4:14]` - 5-point landmarks (eyes, nose, mouth)
  - `[14]` - Confidence score

**Stage 3: Post-processing**
- Non-Maximum Suppression (NMS) removes overlaps
- Coordinate scaling to original image size
- Face size filtering (removes < 80px faces)

### Deep SORT Tracking Algorithm

**Motion Model (Kalman Filter)**
```
State Vector: [x, y, aspect_ratio, height, vx, vy, vh]
Prediction: x' = F·x  (constant velocity)
Update: x = x' + K·(z - H·x')  (measurement correction)
```

**Appearance Model (Face Embeddings)**
- 512-dim normalized vectors from face recognizer
- Cosine distance for similarity: `d = 1 - (a·b / |a||b|)`
- Feature gallery: stores last 30 embeddings per track
- Matching threshold: 0.25 (stricter = fewer ID switches)

**Data Association**
1. **Cascade Matching**: Prioritizes recent tracks
2. **Hungarian Algorithm**: Optimal assignment (LAP solver)
3. **Combined Cost**: `0.7×appearance + 0.3×motion`
4. **Gating**: Rejects matches above distance thresholds

**Track Life Cycle**
```
Detection → Tentative (2 frames) → Confirmed → Deleted (30 frames no-match)
```

### Liveness Detection Strategy

**Model Architecture**
- Input: 128×128 RGB face crop with 1.5× bounding box expansion
- Output: 3-class softmax `[live, print, replay]`

**CONFIDENCE Decision Rule**
```python
spoof_score = print_score + replay_score
max_confidence = max(live_score, spoof_score)

is_real = (live_score > spoof_score) AND 
          (max_confidence >= threshold)
```

**Why This Works**
- Handles model uncertainty (low confidence on both classes)
- Prevents attacks that fool only one class
- Implements optimal Bayesian decision theory
- Industry standard for production systems

**Attack Statistics**
- Tracks distribution: live, print, replay
- Calculates average confidence per attack type
- Provides threshold sensitivity analysis

### Face Recognition Mathematics

**Embedding Extraction**
1. **Alignment**: Similarity transform using reference points
   ```
   Reference (112×112): [(38.3, 51.7), (73.5, 51.5), ...]
   Transform: T = estimateAffinePartial2D(landmarks, reference)
   Aligned = warpAffine(image, T, (112, 112))
   ```

2. **Normalization**: `x_norm = (x - 127.5) / 127.5` → [-1, 1]

3. **CNN Forward Pass**: 
   - Input: 112×112×3
   - Output: 512-dim embedding
   - L2 Normalization: `e' = e / ||e||`

**Matching Process**
```python
# Cosine similarity (since embeddings are normalized)
similarity = dot(query_embedding, database_embedding)

# Decision
if similarity >= threshold (0.6):
    return person_id
else:
    return "Unknown"
```

**Group Filtering**
```python
# Restrict search space to group members
allowed_ids = get_group_member_ids(group_id)
best_match = find_best_match(embedding, allowed_ids)
```

### Database Schema

**Attendance Groups**
```sql
CREATE TABLE attendance_groups (
    id TEXT PRIMARY KEY,              -- ULID
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP,
    settings JSON                     -- Serialized config
);
```

**Attendance Sessions**
```sql
CREATE TABLE attendance_sessions (
    id TEXT PRIMARY KEY,
    person_id TEXT,
    group_id TEXT,
    date TEXT,                        -- YYYY-MM-DD
    check_in_time TIMESTAMP,          -- Latest check-in
    status TEXT,                      -- present/absent
    is_late BOOLEAN,
    late_minutes INTEGER
);
```

**Performance Indexes**
```sql
CREATE INDEX idx_records_timestamp ON attendance_records(timestamp);
CREATE INDEX idx_sessions_date ON attendance_sessions(date);
CREATE INDEX idx_members_group_id ON attendance_members(group_id);
```

### WebSocket Protocol

**Detection Stream** (`/ws/detect/{client_id}`)
```javascript
// Client → Server (Binary)
JPEG Frame (ArrayBuffer)

// Server → Client (JSON)
{
  "type": "detection_response",
  "faces": [{
    "bbox": [x, y, w, h],
    "confidence": 0.95,
    "track_id": 42,
    "liveness": {
      "is_real": true,
      "live_score": 0.89,
      "spoof_score": 0.11,
      "status": "real"
    }
  }],
  "processing_time": 0.032
}
```

**Notification Stream** (`/ws/notifications/{client_id}`)
```javascript
// Server → Client (JSON)
{
  "type": "attendance_event",
  "data": {
    "person_id": "01ARZ3NDEK...",
    "group_id": "01ARZ3NDEK...",
    "member_name": "John Doe",
    "timestamp": "2025-10-27T14:30:00Z",
    "confidence": 0.87
  }
}
```

---

## 🔧 Troubleshooting

### Common Issues

**Backend fails to start**
```bash
# Check Python version
python --version  # Should be 3.10 or 3.11

# Verify virtual environment
which python  # Should point to venv

# Check model files exist in weights directory
```

**GPU not detected**
```python
# Check ONNX Runtime providers
import onnxruntime as ort
print(ort.get_available_providers())

# Should include: CUDAExecutionProvider (NVIDIA) or DmlExecutionProvider (AMD/Intel)
```

**Low recognition accuracy**
```python
# Increase similarity threshold (stricter matching)
FACE_RECOGNIZER_CONFIG["similarity_threshold"] = 0.7

# Increase detection threshold (fewer false detections)
FACE_DETECTOR_CONFIG["score_threshold"] = 0.8
```

**High false rejections (real faces marked as spoof)**
```python
# Lower liveness threshold (more permissive)
LIVENESS_DETECTOR_CONFIG["confidence_threshold"] = 0.45
```

**Memory issues**
```python
# Reduce track history
FACE_TRACKER_CONFIG["nn_budget"] = 20

# Reduce input size
FACE_DETECTOR_CONFIG["input_size"] = (480, 480)

# Limit concurrent tracks
FACE_TRACKER_CONFIG["max_age"] = 20
```

### Performance Benchmarks

**Typical Performance (NVIDIA GTX 1650)**
- Face Detection: ~15ms per frame
- Liveness Check: ~8ms per face
- Face Recognition: ~12ms per face
- Total Pipeline: ~30-50ms (20-30 FPS)

**CPU-only (Intel i5 8th Gen)**
- Face Detection: ~45ms per frame
- Liveness Check: ~25ms per face
- Face Recognition: ~35ms per face
- Total Pipeline: ~100-150ms (6-10 FPS)

---


## 🤝 Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines and development setup instructions.

---

## 🙏 Acknowledgments

**Frameworks & Libraries**
- [FastAPI](https://fastapi.tiangolo.com/) - Modern Python web framework
- [ONNX Runtime](https://onnxruntime.ai/) - Cross-platform inference
- [Electron](https://www.electronjs.org/) - Desktop app framework
- [React](https://react.dev/) - UI library
- [OpenCV](https://opencv.org/) - Computer vision

**AI Models & Algorithms**
- OpenCV Zoo - Face detection model
- EdgeFace - Face recognition model by Idiap Research Institute
- Silent Face Anti-Spoofing - Liveness detection model
- ByteTrack - Multi-object tracking algorithm

> **Note**: Full license texts for third-party AI models are available in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

**Inspiration**
- Face recognition research from academic community
- Anti-spoofing techniques from security research
- Open-source attendance systems

<!-- ---

## 📞 Support

**Issues & Bugs**: [GitHub Issues](https://github.com/yourusername/Suri/issues)

**Feature Requests**: [GitHub Discussions](https://github.com/yourusername/Suri/discussions)

**Documentation**: [Project Wiki](https://github.com/yourusername/Suri/wiki) -->

---

## 🗺️ Roadmap

### Version 2.0 (Planned)
- [ ] Multi-camera support (parallel processing)
- [ ] Web-based admin dashboard (SaaS-ready architecture)
- [ ] Mobile companion app (React Native)
- [ ] Advanced analytics (charts, trends, predictions)
- [ ] Integration APIs (webhooks, REST, GraphQL)

### Version 2.5 (Future)
- [ ] Edge deployment (Raspberry Pi, NVIDIA Jetson)
- [ ] Cloud sync option (encrypted, opt-in)
- [ ] Advanced fraud detection (deepfake detection)
- [ ] Multi-modal biometrics (face + gait + voice)

### Community Requests
- [ ] Docker containerization
- [ ] Kubernetes deployment
- [ ] Custom model training pipeline
- [ ] Multi-language support (i18n)

---

<div align="center">

**Built with ❤️ for education and workplace**

If you find Suri useful, please ⭐ star the repository!

[Report Bug](https://github.com/yourusername/Suri/issues) · [Request Feature](https://github.com/yourusername/Suri/discussions) · [Documentation](https://github.com/yourusername/Suri/wiki)

</div> -->
