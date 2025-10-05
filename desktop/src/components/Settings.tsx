/**
 * Settings Component - SQLite Backend Management
 * 
 * This component provides a management interface for the SQLite backend database,
 * similar to System Management but using BackendService for HTTP API communication
 * instead of Electron IPC.
 */

import React, { useState, useEffect } from 'react';
import { backendService } from '../services/BackendService';
import { attendanceManager } from '../services/AttendanceManager';
import type { AttendanceGroup } from '../types/recognition';

// Quick Settings Interface
export interface QuickSettings {
  showFPS: boolean;
  showPreprocessing: boolean;
  showBoundingBoxes: boolean;
  showLandmarks: boolean;
  showAntiSpoofStatus: boolean;
  showRecognitionNames: boolean;
  showDebugInfo: boolean;
}

// Database Settings Interfaces
interface SettingsOverview {
  totalPersons: number;
  totalEmbeddings: number;
  lastUpdated: string;
}

interface PersonDetails {
  person_id: string;
  embedding_count: number;
  last_seen?: string;
}

interface SettingsProps {
  onBack: () => void;
  isModal?: boolean;
  quickSettings?: QuickSettings;
  onQuickSettingsChange?: (settings: QuickSettings) => void;
  attendanceGroup?: AttendanceGroup; // Optional attendance group for settings
  onAttendanceGroupUpdate?: () => void; // Callback when group is updated
}

