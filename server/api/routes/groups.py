import logging
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query, Depends

from api.schemas import (
    AttendanceGroupCreate,
    AttendanceGroupUpdate,
    AttendanceGroupResponse,
    SuccessResponse,
)
from api.deps import get_repository
from database.repository import AttendanceRepository
from services.attendance_service import AttendanceService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/groups", tags=["groups"])

@router.post("", response_model=AttendanceGroupResponse)
async def create_group(
    group_data: AttendanceGroupCreate,
    repo: AttendanceRepository = Depends(get_repository),
):
    """Create a new attendance group"""
    try:
        service = AttendanceService(repo)
        group_id = service.generate_id()

        db_group_data = {
            "id": group_id,
            "name": group_data.name,
            "description": group_data.description,
            "settings": group_data.settings.model_dump() if group_data.settings else {},
        }

        created_group = await repo.create_group(db_group_data)
        return created_group

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating group: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.get("", response_model=List[AttendanceGroupResponse])
async def get_groups(
    active_only: bool = Query(True, description="Return only active groups"),
    repo: AttendanceRepository = Depends(get_repository),
):
    """Get all attendance groups"""
    try:
        groups = await repo.get_groups(active_only=active_only)
        return groups

    except Exception as e:
        logger.error(f"Error getting groups: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.get("/{group_id}", response_model=AttendanceGroupResponse)
async def get_group(
    group_id: str, repo: AttendanceRepository = Depends(get_repository)
):
    """Get a specific attendance group"""
    try:
        group = await repo.get_group(group_id)
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")

        return group

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting group {group_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.put("/{group_id}", response_model=AttendanceGroupResponse)
async def update_group(
    group_id: str,
    updates: AttendanceGroupUpdate,
    repo: AttendanceRepository = Depends(get_repository),
):
    """Update an attendance group"""
    try:
        existing_group = await repo.get_group(group_id)
        if not existing_group:
            raise HTTPException(status_code=404, detail="Group not found")

        update_data = {}
        for field, value in updates.model_dump(exclude_unset=True).items():
            if field == "settings" and value:
                if isinstance(value, dict):
                    update_data[field] = value
                else:
                    update_data[field] = value.model_dump()
            elif value is not None:
                update_data[field] = value

        if not update_data:
            return existing_group

        updated_group = await repo.update_group(group_id, update_data)
        if not updated_group:
            raise HTTPException(status_code=500, detail="Failed to update group")

        return updated_group

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating group {group_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.delete("/{group_id}", response_model=SuccessResponse)
async def delete_group(
    group_id: str, repo: AttendanceRepository = Depends(get_repository)
):
    """Delete (deactivate) an attendance group"""
    try:
        success = await repo.delete_group(group_id)
        if not success:
            raise HTTPException(status_code=404, detail="Group not found")

        return SuccessResponse(message=f"Group {group_id} deleted successfully")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting group {group_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.get("/{group_id}/persons", response_model=List[dict])
async def get_group_persons(
    group_id: str, repo: AttendanceRepository = Depends(get_repository)
):
    """Get all registered persons for a specific group"""
    try:
        from core.lifespan import face_recognizer

        group = await repo.get_group(group_id)
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")

        members = await repo.get_group_members(group_id)

        if not face_recognizer:
            return [
                {
                    "person_id": member.person_id,
                    "name": member.name,
                    "has_face_data": False,
                }
                for member in members
            ]

        persons_with_face_data = []
        all_persons = await face_recognizer.get_all_persons()

        for member in members:
            has_face_data = member.person_id in all_persons
            persons_with_face_data.append(
                {
                    "person_id": member.person_id,
                    "name": member.name,
                    "role": member.role,
                    "email": member.email,
                    "has_face_data": has_face_data,
                    "joined_at": member.joined_at,
                }
            )

        return persons_with_face_data

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting group persons: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.post("/{group_id}/persons/{person_id}/register-face")
async def register_face_for_group_person(
    group_id: str,
    person_id: str,
    request: dict,
    repo: AttendanceRepository = Depends(get_repository),
):
    """Register face data for a specific person in a group with anti-duplicate protection"""
    try:
        from core.lifespan import face_recognizer
        service = AttendanceService(repo, face_recognizer=face_recognizer)
        try:
            return await service.register_face(group_id, person_id, request)
        except ValueError as e:
            if "not found" in str(e).lower():
                raise HTTPException(status_code=404, detail=str(e))
            else:
                raise HTTPException(status_code=400, detail=str(e))

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error registering face for group person: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.delete("/{group_id}/persons/{person_id}/face-data")
async def remove_face_data_for_group_person(
    group_id: str,
    person_id: str,
    repo: AttendanceRepository = Depends(get_repository),
):
    """Remove face data for a specific person in a group"""
    try:
        from core.lifespan import face_recognizer
        service = AttendanceService(repo, face_recognizer=face_recognizer)
        try:
            return await service.remove_face_data(group_id, person_id)
        except ValueError as e:
            if "not found" in str(e).lower():
                raise HTTPException(status_code=404, detail=str(e))
            else:
                raise HTTPException(status_code=400, detail=str(e))

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error removing face data: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.post("/{group_id}/bulk-detect-faces")
async def bulk_detect_faces(
    group_id: str, request: dict, repo: AttendanceRepository = Depends(get_repository)
):
    """Detect faces in multiple uploaded images for bulk registration"""
    try:
        from core.lifespan import face_detector
        images_data = request.get("images", [])
        if not images_data:
            raise HTTPException(status_code=400, detail="No images provided")

        service = AttendanceService(repo, face_detector=face_detector)
        return await service.bulk_detect_faces_in_images(group_id, images_data)

    except ValueError as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        else:
            raise HTTPException(status_code=400, detail=str(e))

@router.post("/{group_id}/bulk-register-faces")
async def bulk_register_faces(
    group_id: str, request: dict, repo: AttendanceRepository = Depends(get_repository)
):
    """Register multiple faces in bulk"""
    try:
        from core.lifespan import face_recognizer
        registrations = request.get("registrations", [])
        if not registrations:
            raise HTTPException(status_code=400, detail="No registrations provided")

        service = AttendanceService(repo, face_recognizer=face_recognizer)
        return await service.bulk_register(group_id, registrations)
    except ValueError as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        else:
            raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error in bulk face registration: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
