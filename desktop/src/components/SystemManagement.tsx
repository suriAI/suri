import { useState, useEffect, useCallback } from 'react';

interface SystemOverview {
  total_people: number;
  legacy_faces: number;
  enhanced_templates: number;
  today_attendance: number;
  total_attendance: number;
  overall_success_rate: number;
}

interface AttendanceRecord {
  name: string;
  timestamp: string;
  confidence: number;
  date: string;
  time: string;
}

interface PersonDetails {
  name: string;
  num_templates: number;
  in_legacy: boolean;
  total_attempts?: number;
  total_successes?: number;
  overall_success_rate?: number;
}

interface SystemManagementProps {
  onBack: () => void;
}

export default function SystemManagement({ onBack }: SystemManagementProps) {
  const [activeView, setActiveView] = useState("overview");
  const [systemData, setSystemData] = useState<{
    overview: SystemOverview;
    today_attendance: AttendanceRecord[];
    people: PersonDetails[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{
    error?: string;
    person?: PersonDetails;
    templates?: Array<{
      template_id: number;
      cluster_size: number;
      avg_quality: number;
      usage_count: number;
      success_rate: number;
      created_date: string;
    }>;
    attendance?: {
      today: AttendanceRecord[];
      recent: AttendanceRecord[];
      total_records: number;
    };
  } | null>(null);
  const [advancedStats, setAdvancedStats] = useState<{
    database_stats: {
      total_people: number;
      legacy_faces: number;
      enhanced_templates: number;
      people_with_both: number;
    };
    recognition_performance: {
      top_performers: Array<{
        name: string;
        attempts: number;
        successes: number;
        success_rate: number;
      }>;
      bottom_performers: Array<{
        name: string;
        attempts: number;
        successes: number;
        success_rate: number;
      }>;
      average_success_rate: number;
    };
    template_quality: {
      high_quality: number;
      medium_quality: number;
      low_quality: number;
      total_templates: number;
    };
    attendance_analytics: {
      today: number;
      total: number;
      daily_trend: Array<{
        date: string;
        count: number;
      }>;
      unique_people_today: number;
      avg_daily_attendance: number;
    };
  } | null>(null);
  const [editingPerson, setEditingPerson] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState<{ person: string; type: 'normal' | 'complete' } | null>(null);

  const fetchSystemData = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch('http://127.0.0.1:8770/system/management');
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setSystemData(data.data);
        }
      }
    } catch (error) {
      console.error('Failed to fetch system data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchAdvancedStats = useCallback(async () => {
    try {
      const response = await fetch('http://127.0.0.1:8770/system/advanced-stats');
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setAdvancedStats(data.data);
        }
      }
    } catch (error) {
      console.error('Failed to fetch advanced stats:', error);
    }
  }, []);

  const searchPerson = async () => {
    if (!searchQuery.trim()) return;
    
    try {
      const response = await fetch(`http://127.0.0.1:8770/person/search/${encodeURIComponent(searchQuery.trim())}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setSearchResults(data.data);
        }
      } else if (response.status === 404) {
        setSearchResults({ error: 'Person not found' });
      }
    } catch (error) {
      console.error('Search failed:', error);
      setSearchResults({ error: 'Search failed' });
    }
  };

  const clearAttendance = async () => {
    if (!confirm('⚠️ This will permanently delete ALL attendance records. Are you sure?')) {
      return;
    }
    
    try {
      const response = await fetch('http://127.0.0.1:8770/system/clear-attendance', {
        method: 'POST'
      });
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          alert('✅ All attendance records cleared successfully!');
          fetchSystemData(); // Refresh data
        }
      }
    } catch (error) {
      console.error('Failed to clear attendance:', error);
      alert('❌ Failed to clear attendance records');
    }
  };

  const startEdit = (person: PersonDetails) => {
    setEditingPerson(person.name);
    setEditName(person.name);
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

    try {
      const formData = new FormData();
      formData.append('new_name', editName.trim());

      const response = await fetch(`http://127.0.0.1:8770/person/${encodeURIComponent(editingPerson)}/edit`, {
        method: 'PUT',
        body: formData
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          alert(`✅ Successfully renamed "${editingPerson}" to "${editName.trim()}"`);
          fetchSystemData(); // Refresh data
          cancelEdit();
        } else {
          alert(`❌ Failed to rename person: ${data.message}`);
        }
      } else {
        const errorData = await response.json();
        alert(`❌ Failed to rename person: ${errorData.detail}`);
      }
    } catch (error) {
      console.error('Failed to rename person:', error);
      alert('❌ Failed to rename person due to connection error');
    }
  };

  const deletePerson = async (person: string, deleteType: 'normal' | 'complete') => {
    const endpoint = deleteType === 'complete' 
      ? `http://127.0.0.1:8770/person/${encodeURIComponent(person)}/delete-all`
      : `http://127.0.0.1:8770/person/${encodeURIComponent(person)}/delete`;

    try {
      const formData = new FormData();
      formData.append('confirm', 'true');

      const response = await fetch(endpoint, {
        method: 'DELETE',
        body: formData
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          const message = deleteType === 'complete' 
            ? `✅ Completely deleted "${person}" and all related data`
            : `✅ Deleted "${person}" (attendance records preserved)`;
          alert(message);
          fetchSystemData(); // Refresh data
          setShowDeleteDialog(null);
        } else {
          alert(`❌ Failed to delete person: ${data.message}`);
        }
      } else {
        const errorData = await response.json();
        alert(`❌ Failed to delete person: ${errorData.detail}`);
      }
    } catch (error) {
      console.error('Failed to delete person:', error);
      alert('❌ Failed to delete person due to connection error');
    }
  };

  useEffect(() => {
    fetchSystemData();
  }, [fetchSystemData]);

  const renderOverview = () => {
    if (!systemData) return <div>Loading...</div>;

    return (
      <div className="space-y-6">
        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-2">👥 People Database</h3>
            <div className="space-y-2">
              <p className="text-3xl font-bold text-blue-400">{systemData.overview.total_people}</p>
              <p className="text-sm text-slate-400">Total People</p>
              <div className="text-xs text-slate-500">
                <p>Legacy: {systemData.overview.legacy_faces}</p>
                <p>Enhanced: {systemData.overview.enhanced_templates} templates</p>
              </div>
            </div>
          </div>

          <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-2">📊 Today's Activity</h3>
            <div className="space-y-2">
              <p className="text-3xl font-bold text-green-400">{systemData.overview.today_attendance}</p>
              <p className="text-sm text-slate-400">Attendance Records</p>
              <div className="text-xs text-slate-500">
                <p>Total: {systemData.overview.total_attendance}</p>
                <p>Success Rate: {systemData.overview.overall_success_rate.toFixed(1)}%</p>
              </div>
            </div>
          </div>

          <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-2">🎯 Performance</h3>
            <div className="space-y-2">
              <p className="text-3xl font-bold text-purple-400">{systemData.overview.overall_success_rate.toFixed(1)}%</p>
              <p className="text-sm text-slate-400">Recognition Rate</p>
            </div>
          </div>
        </div>

        {/* Today's Attendance */}
        <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">📋 Today's Attendance</h3>
          <div className="max-h-60 overflow-y-auto">
            {systemData.today_attendance.length === 0 ? (
              <p className="text-slate-400">No attendance records for today</p>
            ) : (
              <div className="space-y-2">
                {systemData.today_attendance.map((record, index) => (
                  <div key={index} className="flex justify-between items-center p-3 bg-slate-700/50 rounded-lg">
    <div>
                      <p className="text-white font-medium">{record.name}</p>
                      <p className="text-sm text-slate-400">{record.time}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-green-400">{(record.confidence * 100).toFixed(1)}%</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderPeopleList = () => {
    if (!systemData) return <div>Loading...</div>;

    return (
      <div className="space-y-4">
        <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">👥 Registered People ({systemData.people.length})</h3>
            <div className="text-sm text-slate-400">
              Click name to edit • Click buttons to manage
            </div>
          </div>
          
          <div className="space-y-3">
            {systemData.people.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <p className="text-lg mb-2">No people registered yet</p>
                <p className="text-sm">Add people using the Live Camera feature</p>
              </div>
            ) : (
              systemData.people.map((person, index) => (
                <div key={index} className="group p-4 bg-slate-700/50 hover:bg-slate-700/70 rounded-lg transition-all duration-200 border border-transparent hover:border-slate-600">
                  <div className="flex justify-between items-center">
                    <div className="flex-1">
                      {editingPerson === person.name ? (
                        <div className="flex items-center gap-3">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="px-3 py-1 bg-slate-600 border border-slate-500 rounded text-white text-lg font-medium focus:outline-none focus:border-blue-400"
                            onKeyPress={(e) => {
                              if (e.key === 'Enter') saveEdit();
                              if (e.key === 'Escape') cancelEdit();
                            }}
                            autoFocus
                          />
                          <button
                            onClick={saveEdit}
                            className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-sm transition-colors"
                          >
                            ✓ Save
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="px-3 py-1 bg-gray-600 hover:bg-gray-700 text-white rounded text-sm transition-colors"
                          >
                            ✕ Cancel
                          </button>
                        </div>
                      ) : (
                        <div>
                          <button
                            onClick={() => startEdit(person)}
                            className="text-white font-medium text-lg hover:text-blue-400 transition-colors text-left"
                          >
                            {person.name}
                          </button>
                          <div className="flex gap-6 text-sm text-slate-400 mt-1">
                            <span className="flex items-center gap-1">
                              <span className="w-2 h-2 bg-blue-400 rounded-full"></span>
                              Templates: {person.num_templates}
                            </span>
                            <span className="flex items-center gap-1">
                              <span className={`w-2 h-2 rounded-full ${person.in_legacy ? 'bg-green-400' : 'bg-gray-400'}`}></span>
                              Legacy: {person.in_legacy ? '✓' : '✗'}
                            </span>
                            {person.total_attempts && (
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-2 bg-purple-400 rounded-full"></span>
                                Success: {person.overall_success_rate?.toFixed(1)}%
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {editingPerson !== person.name && (
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        <button
                          onClick={() => startEdit(person)}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition-colors flex items-center gap-1"
                        >
                          ✏️ Edit
                        </button>
                        <button
                          onClick={() => setShowDeleteDialog({ person: person.name, type: 'normal' })}
                          className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded text-sm font-medium transition-colors flex items-center gap-1"
                        >
                          🗑️ Delete
                        </button>
                        <button
                          onClick={() => setShowDeleteDialog({ person: person.name, type: 'complete' })}
                          className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium transition-colors flex items-center gap-1"
                        >
                          💥 Delete All
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
    </div>
  );
  };

  const renderSearch = () => (
    <div className="space-y-6">
      <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">🔍 Search Person</h3>
        <div className="flex gap-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Enter person's name..."
            className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400"
            onKeyPress={(e) => e.key === 'Enter' && searchPerson()}
          />
          <button
            onClick={searchPerson}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            Search
          </button>
        </div>
      </div>

      {searchResults && (
        <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Search Results</h3>
                    {searchResults.error ? (
            <p className="text-red-400">{searchResults.error}</p>
          ) : searchResults.person ? (
            <div className="space-y-4">
              <div className="p-4 bg-slate-700/50 rounded-lg">
                <h4 className="text-white font-medium mb-2">{searchResults.person.name}</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-slate-400">Templates: <span className="text-white">{searchResults.person.num_templates}</span></p>
                    <p className="text-slate-400">Legacy DB: <span className="text-white">{searchResults.person.in_legacy ? '✓' : '✗'}</span></p>
                  </div>
                  <div>
                    {searchResults.person.total_attempts && (
                      <>
                        <p className="text-slate-400">Attempts: <span className="text-white">{searchResults.person.total_attempts}</span></p>
                        <p className="text-slate-400">Success Rate: <span className="text-white">{searchResults.person.overall_success_rate?.toFixed(1)}%</span></p>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {searchResults.attendance && searchResults.attendance.today.length > 0 && (
                <div className="p-4 bg-slate-700/50 rounded-lg">
                  <h5 className="text-white font-medium mb-2">Today's Attendance</h5>
                  <div className="space-y-2">
                    {searchResults.attendance.today.map((record, index) => (
                      <p key={index} className="text-sm text-slate-300">
                        {record.time} - Confidence: {(record.confidence * 100).toFixed(1)}%
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );

  const renderAdvancedStats = () => {
    if (!advancedStats) {
      fetchAdvancedStats();
      return <div>Loading advanced statistics...</div>;
    }

    return (
      <div className="space-y-6">
        {/* Performance Analytics */}
        <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">📊 Performance Analytics</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-white font-medium mb-3">Top Performers</h4>
              <div className="space-y-2">
                {advancedStats.recognition_performance.top_performers.slice(0, 5).map((person, index) => (
                  <div key={index} className="flex justify-between p-2 bg-slate-700/50 rounded">
                    <span className="text-white">{person.name}</span>
                    <span className="text-green-400">{person.success_rate.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
    <div>
              <h4 className="text-white font-medium mb-3">Template Quality</h4>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-400">High Quality:</span>
                  <span className="text-green-400">{advancedStats.template_quality.high_quality}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Medium Quality:</span>
                  <span className="text-yellow-400">{advancedStats.template_quality.medium_quality}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Low Quality:</span>
                  <span className="text-red-400">{advancedStats.template_quality.low_quality}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Daily Trend */}
        <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">📈 Daily Attendance Trend (Last 7 Days)</h3>
          <div className="space-y-2">
            {advancedStats.attendance_analytics.daily_trend.map((day, index) => (
              <div key={index} className="flex justify-between items-center p-2 bg-slate-700/50 rounded">
                <span className="text-white">{day.date}</span>
                <span className="text-blue-400">{day.count} records</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderMaintenance = () => (
    <div className="space-y-6">
      <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">🛠️ System Maintenance</h3>
        <div className="space-y-4">
          <button
            onClick={clearAttendance}
            className="w-full px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
          >
            🗑️ Clear All Attendance Records
          </button>
          
          <button
            onClick={fetchSystemData}
            className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            🔄 Refresh System Data
          </button>
        </div>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-white">Loading system data...</div>
    </div>
  );
  }

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-7xl mx-auto">
        {/* Glass Header */}
        <div className="flex items-center justify-between mb-12">
          <div className="flex items-center space-x-6">
            <button
              onClick={onBack}
              className="px-6 py-3 bg-white/[0.05] hover:bg-white/[0.08] backdrop-blur-xl border border-white/[0.10] text-white rounded-xl font-light transition-all duration-300"
            >
              ← Back
            </button>
            <h1 className="text-4xl font-extralight text-white tracking-tight">⚙️ System Management</h1>
          </div>
        </div>

        {/* Glass Navigation */}
        <div className="flex flex-wrap gap-3 mb-12">
          {[
            { id: 'overview', label: '📊 Overview', icon: '📊' },
            { id: 'people', label: '👥 People', icon: '👥' },
            { id: 'search', label: '🔍 Search', icon: '🔍' },
            { id: 'stats', label: '📈 Advanced Stats', icon: '📈' },
            { id: 'maintenance', label: '🛠️ Maintenance', icon: '🛠️' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveView(tab.id)}
              className={`px-6 py-3 rounded-xl font-light transition-all duration-300 ${
                activeView === tab.id
                  ? 'bg-white/[0.08] backdrop-blur-xl border border-white/[0.15] text-white'
                  : 'bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] text-white/70 hover:bg-white/[0.05] hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div>
          {activeView === 'overview' && renderOverview()}
          {activeView === 'people' && renderPeopleList()}
          {activeView === 'search' && renderSearch()}
          {activeView === 'stats' && renderAdvancedStats()}
          {activeView === 'maintenance' && renderMaintenance()}
        </div>

        {/* Glass Delete Confirmation Dialog */}
        {showDeleteDialog && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50">
            <div className="bg-white/[0.05] backdrop-blur-xl border border-white/[0.15] rounded-2xl p-8 w-full max-w-md mx-4">
              <div className="text-center">
                <div className="text-4xl mb-6">
                  {showDeleteDialog.type === 'complete' ? '💥' : '🗑️'}
                </div>
                <h3 className="text-xl font-light text-white mb-4">
                  {showDeleteDialog.type === 'complete' ? 'Complete Deletion' : 'Delete Person'}
                </h3>
                <p className="text-white/60 mb-6 font-light leading-relaxed">
                  {showDeleteDialog.type === 'complete' 
                    ? `This will permanently delete "${showDeleteDialog.person}" and ALL their attendance records. This action cannot be undone.`
                    : `This will delete "${showDeleteDialog.person}" from the recognition system but preserve their attendance records for historical data.`
                  }
                </p>
                
                <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-xl p-5 mb-8">
                  <h4 className="text-white/80 font-light mb-3">What will be deleted:</h4>
                  <ul className="text-sm text-white/60 space-y-2 font-light">
                    <li>✓ Face recognition templates</li>
                    <li>✓ Legacy database entries</li>
                    <li>✓ Recognition statistics</li>
                    <li>✓ Face image files</li>
                    {showDeleteDialog.type === 'complete' && (
                      <li className="text-white/80">✓ ALL attendance records</li>
                    )}
                    {showDeleteDialog.type === 'normal' && (
                      <li className="text-white/80">✗ Attendance records (preserved)</li>
                    )}
                  </ul>
                </div>

                <div className="flex gap-4">
                  <button
                    onClick={() => setShowDeleteDialog(null)}
                    className="flex-1 px-6 py-3 bg-white/[0.03] hover:bg-white/[0.06] backdrop-blur-xl border border-white/[0.08] text-white/80 hover:text-white rounded-xl transition-all duration-300 font-light"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => deletePerson(showDeleteDialog.person, showDeleteDialog.type)}
                    className="flex-1 px-6 py-3 bg-white/[0.08] hover:bg-white/[0.12] backdrop-blur-xl border border-white/[0.15] text-white rounded-xl font-light transition-all duration-300"
                  >
                    {showDeleteDialog.type === 'complete' ? 'Delete Everything' : 'Delete Person'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}