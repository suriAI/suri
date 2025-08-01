import os, sys

project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(project_root)

from experiments.prototype.main import (
    AttendanceSystem, 
    show_main_menu, 
    live_camera_recognition, 
    process_single_image, 
    process_batch_images,
    system_management)

# 1 Live Camera Recognition
# 2 Single Image Recognition
# 3 Batch Image Processing
# 4 System Management
# 5 Exit

def main():
    attendance_system = AttendanceSystem()
    
    while True:
        choice = show_main_menu()
        if choice == 1:
            live_camera_recognition(attendance_system)

        elif choice == 2:
            print("\n🖼️  SINGLE IMAGE RECOGNITION")
            image_path = input("Enter image path (or drag & drop): ").strip().strip('"')
            if os.path.exists(image_path):
                process_single_image(attendance_system, image_path)
            else:
                print("❌ Image file not found!")

        elif choice == 3:
            print("\n📁 BATCH IMAGE PROCESSING")
            folder_path = input("Enter folder path containing images: ").strip().strip('"')
            if os.path.exists(folder_path) and os.path.isdir(folder_path):
                process_batch_images(attendance_system, folder_path)
            else:
                print("❌ Folder not found!")

        elif choice == 4:
            system_management(attendance_system)

        elif choice == 5:
            break
        input("\nPress Enter to continue...")

if __name__ == "__main__":
    main()