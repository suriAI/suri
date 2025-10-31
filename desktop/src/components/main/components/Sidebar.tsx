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
}

const MIN_WIDTH = 64; // Collapsed width (icon only)
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
}: SidebarProps) {
  // Persistent state from localStorage
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem('suri_sidebar_collapsed');
    return saved === 'true';
  });

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('suri_sidebar_width');
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });

  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

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
  }, [isCollapsed, sidebarWidth]);

  // Handle resize move
  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;

    const delta = resizeStartX.current - e.clientX; // Right-to-left sidebar
    const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, resizeStartWidth.current + delta));
    
    // Use requestAnimationFrame for smooth resizing
    requestAnimationFrame(() => {
      setSidebarWidth(newWidth);
    });
  }, [isResizing]);

  // Handle resize end
  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
  }, []);

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
          >
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-12 bg-white/10 rounded-r group-hover:bg-blue-500/50 transition-all" />
          </div>
        )}

        {/* Header - Minimal Design */}
        <div className={`px-3 py-2.5 border-b border-white/[0.08] transition-opacity duration-200 ${isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
          <div className="flex items-center justify-between gap-2">
            {/* Settings Button */}
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] transition-all duration-200 hover:scale-105 active:scale-95 group"
              title="Settings (Ctrl+,)"
              disabled={isCollapsed}
              aria-label="Open Settings"
            >
              <i className="fa-solid fa-gear text-white/70 group-hover:text-white text-base transition-colors"></i>
            </button>

            {/* Collapse Button - Top Right (Industry Standard) */}
            <button
              onClick={toggleSidebar}
              className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] transition-all duration-200 hover:scale-105 active:scale-95 group"
              title={isCollapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'}
              aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <i className={`fa-solid fa-chevron-left text-white/70 group-hover:text-white text-sm transition-all duration-300 ${isCollapsed ? 'rotate-180' : ''}`}></i>
            </button>
          </div>
        </div>
        
        {/* Content Area */}
        <div className={`sidebar h-screen max-h-screen flex flex-col overflow-hidden transition-opacity duration-200 ${isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
          {/* Face Detection Display - Half of remaining space */}
          <div className="flex-1 border-b border-white/[0.08] flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto space-y-2 custom-scroll">
              {/* Active Cooldowns - Only show in Auto mode */}
              <CooldownList
                trackingMode={trackingMode}
                persistentCooldowns={persistentCooldowns}
                attendanceCooldownSeconds={attendanceCooldownSeconds}
              />
              
              <DetectionPanel
                currentDetections={currentDetections}
                currentRecognitionResults={currentRecognitionResults}
                recognitionEnabled={recognitionEnabled}
                trackedFaces={trackedFaces}
                groupMembers={groupMembers}
              />
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
              className="flex items-center justify-center w-11 h-11 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] transition-all duration-200 hover:scale-105 active:scale-95 group"
              title="Expand sidebar (Ctrl+B)"
              aria-label="Expand sidebar"
            >
              <i className="fa-solid fa-chevron-right text-white/70 group-hover:text-white text-sm transition-colors"></i>
            </button>

            {/* Visual Separator */}
            <div className="w-8 h-px bg-white/[0.06] my-1"></div>

            {/* Settings Icon */}
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center justify-center w-11 h-11 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] transition-all duration-200 hover:scale-105 active:scale-95 group"
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
