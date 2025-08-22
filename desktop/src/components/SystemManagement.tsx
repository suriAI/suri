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
          <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6">
            <div className="flex items-center space-x-3 mb-4">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-white/[0.05] border border-white/[0.1]">
                <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
              </div>
              <h3 className="text-lg font-light text-white">People Database</h3>
            </div>
            <div className="space-y-2">
              <p className="text-3xl font-extralight text-white">{systemData.overview.total_people}</p>
              <p className="text-sm text-white/60 font-light">Total People</p>
              <div className="text-xs text-white/50 font-light">
                <p>Legacy: {systemData.overview.legacy_faces}</p>
                <p>Enhanced: {systemData.overview.enhanced_templates} templates</p>
              </div>
            </div>
          </div>

          <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6">
            <div className="flex items-center space-x-3 mb-4">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-white/[0.05] border border-white/[0.1]">
                <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
              </div>
              <h3 className="text-lg font-light text-white">Today's Activity</h3>
            </div>
            <div className="space-y-2">
              <p className="text-3xl font-extralight text-white">{systemData.overview.today_attendance}</p>
              <p className="text-sm text-white/60 font-light">Attendance Records</p>
              <div className="text-xs text-white/50 font-light">
                <p>Total: {systemData.overview.total_attendance}</p>
                <p>Success Rate: {systemData.overview.overall_success_rate.toFixed(1)}%</p>
              </div>
            </div>
          </div>

          <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6">
            <div className="flex items-center space-x-3 mb-4">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-white/[0.05] border border-white/[0.1]">
                <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423L16.5 15.75l.394 1.183a2.25 2.25 0 001.423 1.423L19.5 18.75l-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
                </svg>
              </div>
              <h3 className="text-lg font-light text-white">Performance</h3>
            </div>
            <div className="space-y-2">
              <p className="text-3xl font-extralight text-white">{systemData.overview.overall_success_rate.toFixed(1)}%</p>
              <p className="text-sm text-white/60 font-light">Recognition Rate</p>
            </div>
          </div>
        </div>

        {/* Today's Attendance */}
        <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6">
          <div className="flex items-center space-x-3 mb-4">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-white/[0.05] border border-white/[0.1]">
              <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V19.5a2.25 2.25 0 002.25 2.25h.75m0-3H21" />
              </svg>
            </div>
            <h3 className="text-lg font-light text-white">Today's Attendance</h3>
          </div>
          <div className="max-h-60 overflow-y-auto">
            {systemData.today_attendance.length === 0 ? (
              <p className="text-white/60 font-light">No attendance records for today</p>
            ) : (
              <div className="space-y-2">
                {systemData.today_attendance.map((record, index) => (
                  <div key={index} className="flex justify-between items-center p-3 bg-white/[0.02] border border-white/[0.05] rounded-xl">
                    <div>
                      <p className="text-white font-light">{record.name}</p>
                      <p className="text-sm text-white/60 font-light">{record.time}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-white/80 font-light">{(record.confidence * 100).toFixed(1)}%</p>
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
        <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-white/[0.05] border border-white/[0.1]">
                <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-light text-white">Registered People ({systemData.people.length})</h3>
            </div>
            <div className="text-sm text-white/60 font-light">
              Click name to edit • Click buttons to manage
            </div>
          </div>
          
          <div className="space-y-3">
            {systemData.people.length === 0 ? (
              <div className="text-center py-8 text-white/60">
                <div className="flex items-center justify-center w-16 h-16 rounded-full bg-white/[0.02] border border-white/[0.05] mb-4 mx-auto">
                  <svg className="w-8 h-8 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                </div>
                <p className="text-lg mb-2 font-light">No people registered yet</p>
                <p className="text-sm font-light">Add people using the Live Camera feature</p>
              </div>
            ) : (
              systemData.people.map((person, index) => (
                <div key={index} className="group p-4 bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.05] hover:border-white/[0.08] rounded-xl transition-all duration-300">
                  <div className="flex justify-between items-center">
                    <div className="flex-1">
                      {editingPerson === person.name ? (
                        <div className="flex items-center gap-3">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="px-3 py-1 bg-white/[0.03] border border-white/[0.08] rounded-lg text-white text-lg font-light focus:outline-none focus:border-white/[0.20] focus:bg-white/[0.05] transition-all duration-300"
                            onKeyPress={(e) => {
                              if (e.key === 'Enter') saveEdit();
                              if (e.key === 'Escape') cancelEdit();
                            }}
                            autoFocus
                          />
                          <button
                            onClick={saveEdit}
                            className="px-3 py-1 bg-white/[0.08] hover:bg-white/[0.12] border border-white/[0.15] text-white rounded-lg text-sm font-light transition-all duration-300"
                          >
                            Save
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="px-3 py-1 bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.08] text-white/80 hover:text-white rounded-lg text-sm font-light transition-all duration-300"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div>
                          <button
                            onClick={() => startEdit(person)}
                            className="text-white font-light text-lg hover:text-white/80 transition-colors text-left"
                          >
                            {person.name}
                          </button>
                          <div className="flex gap-6 text-sm text-white/60 mt-1 font-light">
                            <span className="flex items-center gap-1">
                              <span className="w-2 h-2 bg-white/60 rounded-full"></span>
                              Templates: {person.num_templates}
                            </span>
                            <span className="flex items-center gap-1">
                              <span className={`w-2 h-2 rounded-full ${person.in_legacy ? 'bg-white/80' : 'bg-white/30'}`}></span>
                              Legacy: {person.in_legacy ? 'Yes' : 'No'}
                            </span>
                            {person.total_attempts && (
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-2 bg-white/60 rounded-full"></span>
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
                          className="px-3 py-1.5 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] text-white/80 hover:text-white rounded-lg text-sm font-light transition-all duration-300"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setShowDeleteDialog({ person: person.name, type: 'normal' })}
                          className="px-3 py-1.5 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] text-white/80 hover:text-white rounded-lg text-sm font-light transition-all duration-300"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setShowDeleteDialog({ person: person.name, type: 'complete' })}
                          className="px-3 py-1.5 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] text-white/80 hover:text-white rounded-lg text-sm font-light transition-all duration-300"
                        >
                          Delete All
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
      <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6">
        <div className="flex items-center space-x-3 mb-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-white/[0.05] border border-white/[0.1]">
            <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </div>
          <h3 className="text-lg font-light text-white">Search Person</h3>
        </div>
        <div className="flex gap-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Enter person's name..."
            className="flex-1 px-4 py-2 bg-white/[0.03] border border-white/[0.08] rounded-xl text-white placeholder-white/40 font-light focus:outline-none focus:border-white/[0.20] focus:bg-white/[0.05] transition-all duration-300"
            onKeyPress={(e) => e.key === 'Enter' && searchPerson()}
          />
          <button
            onClick={searchPerson}
            className="px-6 py-2 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] text-white/80 hover:text-white rounded-xl font-light transition-all duration-300"
          >
            Search
          </button>
        </div>
      </div>

      {searchResults && (
        <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6">
          <h3 className="text-lg font-light text-white mb-4">Search Results</h3>
                    {searchResults.error ? (
            <p className="text-white/60 font-light">{searchResults.error}</p>
          ) : searchResults.person ? (
            <div className="space-y-4">
              <div className="p-4 bg-white/[0.02] border border-white/[0.05] rounded-xl">
                <h4 className="text-white font-light mb-2">{searchResults.person.name}</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-white/60 font-light">Templates: <span className="text-white font-light">{searchResults.person.num_templates}</span></p>
                    <p className="text-white/60 font-light">Legacy DB: <span className="text-white font-light">{searchResults.person.in_legacy ? 'Yes' : 'No'}</span></p>
                  </div>
                  <div>
                    {searchResults.person.total_attempts && (
                      <>
                        <p className="text-white/60 font-light">Attempts: <span className="text-white font-light">{searchResults.person.total_attempts}</span></p>
                        <p className="text-white/60 font-light">Success Rate: <span className="text-white font-light">{searchResults.person.overall_success_rate?.toFixed(1)}%</span></p>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {searchResults.attendance && searchResults.attendance.today.length > 0 && (
                <div className="p-4 bg-white/[0.02] border border-white/[0.05] rounded-xl">
                  <h5 className="text-white font-light mb-2">Today's Attendance</h5>
                  <div className="space-y-2">
                    {searchResults.attendance.today.map((record, index) => (
                      <p key={index} className="text-sm text-white/60 font-light">
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
        <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6">
          <div className="flex items-center space-x-3 mb-4">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-white/[0.05] border border-white/[0.1]">
              <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
            </div>
            <h3 className="text-lg font-light text-white">Performance Analytics</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-white font-light mb-3">Top Performers</h4>
              <div className="space-y-2">
                {advancedStats.recognition_performance.top_performers.slice(0, 5).map((person, index) => (
                  <div key={index} className="flex justify-between p-2 bg-white/[0.02] border border-white/[0.05] rounded-xl">
                    <span className="text-white font-light">{person.name}</span>
                    <span className="text-white/80 font-light">{person.success_rate.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
    <div>
              <h4 className="text-white font-light mb-3">Template Quality</h4>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-white/60 font-light">High Quality:</span>
                  <span className="text-white/80 font-light">{advancedStats.template_quality.high_quality}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60 font-light">Medium Quality:</span>
                  <span className="text-white/80 font-light">{advancedStats.template_quality.medium_quality}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60 font-light">Low Quality:</span>
                  <span className="text-white/80 font-light">{advancedStats.template_quality.low_quality}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Daily Trend */}
        <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6">
          <div className="flex items-center space-x-3 mb-4">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-white/[0.05] border border-white/[0.1]">
              <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a1.125 1.125 0 010 1.594L9 18.75l-6.75-6.75z" />
              </svg>
            </div>
            <h3 className="text-lg font-light text-white">Daily Attendance Trend (Last 7 Days)</h3>
          </div>
          <div className="space-y-2">
            {advancedStats.attendance_analytics.daily_trend.map((day, index) => (
              <div key={index} className="flex justify-between items-center p-2 bg-white/[0.02] border border-white/[0.05] rounded-xl">
                <span className="text-white font-light">{day.date}</span>
                <span className="text-white/80 font-light">{day.count} records</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderMaintenance = () => (
    <div className="space-y-6">
      <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6">
        <div className="flex items-center space-x-3 mb-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-white/[0.05] border border-white/[0.1]">
            <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
            </svg>
          </div>
          <h3 className="text-lg font-light text-white">System Maintenance</h3>
        </div>
        <div className="space-y-4">
          <button
            onClick={clearAttendance}
            className="w-full px-6 py-3 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] text-white/80 hover:text-white rounded-xl font-light transition-all duration-300"
          >
            Clear All Attendance Records
          </button>
          
          <button
            onClick={fetchSystemData}
            className="w-full px-6 py-3 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] text-white/80 hover:text-white rounded-xl font-light transition-all duration-300"
          >
            Refresh System Data
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
        <div className="mb-12">
          <div className="flex items-center space-x-6 mb-4">
            <button
              onClick={onBack}
              className="px-6 py-3 bg-white/[0.05] hover:bg-white/[0.08] backdrop-blur-xl border border-white/[0.10] text-white rounded-xl font-light transition-all duration-300"
            >
              ← Back
            </button>
          </div>
          <h1 className="text-4xl font-extralight text-white tracking-tight">System Management</h1>
          <p className="text-sm text-white/50 mt-3 font-light">Manage people, settings, and system analytics</p>
        </div>

        {/* Glass Navigation */}
        <div className="flex flex-wrap gap-3 mb-12">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'people', label: 'People' },
            { id: 'search', label: 'Search' },
            { id: 'stats', label: 'Advanced Stats' },
            { id: 'maintenance', label: 'Maintenance' }
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