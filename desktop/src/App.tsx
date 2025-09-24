import { useState } from 'react'
import SystemManagement from './components/SystemManagement.tsx'
import LiveVideo from './components/LiveVideo.tsx'
import TitleBar from './components/TitleBar.tsx'

export type MenuOption = 
  | 'system-management'
  | 'live-video'
  | 'advanced-recognition'

function App() {
  const [currentMenu, setCurrentMenu] = useState<MenuOption>('live-video')



  const renderCurrentComponent = () => {
    switch (currentMenu) {
      case 'system-management':
        return <SystemManagement onBack={() => setCurrentMenu('live-video')} />
      case 'live-video':
      default:
        return <LiveVideo />
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
