# Features

Suri provides a local attendance system focused on speed and data security.

## Core Recognition Engine

### Biometric Authentication
Uses a pipeline of neural networks to verify identity.
- **Fast Detection**: Finds faces in **<10ms** using lightweight models.
- **Liveness Detection**: Blocks photos, screens, and masks by analyzing depth and texture.
- **Vector Matching**: Uses Cosine Similarity to compare 512-dimensional vectors. Stable even if someone is wearing glasses or partially blocked.

### Identity Tracking
Maintains identity consistency across video frames.
- **Handling occlusions**: Keeps track of people even if they're moving fast or temporarily blocked from view.
- **Smoothing**: Uses **Kalman Filtering** to prevent "jittery" tracking and predict positions accurately.

## Management Tools

### Configuration
- **Grouping**: Organize users into Classes, Teams, or Zones.
- **Attendance Rules**: Define specific times for "Late", "Absent", or "Present" status.

### Real-Time Monitoring
- **Live Dashboard**: View attendance status as it happens.
- **Analytics**: Visualization of attendance frequency over time.

## Data Export

- **CSV Export**: Download raw attendance logs for external processing (Excel, ERPS).

## Suri Cloud (Optional)

For teams that need multi-device management, the optional **Pro** tier adds:

### 1. Hybrid Sync
- **Secure Encrypted Sync**: Biometric data is encrypted (E2EE) before upload.
- **Web Dashboard**: View attendance reports from any browser without exposing raw face data.

### 2. Organization Management
- **Role Based Access**: Assign Admins and Viewers.
- **Centralized Settings**: Push configuration timelines to all connected kiosks.
