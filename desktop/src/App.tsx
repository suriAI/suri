import { useState, useEffect, useCallback } from 'react'
import MainMenu from './components/MainMenu.tsx'
import LiveCameraRecognition from './components/LiveCameraRecognitionNew.tsx'
import SingleImageRecognition from './components/SingleImageRecognition.tsx'
import BatchImageProcessing from './components/BatchImageProcessing.tsx'
import SystemManagement from './components/SystemManagement.tsx'
import AddPerson from './components/AddPerson.tsx'
import AppDropdown from './components/AppDropdown.tsx'
import TitleBar from './components/TitleBar.tsx'
import './App.css'

export type MenuOption = 
  | 'main'
  | 'live-camera'
  | 'single-image'
  | 'batch-processing'
  | 'system-management'
  | 'add-person'

function App() {
  const [currentMenu, setCurrentMenu] = useState<MenuOption>('main') // Back to main menu
  const [isConnected, setIsConnected] = useState(false)
  const [systemStats, setSystemStats] = useState({
    legacy_faces: 0,
    enhanced_templates: 0,
    total_people: 0,
    today_records: 0,
    total_records: 0,
    success_rate: 0
  })

  const fetchSystemStats = useCallback(async () => {
    try {
      const response = await fetch('http://127.0.0.1:8770/system/stats')
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          const stats = data.stats
          setSystemStats({
            legacy_faces: stats.legacy_faces || 0,
            enhanced_templates: stats.template_count || 0,
            total_people: stats.people_count || 0,
            today_records: stats.today_attendance || 0,
            total_records: stats.total_attendance || 0,
            success_rate: stats.success_rate || 0
          })
        }
      }
    } catch (error) {
      console.error('Failed to fetch system stats:', error)
    }
  }, [])

  const preloadCamera = useCallback(async () => {
    try {
      console.log('Preloading camera models for instant startup...')
      // Warm up the ONNX models by making a preload request
      const response = await fetch('http://127.0.0.1:8770/system/preload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      if (response.ok) {
        console.log('Camera models preloaded successfully')
      } else {
        console.log('Camera preload endpoint not available (normal)')
      }
    } catch (error) {
      console.log('Camera preload failed (models will load on first use):', error)
    }
  }, [])

  useEffect(() => {
    // Initialize connection on app start with retry
    const initializeConnection = async () => {
      const maxRetries = 5
      const retryDelay = 1000 // 1 second
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // Test connection to backend
          const response = await fetch('http://127.0.0.1:8770/')
          if (response.ok) {
            setIsConnected(true)
            fetchSystemStats()
            console.log(`Backend connected on attempt ${attempt}`)
            
            // Preload camera for instant startup later
            preloadCamera()
            return
          }
        } catch (error) {
          console.log(`Backend connection attempt ${attempt}/${maxRetries} failed:`, error)
        }
        
        // Wait before retry (except on last attempt)
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay))
        }
      }
      
      console.error('Backend connection failed after all attempts')
      setIsConnected(false)
    }
    
    initializeConnection()
  }, [fetchSystemStats, preloadCamera])

  const getCurrentSectionName = () => {
    switch (currentMenu) {
      case 'live-camera': return 'Live Camera'
      case 'single-image': return 'Single Image'
      case 'batch-processing': return 'Batch Processing'
      case 'system-management': return 'System Management'
      case 'add-person': return 'Add Person'
      default: return 'Main'
    }
  }

  const renderCurrentComponent = () => {
    switch (currentMenu) {
      case 'live-camera':
        return <LiveCameraRecognition />
      case 'single-image':
        return <SingleImageRecognition />
      case 'batch-processing':
        return <BatchImageProcessing onBack={() => setCurrentMenu('main')} />
      case 'system-management':
        return <SystemManagement onBack={() => setCurrentMenu('main')} />
      case 'add-person':
        return <AddPerson />
      default:
        return (
          <MainMenu 
            onMenuSelect={setCurrentMenu}
            isConnected={isConnected}
            systemStats={systemStats}
            onRefreshStats={fetchSystemStats}
          />
        )
    }
  }

  return (
    <div className="electron-window-container">
      {/* Custom TitleBar - Outside scrollable area */}
      <TitleBar title="SURI - Face Recognition System" />
      
      {/* Scrollable content wrapper */}
      <div className="app-content-wrapper">
        {/* Glass Morphism Header - only when not on main menu */}
        {currentMenu !== 'main' && (
          <div className="sticky top-0 z-50 bg-black/70 backdrop-blur-xl border-b border-white/[0.05]">
            <div className="flex items-center justify-between px-8 py-4">
              <button
                onClick={() => setCurrentMenu('main')}
                className="group flex items-center space-x-4 text-white/60 hover:text-white transition-all duration-300"
              >
                <div className="w-2 h-2 rounded-full bg-white/60 group-hover:bg-white group-hover:scale-125 transition-all duration-300"></div>
                <span className="text-sm font-light tracking-[0.15em] uppercase">SURI</span>
                <span className="text-xs text-white/30">•</span>
                <span className="text-xs font-light text-white/80">{getCurrentSectionName()}</span>
              </button>
              
              <div className="flex items-center space-x-3">
                <AppDropdown isConnected={isConnected} onRefreshStats={fetchSystemStats} />
              </div>
            </div>
          </div>
        )}

        {/* Main content area */}
        <div className={`${currentMenu !== 'main' ? 'pt-4 pb-10' : 'pt-4'} text-white px-4`}>
          {renderCurrentComponent()}
        </div>
      </div>
    </div>
  )
}

export default App
