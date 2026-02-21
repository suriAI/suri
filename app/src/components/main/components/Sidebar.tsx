import { useState, useEffect, useCallback, memo, useRef } from "react";
import { motion } from "framer-motion";
import type {
  AttendanceGroup,
  DetectionResult,
  TrackedFace,
} from "@/components/main/types";
import type { ExtendedFaceRecognitionResponse } from "@/components/main/utils";
import { AttendancePanel } from "@/components/main/components/AttendancePanel";
import { DetectionPanel } from "@/components/main/components/DetectionPanel";

// Get asset path that works in both dev and production (Electron)
// In Electron with loadFile, we need to use paths relative to the HTML file
// Vite's base is "./", so we use relative paths for both dev and production
const getAssetPath = (assetName: string): string => {
  // Use relative path from the HTML file (public folder assets are copied to root of dist-react)
  return `./${assetName}`;
};

const sidebarCollapseIcon = getAssetPath("sidebar-collapse.svg");
const sidebarExpandIcon = getAssetPath("sidebar-expand.svg");

import { useAttendanceStore, useUIStore } from "@/components/main/stores";

// ... existing imports ...

interface SidebarProps {
  // Detection props
  currentDetections: DetectionResult | null;
  currentRecognitionResults: Map<number, ExtendedFaceRecognitionResponse>;
  recognitionEnabled: boolean;
  trackedFaces: Map<string, TrackedFace>;
  isStreaming: boolean;
  isVideoLoading: boolean;

  handleSelectGroup: (group: AttendanceGroup) => void;
}

const MIN_WIDTH = 50; // Collapsed width (icon only)
const MIN_EXPANDED_WIDTH = 240; // Minimum width when expanded (prevents resizing too small)
const MAX_WIDTH = 340; // Maximum expanded width

