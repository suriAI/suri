import os, sys

sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from experiments.prototype.main import (
    Main, 
    live_camera_recognition, 
    process_single_image, 
    process_batch_images,
    system_management)
from experiments.prototype.show_menu import show_menu

# 1 Live Camera Recognition
# 2 Single Image Recognition
# 3 Batch Image Processing
# 4 System Management
# 5 Exit

def main():
    start = Main()
    
    while True:
        choice = show_menu()
        if choice == 1:
            live_camera_recognition(start)

        elif choice == 2:
            print("\n🖼️  SINGLE IMAGE RECOGNITION")
            image_path = input("Enter image path (or drag & drop): ").strip().strip('"')
            if os.path.exists(image_path):
                process_single_image(start, image_path)
            else:
                print("❌ Image file not found!")

        elif choice == 3:
            print("\n📁 BATCH IMAGE PROCESSING")
            folder_path = input("Enter folder path containing images: ").strip().strip('"')
            if os.path.exists(folder_path) and os.path.isdir(folder_path):
                process_batch_images(start, folder_path)
            else:
                print("❌ Folder not found!")

        elif choice == 4:
            system_management(start)

        elif choice == 5:
            break
        input("\nPress Enter to continue...")

if __name__ == "__main__":
    main()