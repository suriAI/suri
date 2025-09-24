import { useState, useEffect, useCallback } from 'react';
import { attendanceManager } from '../services/AttendanceManager';
import type {
  AttendanceGroup,
  AttendanceMember,
  AttendanceStats,
  AttendanceReport,
  AttendanceRecord,
  AttendanceSession,
  GroupType
} from '../types/recognition.js';

interface AttendanceDashboardProps {
  onBack: () => void;
}

export function AttendanceDashboard({ onBack }: AttendanceDashboardProps) {
  const [selectedGroup, setSelectedGroup] = useState<AttendanceGroup | null>(null);
  const [groups, setGroups] = useState<AttendanceGroup[]>([]);
  const [members, setMembers] = useState<AttendanceMember[]>([]);
  const [stats, setStats] = useState<AttendanceStats | null>(null);
  const [report, setReport] = useState<AttendanceReport | null>(null);
  const [recentRecords, setRecentRecords] = useState<AttendanceRecord[]>([]);
  const [todaySessions, setTodaySessions] = useState<AttendanceSession[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [reportStartDate, setReportStartDate] = useState<string>(
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const [reportEndDate, setReportEndDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [activeTab, setActiveTab] = useState<'overview' | 'members' | 'reports' | 'settings'>('overview');

  const loadData = useCallback(async () => {
    try {
      const allGroups = attendanceManager.getGroups();
      setGroups(allGroups);

      if (selectedGroup) {
        const groupMembers = attendanceManager.getGroupMembers(selectedGroup.id);
        setMembers(groupMembers);

        const groupStats = attendanceManager.getGroupStats(selectedGroup.id, new Date(selectedDate));
        setStats(groupStats);

        // Load today's sessions
        const today = new Date(selectedDate).toISOString().split('T')[0];
        const sessions: AttendanceSession[] = [];
        groupMembers.forEach(member => {
          const sessionKey = `${member.person_id}_${today}`;
          const session = attendanceManager['sessions']?.get(sessionKey);
          if (session) {
            sessions.push(session);
          }
        });
        setTodaySessions(sessions);

        // Load recent records
        const allRecords = attendanceManager['records'] || [];
        const groupRecords = allRecords
          .filter(record => record.group_id === selectedGroup.id)
          .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
          .slice(0, 100);
        setRecentRecords(groupRecords);
      }
    } catch (error) {
      console.error('Error loading attendance data:', error);
    }
  }, [selectedGroup, selectedDate]);

  const generateReport = useCallback(async () => {
    if (!selectedGroup) return;

    try {
      const startDate = new Date(reportStartDate);
      const endDate = new Date(reportEndDate);
      const generatedReport = attendanceManager.generateReport(selectedGroup.id, startDate, endDate);
      setReport(generatedReport);
    } catch (error) {
      console.error('Error generating report:', error);
    }
  }, [selectedGroup, reportStartDate, reportEndDate]);

  const exportData = useCallback(() => {
    try {
      const data = attendanceManager.exportData();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attendance-data-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting data:', error);
    }
  }, []);

  const exportReport = useCallback(() => {
    if (!report || !selectedGroup) return;

    try {
      const csvContent = [
        ['Name', 'Total Days', 'Present Days', 'Absent Days', 'Late Days', 'Total Hours', 'Average Hours', 'Attendance Rate'],
        ...report.members.map(member => [
          member.name,
          member.total_days.toString(),
          member.present_days.toString(),
          member.absent_days.toString(),
          member.late_days.toString(),
          member.total_hours.toString(),
          member.average_hours.toString(),
          `${member.attendance_rate}%`
        ])
      ].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attendance-report-${selectedGroup.name}-${reportStartDate}-to-${reportEndDate}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting report:', error);
    }
  }, [report, selectedGroup, reportStartDate, reportEndDate]);

  const getGroupTypeIcon = (type: GroupType): string => {
    switch (type) {
      case 'employee': return '👔';
      case 'student': return '🎓';
      case 'visitor': return '👤';
      case 'general': return '👥';
      default: return '👥';
    }
  };

  const formatTime = (date: Date): string => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDuration = (hours: number): string => {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h}h ${m}m`;
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (selectedGroup && reportStartDate && reportEndDate) {
      generateReport();
    }
  }, [selectedGroup, reportStartDate, reportEndDate, generateReport]);

  return (
    <div className="h-screen bg-black text-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.08] flex items-center justify-between">
        <h1 className="text-xl font-light">Attendance Dashboard</h1>
        <div className="flex items-center space-x-3">
          <button
            onClick={exportData}
            className="px-4 py-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 rounded transition-colors"
          >
            Export Data
          </button>
          <button
            onClick={onBack}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded transition-colors"
          >
            ← Back
          </button>
        </div>
      </div>

      {/* Group Selection */}
      <div className="px-4 py-3 border-b border-white/[0.08]">
        <div className="flex items-center space-x-4">
          <div className="flex-1">
            <label className="block text-sm font-medium mb-2">Select Group:</label>
            <select
              value={selectedGroup?.id || ''}
              onChange={(e) => {
                const group = groups.find(g => g.id === e.target.value);
                setSelectedGroup(group || null);
              }}
              className="w-full max-w-md bg-white/[0.05] text-white border border-white/[0.1] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
            >
              <option value="">Select a group...</option>
              {groups.map(group => (
                <option key={group.id} value={group.id} className="bg-black text-white">
                  {getGroupTypeIcon(group.type)} {group.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Date:</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-white/[0.05] text-white border border-white/[0.1] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {selectedGroup ? (
        <>
          {/* Tabs */}
          <div className="px-4 py-2 border-b border-white/[0.08]">
            <div className="flex space-x-1">
              {[
                { id: 'overview', label: 'Overview' },
                { id: 'members', label: 'Members' },
                { id: 'reports', label: 'Reports' },
                { id: 'settings', label: 'Settings' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as typeof activeTab)}
                  className={`px-4 py-2 rounded transition-colors ${
                    activeTab === tab.id
                      ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30'
                      : 'text-white/60 hover:text-white hover:bg-white/[0.05]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            {activeTab === 'overview' && (
              <div className="h-full overflow-y-auto p-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Stats Cards */}
                  {stats && (
                    <div className="space-y-4">
                      <h3 className="text-lg font-medium">Today's Statistics</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white/[0.03] border border-white/[0.08] rounded-lg p-4">
                          <div className="text-2xl font-bold text-green-400">{stats.present_today}</div>
                          <div className="text-sm text-white/60">Present</div>
                        </div>
                        <div className="bg-white/[0.03] border border-white/[0.08] rounded-lg p-4">
                          <div className="text-2xl font-bold text-red-400">{stats.absent_today}</div>
                          <div className="text-sm text-white/60">Absent</div>
                        </div>
                        <div className="bg-white/[0.03] border border-white/[0.08] rounded-lg p-4">
                          <div className="text-2xl font-bold text-yellow-400">{stats.late_today}</div>
                          <div className="text-sm text-white/60">Late</div>
                        </div>
                        <div className="bg-white/[0.03] border border-white/[0.08] rounded-lg p-4">
                          <div className="text-2xl font-bold text-blue-400">{stats.on_break}</div>
                          <div className="text-sm text-white/60">On Break</div>
                        </div>
                      </div>
                      <div className="bg-white/[0.03] border border-white/[0.08] rounded-lg p-4">
                        <div className="text-lg font-medium mb-2">Hours Summary</div>
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span className="text-white/60">Total Hours Today:</span>
                            <span className="font-mono">{formatDuration(stats.total_hours_today)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-white/60">Average Hours:</span>
                            <span className="font-mono">{formatDuration(stats.average_hours_today)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Recent Activity */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium">Recent Activity</h3>
                    <div className="bg-white/[0.03] border border-white/[0.08] rounded-lg p-4 max-h-96 overflow-y-auto">
                      {recentRecords.length > 0 ? (
                        <div className="space-y-2">
                          {recentRecords.slice(0, 20).map(record => {
                            const member = members.find(m => m.person_id === record.person_id);
                            return (
                              <div key={record.id} className="flex justify-between items-center py-2 border-b border-white/[0.05] last:border-b-0">
                                <div>
                                  <div className="font-medium text-sm">{member?.name || record.person_id}</div>
                                  <div className="text-xs text-white/60">
                                    {record.timestamp.toLocaleDateString()} {formatTime(record.timestamp)}
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className={`px-2 py-1 rounded text-xs ${
                                    record.type === 'check_in' ? 'bg-green-600/20 text-green-300' :
                                    record.type === 'check_out' ? 'bg-red-600/20 text-red-300' :
                                    record.type === 'break_start' ? 'bg-blue-600/20 text-blue-300' :
                                    'bg-purple-600/20 text-purple-300'
                                  }`}>
                                    {record.type.replace('_', ' ').toUpperCase()}
                                  </div>
                                  <div className="text-xs text-white/40 mt-1">
                                    {(record.confidence * 100).toFixed(0)}%
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-center text-white/50 py-8">No recent activity</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'members' && (
              <div className="h-full overflow-y-auto p-4">
                <div className="space-y-4">
                  <h3 className="text-lg font-medium">Member Status - {new Date(selectedDate).toLocaleDateString()}</h3>
                  {members.length > 0 ? (
                    <div className="grid gap-4">
                      {members.map(member => {
                        const session = todaySessions.find(s => s.person_id === member.person_id);
                        return (
                          <div key={member.person_id} className="bg-white/[0.03] border border-white/[0.08] rounded-lg p-4">
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <div className="font-medium text-lg">{member.name}</div>
                                <div className="text-sm text-white/60 mb-2">
                                  {member.role && `${member.role} • `}
                                  {member.employee_id && `Emp: ${member.employee_id} • `}
                                  {member.student_id && `Student: ${member.student_id} • `}
                                  ID: {member.person_id}
                                </div>
                                
                                {session ? (
                                  <div className="space-y-2">
                                    <div className="flex items-center space-x-2">
                                      <span className={`px-3 py-1 rounded text-sm ${
                                        session.status === 'present' ? 'bg-green-600/20 text-green-300' :
                                        session.status === 'late' ? 'bg-yellow-600/20 text-yellow-300' :
                                        session.status === 'on_break' ? 'bg-blue-600/20 text-blue-300' :
                                        session.status === 'checked_out' ? 'bg-gray-600/20 text-gray-300' :
                                        'bg-red-600/20 text-red-300'
                                      }`}>
                                        {session.status === 'present' ? 'Present' :
                                         session.status === 'late' ? `Late (${session.late_minutes}m)` :
                                         session.status === 'on_break' ? 'On Break' :
                                         session.status === 'checked_out' ? 'Checked Out' :
                                         'Absent'}
                                      </span>
                                    </div>
                                    
                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                      {session.check_in && (
                                        <div>
                                          <span className="text-white/60">Check In:</span>
                                          <span className="ml-2 font-mono">{formatTime(session.check_in)}</span>
                                        </div>
                                      )}
                                      {session.check_out && (
                                        <div>
                                          <span className="text-white/60">Check Out:</span>
                                          <span className="ml-2 font-mono">{formatTime(session.check_out)}</span>
                                        </div>
                                      )}
                                      {session.break_start && (
                                        <div>
                                          <span className="text-white/60">Break Start:</span>
                                          <span className="ml-2 font-mono">{formatTime(session.break_start)}</span>
                                        </div>
                                      )}
                                      {session.break_end && (
                                        <div>
                                          <span className="text-white/60">Break End:</span>
                                          <span className="ml-2 font-mono">{formatTime(session.break_end)}</span>
                                        </div>
                                      )}
                                      {session.total_hours && (
                                        <div>
                                          <span className="text-white/60">Total Hours:</span>
                                          <span className="ml-2 font-mono">{formatDuration(session.total_hours)}</span>
                                        </div>
                                      )}
                                      {session.break_duration && (
                                        <div>
                                          <span className="text-white/60">Break Duration:</span>
                                          <span className="ml-2 font-mono">{Math.round(session.break_duration)}m</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="text-red-400 text-sm">No attendance record for this date</div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center text-white/50 py-8">No members in this group</div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'reports' && (
              <div className="h-full overflow-y-auto p-4">
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-medium mb-4">Generate Report</h3>
                    <div className="bg-white/[0.03] border border-white/[0.08] rounded-lg p-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                        <div>
                          <label className="block text-sm font-medium mb-2">Start Date:</label>
                          <input
                            type="date"
                            value={reportStartDate}
                            onChange={(e) => setReportStartDate(e.target.value)}
                            className="w-full bg-white/[0.05] text-white border border-white/[0.1] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2">End Date:</label>
                          <input
                            type="date"
                            value={reportEndDate}
                            onChange={(e) => setReportEndDate(e.target.value)}
                            className="w-full bg-white/[0.05] text-white border border-white/[0.1] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
                          />
                        </div>
                        <div className="flex items-end">
                          <button
                            onClick={exportReport}
                            disabled={!report}
                            className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded transition-colors"
                          >
                            Export CSV
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {report && (
                    <div>
                      <h3 className="text-lg font-medium mb-4">Report Summary</h3>
                      <div className="bg-white/[0.03] border border-white/[0.08] rounded-lg p-4 mb-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div>
                            <div className="text-2xl font-bold">{report.summary.total_working_days}</div>
                            <div className="text-sm text-white/60">Working Days</div>
                          </div>
                          <div>
                            <div className="text-2xl font-bold text-green-400">{report.summary.average_attendance_rate}%</div>
                            <div className="text-sm text-white/60">Avg Attendance</div>
                          </div>
                          <div>
                            <div className="text-2xl font-bold">{formatDuration(report.summary.total_hours_logged)}</div>
                            <div className="text-sm text-white/60">Total Hours</div>
                          </div>
                          <div>
                            <div className="text-sm">
                              <div className="text-green-400">Most Punctual: {report.summary.most_punctual}</div>
                              <div className="text-red-400">Most Absent: {report.summary.most_absent}</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white/[0.03] border border-white/[0.08] rounded-lg overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead className="bg-white/[0.05]">
                              <tr>
                                <th className="px-4 py-3 text-left text-sm font-medium">Name</th>
                                <th className="px-4 py-3 text-center text-sm font-medium">Present</th>
                                <th className="px-4 py-3 text-center text-sm font-medium">Absent</th>
                                <th className="px-4 py-3 text-center text-sm font-medium">Late</th>
                                <th className="px-4 py-3 text-center text-sm font-medium">Total Hours</th>
                                <th className="px-4 py-3 text-center text-sm font-medium">Avg Hours</th>
                                <th className="px-4 py-3 text-center text-sm font-medium">Attendance %</th>
                              </tr>
                            </thead>
                            <tbody>
                              {report.members.map((member, index) => (
                                <tr key={member.person_id} className={index % 2 === 0 ? 'bg-white/[0.02]' : ''}>
                                  <td className="px-4 py-3 text-sm font-medium">{member.name}</td>
                                  <td className="px-4 py-3 text-center text-sm text-green-400">{member.present_days}</td>
                                  <td className="px-4 py-3 text-center text-sm text-red-400">{member.absent_days}</td>
                                  <td className="px-4 py-3 text-center text-sm text-yellow-400">{member.late_days}</td>
                                  <td className="px-4 py-3 text-center text-sm font-mono">{formatDuration(member.total_hours)}</td>
                                  <td className="px-4 py-3 text-center text-sm font-mono">{formatDuration(member.average_hours)}</td>
                                  <td className="px-4 py-3 text-center text-sm">
                                    <span className={`px-2 py-1 rounded text-xs ${
                                      member.attendance_rate >= 90 ? 'bg-green-600/20 text-green-300' :
                                      member.attendance_rate >= 75 ? 'bg-yellow-600/20 text-yellow-300' :
                                      'bg-red-600/20 text-red-300'
                                    }`}>
                                      {member.attendance_rate}%
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="h-full overflow-y-auto p-4">
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-medium mb-4">Group Settings</h3>
                    <div className="bg-white/[0.03] border border-white/[0.08] rounded-lg p-4">
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium mb-2">Group Name:</label>
                          <input
                            type="text"
                            value={selectedGroup.name}
                            readOnly
                            className="w-full bg-white/[0.02] text-white border border-white/[0.1] rounded px-3 py-2 cursor-not-allowed"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2">Group Type:</label>
                          <input
                            type="text"
                            value={`${getGroupTypeIcon(selectedGroup.type)} ${selectedGroup.type}`}
                            readOnly
                            className="w-full bg-white/[0.02] text-white border border-white/[0.1] rounded px-3 py-2 cursor-not-allowed"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2">Created:</label>
                          <input
                            type="text"
                            value={selectedGroup.created_at.toLocaleDateString()}
                            readOnly
                            className="w-full bg-white/[0.02] text-white border border-white/[0.1] rounded px-3 py-2 cursor-not-allowed"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-lg font-medium mb-4">Data Management</h3>
                    <div className="bg-white/[0.03] border border-white/[0.08] rounded-lg p-4">
                      <div className="space-y-4">
                        <button
                          onClick={() => {
                            if (confirm('Are you sure you want to clean up old data? This will remove records older than 30 days.')) {
                              attendanceManager.cleanupOldData(30);
                              loadData();
                            }
                          }}
                          className="w-full px-4 py-2 bg-yellow-600 hover:bg-yellow-700 rounded transition-colors"
                        >
                          Clean Up Old Data (30+ days)
                        </button>
                        <button
                          onClick={exportData}
                          className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                        >
                          Export All Data
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-white/50">
            <div className="text-6xl mb-4">📊</div>
            <div className="text-xl mb-2">Select a Group</div>
            <div className="text-sm">Choose a group from the dropdown above to view attendance data</div>
          </div>
        </div>
      )}
    </div>
  );
}