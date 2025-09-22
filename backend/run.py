"""
Startup script for the Face Detection API backend
"""

import argparse
import logging
import logging.config
import sys
from pathlib import Path

import uvicorn

# Add the backend directory to Python path
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

from config import config, validate_model_paths, validate_directories

def setup_logging():
    """Setup logging configuration"""
    logging.config.dictConfig(config["logging"])

def validate_setup():
    """Validate the setup before starting the server"""
    try:
        # Validate directories
        validate_directories()
        print("Directories validated")
        
        # Validate model paths
        validate_model_paths()
        print("Model paths validated")
        
        return True
        
    except Exception as e:
        print(f"✗ Setup validation failed: {e}")
        return False

def main():
    """Main entry point"""
    print("Starting Face Detection API Backend...")
    
    # Parse command line arguments
    parser = argparse.ArgumentParser(description="Face Detection API Backend")
    parser.add_argument("--port", type=int, help="Port to run the server on")
    parser.add_argument("--host", type=str, help="Host to run the server on")
    args = parser.parse_args()
    
    # Setup logging
    setup_logging()
    logger = logging.getLogger(__name__)
    
    # Validate setup
    if not validate_setup():
        print("Setup validation failed. Please check the configuration.")
        sys.exit(1)
    
    # Server configuration
    server_config = config["server"].copy()
    
    # Override with command line arguments if provided
    if args.port:
        server_config["port"] = args.port
    if args.host:
        server_config["host"] = args.host
    
    print(f"Server will start on http://{server_config['host']}:{server_config['port']}")
    print(f"API documentation: http://{server_config['host']}:{server_config['port']}/docs")
    print(f"WebSocket endpoint: ws://{server_config['host']}:{server_config['port']}/ws")
    
    try:
        # Start the server
        uvicorn.run(
            "main:app",
            host=server_config["host"],
            port=server_config["port"],
            reload=server_config["reload"],
            log_level=server_config["log_level"],
            workers=server_config["workers"],
            access_log=True,
        )
    except KeyboardInterrupt:
        logger.info("Server stopped by user")
        print("\n👋 Server stopped gracefully")
    except Exception as e:
        logger.error(f"Server error: {e}")
        print(f"\nServer error: {e}")
        print("Traceback:")
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()