export const Sidebar = memo(function Sidebar({
  currentDetections,
  currentRecognitionResults,
  recognitionEnabled,
  trackedFaces,
  isStreaming,
  isVideoLoading,
  handleSelectGroup,
}: SidebarProps) {
  // Zustand Stores
  const { groupMembers } = useAttendanceStore();
  const {
    setShowSettings,
    sidebarCollapsed: isCollapsed,
    setSidebarCollapsed: setIsCollapsed,
    sidebarWidth,
    setSidebarWidth,
    isHydrated,
  } = useUIStore();

  const [isResizing, setIsResizing] = useState(false);
  const isResizingRef = useRef(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);
  const currentResizeWidth = useRef(0);
  const originalTransition = useRef<string>("");

  // No local state initialization or manual state sync needed - handled by store
  const isInitialized = isHydrated;

  // Sync isResizing ref with state
  useEffect(() => {
    isResizingRef.current = isResizing;
  }, [isResizing]);

  // Toggle collapse/expand (with transition for manual toggles)
  const toggleSidebar = useCallback(() => {
    if (sidebarRef.current && isInitialized) {
      // Ensure transition is enabled for manual toggles
      sidebarRef.current.style.transition = "";
    }
    setIsCollapsed(!isCollapsed);
  }, [isInitialized, isCollapsed, setIsCollapsed]);

  // Handle resize start
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (isCollapsed) return;

      resizeStartX.current = e.clientX;
      resizeStartWidth.current = sidebarWidth;
      currentResizeWidth.current = sidebarWidth;
      isResizingRef.current = true;
      setIsResizing(true);

      if (sidebarRef.current) {
        originalTransition.current = sidebarRef.current.style.transition || "";
        sidebarRef.current.style.transition = "none";
      }
    },
    [isCollapsed, sidebarWidth],
  );

  // Handle resize move
  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizingRef.current || !sidebarRef.current) return;

    const delta = resizeStartX.current - e.clientX;
    const newWidth = Math.min(
      MAX_WIDTH,
      Math.max(MIN_EXPANDED_WIDTH, resizeStartWidth.current + delta),
    );

    currentResizeWidth.current = newWidth;
    sidebarRef.current.style.width = `${newWidth}px`;
    sidebarRef.current.style.minWidth = `${newWidth}px`;
    sidebarRef.current.style.maxWidth = `${newWidth}px`;
  }, []);

  // Handle resize end
  const handleResizeEnd = useCallback(() => {
    if (!isResizingRef.current) return;

    let finalWidth = currentResizeWidth.current;

    if (
      sidebarRef.current &&
      (!finalWidth || finalWidth < MIN_EXPANDED_WIDTH)
    ) {
      const domWidth = parseFloat(sidebarRef.current.style.width);
      if (!isNaN(domWidth) && domWidth >= MIN_EXPANDED_WIDTH) {
        finalWidth = domWidth;
      }
    }

    if (!finalWidth || finalWidth < MIN_EXPANDED_WIDTH) {
      finalWidth = sidebarWidth;
    }

    finalWidth = Math.min(MAX_WIDTH, Math.max(MIN_EXPANDED_WIDTH, finalWidth));

    setSidebarWidth(finalWidth);
    setIsResizing(false);
    isResizingRef.current = false;

    if (sidebarRef.current) {
      sidebarRef.current.style.transition = originalTransition.current;
    }
  }, [sidebarWidth, setSidebarWidth]);

  // Setup resize event listeners
  useEffect(() => {
    if (isResizing) {
      document.addEventListener("mousemove", handleResizeMove);
      document.addEventListener("mouseup", handleResizeEnd);
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";

      return () => {
        document.removeEventListener("mousemove", handleResizeMove);
        document.removeEventListener("mouseup", handleResizeEnd);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
    }
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + B to toggle sidebar
      if ((e.ctrlKey || e.metaKey) && e.key === "b") {
        e.preventDefault();
        toggleSidebar();
      }

      // Ctrl/Cmd + , to open settings (industry standard)
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setShowSettings(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar, setShowSettings]);

  const currentWidth = isCollapsed ? MIN_WIDTH : sidebarWidth;

  // Ensure width is correct when collapsed state changes (only after initialization)
  useEffect(() => {
    if (isInitialized && !isResizing && sidebarRef.current) {
      const expectedWidth = isCollapsed ? MIN_WIDTH : sidebarWidth;
      sidebarRef.current.style.width = `${expectedWidth}px`;
      sidebarRef.current.style.minWidth = `${expectedWidth}px`;
      sidebarRef.current.style.maxWidth = `${expectedWidth}px`;
    }
  }, [isCollapsed, sidebarWidth, isResizing, isInitialized]);

  return (
    <>
      {/* Sidebar Container */}
      <div
        ref={sidebarRef}
        className={`relative z-50 h-full overflow-hidden bg-black/80 border-l border-white/10 shadow-[-8px_0_32px_rgba(0,0,0,0.5)] flex flex-col ${isInitialized ? "transition-all duration-300 ease-in-out" : ""}`}
        style={{
          width: `${currentWidth}px`,
          minWidth: `${currentWidth}px`,
          maxWidth: `${currentWidth}px`,
          willChange: "width",
        }}
      >
        {/* Resize Handle - Left side of sidebar */}
        {!isCollapsed && (
          <div
            className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-blue-500/30 active:bg-blue-500/50 transition-colors z-20 group"
            onMouseDown={handleResizeStart}
            title="Drag to resize"
            style={{
              // Extend hitbox for easier grabbing (but keep visual width minimal)
              paddingLeft: "2px",
              marginLeft: "-2px",
            }}
          >
            <div
              className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 h-12 rounded-r transition-all ${
                isResizing
                  ? "bg-blue-500/70 h-16"
                  : "bg-white/10 group-hover:bg-blue-500/50"
              }`}
            />
          </div>
        )}

        {/* Header - Minimal Design */}
        <div
          className={`px-3 py-1 border-b border-white/[0.08] transition-opacity duration-200 ${isCollapsed ? "opacity-0 pointer-events-none" : "opacity-100"}`}
          style={{ minWidth: isResizing ? undefined : sidebarWidth }}
        >
          <div className="flex items-center justify-between gap-2">
            {/* Collapse Button - Top Left */}
            <button
              onClick={toggleSidebar}
              className="sidebar-toggle-btn flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 group"
              title={
                isCollapsed
                  ? "Expand sidebar (Ctrl+B)"
                  : "Collapse sidebar (Ctrl+B)"
              }
              aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <img
                src={sidebarCollapseIcon}
                alt=""
                className="w-5 h-5 transition-all duration-300 group-hover:opacity-100"
                style={{ filter: "brightness(0) invert(1)", opacity: 0.7 }}
              />
            </button>

            {/* Settings Button - Top Right */}
            <motion.button
              onClick={() => setShowSettings(true)}
              className="flex items-center justify-center w-9 h-9 bg-transparent border-none group rounded-lg"
              title="Settings (Ctrl+,)"
              disabled={isCollapsed}
              aria-label="Open Settings"
              initial="initial"
              whileHover="hover"
            >
              <motion.i
                className="fa-solid fa-gear text-white/50 group-hover:text-white text-base transition-colors"
                variants={{
                  initial: { rotate: 0 },
                  hover: { rotate: 90 },
                }}
                transition={{ type: "spring", stiffness: 260, damping: 20 }}
              ></motion.i>
            </motion.button>
          </div>
        </div>

        {/* Content Area */}
        <div
          className={`sidebar flex-1 flex flex-col overflow-hidden transition-opacity duration-200 ${isCollapsed ? "opacity-0 pointer-events-none" : "opacity-100"}`}
          style={{ minWidth: isResizing ? undefined : sidebarWidth }}
        >
          {/* Attendance Management or Recent Logs - Using AttendancePanel Component */}
          <AttendancePanel handleSelectGroup={handleSelectGroup} />

          {/* Face Detection Display - Half of remaining space */}
          <div className="flex-1 border-t border-white/[0.08] flex flex-col min-h-0 bg-black">
            <div className="flex-1 overflow-y-auto custom-scroll flex flex-col min-h-0 bg-black">
              <div className="flex-1 flex flex-col min-h-[0] px-2 bg-black">
                <DetectionPanel
                  currentDetections={currentDetections}
                  currentRecognitionResults={currentRecognitionResults}
                  recognitionEnabled={recognitionEnabled}
                  trackedFaces={trackedFaces}
                  groupMembers={groupMembers}
                  isStreaming={isStreaming}
                  isVideoLoading={isVideoLoading}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Collapsed State - Minimalist Icon Bar */}
        {isCollapsed && (
          <div className="absolute inset-0 flex flex-col items-center py-3 gap-3">
            {/* Expand Button - Top */}
            <button
              onClick={toggleSidebar}
              className="sidebar-toggle-btn flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 group"
              title="Expand sidebar (Ctrl+B)"
              aria-label="Expand sidebar"
            >
              <img
                src={sidebarExpandIcon}
                alt=""
                className="w-5 h-5 transition-all group-hover:opacity-100"
                style={{ filter: "brightness(0) invert(1)", opacity: 0.7 }}
              />
            </button>

            {/* Visual Separator */}
            <div className="w-8 h-px bg-white/[0.06] my-1"></div>

            {/* Settings Icon */}
            <motion.button
              onClick={() => setShowSettings(true)}
              className="flex items-center justify-center w-11 h-11 bg-transparent border-none group rounded-xl"
              title="Settings (Ctrl+,)"
              aria-label="Open Settings"
              initial="initial"
              whileHover="hover"
            >
              <motion.i
                className="fa-solid fa-gear text-white/70 group-hover:text-white text-base transition-colors"
                variants={{
                  initial: { rotate: 0 },
                  hover: { rotate: 90 },
                }}
                transition={{ type: "spring", stiffness: 260, damping: 20 }}
              ></motion.i>
            </motion.button>
          </div>
        )}
      </div>
    </>
  );
});
