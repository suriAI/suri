import { useEffect, useState } from 'react'
import Main from './components/Main'
import TitleBar from './components/TitleBar.tsx'
import LoadingScreen from './components/LoadingScreen.tsx'

function App() {
  const [modelsReady, setModelsReady] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    // Check if models are ready
    const checkModelsReady = async () => {
      try {
        if (window.electronAPI && 'models' in window.electronAPI) {
          const ready = await window.electronAPI.models.isReady();
          setModelsReady(ready || false);
          setIsChecking(false);
        } else {
          setModelsReady(false);
          setIsChecking(false);
        }
      } catch (error) {
        console.error('Failed to check models readiness:', error);
        // If check fails, assume not ready and show loading screen
        setModelsReady(false);
        setIsChecking(false);
      }
    };

    // Initial check
    checkModelsReady();

    // Listen for model loading progress to update readiness state
    let removeListener: (() => void) | undefined;
    if (window.electronAPI && 'models' in window.electronAPI) {
      removeListener = window.electronAPI.models.onLoadingProgress(() => {
        // After any progress update, recheck readiness
        checkModelsReady();
      });
    }

    return () => {
      removeListener?.();
    };
  }, []);

  const renderCurrentComponent = () => {
        return <Main />
  }

  return (
    <div className="electron-window-container">
      {/* Custom TitleBar - Always visible */}
      <TitleBar />
      
      {/* Show loading screen or main content */}
      {isChecking || !modelsReady ? (
        <LoadingScreen />
      ) : (
        <div className="app-content-wrapper">
          {/* Main content area */}
          <div className="text-white">
            {renderCurrentComponent()}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
