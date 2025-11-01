import { useState, useEffect, useCallback, memo, useRef } from 'react';
import type { AttendanceGroup, AttendanceMember, AttendanceRecord, DetectionResult, TrackedFace, CooldownInfo } from '../types';
import type { ExtendedFaceRecognitionResponse } from '../index';
import { AttendancePanel } from './AttendancePanel';
import { CooldownList } from './CooldownList';
import { DetectionPanel } from './DetectionPanel';

interface SidebarProps {
  // Detection props
  currentDetections: DetectionResult | null;
  currentRecognitionResults: Map<number, ExtendedFaceRecognitionResponse>;
  recognitionEnabled: boolean;
  trackedFaces: Map<string, TrackedFace>;
  trackingMode: 'auto' | 'manual';
  
  // Cooldown props
  persistentCooldowns: Map<string, CooldownInfo>;
  attendanceCooldownSeconds: number;
  
  // Attendance props
  attendanceEnabled: boolean;
  attendanceGroups: AttendanceGroup[];
  currentGroup: AttendanceGroup | null;
  recentAttendance: AttendanceRecord[];
  groupMembers: AttendanceMember[];
  handleSelectGroup: (group: AttendanceGroup) => void;
  setShowGroupManagement: (show: boolean) => void;
  
  // Settings
  setShowSettings: (show: boolean) => void;
  enableSpoofDetection: boolean;
}

const MIN_WIDTH = 50; // Collapsed width (icon only)
const MIN_EXPANDED_WIDTH = 240; // Minimum width when expanded (prevents resizing too small)
const MAX_WIDTH = 480; // Maximum expanded width
const DEFAULT_WIDTH = 320; // Default expanded width

