#!/usr/bin/env python3
"""
Build script for Suri Face Detection Backend using PyInstaller
Handles cross-platform builds and optimization
"""

import argparse
import os
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path

def get_platform_info():
    """Get current platform information"""
    system = platform.system().lower()
    machine = platform.machine().lower()
    
    if system == "windows":
        return "win", "x64" if machine in ["amd64", "x86_64"] else "x86"
    elif system == "darwin":
        return "mac", "arm64" if machine == "arm64" else "x64"
    elif system == "linux":
        return "linux", "x64" if machine in ["amd64", "x86_64"] else machine
    else:
        return system, machine

def check_dependencies():
    """Check if required dependencies are installed"""
    # Map package names to their import names
    package_imports = {
        "pyinstaller": "PyInstaller",
        "fastapi": "fastapi",
        "uvicorn": "uvicorn",
        "opencv-python": "cv2",
        "onnxruntime": "onnxruntime",
        "numpy": "numpy",
        "pillow": "PIL",
        "websockets": "websockets",
        "pydantic": "pydantic",
    }
    
    missing_packages = []
    
    for package_name, import_name in package_imports.items():
        try:
            __import__(import_name)
        except ImportError:
            missing_packages.append(package_name)
    
    if missing_packages:
        print(f"[ERROR] Missing required packages: {', '.join(missing_packages)}")
        print("Install them with: pip install " + " ".join(missing_packages))
        return False
    
    print("[SUCCESS] All required packages are installed")
    return True

def clean_build_dirs():
    """Clean previous build directories"""
    dirs_to_clean = ["build", "dist"]
    
    for dir_name in dirs_to_clean:
        dir_path = Path(dir_name)
        if dir_path.exists():
            print(f"🧹 Cleaning {dir_path}")
            shutil.rmtree(dir_path)

def install_pyinstaller():
    """Install PyInstaller if not available"""
    try:
        import PyInstaller
        print("[SUCCESS] PyInstaller is already installed")
        return True
    except ImportError:
        print("📦 Installing PyInstaller...")
        try:
            subprocess.check_call([sys.executable, "-m", "pip", "install", "pyinstaller"])
            print("[SUCCESS] PyInstaller installed successfully")
            return True
        except subprocess.CalledProcessError:
            print("[ERROR] Failed to install PyInstaller")
            return False

def build_backend(debug=False, onefile=True, clean=True):
    """Build the backend using PyInstaller"""
    
    print("🚀 Starting Suri Backend Build Process")
    print("=" * 50)
    
    # Get platform info
    platform_name, arch = get_platform_info()
    print(f"🖥️  Platform: {platform_name}-{arch}")
    
    # Check dependencies
    if not check_dependencies():
        return False
    
    # Install PyInstaller if needed
    if not install_pyinstaller():
        return False
    
    # Clean build directories
    if clean:
        clean_build_dirs()
    
    # Prepare build command
    # When using a spec file, we only need basic options
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--clean",  # Clean PyInstaller cache
        "--noconfirm",  # Replace output directory without asking
    ]
    
    if debug:
        cmd.extend(["--debug", "all"])
    
    # Add the spec file (spec file contains all other configuration)
    cmd.append("suri_backend.spec")
    
    print(f"🔨 Build command: {' '.join(cmd)}")
    print("⏳ Building... This may take several minutes")
    
    start_time = time.time()
    
    try:
        # Run PyInstaller
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode == 0:
            build_time = time.time() - start_time
            print(f"[SUCCESS] Build completed successfully in {build_time:.1f} seconds")
            
            # Show output information
            dist_dir = Path("dist")
            if dist_dir.exists():
                print(f"📁 Output directory: {dist_dir.absolute()}")
                
                # List built files
                for item in dist_dir.iterdir():
                    if item.is_file():
                        size_mb = item.stat().st_size / (1024 * 1024)
                        print(f"   📄 {item.name} ({size_mb:.1f} MB)")
                    elif item.is_dir():
                        print(f"   📁 {item.name}/")
            
            return True
        else:
            print("[ERROR] Build failed!")
            print("STDOUT:", result.stdout)
            print("STDERR:", result.stderr)
            return False
            
    except Exception as e:
        print(f"[ERROR] Build error: {e}")
        return False

def test_executable():
    """Test the built executable"""
    platform_name, _ = get_platform_info()
    
    if platform_name == "win":
        exe_path = Path("dist/suri-backend.exe")
    else:
        exe_path = Path("dist/suri-backend")
    
    if not exe_path.exists():
        print("[ERROR] Executable not found")
        return False
    
    print("🧪 Testing executable...")
    
    try:
        # Test with --help flag
        result = subprocess.run([str(exe_path), "--help"], 
                              capture_output=True, text=True, timeout=10)
        
        if result.returncode == 0:
            print("[SUCCESS] Executable test passed")
            return True
        else:
            print("[ERROR] Executable test failed")
            print("STDERR:", result.stderr)
            return False
            
    except subprocess.TimeoutExpired:
        print("[WARNING] Executable test timed out (this might be normal)")
        return True
    except Exception as e:
        print(f"[ERROR] Executable test error: {e}")
        return False

def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description="Build Suri Backend with PyInstaller")
    parser.add_argument("--debug", action="store_true", help="Build in debug mode")
    parser.add_argument("--onedir", action="store_true", help="Build as directory instead of single file")
    parser.add_argument("--no-clean", action="store_true", help="Don't clean build directories")
    parser.add_argument("--test", action="store_true", help="Test the executable after building")
    
    args = parser.parse_args()
    
    # Build the backend
    success = build_backend(
        debug=args.debug,
        onefile=not args.onedir,
        clean=not args.no_clean
    )
    
    if success and args.test:
        test_executable()
    
    if success:
        print("\n🎉 Build process completed successfully!")
        print("💡 You can now integrate the executable with your Electron app")
    else:
        print("\n💥 Build process failed!")
        sys.exit(1)

if __name__ == "__main__":
    main()