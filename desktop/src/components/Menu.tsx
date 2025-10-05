import { useState, useEffect, useCallback, useRef } from 'react';
import { attendanceManager } from '../services/AttendanceManager';
import { FaceRegistrationLab } from './FaceRegistrationLab';
import { BulkFaceRegistration } from './BulkFaceRegistration';
import { AssistedCameraRegistration } from './AssistedCameraRegistration';
import type {
  AttendanceGroup,
  AttendanceMember,
  AttendanceStats,
  AttendanceReport,
  AttendanceRecord,
  AttendanceSession,
  GroupType
} from '../types/recognition.js';

export type MenuSection = 'overview' | 'members' | 'reports' | 'registration' | 'settings';

interface MenuProps {
  onBack: () => void;
  initialSection?: MenuSection;
}

interface SectionConfig {
  id: MenuSection;
  label: string;
}

const SECTION_CONFIG: SectionConfig[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'members', label: 'Members' },
  { id: 'reports', label: 'Reports' },
  { id: 'registration', label: 'Face registration' },
  { id: 'settings', label: 'Settings' }
];

const getGroupTypeIcon = (type: GroupType): string => {
  switch (type) {
    case 'employee':
      return '👔';
    case 'student':
      return '🎓';
    case 'visitor':
      return '👤';
    case 'general':
    default:
      return '👥';
  }
};

const toDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

