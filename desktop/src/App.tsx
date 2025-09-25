
import LiveVideo from './components/LiveVideo.tsx'
import TitleBar from './components/TitleBar.tsx'

function App() {

  const renderCurrentComponent = () => {
        return <LiveVideo />
  }

  return (
    <div className="electron-window-container">
      {/* Custom TitleBar - Outside scrollable area */}
      <TitleBar />
      
      {/* Scrollable content wrapper */}
      <div className="app-content-wrapper">
        {/* Main content area */}
        <div className="text-white">
          {renderCurrentComponent()}
        </div>
      </div>
    </div>
  )
}

export default App
