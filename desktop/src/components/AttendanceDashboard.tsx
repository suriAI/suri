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
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Member management states
  const [showAddMemberModal, setShowAddMemberModal] = useState<boolean>(false);
  const [showEditMemberModal, setShowEditMemberModal] = useState<boolean>(false);
  const [editingMember, setEditingMember] = useState<AttendanceMember | null>(null);
  const [newMemberName, setNewMemberName] = useState<string>('');
  const [newMemberRole, setNewMemberRole] = useState<string>('');
  const [newMemberEmployeeId, setNewMemberEmployeeId] = useState<string>('');
  const [newMemberStudentId, setNewMemberStudentId] = useState<string>('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const allGroups = await attendanceManager.getGroups();
      setGroups(allGroups);

      // Validate that selectedGroup still exists in the available groups
      if (selectedGroup) {
        const groupStillExists = allGroups.some(group => group.id === selectedGroup.id);
        if (!groupStillExists) {
          // Clear selectedGroup if it no longer exists (e.g., was deleted)
          setSelectedGroup(null);
          setMembers([]);
          setStats(null);
          setTodaySessions([]);
          setRecentRecords([]);
          return;
        }

        const [groupMembers, groupStats, sessions, records] = await Promise.all([
          attendanceManager.getGroupMembers(selectedGroup.id),
          attendanceManager.getGroupStats(selectedGroup.id, new Date(selectedDate)),
          attendanceManager.getSessions({
            group_id: selectedGroup.id,
            start_date: selectedDate,
            end_date: selectedDate
          }),
          attendanceManager.getRecords({
            group_id: selectedGroup.id,
            limit: 100
          })
        ]);

        setMembers(groupMembers);
        setStats(groupStats);
        setTodaySessions(sessions);
        setRecentRecords(records);
      }
    } catch (error) {
      console.error('Error loading attendance data:', error);
      setError(error instanceof Error ? error.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [selectedGroup, selectedDate]);

  const generateReport = useCallback(async () => {
    if (!selectedGroup) return;

    setLoading(true);
    try {
      const startDate = new Date(reportStartDate);
      const endDate = new Date(reportEndDate);
      const generatedReport = await attendanceManager.generateReport(selectedGroup.id, startDate, endDate);
      setReport(generatedReport);
    } catch (error) {
      console.error('Error generating report:', error);
      setError(error instanceof Error ? error.message : 'Failed to generate report');
    } finally {
      setLoading(false);
    }
  }, [selectedGroup, reportStartDate, reportEndDate]);

  const exportData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await attendanceManager.exportData();
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
      setError(error instanceof Error ? error.message : 'Failed to export data');
    } finally {
      setLoading(false);
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

  // Member management functions
  const resetMemberForm = () => {
    setNewMemberName('');
    setNewMemberRole('');
    setNewMemberEmployeeId('');
    setNewMemberStudentId('');
  };

  const handleAddMember = async () => {
    if (!selectedGroup || !newMemberName.trim()) return;

    try {
      setLoading(true);
      await attendanceManager.addMember(selectedGroup.id, newMemberName.trim(), {
        role: newMemberRole.trim() || undefined,
        employee_id: newMemberEmployeeId.trim() || undefined,
        student_id: newMemberStudentId.trim() || undefined
      });
      resetMemberForm();
      setShowAddMemberModal(false);
      await loadData(); // Refresh data
    } catch (error) {
      console.error('Error adding member:', error);
      setError(error instanceof Error ? error.message : 'Failed to add member');
    } finally {
      setLoading(false);
    }
  };

  const handleEditMember = async () => {
    if (!editingMember || !newMemberName.trim()) return;

    try {
      setLoading(true);
      const updates: Partial<AttendanceMember> = {
        name: newMemberName.trim(),
        role: newMemberRole.trim() || undefined,
        employee_id: newMemberEmployeeId.trim() || undefined,
        student_id: newMemberStudentId.trim() || undefined
      };

      await attendanceManager.updateMember(editingMember.person_id, updates);
      resetMemberForm();
      setEditingMember(null);
      setShowEditMemberModal(false);
      await loadData(); // Refresh data
    } catch (error) {
      console.error('Error updating member:', error);
      setError(error instanceof Error ? error.message : 'Failed to update member');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveMember = async (personId: string) => {
    if (!selectedGroup) return;

    try {
      setLoading(true);
      await attendanceManager.removeMember(personId);
      await loadData(); // Refresh data
    } catch (error) {
      console.error('Error removing member:', error);
      setError(error instanceof Error ? error.message : 'Failed to remove member');
    } finally {
      setLoading(false);
    }
  };

  const openEditMember = (member: AttendanceMember) => {
    setEditingMember(member);
    setNewMemberName(member.name);
    setNewMemberRole(member.role || '');
    setNewMemberEmployeeId(member.employee_id || '');
    setNewMemberStudentId(member.student_id || '');
    setShowEditMemberModal(true);
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
    <div className="pt-8 h-screen bg-black text-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.08] flex items-center justify-between">
        <h1 className="text-xl font-light">Attendance Dashboard</h1>
        <div className="flex items-center space-x-3">
          {loading && (
            <div className="flex items-center space-x-2 text-blue-300">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-300"></div>
              <span className="text-sm">Loading...</span>
            </div>
          )}
          <button
            onClick={exportData}
            className="px-4 py-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 rounded transition-colors disabled:opacity-50"
            disabled={loading}
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

      {/* Error Display */}
      {error && (
        <div className="px-4 py-3 bg-red-600/20 border-b border-red-500/30 text-red-300">
          <div className="flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-red-300 hover:text-red-100"
            >
              ✕
            </button>
          </div>
        </div>
      )}

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
                  <div className="flex justify-between items-center">
                    <h3 className="text-lg font-medium">Member Status - {new Date(selectedDate).toLocaleDateString()}</h3>
                    <button
                      onClick={() => setShowAddMemberModal(true)}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                    >
                      Add Member
                    </button>
                  </div>
                  {members.length > 0 ? (
                    <div className="grid gap-4">
                      {members.map(member => {
                        const session = todaySessions.find(s => s.person_id === member.person_id);
                        return (
                          <div key={member.person_id} className="bg-white/[0.03] border border-white/[0.08] rounded-lg p-4">
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <div className="flex justify-between items-start mb-2">
                                  <div>
                                    <div className="font-medium text-lg">{member.name}</div>
                                    <div className="text-sm text-white/60">
                                      {member.role && `${member.role} • `}
                                      {member.employee_id && `Emp: ${member.employee_id} • `}
                                      {member.student_id && `Student: ${member.student_id} • `}
                                      ID: {member.person_id}
                                    </div>
                                  </div>
                                  <div className="flex space-x-2">
                                    <button
                                      onClick={() => openEditMember(member)}
                                      className="px-3 py-1 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 rounded text-sm transition-colors"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={() => {
                                        if (confirm(`Are you sure you want to remove ${member.name} from this group?`)) {
                                          handleRemoveMember(member.person_id);
                                        }
                                      }}
                                      className="px-3 py-1 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-300 rounded text-sm transition-colors"
                                    >
                                      Remove
                                    </button>
                                  </div>
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
                          onClick={async () => {
                            if (confirm('Are you sure you want to clean up old data? This will remove records older than 30 days.')) {
                              setLoading(true);
                              try {
                                await attendanceManager.cleanupOldData(30);
                                await loadData();
                              } catch (error) {
                                console.error('Error cleaning up data:', error);
                                setError(error instanceof Error ? error.message : 'Failed to cleanup data');
                              } finally {
                                setLoading(false);
                              }
                            }
                          }}
                          className="w-full px-4 py-2 bg-yellow-600 hover:bg-yellow-700 rounded transition-colors disabled:opacity-50"
                          disabled={loading}
                        >
                          {loading ? 'Cleaning...' : 'Clean Up Old Data (30+ days)'}
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

      {/* Add Member Modal */}
      {showAddMemberModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-white/[0.08] rounded-lg p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-medium mb-4">Add New Member</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Full Name *</label>
                <input
                  type="text"
                  value={newMemberName}
                  onChange={(e) => setNewMemberName(e.target.value)}
                  className="w-full bg-white/[0.05] text-white border border-white/[0.1] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
                  placeholder="Enter full name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Role</label>
                <input
                  type="text"
                  value={newMemberRole}
                  onChange={(e) => setNewMemberRole(e.target.value)}
                  className="w-full bg-white/[0.05] text-white border border-white/[0.1] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
                  placeholder="e.g., Student, Teacher, Staff"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Employee ID</label>
                <input
                  type="text"
                  value={newMemberEmployeeId}
                  onChange={(e) => setNewMemberEmployeeId(e.target.value)}
                  className="w-full bg-white/[0.05] text-white border border-white/[0.1] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
                  placeholder="Optional employee ID"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Student ID</label>
                <input
                  type="text"
                  value={newMemberStudentId}
                  onChange={(e) => setNewMemberStudentId(e.target.value)}
                  className="w-full bg-white/[0.05] text-white border border-white/[0.1] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
                  placeholder="Optional student ID"
                />
              </div>
            </div>
            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => {
                  resetMemberForm();
                  setShowAddMemberModal(false);
                }}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddMember}
                disabled={!newMemberName.trim() || loading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:opacity-50"
              >
                {loading ? 'Adding...' : 'Add Member'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Member Modal */}
      {showEditMemberModal && editingMember && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-white/[0.08] rounded-lg p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-medium mb-4">Edit Member</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Full Name *</label>
                <input
                  type="text"
                  value={newMemberName}
                  onChange={(e) => setNewMemberName(e.target.value)}
                  className="w-full bg-white/[0.05] text-white border border-white/[0.1] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
                  placeholder="Enter full name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Role</label>
                <input
                  type="text"
                  value={newMemberRole}
                  onChange={(e) => setNewMemberRole(e.target.value)}
                  className="w-full bg-white/[0.05] text-white border border-white/[0.1] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
                  placeholder="e.g., Student, Teacher, Staff"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Employee ID</label>
                <input
                  type="text"
                  value={newMemberEmployeeId}
                  onChange={(e) => setNewMemberEmployeeId(e.target.value)}
                  className="w-full bg-white/[0.05] text-white border border-white/[0.1] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
                  placeholder="Optional employee ID"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Student ID</label>
                <input
                  type="text"
                  value={newMemberStudentId}
                  onChange={(e) => setNewMemberStudentId(e.target.value)}
                  className="w-full bg-white/[0.05] text-white border border-white/[0.1] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
                  placeholder="Optional student ID"
                />
              </div>
            </div>
            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => {
                  resetMemberForm();
                  setEditingMember(null);
                  setShowEditMemberModal(false);
                }}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleEditMember}
                disabled={!newMemberName.trim() || loading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:opacity-50"
              >
                {loading ? 'Updating...' : 'Update Member'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}