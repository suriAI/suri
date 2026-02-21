import { WindowBar } from "@/components/window";
import Main from "@/components/main";
import { useUIStore } from "@/components/main/stores/uiStore";
import { IntroModal } from "@/components/shared/IntroModal";
import { DialogProvider } from "@/components/shared";

import { AppSkeleton } from "@/components/shared/AppSkeleton";

function App() {
  const { hasSeenIntro, isHydrated } = useUIStore();

  if (!isHydrated) {
    return (
      <div className="electron-window-container bg-black">
        <WindowBar />
        <div className="flex-1" />
      </div>
    );
  }

  return (
    <DialogProvider>
      <div className="electron-window-container">
        <WindowBar />
        <div className="app-content-wrapper">
          <div className="text-white h-full">
            {hasSeenIntro ? (
              <Main />
            ) : (
              <>
                <AppSkeleton />
                <IntroModal />
              </>
            )}
          </div>
        </div>
      </div>
    </DialogProvider>
  );
}

export default App;