const formatTime = (value: Date | string): string => {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export function Menu({ onBack, initialSection }: MenuProps) {
  const [selectedGroup, setSelectedGroup] = useState<AttendanceGroup | null>(null);
  const [groups, setGroups] = useState<AttendanceGroup[]>([]);
  const [members, setMembers] = useState<AttendanceMember[]>([]);
  const [stats, setStats] = useState<AttendanceStats | null>(null);
  const [report, setReport] = useState<AttendanceReport | null>(null);
  const [recentRecords, setRecentRecords] = useState<AttendanceRecord[]>([]);
  const [todaySessions, setTodaySessions] = useState<AttendanceSession[]>([]);
  const [reportStartDate, setReportStartDate] = useState<string>(
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const [reportEndDate, setReportEndDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [activeSection, setActiveSection] = useState<MenuSection>(initialSection ?? 'overview');
  const [error, setError] = useState<string | null>(null);
  const [pendingTasks, setPendingTasks] = useState(0);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [showEditMemberModal, setShowEditMemberModal] = useState(false);
  const [editingMember, setEditingMember] = useState<AttendanceMember | null>(null);
  const [bulkMembersText, setBulkMembersText] = useState('');
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [isProcessingBulk, setIsProcessingBulk] = useState(false);
  const [bulkResults, setBulkResults] = useState<{ success: number; failed: number; errors: string[] } | null>(null);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('');
  const [showBulkRegistration, setShowBulkRegistration] = useState(false);
  const [showCameraQueue, setShowCameraQueue] = useState(false);

  const loading = pendingTasks > 0;
  const selectedGroupRef = useRef<AttendanceGroup | null>(null);
  const fetchGroupDetailsRef = useRef<((groupId: string) => Promise<void>) | null>(null);

  const trackAsync = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    setPendingTasks(prev => prev + 1);
    try {
      return await action();
    } finally {
      setPendingTasks(prev => (prev > 0 ? prev - 1 : 0));
    }
  }, []);

  const fetchGroupDetails = useCallback(async (groupId: string) => {
    await trackAsync(async () => {
      try {
        setError(null);
        const todayStr = new Date().toISOString().split('T')[0];
        const [groupMembers, groupStats, sessions, records] = await Promise.all([
          attendanceManager.getGroupMembers(groupId),
          attendanceManager.getGroupStats(groupId, new Date()),
          attendanceManager.getSessions({
            group_id: groupId,
            start_date: todayStr,
            end_date: todayStr
          }),
          attendanceManager.getRecords({
            group_id: groupId,
            limit: 100
          })
        ]);

        setMembers(groupMembers);
        setStats(groupStats);
        setTodaySessions(sessions);
        setRecentRecords(records);
      } catch (err) {
        console.error('Error loading group data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load group data');
      }
    });
  }, [trackAsync]);

  fetchGroupDetailsRef.current = fetchGroupDetails;

  const fetchGroups = useCallback(async (): Promise<AttendanceGroup | null> => {
    return trackAsync(async () => {
      try {
        setError(null);
        const allGroups = await attendanceManager.getGroups();
        setGroups(allGroups);

        if (allGroups.length === 0) {
          setSelectedGroup(null);
          setMembers([]);
          setStats(null);
          setTodaySessions([]);
          setRecentRecords([]);
          setReport(null);
          return null;
        }

        const existingSelection = selectedGroupRef.current;
        const resolved = existingSelection
          ? allGroups.find(group => group.id === existingSelection.id) ?? allGroups[0]
          : allGroups[0];

        setSelectedGroup(resolved);
        return resolved;
      } catch (err) {
        console.error('Error loading groups:', err);
        setError(err instanceof Error ? err.message : 'Failed to load groups');
        return null;
      }
    });
  }, [trackAsync]);

  const generateReport = useCallback(async () => {
    if (!selectedGroup) {
      setReport(null);
      return;
    }

    const startDate = new Date(reportStartDate);
    const endDate = new Date(reportEndDate);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      setError('Please select valid report dates.');
      return;
    }

    if (startDate > endDate) {
      setError('The start date must be before the end date.');
      return;
    }

    await trackAsync(async () => {
      try {
        setError(null);
        const generatedReport = await attendanceManager.generateReport(selectedGroup.id, startDate, endDate);
        setReport(generatedReport);
      } catch (err) {
        console.error('Error generating report:', err);
        setError(err instanceof Error ? err.message : 'Failed to generate report');
      }
    });
  }, [reportEndDate, reportStartDate, selectedGroup, trackAsync]);

  const exportData = useCallback(async () => {
    await trackAsync(async () => {
      try {
        setError(null);
        const data = await attendanceManager.exportData();
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `attendance-data-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('Error exporting data:', err);
        setError(err instanceof Error ? err.message : 'Failed to export data');
      }
    });
  }, [trackAsync]);

  const exportReport = useCallback(() => {
    if (!report || !selectedGroup) {
      return;
    }

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
      ]
        .map(row => row.map(cell => `"${cell}"`).join(','))
        .join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `attendance-report-${selectedGroup.name}-${reportStartDate}-to-${reportEndDate}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exporting report:', err);
      setError(err instanceof Error ? err.message : 'Failed to export report');
    }
  }, [report, selectedGroup, reportStartDate, reportEndDate]);

  const resetMemberForm = () => {
    setNewMemberName('');
    setNewMemberRole('');
    setBulkMembersText('');
    setBulkResults(null);
    setIsBulkMode(false);
  };

  const handleAddMember = async () => {
    if (!selectedGroup || !newMemberName.trim()) {
      return;
    }

    await trackAsync(async () => {
      try {
        await attendanceManager.addMember(selectedGroup.id, newMemberName.trim(), {
          role: newMemberRole.trim() || undefined
        });
        resetMemberForm();
        setShowAddMemberModal(false);
        await fetchGroupDetails(selectedGroup.id);
      } catch (err) {
        console.error('Error adding member:', err);
        setError(err instanceof Error ? err.message : 'Failed to add member');
      }
    });
  };

  const handleBulkAddMembers = async () => {
    if (!selectedGroup || !bulkMembersText.trim()) {
      return;
    }

    setIsProcessingBulk(true);
    setBulkResults(null);

    await trackAsync(async () => {
      try {
        const lines = bulkMembersText.split('\n').filter(line => line.trim());
        let success = 0;
        let failed = 0;
        const errors: string[] = [];

        for (const line of lines) {
          const parts = line.split(',').map(p => p.trim());
          const name = parts[0];
          const role = parts[1] || '';

          if (!name) {
            failed++;
            errors.push(`Empty name in line: "${line}"`);
            continue;
          }

          try {
            await attendanceManager.addMember(selectedGroup.id, name, {
              role: role || undefined
            });
            success++;
          } catch (err) {
            failed++;
            errors.push(`Failed to add "${name}": ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        }

        setBulkResults({ success, failed, errors });
        await fetchGroupDetails(selectedGroup.id);

        if (failed === 0) {
          setTimeout(() => {
            resetMemberForm();
            setShowAddMemberModal(false);
          }, 2000);
        }
      } catch (err) {
        console.error('Error bulk adding members:', err);
        setError(err instanceof Error ? err.message : 'Failed to bulk add members');
      } finally {
        setIsProcessingBulk(false);
      }
    });
  };

  const handleFileUpload = async (file: File) => {
    try {
      const text = await file.text();
      setBulkMembersText(text);
    } catch {
      setError('Failed to read file. Please ensure it\'s a valid text or CSV file.');
    }
  };

  const handleEditMember = async () => {
    if (!editingMember || !newMemberName.trim()) {
      return;
    }

    await trackAsync(async () => {
      try {
        const updates: Partial<AttendanceMember> = {
          name: newMemberName.trim(),
          role: newMemberRole.trim() || undefined
        };

        await attendanceManager.updateMember(editingMember.person_id, updates);
        resetMemberForm();
        setEditingMember(null);
        setShowEditMemberModal(false);
        const targetGroupId = editingMember.group_id ?? selectedGroup?.id;
        if (targetGroupId) {
          await fetchGroupDetails(targetGroupId);
        }
      } catch (err) {
        console.error('Error updating member:', err);
        setError(err instanceof Error ? err.message : 'Failed to update member');
      }
    });
  };

  const handleRemoveMember = async (personId: string) => {
    if (!selectedGroup) {
      return;
    }

    if (!confirm('Remove this member from the group?')) {
      return;
    }

    await trackAsync(async () => {
      try {
        await attendanceManager.removeMember(personId);
        await fetchGroupDetails(selectedGroup.id);
      } catch (err) {
        console.error('Error removing member:', err);
        setError(err instanceof Error ? err.message : 'Failed to remove member');
      }
    });
  };

  const openEditMember = (member: AttendanceMember) => {
    setEditingMember(member);
    setNewMemberName(member.name);
    setNewMemberRole(member.role || '');
    setShowEditMemberModal(true);
  };

  useEffect(() => {
    selectedGroupRef.current = selectedGroup;
  }, [selectedGroup]);

  useEffect(() => {
    const initialise = async () => {
      const group = await fetchGroups();
      if (group && fetchGroupDetailsRef.current) {
        await fetchGroupDetailsRef.current(group.id);
      }
    };

    void initialise();
  }, [fetchGroups]);

  useEffect(() => {
    if (selectedGroup) {
      void fetchGroupDetails(selectedGroup.id);
    }
  }, [selectedGroup, fetchGroupDetails]);

  useEffect(() => {
    if (initialSection) {
      setActiveSection(initialSection);
    }
  }, [initialSection]);

  useEffect(() => {
    if (selectedGroup) {
      void generateReport();
    }
  }, [selectedGroup, reportStartDate, reportEndDate, generateReport]);

  const selectedGroupCreatedAt = selectedGroup ? toDate(selectedGroup.created_at) : null;

  return (
    <div className="h-screen bg-black text-white flex flex-col">
      <header className="px-6 py-4 border-b border-white/10 bg-black/80 backdrop-blur">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-semibold">Menu</h1>
            <div className="h-6 w-px bg-white/10" />
            <select
              value={selectedGroup?.id ?? ''}
              onChange={event => {
                const group = groups.find(item => item.id === event.target.value) ?? null;
                setSelectedGroup(group);
              }}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500/60"
            >
              <option value="">Select group…</option>
              {groups.map(group => (
                <option key={group.id} value={group.id} className="bg-black text-white">
                  {getGroupTypeIcon(group.type)} {group.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            {loading && (
              <div className="flex items-center gap-2 text-blue-300 text-xs">
                <span className="h-3 w-3 border-2 border-blue-400/40 border-t-blue-300 rounded-full animate-spin" />
              </div>
            )}
            <button
              onClick={exportData}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg bg-blue-600/20 border border-blue-500/40 text-blue-200 hover:bg-blue-600/30 transition-colors text-xs disabled:opacity-50"
            >
              Export
            </button>
            <button
              onClick={onBack}
              className="px-3 py-1.5 rounded-lg bg-white text-black hover:bg-gray-100 transition-colors text-xs font-medium"
            >
              Close
            </button>
          </div>
        </div>
        <nav className="mt-3 flex flex-wrap gap-1.5">
          {SECTION_CONFIG.map(section => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`px-3 py-1.5 rounded-lg text-xs transition-colors border ${
                activeSection === section.id
                  ? 'border-blue-500/60 bg-blue-600/20 text-blue-200'
                  : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
              }`}
            >
              {section.label}
            </button>
          ))}
        </nav>
      </header>

      {error && (
        <div className="px-6 py-2 bg-red-600/20 border-b border-red-500/40 text-red-200 flex items-center justify-between text-sm">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-200 hover:text-red-100">
            ✕
          </button>
        </div>
      )}

      <main className="flex-1 overflow-hidden bg-gradient-to-b from-black via-[#050505] to-black">
        <div className="h-full overflow-y-auto px-6 py-6 space-y-6">
          {!selectedGroup ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-3 max-w-md">
                <div className="text-4xl opacity-40">📊</div>
                <h3 className="text-lg font-medium text-white/70">No group selected</h3>
                <p className="text-sm text-white/40">Select a group from the dropdown above to view attendance data</p>
              </div>
            </div>
          ) : (
            <>
              {activeSection === 'overview' && stats && (
            <section className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-white/10 bg-gradient-to-br from-green-500/20 via-green-500/10 to-transparent p-4">
                  <p className="text-xs text-white/40">Present</p>
                  <div className="text-2xl font-semibold text-green-200 mt-1">{stats.present_today}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-gradient-to-br from-red-500/20 via-red-500/10 to-transparent p-4">
                  <p className="text-xs text-white/40">Absent</p>
                  <div className="text-2xl font-semibold text-red-200 mt-1">{stats.absent_today}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-gradient-to-br from-yellow-500/20 via-yellow-500/10 to-transparent p-4">
                  <p className="text-xs text-white/40">Late</p>
                  <div className="text-2xl font-semibold text-yellow-200 mt-1">{stats.late_today}</div>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <h3 className="text-sm font-semibold mb-3">Recent activity</h3>
                <div className="max-h-64 overflow-y-auto pr-2 space-y-2 text-sm">
                  {recentRecords.length > 0 ? (
                    recentRecords.slice(0, 24).map(record => {
                      const member = members.find(item => item.person_id === record.person_id);
                      return (
                        <div
                          key={record.id}
                          className="flex items-center justify-between py-2 border-b border-white/5 last:border-b-0"
                        >
                          <div>
                            <div className="font-medium text-white text-sm">{member?.name ?? record.person_id}</div>
                            <div className="text-xs text-white/40">
                              {toDate(record.timestamp).toLocaleDateString()} · {formatTime(record.timestamp)}
                            </div>
                          </div>
                          <div className="text-xs text-white/40">{(record.confidence * 100).toFixed(0)}%</div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-white/40 text-xs py-6 text-center">No activity</div>
                  )}
                </div>
              </div>
            </section>
          )}

              {activeSection === 'members' && (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Members</h2>
                <button
                  onClick={() => setShowAddMemberModal(true)}
                  className="px-3 py-1.5 rounded-lg bg-green-500/20 border border-green-400/40 text-green-100 hover:bg-green-500/30 transition-colors text-xs"
                >
                  Add member
                </button>
              </div>

              {members.length > 0 && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {members.map(member => {
                    const session = todaySessions.find(item => item.person_id === member.person_id);

                    const statusLabel = session?.status === 'present'
                      ? 'Present'
                      : session?.status === 'late'
                        ? `Late (${session.late_minutes ?? 0}m)`
                        : session?.status === 'checked_out'
                          ? 'Checked out'
                          : session?.status === 'absent'
                            ? 'Absent'
                            : 'No record';

                    const statusClass = session?.status === 'present'
                      ? 'bg-green-500/20 text-green-200 border border-green-400/40'
                      : session?.status === 'late'
                        ? 'bg-yellow-500/20 text-yellow-200 border border-yellow-400/40'
                        : session?.status === 'checked_out'
                          ? 'bg-white/10 text-white/70 border border-white/20'
                          : 'bg-red-500/20 text-red-200 border border-red-400/40';

                    return (
                      <div key={member.person_id} className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="text-base font-semibold truncate">{member.name}</div>
                            <div className="text-xs text-white/50 mt-0.5">
                              {member.role && <span>{member.role} · </span>}
                              <span className="text-white/30">{member.person_id}</span>
                            </div>
                          </div>
                          <div className={`px-2 py-1 rounded-lg text-xs font-medium whitespace-nowrap ${statusClass}`}>{statusLabel}</div>
                        </div>

                        <div className="flex gap-2 text-xs">
                          <button
                            onClick={() => openEditMember(member)}
                            className="flex-1 px-3 py-1.5 rounded-lg bg-blue-500/20 border border-blue-400/40 text-blue-100 hover:bg-blue-500/30 transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleRemoveMember(member.person_id)}
                            className="flex-1 px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-400/40 text-red-100 hover:bg-red-500/30 transition-colors"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

              {activeSection === 'reports' && (
            <section className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Reports</h2>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs">
                    <span className="text-white/40">From</span>
                    <input
                      type="date"
                      value={reportStartDate}
                      onChange={event => setReportStartDate(event.target.value)}
                      className="bg-transparent focus:outline-none w-28"
                    />
                  </label>
                  <label className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs">
                    <span className="text-white/40">To</span>
                    <input
                      type="date"
                      value={reportEndDate}
                      onChange={event => setReportEndDate(event.target.value)}
                      className="bg-transparent focus:outline-none w-28"
                    />
                  </label>
                  <button
                    onClick={generateReport}
                    className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-xs"
                  >
                    Refresh
                  </button>
                  <button
                    onClick={exportReport}
                    disabled={!report}
                    className="px-3 py-1.5 rounded-lg bg-green-500/20 border border-green-400/40 text-green-100 hover:bg-green-500/30 transition-colors text-xs disabled:opacity-50"
                  >
                    Export
                  </button>
                </div>
              </div>

              {report && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <p className="text-xs text-white/40">Working days</p>
                      <div className="text-2xl font-semibold mt-1">{report.summary.total_working_days}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-gradient-to-br from-green-500/20 via-green-500/10 to-transparent p-4">
                    <p className="text-xs text-white/40">Avg attendance</p>
                    <div className="text-2xl font-semibold text-green-200 mt-1">{report.summary.average_attendance_rate}%</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-xs text-white/70 space-y-1">
                    <div>Punctual: <span className="text-white">{report.summary.most_punctual}</span></div>
                    <div>Absent: <span className="text-white">{report.summary.most_absent}</span></div>
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse">
                        <thead className="bg-white/10 text-xs uppercase tracking-[0.2em] text-white/40">
                          <tr>
                            <th className="px-4 py-3 text-left">Name</th>
                            <th className="px-4 py-3 text-center">Present</th>
                            <th className="px-4 py-3 text-center">Absent</th>
                            <th className="px-4 py-3 text-center">Late</th>
                            <th className="px-4 py-3 text-center">Attendance %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.members.map((member, index) => (
                            <tr key={member.person_id} className={index % 2 === 0 ? 'bg-white/5' : ''}>
                              <td className="px-4 py-3 text-sm font-medium text-white">{member.name}</td>
                              <td className="px-4 py-3 text-sm text-center text-green-200">{member.present_days}</td>
                              <td className="px-4 py-3 text-sm text-center text-red-200">{member.absent_days}</td>
                              <td className="px-4 py-3 text-sm text-center text-yellow-200">{member.late_days}</td>
                              <td className="px-4 py-3 text-sm text-center">
                                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                                  member.attendance_rate >= 90
                                    ? 'bg-green-500/20 text-green-200 border border-green-400/40'
                                    : member.attendance_rate >= 75
                                      ? 'bg-yellow-500/20 text-yellow-200 border border-yellow-400/40'
                                      : 'bg-red-500/20 text-red-200 border border-red-400/40'
                                }`}
                                >
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
            </section>
          )}

              {activeSection === 'registration' && (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Face registration</h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowBulkRegistration(true)}
                    className="px-3 py-1.5 rounded-lg bg-purple-500/20 border border-purple-400/40 text-purple-100 hover:bg-purple-500/30 transition-colors text-xs"
                  >
                    📁 Bulk
                  </button>
                  <button
                    onClick={() => setShowCameraQueue(true)}
                    className="px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-400/40 text-cyan-100 hover:bg-cyan-500/30 transition-colors text-xs"
                  >
                    🎥 Camera
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <FaceRegistrationLab
                  group={selectedGroup}
                  members={members}
                  onRefresh={() => {
                    if (selectedGroup) {
                      void fetchGroupDetails(selectedGroup.id);
                    }
                  }}
                />
              </div>
            </section>
          )}

              {activeSection === 'settings' && (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Settings</h2>
                <button
                  onClick={exportData}
                  className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-xs"
                >
                  Export
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                  <h3 className="text-sm font-semibold">Group details</h3>
                  <div className="space-y-2 text-xs text-white/70">
                    <div className="flex justify-between">
                      <span>Name</span>
                      <span className="text-white">{selectedGroup.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Type</span>
                      <span className="text-white">{getGroupTypeIcon(selectedGroup.type)} {selectedGroup.type}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Created</span>
                      <span className="text-white">
                        {selectedGroupCreatedAt ? selectedGroupCreatedAt.toLocaleDateString() : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Members</span>
                      <span className="text-white">{members.length}</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                  <h3 className="text-sm font-semibold">Data tools</h3>
                  <button
                    onClick={async () => {
                      if (!confirm('Remove records older than 30 days?')) {
                        return;
                      }

                      await trackAsync(async () => {
                        try {
                          setError(null);
                          await attendanceManager.cleanupOldData(30);
                          if (selectedGroup) {
                            await fetchGroupDetails(selectedGroup.id);
                          }
                        } catch (err) {
                          console.error('Error cleaning data:', err);
                          setError(err instanceof Error ? err.message : 'Failed to clean up old data');
                        }
                      });
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-yellow-500/20 border border-yellow-400/40 text-yellow-100 hover:bg-yellow-500/30 transition-colors text-xs"
                  >
                    Clean old records (30d+)
                  </button>
                  <button
                    onClick={exportData}
                    className="w-full px-3 py-2 rounded-lg bg-blue-500/20 border border-blue-400/40 text-blue-100 hover:bg-blue-500/30 transition-colors text-xs"
                  >
                    Export snapshot
                  </button>
                </div>
              </div>
            </section>
              )}
            </>
          )}
        </div>
      </main>      {showAddMemberModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur flex items-center justify-center z-50 px-4">
          <div className="bg-[#0f0f0f] border border-white/10 rounded-3xl p-6 w-full max-w-2xl shadow-[0_40px_80px_rgba(0,0,0,0.6)] max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-semibold mb-2">Add Members</h3>
            <p className="text-sm text-white/60 mb-4">Add one or multiple members to the group</p>
            
            {/* Tab selector */}
            <div className="flex gap-2 mb-4 border-b border-white/10 pb-2">
              <button
                onClick={() => {
                  setIsBulkMode(false);
                  setBulkMembersText('');
                }}
                className={`px-4 py-2 text-sm rounded-lg transition ${
                  !isBulkMode ? 'bg-blue-500/20 text-blue-200' : 'text-white/60 hover:text-white'
                }`}
              >
                Single Member
              </button>
              <button
                onClick={() => {
                  setIsBulkMode(true);
                  setNewMemberName('');
                  setNewMemberRole('');
                }}
                className={`px-4 py-2 text-sm rounded-lg transition ${
                  isBulkMode ? 'bg-blue-500/20 text-blue-200' : 'text-white/60 hover:text-white'
                }`}
              >
                Bulk Add
              </button>
            </div>

            {/* Single Member Form */}
            {!isBulkMode && (
              <div className="grid gap-4">
                <label className="text-sm">
                  <span className="text-white/60 block mb-2">Full name *</span>
                  <input
                    type="text"
                    value={newMemberName}
                    onChange={event => setNewMemberName(event.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:outline-none focus:border-blue-500/60"
                    placeholder="Enter full name"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-white/60 block mb-2">Role (optional)</span>
                  <input
                    type="text"
                    value={newMemberRole}
                    onChange={event => setNewMemberRole(event.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:outline-none focus:border-blue-500/60"
                    placeholder="e.g. Staff, Student, Teacher"
                  />
                </label>
              </div>
            )}

            {/* Bulk Add Form */}
            {isBulkMode && (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-white/60">Upload CSV/TXT file or paste below</span>
                    <label className="px-3 py-1 text-xs rounded-lg bg-blue-500/20 border border-blue-400/40 text-blue-200 hover:bg-blue-500/30 cursor-pointer transition">
                      📁 Upload File
                      <input
                        type="file"
                        accept=".txt,.csv"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handleFileUpload(file);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                  <textarea
                    value={bulkMembersText}
                    onChange={event => setBulkMembersText(event.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500/60 font-mono text-sm min-h-[200px]"
                    placeholder="Enter one member per line. Format:&#10;Name, Role (optional)&#10;&#10;Example:&#10;John Doe, Student&#10;Jane Smith, Teacher&#10;Bob Johnson"
                  />
                  <div className="mt-2 text-xs text-white/50">
                    Format: <span className="text-white/70 font-mono">Name, Role</span> (one per line, role is optional)
                  </div>
                </div>

                {/* Bulk Results */}
                {bulkResults && (
                  <div className={`rounded-xl border p-3 ${
                    bulkResults.failed === 0 
                      ? 'border-emerald-500/40 bg-emerald-500/10' 
                      : 'border-yellow-500/40 bg-yellow-500/10'
                  }`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold">
                        {bulkResults.failed === 0 ? '✓ Success!' : '⚠ Partial Success'}
                      </span>
                      <span className="text-xs">
                        {bulkResults.success} added, {bulkResults.failed} failed
                      </span>
                    </div>
                    {bulkResults.errors.length > 0 && (
                      <div className="mt-2 max-h-32 overflow-y-auto space-y-1">
                        {bulkResults.errors.map((err, idx) => (
                          <div key={idx} className="text-xs text-red-200 bg-red-500/10 rounded px-2 py-1">
                            {err}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  resetMemberForm();
                  setShowAddMemberModal(false);
                }}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 transition-colors text-sm"
              >
                Cancel
              </button>
              {!isBulkMode ? (
                <button
                  onClick={handleAddMember}
                  disabled={!newMemberName.trim() || loading}
                  className="px-4 py-2 rounded-xl bg-green-500/20 border border-green-400/40 text-green-100 hover:bg-green-500/30 transition-colors text-sm disabled:opacity-50"
                >
                  {loading ? 'Adding…' : 'Add Member'}
                </button>
              ) : (
                <button
                  onClick={() => void handleBulkAddMembers()}
                  disabled={!bulkMembersText.trim() || isProcessingBulk}
                  className="px-4 py-2 rounded-xl bg-green-500/20 border border-green-400/40 text-green-100 hover:bg-green-500/30 transition-colors text-sm disabled:opacity-50"
                >
                  {isProcessingBulk ? 'Processing…' : `Add Members`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showEditMemberModal && editingMember && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur flex items-center justify-center z-50 px-4">
          <div className="bg-[#0f0f0f] border border-white/10 rounded-2xl p-6 w-full max-w-lg shadow-[0_40px_80px_rgba(0,0,0,0.6)]">
            <h3 className="text-xl font-semibold mb-4">Edit member</h3>
            <div className="grid gap-4">
              <label className="text-sm">
                <span className="text-white/60 block mb-2">Full name *</span>
                <input
                  type="text"
                  value={newMemberName}
                  onChange={event => setNewMemberName(event.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:outline-none focus:border-blue-500/60"
                  placeholder="Enter full name"
                />
              </label>
              <label className="text-sm">
                <span className="text-white/60 block mb-2">Role (optional)</span>
                <input
                  type="text"
                  value={newMemberRole}
                  onChange={event => setNewMemberRole(event.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:outline-none focus:border-blue-500/60"
                  placeholder="e.g. Staff, Student, Teacher"
                />
              </label>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  resetMemberForm();
                  setEditingMember(null);
                  setShowEditMemberModal(false);
                }}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleEditMember}
                disabled={!newMemberName.trim() || loading}
                className="px-4 py-2 rounded-xl bg-blue-500/20 border border-blue-400/40 text-blue-100 hover:bg-blue-500/30 transition-colors text-sm disabled:opacity-50"
              >
                {loading ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Registration Modal */}
      {showBulkRegistration && selectedGroup && (
        <BulkFaceRegistration
          group={selectedGroup}
          members={members}
          onRefresh={() => {
            if (selectedGroup) {
              void fetchGroupDetails(selectedGroup.id);
            }
          }}
          onClose={() => setShowBulkRegistration(false)}
        />
      )}

      {/* Assisted Camera Queue Modal */}
      {showCameraQueue && selectedGroup && (
        <AssistedCameraRegistration
          group={selectedGroup}
          members={members}
          onRefresh={() => {
            if (selectedGroup) {
              void fetchGroupDetails(selectedGroup.id);
            }
          }}
          onClose={() => setShowCameraQueue(false)}
        />
      )}
    </div>
  );
}
