# Late Attendance System - How It Works

## Overview
The attendance system now uses **actual class/work start times** instead of a hardcoded default, making late calculations accurate and flexible for different schedules.

---

## 🎯 Key Features

### 1. **Configurable Class Start Time**
- Each group can set their actual class/work start time (e.g., 7:30 AM, 9:00 AM, 1:00 PM)
- Set via **Settings tab** in the dashboard
- Uses 24-hour format (HH:MM) - e.g., "08:00" for 8:00 AM, "13:30" for 1:30 PM
- Default: 08:00 (8:00 AM)

### 2. **Configurable Late Threshold**
- Teachers can set how many minutes after class start time is considered "late"
- Range: 5-60 minutes (adjustable via slider)
- Default: 15 minutes
- Example: If class starts at 8:00 AM and threshold is 10 minutes, anyone arriving after 8:10 AM is marked late

---

## 📊 How Late Status is Calculated

### Formula:
```
Class Start Time + Late Threshold = Late Cutoff Time

If First Check-in Time > Late Cutoff Time → LATE
If First Check-in Time ≤ Late Cutoff Time → PRESENT
```

### Example Scenarios:

#### Scenario 1: Regular Class
- **Class Start Time**: 8:00 AM
- **Late Threshold**: 15 minutes
- **Late Cutoff**: 8:15 AM

| Student | Check-in Time | Status | Minutes Late |
|---------|---------------|--------|--------------|
| Juan    | 7:45 AM       | Present | - |
| Maria   | 8:10 AM       | Present | - |
| Pedro   | 8:20 AM       | **Late** | 5 minutes |
| Ana     | 8:30 AM       | **Late** | 15 minutes |

#### Scenario 2: Afternoon Class
- **Class Start Time**: 1:00 PM (13:00)
- **Late Threshold**: 10 minutes
- **Late Cutoff**: 1:10 PM (13:10)

| Student | Check-in Time | Status | Minutes Late |
|---------|---------------|--------|--------------|
| Carlo   | 12:55 PM      | Present | - |
| Lisa    | 1:05 PM       | Present | - |
| Mark    | 1:15 PM       | **Late** | 5 minutes |

---

## 🔧 Configuration Guide

### Setting Up Class Start Time:

1. Open **Menu** → Select your group
2. Go to **Settings** tab
3. Find "**Attendance settings**" section
4. Set "**Class start time**" using the time picker
5. Adjust "**Late threshold**" slider (5-60 minutes)
6. Changes save automatically

### Visual Reference:
```
┌─────────────────────────────────────────┐
│ Attendance settings                     │
├─────────────────────────────────────────┤
│                                         │
│ Class start time         08:00         │
│ [Time Picker: HH:MM]                    │
│ ▸ Actual time when class/work starts   │
│                                         │
│ Late threshold (minutes)   15 min      │
│ [━━━━━●━━━━━━━━] 5 min ↔ 60 min       │
│ ▸ Grace period after start time        │
│                                         │
└─────────────────────────────────────────┘
```

---

## 📈 How Sessions Are Computed

### Automatic Session Creation:
1. When stats/reports are requested, the system checks if sessions exist for that date
2. If no sessions found, they're computed **on-the-fly** from attendance records
3. For each member:
   - Find their **first check-in** of the day
   - Compare to: `Class Start Time + Late Threshold`
   - Assign status: `PRESENT` or `LATE`
   - Calculate minutes late if applicable
4. Sessions are saved to database for future queries

### Session Status Logic:
```python
first_checkin = member's earliest attendance record for the day
class_start = group's configured start time (e.g., 08:00)
late_cutoff = class_start + late_threshold_minutes

if first_checkin <= late_cutoff:
    status = "PRESENT"
    is_late = False
else:
    status = "LATE"
    is_late = True
    late_minutes = (first_checkin - late_cutoff) in minutes
```

---

## 💡 Best Practices

### For Schools:
- Set different start times for different grade levels/sections
- Use 10-15 minute thresholds for elementary, 5-10 for high school
- Morning class: 7:30 AM or 8:00 AM
- Afternoon class: 1:00 PM

### For Workplaces:
- Set actual shift start times (e.g., 8:00 AM, 9:00 AM, flexible hours)
- Use 5-10 minute thresholds for strict punctuality
- Different thresholds for different departments if needed

### For Events:
- Set event start time accurately
- Use shorter thresholds (5 minutes) for formal events
- Longer thresholds (30-60 minutes) for casual gatherings

---

## 🎨 UI Improvements

### Color Coding:
- **Emerald/Green** 🟢 → Present (on time)
- **Amber/Yellow** 🟡 → Late (after threshold)
- **Rose/Red** 🔴 → Absent (no check-in)

### Dashboard Sections:
1. **Overview**: Today's attendance snapshot
2. **Members**: Individual status with late minutes shown
3. **Reports**: Historical data with accurate percentages
4. **Settings**: Configure times and thresholds

---

## 🔍 Technical Details

### Database Schema:
```sql
-- Groups table now includes class_start_time
attendance_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    class_start_time TEXT DEFAULT '08:00',  -- NEW FIELD
    late_threshold_minutes INTEGER,
    ...
)

-- Sessions store computed late status
attendance_sessions (
    id TEXT PRIMARY KEY,
    person_id TEXT,
    date TEXT,
    status TEXT,  -- 'present', 'late', 'absent'
    is_late BOOLEAN,
    late_minutes INTEGER,  -- NULL if not late
    ...
)
```

### API Endpoints:
- `GET /attendance/groups/{id}` - Returns group with settings including `class_start_time`
- `PUT /attendance/groups/{id}` - Update group settings
- `GET /attendance/sessions` - Auto-computes sessions if missing
- `GET /attendance/groups/{id}/stats` - Uses group's start time for calculations

---

## ❓ FAQ

**Q: What happens if I change the class start time?**
A: Old sessions remain unchanged. New sessions computed after the change will use the new start time.

**Q: Can different groups have different start times?**
A: Yes! Each group has its own configurable start time and late threshold.

**Q: What if someone checks in very early (e.g., 6:00 AM)?**
A: They're marked as "present" (not late). Early arrivals are never penalized.

**Q: What if no one attends a particular day?**
A: The report only counts days where at least one person checked in. Empty days aren't counted against attendance percentage.

**Q: Can I see who arrived earliest?**
A: Yes, check the "Recent activity" in Overview tab - it shows all check-ins with timestamps.

---

## 🚀 Example Use Cases

### Elementary School
```
Class Start Time: 7:30 AM
Late Threshold: 15 minutes
Late Cutoff: 7:45 AM

Result: Students arriving after 7:45 AM are marked late
```

### Office (Flexible Hours)
```
Class Start Time: 9:00 AM
Late Threshold: 30 minutes
Late Cutoff: 9:30 AM

Result: Employees have 30-minute grace period
```

### Training Session
```
Class Start Time: 2:00 PM
Late Threshold: 5 minutes
Late Cutoff: 2:05 PM

Result: Strict punctuality for professional training
```

---

## 📝 Summary

The new system is **more accurate and flexible** because:
✅ Uses actual class/work start times instead of hardcoded defaults
✅ Customizable per group/section
✅ Automatic session computation from records
✅ Clear visual feedback with color coding
✅ Grace period configurable (5-60 minutes)
✅ Reports only count actual attendance days
✅ Early arrivals never penalized

This makes attendance tracking fair, accurate, and adaptable to any schedule! 🎉
