def show_menu():
    """Display the main menu and get user choice"""
    print("\n" + "="*70)
    print("🎯 ENTERPRISE-GRADE FACE RECOGNITION ATTENDANCE SYSTEM")
    print("="*70)
    print("📊 Advanced Features:")
    print("  • Multi-scale feature extraction")
    print("  • Enhanced preprocessing (CLAHE, deblurring)")
    print("  • Adaptive thresholding based on conditions")
    print("  • Multi-template identity management")
    print("  • Quality-based face assessment")
    print("  • Smart duplicate detection")
    print("="*70)
    print("🎛️  MAIN MENU:")
    print("  1. 📹 Live Camera Recognition (Real-time attendance)")
    print("  2. 🖼️  Single Image Recognition (Upload & detect)")
    print("  3. 📁 Batch Image Processing (Process folder)")
    print("  4. ⚙️  System Management")
    print("  5. 🚪 Exit")
    print("="*70)
    
    while True:
        try:
            choice = input("Enter your choice (1-5): ").strip()
            if choice in ['1', '2', '3', '4', '5']:
                return int(choice)
            else:
                print("❌ Invalid choice. Please enter 1-5.")
        except KeyboardInterrupt:
            return 5
