import { useState, useEffect, useCallback } from 'react';
import { attendanceManager } from '../../../services/AttendanceManager.js';
import type {
  AttendanceGroup,
  AttendanceReport
} from '../../../types/recognition.js';

interface ReportsProps {
  group: AttendanceGroup;
}

export function Reports({ group }: ReportsProps) {
  const [report, setReport] = useState<AttendanceReport | null>(null);
  const [reportStartDate, setReportStartDate] = useState<string>(
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const [reportEndDate, setReportEndDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateReport = useCallback(async () => {
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

    setLoading(true);
    try {
      setError(null);
      const generatedReport = await attendanceManager.generateReport(group.id, startDate, endDate);
      setReport(generatedReport);
    } catch (err) {
      console.error('Error generating report:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate report');
    } finally {
      setLoading(false);
    }
  }, [group.id, reportStartDate, reportEndDate]);

  const exportReport = useCallback(() => {
    if (!report) return;

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
      anchor.download = `attendance-report-${group.name}-${reportStartDate}-to-${reportEndDate}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exporting report:', err);
      setError(err instanceof Error ? err.message : 'Failed to export report');
    }
  }, [report, group.name, reportStartDate, reportEndDate]);

  useEffect(() => {
    generateReport();
  }, [generateReport]);

  return (
    <section className="h-full flex flex-col overflow-hidden space-y-4">
      <div className="flex items-center justify-between gap-3 flex-shrink-0">
        <h2 className="text-lg font-semibold">Reports</h2>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs">
            <span className="text-white/50">From</span>
            <input
              type="date"
              value={reportStartDate}
              onChange={event => setReportStartDate(event.target.value)}
              className="bg-transparent focus:outline-none w-36 text-white/90"
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <span className="text-white/50">To</span>
            <input
              type="date"
              value={reportEndDate}
              onChange={event => setReportEndDate(event.target.value)}
              className="bg-transparent focus:outline-none w-36 text-white/90"
            />
          </label>
          <button
            onClick={exportReport}
            disabled={!report}
            className="btn-success text-xs px-2 py-1 disabled:opacity-50"
          >
            Export
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scroll overflow-x-hidden min-h-0 pr-2">
        {error && (
          <div className="px-4 py-2 bg-red-600/20 border border-red-500/40 text-red-200 rounded-lg text-sm mb-4">
            {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 rounded-full border-2 border-white/20 border-t-cyan-400 animate-spin" />
              <span className="text-sm text-white/60">Generating report...</span>
            </div>
          </div>
        )}

        {!loading && report && (
          <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-blue-500/20 bg-gradient-to-br from-blue-500/20 via-blue-500/10 to-transparent p-4">
              <p className="text-xs text-blue-100/60 uppercase tracking-wider">Days Tracked</p>
              <div className="text-2xl font-semibold text-blue-200 mt-1">{report.summary.total_working_days}</div>
              <p className="text-[10px] text-blue-100/40 mt-1">attendance taken</p>
            </div>
            <div className="rounded-xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/20 via-emerald-500/10 to-transparent p-4">
              <p className="text-xs text-emerald-100/60 uppercase tracking-wider">Avg Attendance</p>
              <div className="text-2xl font-semibold text-emerald-200 mt-1">{report.summary.average_attendance_rate}%</div>
              <p className="text-[10px] text-emerald-100/40 mt-1">across all members</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <p className="text-[10px] text-white/50 uppercase tracking-wider">Most Punctual</p>
                  <span className="text-xs text-emerald-200 font-medium">{report.summary.most_punctual}</span>
                </div>
                <div className="flex justify-between items-center">
                  <p className="text-[10px] text-white/50 uppercase tracking-wider">Most Absent</p>
                  <span className="text-xs text-rose-200 font-medium">{report.summary.most_absent}</span>
                </div>
              </div>
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
                      <td className="px-4 py-3 text-sm text-center text-emerald-200">{member.present_days}</td>
                      <td className="px-4 py-3 text-sm text-center text-rose-200">{member.absent_days}</td>
                      <td className="px-4 py-3 text-sm text-center text-amber-200">{member.late_days}</td>
                      <td className="px-4 py-3 text-sm text-center">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                          member.attendance_rate >= 90
                            ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/40'
                            : member.attendance_rate >= 75
                              ? 'bg-amber-500/20 text-amber-200 border border-amber-400/40'
                              : 'bg-rose-500/20 text-rose-200 border border-rose-400/40'
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
    </section>
  );
}

