import { useState, useEffect, useCallback } from 'react'
import LiveCameraRecognition from './components/LiveCameraRecognition.tsx'
import SystemManagement from './components/SystemManagement.tsx'
import TitleBar from './components/TitleBar.tsx'
import { sqliteFaceLogService } from './services/SqliteFaceLogService'

export type MenuOption = 
  | 'live-camera'
  | 'system-management'

function App() {
  const [currentMenu, setCurrentMenu] = useState<MenuOption>('live-camera')

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
    // Initialize with SQLite3 database
    const initializeApp = async () => {
      try {
        // Check if SQLite3 database is available
        const isAvailable = await sqliteFaceLogService.isAvailable()
        if (isAvailable) {
          await fetchSystemStats()
        } else {
          console.error('SQLite3 database not available')
        }
      } catch (error) {
        console.error('Failed to initialize app:', error)
      }
    }

    initializeApp()
  }, [fetchSystemStats])



  const renderCurrentComponent = () => {
    switch (currentMenu) {
      case 'live-camera':
        return <LiveCameraRecognition onMenuSelect={setCurrentMenu} />
      case 'system-management':
        return <SystemManagement onBack={() => setCurrentMenu('live-camera')} />
      default:
        return <LiveCameraRecognition onMenuSelect={setCurrentMenu} />
    }
  }

  return (
    <div className="electron-window-container">
      {/* Custom TitleBar - Outside scrollable area */}
      <TitleBar />
      
      {/* Scrollable content wrapper */}
      <div className="app-content-wrapper">
        {/* Main content area */}
        <div className="text-white px-4">
          {renderCurrentComponent()}
        </div>
      </div>
    </div>
  )
}

export default App
