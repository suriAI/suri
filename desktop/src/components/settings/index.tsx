import { useState, useEffect } from 'react';
import { backendService } from '../../services/BackendService';
import { attendanceManager } from '../../services/AttendanceManager';
import { Display } from './sections/Display';
import { Database } from './sections/Database';
import { Attendance } from './sections/Attendance';
import type { QuickSettings, AttendanceSettings, SettingsOverview } from './types';
import type { AttendanceGroup } from '../../types/recognition';

// Re-export types for backward compatibility
export type { QuickSettings, AttendanceSettings };

interface SettingsProps {
  onBack: () => void;
  isModal?: boolean;
  quickSettings?: QuickSettings;
  onQuickSettingsChange?: (settings: QuickSettings) => void;
  attendanceSettings?: AttendanceSettings;
  onAttendanceSettingsChange?: (settings: Partial<AttendanceSettings>) => void;
  isStreaming?: boolean;
}

export const Settings: React.FC<SettingsProps> = ({ 
  onBack, 
  isModal = false, 
  quickSettings: externalQuickSettings, 
  onQuickSettingsChange,
  attendanceSettings: externalAttendanceSettings,
  onAttendanceSettingsChange,
  isStreaming = false,
}) => {
  const [activeSection, setActiveSection] = useState<string>('display');
  const [systemData, setSystemData] = useState<SettingsOverview>({
    totalPersons: 0,
    totalMembers: 0,
    lastUpdated: new Date().toISOString()
  });
  const [groups, setGroups] = useState<AttendanceGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const [internalQuickSettings, setInternalQuickSettings] = useState<QuickSettings>({
    cameraMirrored: true,
    showFPS: true,
    showPreprocessing: false,
    showBoundingBoxes: true,
    showLandmarks: true,
    showAntiSpoofStatus: true,
    showRecognitionNames: true,
  });

  const [internalAttendanceSettings, setInternalAttendanceSettings] = useState<AttendanceSettings>({
    trackingMode: 'auto',
    lateThresholdEnabled: true,
    lateThresholdMinutes: 15,
    classStartTime: '08:00',
  });

  const quickSettings = externalQuickSettings || internalQuickSettings;
  const attendanceSettings = externalAttendanceSettings || internalAttendanceSettings;

  const toggleQuickSetting = (key: keyof QuickSettings) => {
    const newSettings = { ...quickSettings, [key]: !quickSettings[key] };
    if (onQuickSettingsChange) {
      onQuickSettingsChange(newSettings);
    } else {
      setInternalQuickSettings(newSettings);
    }
  };

  const updateAttendanceSetting = (updates: Partial<AttendanceSettings>) => {
    if (onAttendanceSettingsChange) {
      onAttendanceSettingsChange(updates);
    } else {
      setInternalAttendanceSettings(prev => ({ ...prev, ...updates }));
    }
  };

  useEffect(() => {
    loadSystemData();
  }, []);

  const loadSystemData = async () => {
    setIsLoading(true);
    try {
      const [faceStats, attendanceStats, groupsData] = await Promise.all([
        backendService.getDatabaseStats(),
        attendanceManager.getAttendanceStats(),
        attendanceManager.getGroups()
      ]);
      setSystemData({
        totalPersons: faceStats.total_persons,
        totalMembers: attendanceStats.total_members,
        lastUpdated: new Date().toISOString()
      });
      setGroups(groupsData);
    } catch (error) {
      console.error('Failed to load system data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearDatabase = async () => {
    if (!window.confirm('⚠️ Clear ALL face recognition data? This will delete all registered faces and embeddings. This cannot be undone.')) return;
    setIsLoading(true);
    try {
      await backendService.clearDatabase();
      await loadSystemData();
      alert('✓ Database cleared successfully');
    } catch (error) {
      console.error('Failed to clear database:', error);
      alert('❌ Failed to clear database');
    } finally {
      setIsLoading(false);
    }
  };

  const sections = [
    { id: 'display', label: 'Display' },
    { id: 'attendance', label: 'Attendance' },
    { id: 'database', label: 'Database' },
  ];

  const mainContent = (
    <div className="h-full flex bg-[#0f0f0f] text-white">
      {/* Sidebar Navigation */}
      <div className="w-56 flex-shrink-0 border-r border-white/10 flex flex-col">
        {/* Header */}
        <div className="px-4 py-4 border-b border-white/10">
          <h1 className="text-sm font-semibold uppercase tracking-wider text-white/60">Settings</h1>
        </div>

        {/* Navigation Items */}
        <div className="flex-1 p-2 space-y-0.5">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-all ${
                activeSection === section.id
                  ? 'bg-white/10 text-white'
                  : 'text-white/60 hover:bg-white/5 hover:text-white/80'
              }`}
            >
              {section.label}
            </button>
          ))}
        </div>

        {/* Close Button at Bottom */}
        <div className="p-2 border-t border-white/10">
          <button
            onClick={onBack}
            className="w-full px-3 py-2 rounded-md text-sm font-medium text-white/60 hover:bg-white/5 hover:text-white/80 transition-all text-center"
          >
            Close
          </button>
        </div>
      </div>

      {/* Content Panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Section Header */}
        <div className="px-8 py-6 border-b border-white/10">
          <h2 className="text-xl font-semibold">
            {sections.find(s => s.id === activeSection)?.label}
          </h2>
        </div>

        {/* Section Content */}
        <div className="flex-1 overflow-y-auto p-8 custom-scroll">
          {activeSection === 'display' && (
            <Display quickSettings={quickSettings} toggleQuickSetting={toggleQuickSetting} />
          )}
          {activeSection === 'attendance' && (
            <Attendance 
              attendanceSettings={attendanceSettings}
              onTrackingModeChange={(mode) => updateAttendanceSetting({ trackingMode: mode })}
              onLateThresholdChange={(minutes) => updateAttendanceSetting({ lateThresholdMinutes: minutes })}
              onLateThresholdToggle={(enabled) => updateAttendanceSetting({ lateThresholdEnabled: enabled })}
              onClassStartTimeChange={(time) => updateAttendanceSetting({ classStartTime: time })}
              isStreaming={isStreaming}
            />
          )}
          {activeSection === 'database' && (
            <Database 
              systemData={systemData} 
              groups={groups}
              isLoading={isLoading}
              onClearDatabase={handleClearDatabase}
            />
          )}
        </div>
      </div>
    </div>
  );

  if (isModal) {
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
        <div className="bg-[#0f0f0f] border border-white/10 rounded-2xl w-full max-w-5xl h-[85vh] shadow-[0_40px_80px_rgba(0,0,0,0.6)] overflow-hidden">
          {mainContent}
        </div>
      </div>
    );
  }

  return mainContent;
};

