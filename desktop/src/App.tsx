import { useState, useEffect, useCallback } from 'react'
import LiveCameraRecognition from './components/Main.tsx'
import SystemManagement from './components/SystemManagement.tsx'
import TitleBar from './components/TitleBar.tsx'
import { sqliteFaceLogService } from './services/SqliteFaceLogService'
import { globalWorkerPool, type GlobalWorkerPoolState } from './services/GlobalWorkerPool'

export type MenuOption = 
  | 'live-camera'
  | 'system-management'

function App() {
  const [currentMenu, setCurrentMenu] = useState<MenuOption>('live-camera')
  const [workerPoolState, setWorkerPoolState] = useState<GlobalWorkerPoolState>({
    isInitialized: false,
    isInitializing: true, // Start with loader showing
    error: null,
    workerManager: null,
    antiSpoofingService: null,
    stats: null
  })

  const fetchSystemStats = useCallback(async () => {
    try {
      // Use SqliteFaceLogService instead of API
      await Promise.all([
        sqliteFaceLogService.getTodayStats(),
        sqliteFaceLogService.getRecentLogs(1000)
      ])


    } catch (error) {
      console.error('Failed to fetch system stats:', error)
    }
  }, [])

  useEffect(() => {
    // Subscribe to worker pool state changes
    const unsubscribe = globalWorkerPool.subscribe(setWorkerPoolState)
    
    // Initialize with SQLite3 database and background worker pool
    const initializeApp = async () => {
      try {
        // Check if SQLite3 database is available
        const isAvailable = await sqliteFaceLogService.isAvailable()
        if (isAvailable) {
          await fetchSystemStats()
        } else {
          // SQLite3 database not available
        }
        
        // Initialize worker pool in background for instant face detection
        globalWorkerPool.initializeInBackground().catch(error => {
          console.error('Background worker pool initialization failed:', error)
          // Don't block app startup on worker pool failure, but ensure loader disappears
        })
      } catch {
        // Failed to initialize app
      }
    }

    initializeApp()
    
    return unsubscribe
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

  // Full-screen loader component with smooth animations
  const renderLoader = () => (
    <div className="fixed inset-0 bg-black/95 backdrop-blur-xl flex items-center justify-center z-50">
      <div className="flex flex-col items-center space-y-8 smooth-fade">
        {/* Smooth animated spinner */}
        <div className="relative">
          <div className="w-20 h-20 border-4 border-white/10 border-t-white/80 rounded-full smooth-spinner"></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <svg className="w-10 h-10 text-white/90" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          </div>
        </div>
        
        {/* Loading text with fade animation */}
        <div className="text-center space-y-3">
          <h2 className="text-2xl font-light text-white tracking-wide">Initializing Recognition System</h2>
          <p className="text-base text-white/70 font-light">Loading AI models and preparing face detection...</p>
        </div>
        
        {/* Smooth progress bar */}
        <div className="w-80 h-1 bg-white/10 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-white/50 to-white/90 rounded-full smooth-progress"></div>
        </div>
        
        {/* Status text */}
        <div className="text-sm text-white/50 font-light tracking-wider uppercase">
          {workerPoolState.error ? 'Initialization Failed' : 'Please Wait...'}
        </div>
      </div>
    </div>
  )

  return (
    <div className="electron-window-container">
      {/* Full-screen loader - shows while worker pool is initializing */}
      {(workerPoolState.isInitializing && !workerPoolState.isInitialized && !workerPoolState.error) && renderLoader()}
      
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
