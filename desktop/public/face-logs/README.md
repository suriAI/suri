# Face Detection Logs Database

This folder contains the face detection logs in a simple, organized format.

## Structure

```
face-logs/
├── daily/              # Daily log files
│   ├── 2024-01-15.json # Logs for specific dates
│   └── 2024-01-16.json
├── people/             # Individual person logs
│   ├── john_doe.json   # All logs for specific person
│   └── jane_smith.json
├── summary.json        # Overall statistics
└── README.md          # This file
```

## File Formats

### Daily Logs (`daily/*.json`)
```json
{
  "date": "2024-01-15",
  "total_detections": 45,
  "unique_people": 3,
  "logs": [
    {
      "id": "1705123456789_john_doe",
      "timestamp": "2024-01-15T08:30:45.123Z",
      "personId": "john_doe",
      "confidence": 0.95,
      "mode": "auto",
      "processed_time": "2024-01-15T08:30:45.789Z"
    }
  ]
}
```

### Person Logs (`people/*.json`)
```json
{
  "personId": "john_doe",
  "total_detections": 156,
  "first_detected": "2024-01-01T09:00:00.000Z",
  "last_detected": "2024-01-15T17:30:00.000Z",
  "recent_logs": [
    {
      "id": "1705123456789_john_doe",
      "timestamp": "2024-01-15T08:30:45.123Z",
      "confidence": 0.95,
      "mode": "auto"
    }
  ]
}
```

### Summary (`summary.json`)
```json
{
  "total_people": 25,
  "total_detections": 1250,
  "today_detections": 12,
  "last_updated": "2024-01-15T17:30:00.000Z",
  "daily_stats": {
    "2024-01-15": 12,
    "2024-01-14": 8
  }
}
```

## Manual Editing

You can manually edit these files to:
- Add/remove detection logs
- Modify person information
- Update statistics
- Clean up old data

**Note**: Restart the application after manual changes to reload the data.
