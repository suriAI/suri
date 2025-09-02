"""
WebSocket Routes for Suri Face Recognition System

Handles WebSocket endpoint and message routing with production-ready features:
- JSON protocol validation
- Action-based message routing
- Error handling and logging
- Integration with prototype backend logic
"""

import json
import logging
import sys
import os
from datetime import datetime
from typing import Dict, Any, Optional

from fastapi import WebSocket, WebSocketDisconnect

# Import the connection manager
from .manager import connection_manager, create_success_response, create_error_response

# Set up logging
logger = logging.getLogger("suri.websocket.routes")

# Import the new SCRFD + EdgeFace system components
# No more prototype dependencies!
try:
    # The attendance system will be passed from api_server.py
    attendance_system = None  # Will be set from api_server.py
    
except ImportError as e:
    logger.error(f"Failed to initialize: {e}")
    attendance_system = None


def set_attendance_system(system):
    """Set the shared attendance system instance (now uses SCRFD + EdgeFace)."""
    global attendance_system
    attendance_system = system


async def handle_websocket_message(websocket: WebSocket, message_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle incoming WebSocket messages and route them to appropriate handlers.
    
    Args:
        websocket: The WebSocket connection
        message_data: Parsed JSON message from client
    
    Returns:
        Response dictionary to send back to client
    """
    # Extract required fields
    request_id = message_data.get("id")
    action = message_data.get("action")
    payload = message_data.get("payload", {})
    
    # Validate required fields
    if not request_id:
        return create_error_response("unknown", "unknown", "Missing 'id' field", "MISSING_ID")
    
    if not action:
        return create_error_response(request_id, "unknown", "Missing 'action' field", "MISSING_ACTION")
    
    logger.info(f"Handling WebSocket action: {action} (ID: {request_id})")
    
    try:
        # Route to appropriate handler
        if action == "ping":
            return await handle_ping(request_id, payload)
        elif action == "get_version":
            return await handle_get_version(request_id, payload)
        elif action == "sync_data":
            return await handle_sync_data(request_id, payload)
        elif action == "echo":
            return await handle_echo(request_id, payload)
        elif action == "get_system_status":
            return await handle_get_system_status(request_id, payload)
        elif action == "get_connection_info":
            return await handle_get_connection_info(request_id, payload)
        elif action == "get_today_attendance":
            return await handle_get_today_attendance(request_id, payload)
        elif action == "subscribe_attendance_updates":
            return await handle_subscribe_attendance_updates(request_id, payload)
        else:
            return create_error_response(
                request_id, 
                action, 
                f"Unknown action: {action}", 
                "UNKNOWN_ACTION"
            )
    
    except Exception as e:
        logger.error(f"Error handling action {action}: {e}")
        return create_error_response(
            request_id, 
            action, 
            f"Internal server error: {str(e)}", 
            "INTERNAL_ERROR"
        )


async def handle_ping(request_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Handle ping action - respond with pong."""
    return create_success_response(request_id, "ping", {"message": "pong"})


async def handle_get_version(request_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Handle get_version action - return Suri backend version info."""
    version_info = {
        "name": "suri-backend",
        "version": "1.0.0",
        "python_version": sys.version.split()[0],
        "platform": os.name,
        "timestamp": datetime.now().isoformat()
    }
    return create_success_response(request_id, "get_version", version_info)


async def handle_sync_data(request_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle sync_data action - synchronize data from prototype system.
    
    This function reloads/syncs the face database and attendance logs
    from the prototype system.
    """
    if not attendance_system:
        return create_error_response(
            request_id, 
            "sync_data", 
            "Attendance system not initialized", 
            "SYSTEM_NOT_READY"
        )
    
    try:
        # Reload face database for the new system
        attendance_system._load_attendance_log()
        
        # Get current stats for SCRFD + EdgeFace system
        stats = {
            "total_people": len(attendance_system.get_all_persons()),
            "attendance_records": len(attendance_system.attendance_log),
            "pipeline": "SCRFD + EdgeFace",
            "synced_at": datetime.now().isoformat()
        }
        
        logger.info(f"Data sync completed: {stats}")
        return create_success_response(request_id, "sync_data", {
            "message": "Data synchronized successfully",
            "stats": stats
        })
        
    except Exception as e:
        logger.error(f"Data sync failed: {e}")
        return create_error_response(
            request_id, 
            "sync_data", 
            f"Sync failed: {str(e)}", 
            "SYNC_ERROR"
        )


async def handle_echo(request_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Handle echo action - return the same payload for testing."""
    return create_success_response(request_id, "echo", {"echoed_payload": payload})


async def handle_get_system_status(request_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Handle get_system_status action - return current system status."""
    if not attendance_system:
        return create_error_response(
            request_id, 
            "get_system_status", 
            "Attendance system not initialized", 
            "SYSTEM_NOT_READY"
        )
    
    try:
        # Get comprehensive system status for SCRFD + EdgeFace
        people_count = len(attendance_system.get_all_persons())
        
        # Get today's attendance
        today_records = attendance_system.get_today_attendance()
        
        total_records = len(attendance_system.attendance_log)
        
        status_info = {
            "database_stats": {
                "total_people": people_count,
                "pipeline": "SCRFD + EdgeFace"
            },
            "attendance_stats": {
                "today_records": len(today_records),
                "total_records": total_records,
                "unique_people_today": len(set(r['person_id'] for r in today_records))
            },
            "system_info": {
                "detection_model": "SCRFD",
                "recognition_model": "EdgeFace-S",
                "api_version": "2.0.0"
            },
            "connections": connection_manager.get_connection_info(),
            "timestamp": datetime.now().isoformat()
        }
        
        return create_success_response(request_id, "get_system_status", status_info)
        
    except Exception as e:
        logger.error(f"System status check failed: {e}")
        return create_error_response(
            request_id, 
            "get_system_status", 
            f"Status check failed: {str(e)}", 
            "STATUS_ERROR"
        )


async def handle_get_connection_info(request_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Handle get_connection_info action - return WebSocket connection information."""
    connection_info = connection_manager.get_connection_info()
    return create_success_response(request_id, "get_connection_info", connection_info)


async def handle_get_today_attendance(request_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Handle get_today_attendance action - return today's attendance records."""
    if not attendance_system:
        return create_error_response(
            request_id, 
            "get_today_attendance", 
            "Attendance system not initialized", 
            "SYSTEM_NOT_READY"
        )
    
    try:
        # Get today's attendance records
        today_records = attendance_system.get_today_attendance()
        
        # Get additional stats
        unique_people = set(record['person_id'] for record in today_records)
        
        attendance_data = {
            "date": datetime.now().strftime('%Y-%m-%d'),
            "total_records": len(today_records),
            "unique_people": len(unique_people),
            "people_present": list(unique_people),
            "records": today_records,
            "pipeline": "SCRFD + EdgeFace",
            "last_updated": datetime.now().isoformat()
        }
        
        return create_success_response(request_id, "get_today_attendance", attendance_data)
        
    except Exception as e:
        logger.error(f"Get today attendance failed: {e}")
        return create_error_response(
            request_id, 
            "get_today_attendance", 
            f"Failed to get today's attendance: {str(e)}", 
            "ATTENDANCE_ERROR"
        )


async def handle_subscribe_attendance_updates(request_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Handle subscription to real-time attendance updates."""
    try:
        # This action doesn't need any special handling beyond the response
        # The connection manager will handle broadcasting to all connected clients
        subscription_info = {
            "message": "Successfully subscribed to real-time attendance updates",
            "events": [
                "attendance_logged",
                "database_updated",
                "person_added"
            ],
            "subscribed_at": datetime.now().isoformat()
        }
        
        return create_success_response(request_id, "subscribe_attendance_updates", subscription_info)
        
    except Exception as e:
        logger.error(f"Subscribe to attendance updates failed: {e}")
        return create_error_response(
            request_id, 
            "subscribe_attendance_updates", 
            f"Subscription failed: {str(e)}", 
            "SUBSCRIPTION_ERROR"
        )


async def websocket_endpoint(websocket: WebSocket):
    """
    Main WebSocket endpoint handler.
    
    Handles connection lifecycle and message processing.
    """
    client_info = {
        "connected_at": datetime.now().isoformat(),
        "client": websocket.client.host if websocket.client else "unknown"
    }
    
    await connection_manager.connect(websocket, client_info)
    
    try:
        while True:
            # Receive message from client
            message_text = await websocket.receive_text()
            
            try:
                # Parse JSON message
                message_data = json.loads(message_text)
                logger.debug(f"Received message: {message_data}")
                
            except json.JSONDecodeError as e:
                # Send JSON parse error response
                error_response = create_error_response(
                    "unknown", 
                    "unknown", 
                    f"Invalid JSON: {str(e)}", 
                    "JSON_PARSE_ERROR"
                )
                await connection_manager.send_personal_message(error_response, websocket)
                continue
            
            # Handle the message and get response
            response = await handle_websocket_message(websocket, message_data)
            
            # Send response back to client
            await connection_manager.send_personal_message(response, websocket)
    
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        connection_manager.disconnect(websocket)
