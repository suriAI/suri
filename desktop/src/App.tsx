import { useState, useEffect, useCallback } from 'react'
import MainMenu from './components/MainMenu.tsx'
import LiveCameraRecognition from './components/LiveCameraRecognition.tsx'
import SystemManagement from './components/SystemManagement.tsx'
import AppDropdown from './components/AppDropdown.tsx'
import TitleBar from './components/TitleBar.tsx'
import { sqliteFaceLogService } from './services/SqliteFaceLogService'

export type MenuOption = 
  | 'main'
  | 'live-camera'
  | 'single-image'
  | 'batch-processing'
  | 'system-management'
  | 'add-person'

function App() {
  const [currentMenu, setCurrentMenu] = useState<MenuOption>('main')
  const [isConnected, setIsConnected] = useState(true) // Always connected since using SQL.js directly
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
      // Use SqliteFaceLogService instead of API
      const [todayStats, recentLogs] = await Promise.all([
        sqliteFaceLogService.getTodayStats(),
        sqliteFaceLogService.getRecentLogs(1000)
      ])

      const uniquePeople = new Set<string>()
      recentLogs.forEach(log => {
        if (log.personId) uniquePeople.add(log.personId)
      })

      setSystemStats({
        legacy_faces: 0, // Not applicable with SQL.js
        enhanced_templates: uniquePeople.size,
        total_people: uniquePeople.size,
        today_records: todayStats.totalDetections,
        total_records: recentLogs.length,
        success_rate: 95 // Placeholder
      })
    } catch (error) {
      console.error('Failed to fetch system stats:', error)
    }
  }, [])

  useEffect(() => {
    // Initialize with SQL.js database
    const initializeApp = async () => {
      try {
        // Check if SQL.js database is available
        const isAvailable = await sqliteFaceLogService.isAvailable()
        if (isAvailable) {
          setIsConnected(true)
          await fetchSystemStats()
        } else {
          setIsConnected(false)
          console.error('SQL.js database not available')
        }
      } catch (error) {
        console.error('Failed to initialize app:', error)
        setIsConnected(false)
      }
    }

    initializeApp()
  }, [fetchSystemStats])

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
      case 'system-management':
        return <SystemManagement onBack={() => setCurrentMenu('main')} />
      case 'single-image':
        return (
          <div className="min-h-screen flex items-center justify-center">
            <div className="max-w-md mx-auto text-center bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-8">
              <h2 className="text-xl font-light text-white/80 mb-4">Feature Temporarily Disabled</h2>
              <p className="text-white/60 text-sm leading-relaxed mb-6">
                Single image recognition requires the Python API backend which has been disabled. 
                This feature will be reimplemented to work with the SQL.js database in a future update.
              </p>
              <button
                onClick={() => setCurrentMenu('main')}
                className="px-6 py-2 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] rounded-lg text-white/80 text-sm transition-all duration-200"
              >
                Back to Main Menu
              </button>
            </div>
          </div>
        )
      case 'batch-processing':
        return (
          <div className="min-h-screen flex items-center justify-center">
            <div className="max-w-md mx-auto text-center bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-8">
              <h2 className="text-xl font-light text-white/80 mb-4">Feature Temporarily Disabled</h2>
              <p className="text-white/60 text-sm leading-relaxed mb-6">
                Batch image processing requires the Python API backend which has been disabled. 
                This feature will be reimplemented to work with the SQL.js database in a future update.
              </p>
              <button
                onClick={() => setCurrentMenu('main')}
                className="px-6 py-2 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] rounded-lg text-white/80 text-sm transition-all duration-200"
              >
                Back to Main Menu
              </button>
            </div>
          </div>
        )
      case 'add-person':
        return (
          <div className="min-h-screen flex items-center justify-center">
            <div className="max-w-md mx-auto text-center bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-8">
              <h2 className="text-xl font-light text-white/80 mb-4">Feature Temporarily Disabled</h2>
              <p className="text-white/60 text-sm leading-relaxed mb-6">
                Add person functionality requires the Python API backend which has been disabled. 
                This feature will be reimplemented to work with the SQL.js database in a future update.
              </p>
              <button
                onClick={() => setCurrentMenu('main')}
                className="px-6 py-2 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] rounded-lg text-white/80 text-sm transition-all duration-200"
              >
                Back to Main Menu
              </button>
            </div>
          </div>
        )
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
      <TitleBar />
      
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
        <div className="text-white px-4">
          {renderCurrentComponent()}
        </div>
      </div>
    </div>
  )
}

export default App
