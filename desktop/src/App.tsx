import { useState, useEffect, useCallback } from 'react'
import LiveCameraRecognition from './components/LiveCameraRecognition.tsx'
import SystemManagement from './components/SystemManagement.tsx'
import AppDropdown from './components/AppDropdown.tsx'
import TitleBar from './components/TitleBar.tsx'
import { sqliteFaceLogService } from './services/SqliteFaceLogService'

export type MenuOption = 
  | 'live-camera'
  | 'system-management'

function App() {
  const [currentMenu, setCurrentMenu] = useState<MenuOption>('live-camera')
  const [isConnected, setIsConnected] = useState(true) // Always connected since using SQL.js directly

  const fetchSystemStats = useCallback(async () => {
    try {
      // Use SqliteFaceLogService instead of API
      const [todayStats, recentLogs] = await Promise.all([
        sqliteFaceLogService.getTodayStats(),
        sqliteFaceLogService.getRecentLogs(1000)
      ])

      console.log('System stats fetched:', { todayStats, recentLogsCount: recentLogs.length })
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
      case 'system-management': return 'System Management'
      default: return 'Live Camera'
    }
  }

  const renderCurrentComponent = () => {
    switch (currentMenu) {
      case 'live-camera':
        return <LiveCameraRecognition />
      case 'system-management':
        return <SystemManagement onBack={() => setCurrentMenu('live-camera')} />
      default:
        return <LiveCameraRecognition />
    }
  }

  return (
    <div className="electron-window-container">
      {/* Custom TitleBar - Outside scrollable area */}
      <TitleBar />
      
      {/* Scrollable content wrapper */}
      <div className="app-content-wrapper">
        {/* Glass Morphism Header - always visible */}
        <div className="sticky top-0 z-50 bg-black/70 backdrop-blur-xl border-b border-white/[0.05]">
          <div className="flex items-center justify-between px-8 py-4">
            <div className="group flex items-center space-x-4 text-white/60">
              <div className="w-2 h-2 rounded-full bg-white/60 group-hover:bg-white group-hover:scale-125 transition-all duration-300"></div>
              <span className="text-sm font-light tracking-[0.15em] uppercase">SURI</span>
              <span className="text-xs text-white/30">•</span>
              <span className="text-xs font-light text-white/80">{getCurrentSectionName()}</span>
            </div>
            
            <div className="flex items-center space-x-3">
              <AppDropdown 
                isConnected={isConnected} 
                onRefreshStats={fetchSystemStats}
                onMenuSelect={setCurrentMenu}
              />
            </div>
          </div>
        </div>

        {/* Main content area */}
        <div className="text-white px-4">
          {renderCurrentComponent()}
        </div>
      </div>
    </div>
  )
}

export default App