export const Sidebar = memo(function Sidebar({
  currentDetections,
  currentRecognitionResults,
  recognitionEnabled,
  trackedFaces,
  trackingMode,
  persistentCooldowns,
  attendanceCooldownSeconds,
  attendanceEnabled,
  attendanceGroups,
  currentGroup,
  recentAttendance,
  groupMembers,
  handleSelectGroup,
  setShowGroupManagement,
  setShowSettings,
  enableSpoofDetection,
}: SidebarProps) {
  // Persistent state from localStorage
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem('suri_sidebar_collapsed');
    return saved === 'true';
  });

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('suri_sidebar_width');
    const width = saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
    // Ensure saved width respects minimum expanded width
    return Math.max(MIN_EXPANDED_WIDTH, Math.min(MAX_WIDTH, width));
  });

  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);
  const originalTransition = useRef<string>('');

  // Save state to localStorage
  useEffect(() => {
    localStorage.setItem('suri_sidebar_collapsed', String(isCollapsed));
  }, [isCollapsed]);

  useEffect(() => {
    localStorage.setItem('suri_sidebar_width', String(sidebarWidth));
  }, [sidebarWidth]);

  // Toggle collapse/expand
  const toggleSidebar = useCallback(() => {
    setIsCollapsed(prev => !prev);
  }, []);

  // Handle resize start
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (isCollapsed) return; // Don't allow resize when collapsed
    
    setIsResizing(true);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = sidebarWidth;
    
    // Disable transitions for smooth, real-time resizing
    if (sidebarRef.current) {
      // Store original transition value
      originalTransition.current = sidebarRef.current.style.transition || '';
      sidebarRef.current.style.transition = 'none';
    }
  }, [isCollapsed, sidebarWidth]);

  // Handle resize move
  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing || !sidebarRef.current) return;

    const delta = resizeStartX.current - e.clientX; // Right-to-left sidebar
    // Use MIN_EXPANDED_WIDTH when resizing (sidebar is expanded during resize)
    const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_EXPANDED_WIDTH, resizeStartWidth.current + delta));
    
    // Direct DOM manipulation for smooth, real-time resizing without React re-renders
    if (sidebarRef.current) {
      sidebarRef.current.style.width = `${newWidth}px`;
      sidebarRef.current.style.minWidth = `${newWidth}px`;
      sidebarRef.current.style.maxWidth = `${newWidth}px`;
    }
    
    // Update state in the background (for localStorage save on end)
    setSidebarWidth(newWidth);
  }, [isResizing]);

  // Handle resize end
  const handleResizeEnd = useCallback(() => {
    if (!sidebarRef.current) {
      setIsResizing(false);
      return;
    }
    
    // Get final width from DOM to ensure accuracy
    const finalWidth = parseFloat(sidebarRef.current.style.width) || sidebarWidth;
    
    // Update state with final width
    setSidebarWidth(finalWidth);
    
    // Re-enable transitions after resize is complete (restore original or use CSS class default)
    sidebarRef.current.style.transition = originalTransition.current;
    
    // Sync styles to ensure consistency (React will handle via style prop after render)
    // Small delay to allow transition to be restored first
    requestAnimationFrame(() => {
      if (sidebarRef.current) {
        sidebarRef.current.style.width = '';
        sidebarRef.current.style.minWidth = '';
        sidebarRef.current.style.maxWidth = '';
      }
    });
    
    setIsResizing(false);
  }, [sidebarWidth]);

  // Setup resize event listeners
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeEnd);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';

      return () => {
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeEnd);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + B to toggle sidebar
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
      
      // Ctrl/Cmd + , to open settings (industry standard)
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setShowSettings(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSidebar, setShowSettings]);

  const currentWidth = isCollapsed ? MIN_WIDTH : sidebarWidth;

  return (
    <>
      {/* Sidebar Container */}
      <div
        ref={sidebarRef}
        className="relative bg-white/[0.02] border-l border-b border-white/[0.08] flex flex-col max-h-full transition-all duration-300 ease-in-out"
        style={{
          width: `${currentWidth}px`,
          minWidth: `${currentWidth}px`,
          maxWidth: `${currentWidth}px`,
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
              paddingLeft: '2px',
              marginLeft: '-2px'
            }}
          >
            <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 h-12 rounded-r transition-all ${
              isResizing 
                ? 'bg-blue-500/70 h-16' 
                : 'bg-white/10 group-hover:bg-blue-500/50'
            }`} />
          </div>
        )}

        {/* Header - Minimal Design */}
        <div className={`px-3 py-2.5 border-b border-white/[0.08] transition-opacity duration-200 ${isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
          <div className="flex items-center justify-between gap-2">
            {/* Collapse Button - Top Left */}
            <button
              onClick={toggleSidebar}
              className="sidebar-toggle-btn flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 group"
              title={isCollapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'}
              aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <img 
                src="/sidebar-collapse.svg" 
                alt="" 
                className="w-5 h-5 transition-all duration-300 group-hover:opacity-100"
                style={{ filter: 'brightness(0) invert(1)', opacity: 0.7 }}
              />
            </button>

            {/* Settings Button - Top Right */}
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center justify-center w-9 h-9 hover:bg-white/[0.08] bg-transparent border-none transition-all duration-200 hover:scale-105 active:scale-95 group"
              title="Settings (Ctrl+,)"
              disabled={isCollapsed}
              aria-label="Open Settings"
            >
              <i className="fa-solid fa-gear text-white/50 group-hover:text-white text-base transition-colors"></i>
            </button>
          </div>
        </div>
        
        {/* Content Area */}
        <div className={`sidebar h-screen max-h-screen flex flex-col overflow-hidden transition-opacity duration-200 ${isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
          {/* Face Detection Display - Half of remaining space */}
          <div className="flex-1 border-b border-white/[0.08] flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto custom-scroll">
              {/* Active Cooldowns - Only show in Auto mode */}
              <CooldownList
                trackingMode={trackingMode}
                persistentCooldowns={persistentCooldowns}
                attendanceCooldownSeconds={attendanceCooldownSeconds}
              />
              
              <div className="px-2 py-1.5">
                <DetectionPanel
                  currentDetections={currentDetections}
                  currentRecognitionResults={currentRecognitionResults}
                  recognitionEnabled={recognitionEnabled}
                  trackedFaces={trackedFaces}
                  groupMembers={groupMembers}
                  enableSpoofDetection={enableSpoofDetection}
                />
              </div>
            </div>
          </div>

          {/* Attendance Management or Recent Logs - Using AttendancePanel Component */}
          <AttendancePanel
            attendanceEnabled={attendanceEnabled}
            attendanceGroups={attendanceGroups}
            currentGroup={currentGroup}
            recentAttendance={recentAttendance}
            groupMembers={groupMembers}
            handleSelectGroup={handleSelectGroup}
            setShowGroupManagement={setShowGroupManagement}
          />
        </div>

        {/* Collapsed State - Minimalist Icon Bar */}
        {isCollapsed && (
          <div className="absolute inset-0 flex flex-col items-center py-6 gap-3">
            {/* Expand Button - Top */}
            <button
              onClick={toggleSidebar}
              className="sidebar-toggle-btn flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 group"
              title="Expand sidebar (Ctrl+B)"
              aria-label="Expand sidebar"
            >
              <img 
                src="/sidebar-expand.svg" 
                alt="" 
                className="w-5 h-5 transition-all group-hover:opacity-100"
                style={{ filter: 'brightness(0) invert(1)', opacity: 0.7 }}
              />
            </button>

            {/* Visual Separator */}
            <div className="w-8 h-px bg-white/[0.06] my-1"></div>

            {/* Settings Icon */}
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center justify-center w-11 h-11 hover:bg-white/[0.08] bg-transparent border-none transition-all duration-200 hover:scale-105 active:scale-95 group"
              title="Settings (Ctrl+,)"
              aria-label="Open Settings"
            >
              <i className="fa-solid fa-gear text-white/70 group-hover:text-white text-base transition-colors"></i>
            </button>
          </div>
        )}

      </div>
    </>
  );
});
