from datetime import datetime
from typing import Dict, List, Optional
from pydantic import BaseModel, Field, validator
from enum import Enum


class AttendanceStatus(str, Enum):
    PRESENT = "present"
    ABSENT = "absent"


# Group Models
class GroupSettings(BaseModel):
    late_threshold_minutes: Optional[int] = 15
    late_threshold_enabled: bool = False  # OFF by default
    class_start_time: Optional[str] = "08:00"  # HH:MM format


class AttendanceGroupCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    settings: Optional[GroupSettings] = None


class AttendanceGroupUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    settings: Optional[GroupSettings] = None
    is_active: Optional[bool] = None


class AttendanceGroupResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    created_at: datetime
    is_active: bool
    settings: GroupSettings


# Member Models
class AttendanceMemberCreate(BaseModel):
    person_id: Optional[str] = Field(None, min_length=1, max_length=100, description="Optional - will be auto-generated if not provided")
    group_id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1, max_length=100)
    role: Optional[str] = Field(None, max_length=100)
    email: Optional[str] = Field(None, max_length=255)


class AttendanceMemberUpdate(BaseModel):
    group_id: Optional[str] = None
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    role: Optional[str] = Field(None, max_length=100)
    email: Optional[str] = Field(None, max_length=255)
    is_active: Optional[bool] = None


class AttendanceMemberResponse(BaseModel):
    person_id: str
    group_id: str
    name: str
    role: Optional[str]
    email: Optional[str]
    joined_at: datetime
    is_active: bool


# Record Models
class AttendanceRecordCreate(BaseModel):
    person_id: str = Field(..., min_length=1)
    timestamp: Optional[datetime] = None
    confidence: float = Field(1.0, ge=0.0, le=1.0)
    location: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = Field(None, max_length=500)
    is_manual: bool = False
    created_by: Optional[str] = Field(None, max_length=100)


class AttendanceRecordResponse(BaseModel):
    id: str
    person_id: str
    group_id: str
    timestamp: datetime
    confidence: float
    location: Optional[str]
    notes: Optional[str]
    is_manual: bool
    created_by: Optional[str]


# Session Models
class AttendanceSessionResponse(BaseModel):
    id: str
    person_id: str
    group_id: str
    date: str  # YYYY-MM-DD format
    check_in_time: Optional[datetime]
    total_hours: Optional[float]
    status: AttendanceStatus
    is_late: bool
    late_minutes: Optional[int]
    notes: Optional[str]


# Event Models
class AttendanceEventCreate(BaseModel):
    person_id: str = Field(..., min_length=1)
    confidence: float = Field(..., ge=0.0, le=1.0)
    location: Optional[str] = Field(None, max_length=255)


class AttendanceEventResponse(BaseModel):
    id: Optional[str]
    person_id: str
    group_id: str
    timestamp: datetime
    confidence: float
    location: Optional[str]
    processed: bool
    error: Optional[str]


# Settings Models
class AttendanceSettingsUpdate(BaseModel):
    late_threshold_minutes: Optional[int] = Field(None, ge=0, le=120)
    enable_location_tracking: Optional[bool] = None
    confidence_threshold: Optional[float] = Field(None, ge=0.0, le=1.0)
    attendance_cooldown_seconds: Optional[int] = Field(None, ge=1, le=300)


class AttendanceSettingsResponse(BaseModel):
    late_threshold_minutes: int
    enable_location_tracking: bool
    confidence_threshold: float
    attendance_cooldown_seconds: int


# Statistics Models
class AttendanceStatsResponse(BaseModel):
    total_members: int
    present_today: int
    absent_today: int
    late_today: int
    average_hours_today: float
    total_hours_today: float


class MemberReportData(BaseModel):
    person_id: str
    name: str
    total_days: int
    present_days: int
    absent_days: int
    late_days: int
    total_hours: float
    average_hours: float
    attendance_rate: float


class ReportSummary(BaseModel):
    total_working_days: int
    average_attendance_rate: float
    total_hours_logged: float
    most_punctual: str
    most_absent: str


class AttendanceReportResponse(BaseModel):
    group_id: str
    date_range: Dict[str, datetime]
    members: List[MemberReportData]
    summary: ReportSummary


# Query Models
class AttendanceRecordsQuery(BaseModel):
    group_id: Optional[str] = None
    person_id: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    limit: Optional[int] = Field(None, ge=1, le=1000)


class AttendanceSessionsQuery(BaseModel):
    group_id: Optional[str] = None
    person_id: Optional[str] = None
    start_date: Optional[str] = None  # YYYY-MM-DD format
    end_date: Optional[str] = None    # YYYY-MM-DD format


class AttendanceReportQuery(BaseModel):
    group_id: str = Field(..., min_length=1)
    start_date: datetime
    end_date: datetime

    @validator('end_date')
    def end_date_must_be_after_start_date(cls, v, values):
        if 'start_date' in values and v <= values['start_date']:
            raise ValueError('end_date must be after start_date')
        return v


# Response Models
class SuccessResponse(BaseModel):
    success: bool = True
    message: str


class ErrorResponse(BaseModel):
    success: bool = False
    error: str
    detail: Optional[str] = None


class DatabaseStatsResponse(BaseModel):
    total_groups: int
    total_members: int
    total_records: int
    total_sessions: int
    database_path: str
    database_size_bytes: int
    database_size_mb: float


# Bulk Operations Models
class BulkMemberCreate(BaseModel):
    members: List[AttendanceMemberCreate] = Field(..., min_items=1, max_items=100)


class BulkMemberResponse(BaseModel):
    success_count: int
    error_count: int
    errors: List[Dict[str, str]] = []


class ExportDataResponse(BaseModel):
    groups: List[AttendanceGroupResponse]
    members: List[AttendanceMemberResponse]
    records: List[AttendanceRecordResponse]
    sessions: List[AttendanceSessionResponse]
    settings: AttendanceSettingsResponse
    exported_at: datetime


class ImportDataRequest(BaseModel):
    data: ExportDataResponse
    overwrite_existing: bool = False


class CleanupRequest(BaseModel):
    days_to_keep: int = Field(90, ge=1, le=365)