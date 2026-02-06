import logging
import asyncio
from datetime import datetime, timedelta
from typing import List, Optional, Any, Dict
import ulid

from api.schemas import AttendanceEventResponse
from database.repository import AttendanceRepository
from utils.image_utils import decode_base64_image

logger = logging.getLogger(__name__)


class AttendanceService:
    def __init__(
        self,
        repo: AttendanceRepository,
        face_detector=None,
        face_recognizer=None,
        ws_manager=None,
    ):
        self.repo = repo
        self.face_detector = face_detector
        self.face_recognizer = face_recognizer
        self.ws_manager = ws_manager

    def generate_id(self) -> str:
        """Generate a unique ID"""
        return ulid.ulid()

    async def generate_person_id(self, name: str, group_id: str = None) -> str:
        """Generate a unique person ID"""
        # Generate ULID
        person_id = ulid.ulid()

        # Ensure uniqueness
        max_attempts = 10
        attempt = 0

        while attempt < max_attempts:
            existing_member = await self.repo.get_member(person_id)
            if not existing_member:
                break

            # Generate new ULID if collision occurs
            person_id = ulid.ulid()
            attempt += 1

        return person_id

    def compute_sessions_from_records(
        self,
        records: List[Any],
        members: List[Any],
        late_threshold_minutes: int,
        target_date: str,
        class_start_time: str = "08:00",
        late_threshold_enabled: bool = False,
        existing_sessions: Optional[List[Any]] = None,
    ) -> List[dict]:
        """Compute attendance sessions from records using configurable late threshold"""
        sessions = []

        # Create a map of existing sessions by person_id for quick lookup
        existing_sessions_map = {}
        if existing_sessions:
            for session in existing_sessions:
                existing_sessions_map[session.person_id] = session

        # Group records by person_id
        records_by_person = {}
        for record in records:
            person_id = record.person_id
            if person_id not in records_by_person:
                records_by_person[person_id] = []
            records_by_person[person_id].append(record)

        # Parse class start time (format: "HH:MM")
        try:
            time_parts = class_start_time.split(":")
            day_start_hour = int(time_parts[0])
            day_start_minute = int(time_parts[1])
        except (ValueError, IndexError):
            day_start_hour = 8
            day_start_minute = 0

        # Parse target date for comparison
        try:
            target_date_obj = datetime.strptime(target_date, "%Y-%m-%d").date()
        except (ValueError, TypeError):
            target_date_obj = None

        for member in members:
            person_id = member.person_id

            # Check if member was enrolled on or before target_date
            if target_date_obj is not None and member.joined_at:
                try:
                    joined_at = member.joined_at
                    # joined_at is datetime in SQLAlchemy model
                    joined_at_obj = joined_at.date()

                    if joined_at_obj and target_date_obj < joined_at_obj:
                        continue

                    today = datetime.now().date()
                    if joined_at_obj and joined_at_obj > today:
                        continue
                except (ValueError, TypeError, AttributeError) as e:
                    logger.debug(f"Error comparing dates for member {person_id}: {e}")

            person_records = records_by_person.get(person_id, [])

            if not person_records:
                existing_session = existing_sessions_map.get(person_id)
                sessions.append(
                    {
                        "id": (
                            existing_session.id
                            if existing_session
                            else self.generate_id()
                        ),
                        "person_id": person_id,
                        "group_id": member.group_id,
                        "date": target_date,
                        "check_in_time": None,
                        "status": "absent",
                        "is_late": False,
                        "late_minutes": None,
                        "notes": None,
                    }
                )
                continue

            # Sort records by timestamp (ascending)
            person_records.sort(key=lambda r: r.timestamp)

            first_record = person_records[0]
            timestamp = first_record.timestamp  # earliest check-in for the day

            if late_threshold_enabled:
                day_start = timestamp.replace(
                    hour=day_start_hour,
                    minute=day_start_minute,
                    second=0,
                    microsecond=0,
                )
                time_diff_minutes = (timestamp - day_start).total_seconds() / 60
                is_late = time_diff_minutes >= late_threshold_minutes
                late_minutes = (
                    int(time_diff_minutes - late_threshold_minutes) if is_late else 0
                )
            else:
                is_late = False
                late_minutes = 0

            existing_session = existing_sessions_map.get(person_id)
            sessions.append(
                {
                    "id": (
                        existing_session.id if existing_session else self.generate_id()
                    ),
                    "person_id": person_id,
                    "group_id": member.group_id,
                    "date": target_date,
                    "check_in_time": timestamp,
                    "status": "present",
                    "is_late": is_late,
                    "late_minutes": late_minutes if is_late else None,
                    "notes": None,
                }
            )

        return sessions

    def calculate_group_stats(self, members: List[Any], sessions: List[Any]) -> dict:
        """Calculate group attendance statistics"""
        total_members = len(members)
        present_today = 0
        absent_today = 0
        late_today = 0

        session_map = {session.person_id: session for session in sessions}

        for member in members:
            person_id = member.person_id
            session = session_map.get(person_id)

            if session:
                status = session.status
                if status == "present":
                    present_today += 1
                    if session.is_late:
                        late_today += 1
                else:
                    absent_today += 1
            else:
                absent_today += 1

        return {
            "total_members": total_members,
            "present_today": present_today,
            "absent_today": absent_today,
            "late_today": late_today,
        }

    async def process_event(
        self, event_data, member, settings
    ) -> AttendanceEventResponse:
        """Process an attendance event"""
        cooldown_seconds = settings.attendance_cooldown_seconds or 10
        relog_seconds = getattr(settings, "relog_cooldown_seconds", None) or 1800

        # Enforce cooldown(s)
        current_time = datetime.now()
        window_seconds = max(cooldown_seconds, relog_seconds)
        recent_records = await self.repo.get_records(
            person_id=event_data.person_id,
            start_date=current_time - timedelta(seconds=window_seconds),
            end_date=current_time,
            limit=20,
        )

        # Check if there's a recent record within either cooldown window.
        if recent_records:
            for record in recent_records:
                record_time = record.timestamp
                time_diff = (current_time - record_time).total_seconds()

                if time_diff < cooldown_seconds:
                    return AttendanceEventResponse(
                        id=None,
                        person_id=event_data.person_id,
                        group_id=member.group_id,
                        timestamp=current_time,
                        confidence=event_data.confidence,
                        location=event_data.location,
                        processed=False,
                        error=f"Cooldown active. Wait {int(cooldown_seconds - time_diff)}s.",
                    )

                if time_diff < relog_seconds:
                    return AttendanceEventResponse(
                        id=None,
                        person_id=event_data.person_id,
                        group_id=member.group_id,
                        timestamp=current_time,
                        confidence=event_data.confidence,
                        location=event_data.location,
                        processed=False,
                        error=f"Duplicate log blocked. Wait {int(relog_seconds - time_diff)}s.",
                    )

        # Create attendance record
        record_id = self.generate_id()
        timestamp = datetime.now()

        record_data = {
            "id": record_id,
            "person_id": event_data.person_id,
            "group_id": member.group_id,
            "timestamp": timestamp,
            "confidence": event_data.confidence,
            "location": event_data.location,
            "notes": None,
            "is_manual": False,
            "created_by": None,
        }

        # Add record
        await self.repo.add_record(record_data)

        # Create or update session for today
        today_str = timestamp.strftime("%Y-%m-%d")

        # Get group settings for late threshold calculation
        group = await self.repo.get_group(member.group_id)

        late_threshold_minutes = group.late_threshold_minutes or 15
        class_start_time = group.class_start_time or "08:00"
        late_threshold_enabled = group.late_threshold_enabled or False

        existing_session = await self.repo.get_session(event_data.person_id, today_str)

        # Preserve the earliest check-in time for the day.
        # Re-logs should create additional records but must not push check-in later.
        check_in_time = timestamp
        if existing_session and existing_session.check_in_time:
            try:
                check_in_time = min(existing_session.check_in_time, timestamp)
            except TypeError:
                # Defensive: if timezone/naive mismatch ever happens, prefer the stored value.
                check_in_time = existing_session.check_in_time

        if late_threshold_enabled:
            try:
                time_parts = class_start_time.split(":")
                day_start_hour = int(time_parts[0])
                day_start_minute = int(time_parts[1])
            except (ValueError, IndexError):
                day_start_hour = 8
                day_start_minute = 0

            # Calculate if late (based on earliest check-in)
            day_start = check_in_time.replace(
                hour=day_start_hour, minute=day_start_minute, second=0, microsecond=0
            )
            time_diff_minutes = (check_in_time - day_start).total_seconds() / 60
            is_late = time_diff_minutes >= late_threshold_minutes
            late_minutes = (
                int(time_diff_minutes - late_threshold_minutes) if is_late else 0
            )
        else:
            is_late = False
            late_minutes = 0

        session_data = {
            "id": (existing_session.id if existing_session else self.generate_id()),
            "person_id": event_data.person_id,
            "group_id": member.group_id,
            "date": today_str,
            "check_in_time": check_in_time,
            "status": "present",
            "is_late": is_late,
            "late_minutes": late_minutes if is_late else None,
            "notes": None,
        }

        await self.repo.upsert_session(session_data)

        # Broadcast attendance event
        if self.ws_manager:
            broadcast_message = {
                "type": "attendance_event",
                "data": {
                    "id": record_id,
                    "person_id": event_data.person_id,
                    "group_id": member.group_id,
                    "timestamp": timestamp.isoformat(),
                    "confidence": event_data.confidence,
                    "location": event_data.location,
                    "member_name": member.name,
                },
            }
            asyncio.create_task(self.ws_manager.broadcast(broadcast_message))

        return AttendanceEventResponse(
            id=record_id,
            person_id=event_data.person_id,
            group_id=member.group_id,
            timestamp=timestamp,
            confidence=event_data.confidence,
            location=event_data.location,
            processed=True,
            error=None,
        )

    async def register_face(
        self, group_id: str, person_id: str, request: dict
    ) -> Dict[str, Any]:
        """Register face for a person"""
        if not self.face_recognizer:
            raise ValueError("Face recognition system not available")

        # Verify group exists
        group = await self.repo.get_group(group_id)
        if not group:
            raise ValueError("Group not found")

        # Verify member exists and belongs to group
        member = await self.repo.get_member(person_id)
        if not member:
            raise ValueError("Member not found")

        if member.group_id != group_id:
            raise ValueError("Member does not belong to this group")

        # Decode and validate image
        image_data = request.get("image")
        bbox = request.get("bbox")

        if not image_data:
            raise ValueError("Image data required")

        if not bbox:
            raise ValueError("Face bounding box required")

        try:
            image = decode_base64_image(image_data)
        except Exception as e:
            raise ValueError(f"Invalid image data: {str(e)}")

        landmarks_5 = request.get("landmarks_5")
        if landmarks_5 is None:
            raise ValueError("Landmarks required from frontend face detection")

        # Register the face
        logger.info(f"Registering face for {person_id} in group {group_id}")

        result = await self.face_recognizer.register_person(
            person_id, image, landmarks_5
        )

        if result["success"]:
            logger.info(
                f"Face registered successfully for {person_id}. Total persons: {result.get('total_persons', 0)}"
            )
            return {
                "success": True,
                "message": f"Face registered successfully for {person_id} in group {group.name}",
                "person_id": person_id,
                "group_id": group_id,
                "total_persons": result.get("total_persons", 0),
            }
        else:
            logger.error(
                f"Face registration failed for {person_id}: {result.get('error', 'Unknown error')}"
            )
            raise ValueError(result.get("error", "Face registration failed"))

    async def remove_face_data(self, group_id: str, person_id: str) -> Dict[str, Any]:
        """Remove face data for a person"""
        if not self.face_recognizer:
            raise ValueError("Face recognition system not available")

        # Verify group exists
        group = await self.repo.get_group(group_id)
        if not group:
            raise ValueError("Group not found")

        # Verify member exists and belongs to group
        member = await self.repo.get_member(person_id)
        if not member:
            raise ValueError("Member not found")

        if member.group_id != group_id:
            raise ValueError("Member does not belong to this group")

        # Remove face data
        result = await self.face_recognizer.remove_person(person_id)

        if result["success"]:
            return {
                "success": True,
                "message": f"Face data removed for {person_id} in group {group.name}",
                "person_id": person_id,
                "group_id": group_id,
            }
        else:
            raise ValueError("Face data not found for this person")

    async def bulk_detect_faces_in_images(
        self, group_id: str, images_data: list
    ) -> Dict[str, Any]:
        """Detect faces in multiple images"""
        if not self.face_detector:
            raise ValueError("Face detection system not available")

        group = await self.repo.get_group(group_id)
        if not group:
            raise ValueError("Group not found")

        results = []
        from hooks import process_face_detection

        for idx, image_data in enumerate(images_data):
            try:
                # Decode image
                image_base64 = image_data.get("image")
                image_id = image_data.get("id", f"image_{idx}")

                if not image_base64:
                    results.append(
                        {
                            "image_id": image_id,
                            "success": False,
                            "error": "No image data provided",
                            "faces": [],
                        }
                    )
                    continue

                image = decode_base64_image(image_base64)
                detections = process_face_detection(image)

                if not detections:
                    results.append(
                        {
                            "image_id": image_id,
                            "success": True,
                            "faces": [],
                            "message": "No faces detected",
                        }
                    )
                    continue

                # Process each detected face
                processed_faces = []
                for face in detections:
                    processed_faces.append(
                        {
                            "bbox": face.get("bbox"),
                            "confidence": face.get("confidence", 0.0),
                            "landmarks_5": face.get("landmarks_5"),
                            "quality_score": 0.8,
                            "is_acceptable": True,
                        }
                    )

                results.append(
                    {
                        "image_id": image_id,
                        "success": True,
                        "faces": processed_faces,
                        "total_faces": len(processed_faces),
                    }
                )

            except Exception as e:
                logger.error(f"Error processing image {idx}: {e}")
                results.append(
                    {
                        "image_id": image_data.get("id"),
                        "success": False,
                        "error": str(e),
                        "faces": [],
                    }
                )

        return {
            "success": True,
            "group_id": group_id,
            "total_images": len(images_data),
            "results": results,
        }

    async def bulk_register(self, group_id: str, registrations: list) -> Dict[str, Any]:
        """Bulk register faces"""
        if not self.face_recognizer:
            raise ValueError("Face recognition system not available")

        group = await self.repo.get_group(group_id)
        if not group:
            raise ValueError("Group not found")

        success_count = 0
        failed_count = 0
        results = []

        for idx, reg_data in enumerate(registrations):
            try:
                person_id = reg_data.get("person_id")
                image_base64 = reg_data.get("image")

                member = await self.repo.get_member(person_id)
                if not member or member.group_id != group_id:
                    failed_count += 1
                    results.append(
                        {"index": idx, "success": False, "error": "Invalid member"}
                    )
                    continue

                try:
                    image = decode_base64_image(image_base64)
                except Exception:
                    failed_count += 1
                    results.append(
                        {"index": idx, "success": False, "error": "Invalid image"}
                    )
                    continue

                landmarks_5 = reg_data.get("landmarks_5")
                if landmarks_5 is None:
                    failed_count += 1
                    results.append(
                        {
                            "index": idx,
                            "person_id": person_id,
                            "success": False,
                            "error": "Landmarks required from frontend face detection",
                        }
                    )
                    continue

                result = await self.face_recognizer.register_person(
                    person_id, image, landmarks_5
                )

                if result["success"]:
                    success_count += 1
                    results.append(
                        {"index": idx, "person_id": person_id, "success": True}
                    )
                else:
                    failed_count += 1
                    results.append(
                        {
                            "index": idx,
                            "person_id": person_id,
                            "success": False,
                            "error": result.get("error"),
                        }
                    )

            except Exception as e:
                failed_count += 1
                results.append({"index": idx, "success": False, "error": str(e)})

        return {
            "success": True,
            "group_id": group_id,
            "success_count": success_count,
            "failed_count": failed_count,
            "results": results,
        }
