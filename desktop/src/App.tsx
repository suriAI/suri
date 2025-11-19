import Main from "./components/main/index.tsx";
import { useModelLoading } from "./hooks/useModelLoading";
import { LoadingScreen } from "./components/common";
import { WindowBar, WindowFooter } from "./components/electron";

function App() {
  const { modelsReady, isChecking } = useModelLoading();

  return (
    <div className="electron-window-container">
      {/* Custom Window Bar - Always visible */}
      <WindowBar />

      {/* Show loading screen or main content */}
      {isChecking || !modelsReady ? (
        <LoadingScreen />
      ) : (
        <div className="app-content-wrapper">
          <div className="text-white">
            <Main />
          </div>
        </div>
      )}
      <WindowFooter />
    </div>
  );
}

export default App;
