"""
WebSocket manager for handling real-time streaming connections
"""

import asyncio
import json
import logging
from typing import Dict, Set, Optional
from datetime import datetime

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages WebSocket connections for real-time streaming"""

    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.connection_metadata: Dict[str, dict] = {}
        self.streaming_tasks: Dict[str, asyncio.Task] = {}
        self.fps_tracking: Dict[str, dict] = {}

    async def connect(self, websocket: WebSocket, client_id: str) -> bool:
        """
        Accept a new WebSocket connection

        Args:
            websocket: WebSocket connection
            client_id: Unique client identifier

        Returns:
            True if connection successful, False otherwise
        """
        try:
            await websocket.accept()
            self.active_connections[client_id] = websocket
            self.connection_metadata[client_id] = {
                "connected_at": datetime.now(),
                "last_activity": datetime.now(),
                "message_count": 0,
                "streaming": False,
            }
            self.fps_tracking[client_id] = {
                "timestamps": [],
                "max_samples": 30,
                "last_update": datetime.now(),
                "current_fps": 30,
            }

            # Send welcome message
            await self.send_personal_message(
                {
                    "type": "connection",
                    "status": "connected",
                    "client_id": client_id,
                    "timestamp": datetime.now().isoformat(),
                },
                client_id,
            )

            return True

        except Exception as e:
            logger.error(f"Failed to connect client {client_id}: {e}")
            return False

    async def disconnect(self, client_id: str):
        """
        Disconnect a client

        Args:
            client_id: Client identifier to disconnect
        """
        if client_id in self.active_connections:
            websocket = self.active_connections[client_id]

            # Cancel streaming task if active
            if client_id in self.streaming_tasks:
                self.streaming_tasks[client_id].cancel()
                del self.streaming_tasks[client_id]

            # Close the WebSocket connection
            try:
                await websocket.close(code=1008, reason="Idle timeout")
            except Exception as e:
                logger.warning(f"Error closing websocket for {client_id}: {e}")

            # Remove connection
            del self.active_connections[client_id]
            if client_id in self.connection_metadata:
                del self.connection_metadata[client_id]
            if client_id in self.fps_tracking:
                del self.fps_tracking[client_id]

    async def send_personal_message(self, message: dict, client_id: str) -> bool:
        """
        Send message to specific client

        Args:
            message: Message to send
            client_id: Target client identifier

        Returns:
            True if sent successfully, False otherwise
        """
        if client_id not in self.active_connections:
            return False

        try:
            websocket = self.active_connections[client_id]
            await websocket.send_text(json.dumps(message))

            # Update metadata
            if client_id in self.connection_metadata:
                self.connection_metadata[client_id]["last_activity"] = datetime.now()
                self.connection_metadata[client_id]["message_count"] += 1

            return True

        except Exception as e:
            logger.error(f"Failed to send message to {client_id}: {e}")
            await self.disconnect(client_id)
            return False

    async def broadcast(self, message: dict, exclude: Optional[Set[str]] = None):
        """
        Broadcast message to all connected clients

        Args:
            message: Message to broadcast
            exclude: Set of client IDs to exclude from broadcast
        """
        exclude = exclude or set()

        disconnected_clients = []

        for client_id, websocket in self.active_connections.items():
            if client_id in exclude:
                continue

            try:
                await websocket.send_text(json.dumps(message))

                # Update metadata
                if client_id in self.connection_metadata:
                    self.connection_metadata[client_id][
                        "last_activity"
                    ] = datetime.now()
                    self.connection_metadata[client_id]["message_count"] += 1

            except Exception as e:
                logger.error(f"Failed to broadcast to {client_id}: {e}")
                disconnected_clients.append(client_id)

        # Clean up disconnected clients
        for client_id in disconnected_clients:
            await self.disconnect(client_id)

    async def send_detection_result(
        self,
        client_id: str,
        image_base64: str,
        detections: list,
        processing_time: float,
        model_info: dict,
    ) -> bool:
        """
        Send detection result to client

        Args:
            client_id: Target client identifier
            image_base64: Base64 encoded result image
            detections: List of detected faces
            processing_time: Processing time in seconds
            model_info: Model information

        Returns:
            True if sent successfully, False otherwise
        """
        message = {
            "type": "detection_result",
            "data": {
                "image": image_base64,
                "detections": detections,
                "processing_time": processing_time,
                "model_info": model_info,
                "timestamp": datetime.now().isoformat(),
            },
        }

        return await self.send_personal_message(message, client_id)

    async def send_error(
        self, client_id: str, error_message: str, error_code: str = None
    ) -> bool:
        """
        Send error message to client

        Args:
            client_id: Target client identifier
            error_message: Error message
            error_code: Optional error code

        Returns:
            True if sent successfully, False otherwise
        """
        message = {
            "type": "error",
            "data": {
                "message": error_message,
                "code": error_code,
                "timestamp": datetime.now().isoformat(),
            },
        }

        return await self.send_personal_message(message, client_id)

    async def start_streaming(self, client_id: str):
        """
        Mark client as streaming

        Args:
            client_id: Client identifier
        """
        if client_id in self.connection_metadata:
            self.connection_metadata[client_id]["streaming"] = True

            await self.send_personal_message(
                {
                    "type": "streaming",
                    "status": "started",
                    "timestamp": datetime.now().isoformat(),
                },
                client_id,
            )

    async def stop_streaming(self, client_id: str):
        """
        Stop streaming for client

        Args:
            client_id: Client identifier
        """
        if client_id in self.connection_metadata:
            self.connection_metadata[client_id]["streaming"] = False

        if client_id in self.streaming_tasks:
            self.streaming_tasks[client_id].cancel()
            del self.streaming_tasks[client_id]

            await self.send_personal_message(
                {
                    "type": "streaming",
                    "status": "stopped",
                    "timestamp": datetime.now().isoformat(),
                },
                client_id,
            )

    def get_connection_info(self, client_id: str) -> Optional[dict]:
        """
        Get connection information for client

        Args:
            client_id: Client identifier

        Returns:
            Connection metadata or None if not found
        """
        return self.connection_metadata.get(client_id)

    def get_active_connections(self) -> Dict[str, dict]:
        """
        Get all active connections with metadata

        Returns:
            Dictionary of active connections and their metadata
        """
        return {
            client_id: {
                **metadata,
                "connected_at": metadata["connected_at"].isoformat(),
                "last_activity": metadata["last_activity"].isoformat(),
            }
            for client_id, metadata in self.connection_metadata.items()
        }

    def get_connection_count(self) -> int:
        """
        Get number of active connections

        Returns:
            Number of active connections
        """
        return len(self.active_connections)

    def update_fps(self, client_id: str) -> int:
        """
        Update and get FPS for a client based on frame timestamps

        Args:
            client_id: Client identifier

        Returns:
            Current FPS (defaults to 30 if not enough samples)
        """
        if client_id not in self.fps_tracking:
            return 30

        now = datetime.now()
        tracking = self.fps_tracking[client_id]
        tracking["timestamps"].append(now)

        if len(tracking["timestamps"]) > tracking["max_samples"]:
            tracking["timestamps"].pop(0)

        if (now - tracking["last_update"]).total_seconds() >= 0.1 and len(
            tracking["timestamps"]
        ) >= 2:
            time_span = (
                tracking["timestamps"][-1] - tracking["timestamps"][0]
            ).total_seconds()
            frame_count = len(tracking["timestamps"]) - 1

            if time_span > 0:
                fps = frame_count / time_span
                tracking["current_fps"] = max(1, min(120, int(round(fps))))
                tracking["last_update"] = now

        return tracking["current_fps"]

    def get_fps(self, client_id: str) -> int:
        """
        Get current FPS for a client

        Args:
            client_id: Client identifier

        Returns:
            Current FPS (defaults to 30 if not found)
        """
        if client_id not in self.fps_tracking:
            return 30
        return self.fps_tracking[client_id]["current_fps"]

    async def ping_all_clients(self):
        """
        Send ping to all clients to check connection health
        """
        ping_message = {"type": "ping", "timestamp": datetime.now().isoformat()}

        await self.broadcast(ping_message)

    async def cleanup_inactive_connections(self, timeout_minutes: int = 30):
        """
        Clean up inactive connections

        Args:
            timeout_minutes: Timeout in minutes for inactive connections
        """
        current_time = datetime.now()
        inactive_clients = []

        for client_id, metadata in self.connection_metadata.items():
            time_diff = current_time - metadata["last_activity"]
            if time_diff.total_seconds() > (timeout_minutes * 60):
                inactive_clients.append(client_id)

        for client_id in inactive_clients:
            self.disconnect(client_id)


# Global connection manager instance
manager = ConnectionManager()


async def handle_websocket_message(websocket: WebSocket, client_id: str, message: dict):
    """
    Handle incoming WebSocket message

    Args:
        websocket: WebSocket connection
        client_id: Client identifier
        message: Received message
    """
    try:
        message_type = message.get("type")

        if message_type == "ping":
            await manager.send_personal_message(
                {"type": "pong", "timestamp": datetime.now().isoformat()}, client_id
            )

        elif message_type == "start_streaming":
            await manager.start_streaming(client_id)

        elif message_type == "stop_streaming":
            await manager.stop_streaming(client_id)

        elif message_type == "get_status":
            connection_info = manager.get_connection_info(client_id)
            await manager.send_personal_message(
                {"type": "status", "data": connection_info}, client_id
            )

        else:
            await manager.send_error(
                client_id,
                f"Unknown message type: {message_type}",
                "UNKNOWN_MESSAGE_TYPE",
            )

    except Exception as e:
        logger.error(f"Error handling WebSocket message from {client_id}: {e}")
        await manager.send_error(
            client_id, "Failed to process message", "MESSAGE_PROCESSING_ERROR"
        )