export const Settings: React.FC<SettingsProps> = ({ 
  onBack, 
  isModal = false, 
  quickSettings: externalQuickSettings, 
  onQuickSettingsChange,
  attendanceGroup,
  onAttendanceGroupUpdate
}) => {
  // State management
  const [activeView, setActiveView] = useState<'quick' | 'overview' | 'people' | 'search' | 'advanced' | 'maintenance' | 'attendance'>('quick');
  const [systemData, setSystemData] = useState<SettingsOverview>({
    totalPersons: 0,
    totalEmbeddings: 0,
    lastUpdated: new Date().toISOString()
  });
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PersonDetails[]>([]);
  const [showDeleteDialog, setShowDeleteDialog] = useState<PersonDetails | null>(null);
  const [allPersons, setAllPersons] = useState<PersonDetails[]>([]);
  const [editingPerson, setEditingPerson] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [localAttendanceGroup, setLocalAttendanceGroup] = useState<AttendanceGroup | null>(attendanceGroup || null);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);
  const [isUpdatingAttendance, setIsUpdatingAttendance] = useState(false);

  // Quick Settings State (controlled by parent if provided)
  const [internalQuickSettings, setInternalQuickSettings] = useState<QuickSettings>({
    showFPS: true,
    showPreprocessing: false,
    showBoundingBoxes: true,
    showLandmarks: false,
    showAntiSpoofStatus: true,
    showRecognitionNames: true,
    showDebugInfo: false,
  });

  const quickSettings = externalQuickSettings || internalQuickSettings;

  const toggleQuickSetting = (key: keyof QuickSettings) => {
    const newSettings = { ...quickSettings, [key]: !quickSettings[key] };
    if (onQuickSettingsChange) {
      onQuickSettingsChange(newSettings);
    } else {
      setInternalQuickSettings(newSettings);
    }
  };

  // Load system data on component mount
  useEffect(() => {
    loadSystemData();
  }, []);

  // Update local attendance group when prop changes
  useEffect(() => {
    if (attendanceGroup) {
      setLocalAttendanceGroup(attendanceGroup);
    }
  }, [attendanceGroup]);

  const loadSystemData = async () => {
    setIsLoading(true);
    try {
      // Get database statistics from backend
      const stats = await backendService.getDatabaseStats();
      setSystemData({
        totalPersons: stats.total_persons,
        totalEmbeddings: stats.total_embeddings,
        lastUpdated: new Date().toISOString()
      });
      
      // Convert PersonInfo[] to PersonDetails[]
      const persons: PersonDetails[] = stats.persons.map(person => ({
        person_id: person.person_id,
        embedding_count: person.embedding_count,
        last_seen: person.last_seen
      }));
      setAllPersons(persons);
    } catch (error) {
      console.error('Failed to load system data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setIsLoading(true);
    try {
      // Filter persons based on search query
      const filtered = allPersons.filter(person => 
        person.person_id.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setSearchResults(filtered);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeletePerson = async (person: PersonDetails) => {
    setIsLoading(true);
    try {
      await backendService.removePerson(person.person_id);
      await loadSystemData(); // Refresh data
      setShowDeleteDialog(null);
    } catch (error) {
      console.error('Failed to delete person:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const startEdit = (person: PersonDetails) => {
    setEditingPerson(person.person_id);
    setEditName(person.person_id);
  };

  const cancelEdit = () => {
    setEditingPerson(null);
    setEditName('');
  };

  const saveEdit = async () => {
    if (!editingPerson || !editName.trim() || editName.trim() === editingPerson) {
      cancelEdit();
      return;
    }

    setIsLoading(true);
    try {
      await backendService.updatePerson(editingPerson, editName.trim());
      await loadSystemData(); // Refresh data
      cancelEdit();
    } catch (error) {
      console.error('Failed to update person:', error);
      alert('Failed to update person name. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (showDeleteDialog) {
      await handleDeletePerson(showDeleteDialog);
    }
  };

  const handleClearDatabase = async () => {
    if (!window.confirm('Are you sure you want to clear the entire database? This action cannot be undone.')) {
      return;
    }

    setIsLoading(true);
    try {
      await backendService.clearDatabase();
      await loadSystemData(); // Refresh data
    } catch (error) {
      console.error('Failed to clear database:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefreshData = async () => {
    await loadSystemData();
  };

  const renderAttendanceSettings = () => {
    if (!localAttendanceGroup) {
      return (
        <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
          <p className="text-white/60 text-center">No attendance group selected. Please select a group from the Menu.</p>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {attendanceError && (
          <div className="bg-rose-500/20 border border-rose-500/40 rounded-xl p-4 text-rose-200 text-sm">
            {attendanceError}
          </div>
        )}

        <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Group Information</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-white/60">Group Name</span>
              <span className="text-white font-medium">{localAttendanceGroup.name}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-white/60">Type</span>
              <span className="text-white font-medium capitalize">{localAttendanceGroup.type}</span>
            </div>
          </div>
        </div>

        <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
          <h3 className="text-lg font-semibold text-white mb-6">Attendance Settings</h3>
          <div className="space-y-6">
            <label className="block">
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm text-white/70">Class Start Time</span>
                <span className="text-white font-medium font-mono text-sm">
                  {localAttendanceGroup.settings?.class_start_time ?? '08:00'}
                </span>
              </div>
              <input
                type="time"
                value={localAttendanceGroup.settings?.class_start_time ?? '08:00'}
                onChange={async (event) => {
                  const time = event.target.value;
                  setIsUpdatingAttendance(true);
                  setAttendanceError(null);
                  try {
                    await attendanceManager.updateGroup(localAttendanceGroup.id, {
                      settings: {
                        ...localAttendanceGroup.settings,
                        class_start_time: time
                      }
                    });
                    const updatedGroup = await attendanceManager.getGroup(localAttendanceGroup.id);
                    if (updatedGroup) {
                      setLocalAttendanceGroup(updatedGroup);
                      onAttendanceGroupUpdate?.();
                    }
                  } catch (err) {
                    console.error('Error updating class start time:', err);
                    setAttendanceError(err instanceof Error ? err.message : 'Failed to update class start time');
                  } finally {
                    setIsUpdatingAttendance(false);
                  }
                }}
                disabled={isUpdatingAttendance}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 focus:outline-none focus:border-blue-500/60 text-sm font-mono text-white disabled:opacity-50"
              />
              <p className="text-xs text-white/50 mt-2 leading-relaxed">
                Actual time when class/work starts - used to determine late arrivals
              </p>
            </label>
            
            <label className="block">
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm text-white/70">Late Threshold</span>
                <span className="text-white font-medium text-sm">
                  {localAttendanceGroup.settings?.late_threshold_minutes ?? 15} minutes
                </span>
              </div>
              <input
                type="range"
                min="5"
                max="60"
                step="5"
                value={localAttendanceGroup.settings?.late_threshold_minutes ?? 15}
                onChange={async (event) => {
                  const minutes = parseInt(event.target.value);
                  setIsUpdatingAttendance(true);
                  setAttendanceError(null);
                  try {
                    await attendanceManager.updateGroup(localAttendanceGroup.id, {
                      settings: {
                        ...localAttendanceGroup.settings,
                        late_threshold_minutes: minutes
                      }
                    });
                    const updatedGroup = await attendanceManager.getGroup(localAttendanceGroup.id);
                    if (updatedGroup) {
                      setLocalAttendanceGroup(updatedGroup);
                      onAttendanceGroupUpdate?.();
                    }
                  } catch (err) {
                    console.error('Error updating late threshold:', err);
                    setAttendanceError(err instanceof Error ? err.message : 'Failed to update late threshold');
                  } finally {
                    setIsUpdatingAttendance(false);
                  }
                }}
                disabled={isUpdatingAttendance}
                className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
                style={{
                  background: `linear-gradient(to right, rgb(96 165 250) 0%, rgb(96 165 250) ${((localAttendanceGroup.settings?.late_threshold_minutes ?? 15) - 5) / 55 * 100}%, rgb(255 255 255 / 0.1) ${((localAttendanceGroup.settings?.late_threshold_minutes ?? 15) - 5) / 55 * 100}%, rgb(255 255 255 / 0.1) 100%)`
                }}
              />
              <div className="flex justify-between text-xs text-white/40 mt-2">
                <span>5 min</span>
                <span>60 min</span>
              </div>
              <p className="text-xs text-white/50 mt-2 leading-relaxed">
                Grace period after class start time before marking as late
              </p>
            </label>

            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-blue-200 mb-2">How it works</h4>
              <p className="text-xs text-blue-100/70 leading-relaxed">
                Students/employees who check in after <span className="font-mono font-medium">
                  {localAttendanceGroup.settings?.class_start_time ?? '08:00'}
                </span> + <span className="font-medium">
                  {localAttendanceGroup.settings?.late_threshold_minutes ?? 15} minutes
                </span> will be marked as late.
              </p>
              <p className="text-xs text-blue-100/70 leading-relaxed mt-2">
                Example: If someone checks in at{' '}
                {(() => {
                  const startTime = localAttendanceGroup.settings?.class_start_time ?? '08:00';
                  const threshold = localAttendanceGroup.settings?.late_threshold_minutes ?? 15;
                  const [hours, minutes] = startTime.split(':').map(Number);
                  const totalMinutes = hours * 60 + minutes + threshold;
                  const cutoffHours = Math.floor(totalMinutes / 60);
                  const cutoffMinutes = totalMinutes % 60;
                  const cutoffTime = `${cutoffHours.toString().padStart(2, '0')}:${cutoffMinutes.toString().padStart(2, '0')}`;
                  return cutoffTime;
                })()}, they will be marked as <span className="font-medium text-amber-200">LATE</span>.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderQuickSettings = () => (
    <div className="space-y-6">
      <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
        <h3 className="text-lg font-light text-white/90 mb-6 flex items-center space-x-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span>Display Controls</span>
        </h3>
        
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            { key: 'showFPS' as keyof QuickSettings, label: 'FPS Counter', desc: 'Frame rate', icon: '⚡' },
            { key: 'showBoundingBoxes' as keyof QuickSettings, label: 'Face Boxes', desc: 'Detection boxes', icon: '▢' },
            { key: 'showLandmarks' as keyof QuickSettings, label: 'Landmarks', desc: 'Face keypoints', icon: '●' },
            { key: 'showAntiSpoofStatus' as keyof QuickSettings, label: 'Anti-Spoof', desc: 'Spoof detection', icon: '🛡️' },
            { key: 'showRecognitionNames' as keyof QuickSettings, label: 'Names', desc: 'Person labels', icon: '👤' },
            { key: 'showDebugInfo' as keyof QuickSettings, label: 'Debug', desc: 'Technical info', icon: '🔧' },
          ].map(({ key, label, desc, icon }) => (
            <button
              key={key}
              onClick={() => toggleQuickSetting(key)}
              className={`p-4 rounded-xl border transition-all duration-200 text-left ${
                quickSettings[key]
                  ? 'bg-white/[0.08] border-green-500/50 hover:bg-white/[0.1]'
                  : 'bg-white/[0.02] border-white/[0.08] hover:bg-white/[0.05]'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <span className="text-lg">{icon}</span>
                  <span className="text-white font-light text-sm">{label}</span>
                </div>
                <div className={`w-9 h-5 rounded-full transition-colors ${
                  quickSettings[key] ? 'bg-green-500' : 'bg-white/20'
                }`}>
                  <div className={`w-4 h-4 rounded-full bg-white transition-transform duration-200 ${
                    quickSettings[key] ? 'translate-x-4' : 'translate-x-0.5'
                  } mt-0.5`} />
                </div>
              </div>
              <p className="text-xs text-white/40">{desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="bg-gradient-to-br from-blue-500/10 to-purple-500/10 border border-blue-500/20 rounded-2xl p-6">
        <div className="flex items-start space-x-3">
          <svg className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
          </svg>
          <div>
            <h4 className="text-white font-light mb-1">Display Controls</h4>
            <p className="text-sm text-white/60 leading-relaxed">
              Toggle visual overlays on the live video feed. Changes take effect instantly.
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  const renderOverview = () => (
    <div className="space-y-6">
      {/* People Database Section */}
      <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
        <h3 className="text-lg font-light text-white/90 mb-4 flex items-center space-x-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
          </svg>
          <span>People Database</span>
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white/[0.03] rounded-xl p-4">
            <div className="text-2xl font-light text-white">{systemData.totalPersons}</div>
            <div className="text-sm text-white/60">Total People</div>
          </div>
          <div className="bg-white/[0.03] rounded-xl p-4">
            <div className="text-2xl font-light text-white">{systemData.totalEmbeddings}</div>
            <div className="text-sm text-white/60">Total Embeddings</div>
          </div>
        </div>
      </div>

      {/* Performance Section */}
      <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
        <h3 className="text-lg font-light text-white/90 mb-4 flex items-center space-x-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
          </svg>
          <span>Performance</span>
        </h3>
        <div className="text-sm text-white/60">
          Last updated: {new Date(systemData.lastUpdated).toLocaleString()}
        </div>
      </div>
    </div>
  );

  const renderPeople = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-light text-white/90">Registered People</h3>
        <button
          onClick={loadSystemData}
          className="px-4 py-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-200 rounded-xl text-sm transition-colors duration-150"
        >
          Refresh
        </button>
      </div>
      
      <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl overflow-hidden">
        <div className="max-h-96 overflow-y-auto">
          {allPersons.length === 0 ? (
            <div className="p-6 text-center text-white/60">
              No people registered in the database
            </div>
          ) : (
            <div className="divide-y divide-white/[0.05]">
              {allPersons.map((person) => (
                <div key={person.person_id} className="group p-4 hover:bg-white/[0.02] transition-colors duration-150">
                  <div className="flex justify-between items-center">
                    <div className="flex-1">
                      {editingPerson === person.person_id ? (
                        <div className="flex items-center gap-3">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="px-3 py-1 bg-white/[0.03] border border-white/[0.08] rounded-lg text-white font-medium focus:outline-none focus:border-white/[0.20] focus:bg-white/[0.05] transition-colors duration-150"
                            onKeyPress={(e) => {
                              if (e.key === 'Enter') saveEdit();
                              if (e.key === 'Escape') cancelEdit();
                            }}
                            autoFocus
                          />
                          <button
                            onClick={saveEdit}
                            className="px-3 py-1 bg-white/[0.08] hover:bg-white/[0.12] border border-white/[0.15] text-white rounded-lg text-sm transition-colors duration-150"
                          >
                            Save
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="px-3 py-1 bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.08] text-white/80 hover:text-white rounded-lg text-sm transition-colors duration-150"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div>
                          <button
                            onClick={() => startEdit(person)}
                            className="text-white/90 font-medium hover:text-white transition-colors duration-150 text-left"
                          >
                            {person.person_id}
                          </button>
                          <div className="text-sm text-white/60 mt-1">
                            {person.embedding_count} embeddings
                            {person.last_seen && ` • Last seen: ${new Date(person.last_seen).toLocaleString()}`}
                          </div>
                        </div>
                      )}
                    </div>

                    {editingPerson !== person.person_id && (
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                        <button
                          onClick={() => startEdit(person)}
                          className="px-3 py-1 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] text-white/80 hover:text-white rounded-lg text-sm transition-colors duration-150"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setShowDeleteDialog(person)}
                          className="px-3 py-1 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-200 rounded-lg text-sm transition-colors duration-150"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderSearch = () => (
    <div className="space-y-4">
      <div className="flex space-x-4">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search registered persons..."
          className="flex-1 px-4 py-2 bg-white/[0.05] border border-white/[0.1] rounded-xl text-white placeholder-white/50 focus:outline-none focus:border-white/[0.2]"
        />
        <button
          onClick={handleSearch}
          className="px-6 py-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-200 rounded-xl transition-colors duration-150"
        >
          Search
        </button>
      </div>

      {searchResults.length > 0 && (
        <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl overflow-hidden">
          <div className="divide-y divide-white/[0.05]">
            {searchResults.map((person, index) => (
              <div key={person.person_id} className="p-4">
                <div className="font-medium text-white/90">Registered Person #{index + 1}</div>
                <div className="text-sm text-white/60">
                  {person.embedding_count} face embedding{person.embedding_count !== 1 ? 's' : ''}
                  {person.last_seen && ` • Last seen: ${new Date(person.last_seen).toLocaleString()}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderMaintenance = () => (
    <div className="space-y-6">
      <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
        <h3 className="text-lg font-light text-white/90 mb-4">System Maintenance</h3>
        <div className="space-y-4">
          <button
              onClick={handleClearDatabase}
              disabled={isLoading}
              className="w-full px-4 py-3 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-200 rounded-xl transition-colors duration-150 disabled:opacity-50"
            >
              Clear Database
            </button>
            <button
              onClick={handleRefreshData}
              disabled={isLoading}
              className="w-full px-4 py-3 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-200 rounded-xl transition-colors duration-150 disabled:opacity-50"
            >
              Refresh Data
            </button>
        </div>
      </div>
    </div>
  );

  // Main content JSX
  const mainContent = (
    <div className={isModal ? "w-full p-6" : "min-h-screen bg-gradient-to-br from-gray-900 via-gray-900 to-slate-900 p-6"}>
      <div className={isModal ? "w-full" : "max-w-6xl mx-auto"}>
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-4">
            <button
              onClick={onBack}
              className="flex items-center space-x-2 px-4 py-2 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] text-white/80 hover:text-white rounded-xl transition-colors duration-150"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              <span>{isModal ? "Close" : "Back to Camera"}</span>
            </button>
            <h1 className="text-3xl font-light text-white">Settings</h1>
          </div>
        </div>

        {/* Floating Statistics Dashboard */}
        <div className={`${isModal ? "absolute top-0 right-0" : "fixed top-6 right-6"} bg-black/40 border border-white/[0.1] rounded-2xl p-4 min-w-[200px] z-10`}>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-white/60">Total People</span>
              <span className="font-mono">{systemData.totalPersons}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-white/60">Total Embeddings</span>
              <span className="font-mono">{systemData.totalEmbeddings}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-white/60">Backend Status</span>
              <span className="font-mono text-green-400">Connected</span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex space-x-1 mb-8 bg-white/[0.02] border border-white/[0.08] rounded-2xl p-2">
          {[
            { id: 'quick', label: 'Display', icon: 'M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
            { id: 'attendance', label: 'Attendance', icon: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z' },
            { id: 'overview', label: 'Overview', icon: 'M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605' },
            { id: 'people', label: 'People', icon: 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z' },
            { id: 'search', label: 'Search', icon: 'M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z' },
            { id: 'maintenance', label: 'Maintenance', icon: 'M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveView(tab.id as 'quick' | 'overview' | 'people' | 'search' | 'advanced' | 'maintenance' | 'attendance')}
              className={`flex items-center space-x-2 px-4 py-2 rounded-xl transition-colors duration-150 transform-gpu ${
                activeView === tab.id
                  ? 'bg-white/[0.1] text-white border border-white/[0.2]'
                  : 'text-white/60 hover:text-white/80 hover:bg-white/[0.05]'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
              </svg>
              <span className="text-sm font-light">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="relative">
          {isLoading && (
            <div className="absolute inset-0 bg-black/20 rounded-2xl flex items-center justify-center z-10">
              <div className="flex items-center space-x-3 text-white">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                <span>Loading...</span>
              </div>
            </div>
          )}

          {activeView === 'quick' && renderQuickSettings()}
          {activeView === 'attendance' && renderAttendanceSettings()}
          {activeView === 'overview' && renderOverview()}
          {activeView === 'people' && renderPeople()}
          {activeView === 'search' && renderSearch()}
          {activeView === 'maintenance' && renderMaintenance()}
        </div>

        {/* Delete Confirmation Dialog */}
        {showDeleteDialog && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-slate-800 border border-white/[0.1] rounded-2xl p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-medium text-white mb-4">Confirm Deletion</h3>
              <p className="text-white/70 mb-6">
                Are you sure you want to delete "{showDeleteDialog.person_id}"? This action cannot be undone.
              </p>
              <div className="flex space-x-3">
                <button
                onClick={() => setShowDeleteDialog(null)}
                className="flex-1 px-4 py-2 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] text-white rounded-xl transition-colors duration-150"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-200 rounded-xl transition-colors duration-150"
              >
                Delete
              </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // Return modal wrapper if isModal is true, otherwise return content directly
  if (isModal) {
    return (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6">
        <div className="custom-scroll rounded-tl-md rounded-bl-2xl  bg-black border border-white/[0.1] max-w-5xl w-full max-h-[60vh] overflow-y-auto relative">
          {mainContent}
        </div>
      </div>
    );
  }

  return mainContent;
};