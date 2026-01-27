import { useState, useEffect, useCallback } from "react";
import { useGroupStore } from "../stores";
import { getLocalDateString } from "../../../utils";
import type { AttendanceGroup } from "../../../types/recognition";

// Hooks & Components
import { useReportData } from "./reports/hooks/useReportData";
import { useReportViews } from "./reports/hooks/useReportViews";
import { useReportTransform } from "./reports/hooks/useReportTransform";
import { ReportHeader } from "./reports/components/ReportHeader";
import { ReportToolbar } from "./reports/components/ReportToolbar";
import { ReportTable } from "./reports/components/ReportTable";
import { exportReportToCSV } from "./reports/utils/exportUtils";

import type { ColumnKey } from "./reports/types";

interface ReportsProps {
  group: AttendanceGroup;
  onDaysTrackedChange?: (daysTracked: number, loading: boolean) => void;
  onExportHandlersReady?: (handlers: {
    exportCSV: () => void;
    print: () => void;
  }) => void;
  onAddMember?: () => void;
}

const DEFAULT_COLUMNS = [
  "name",
  "date",
  "status",
  "check_in_time",
  "is_late",
] as unknown as ColumnKey[];

export function Reports({
  group,
  onDaysTrackedChange,
  onExportHandlersReady,
  onAddMember,
}: ReportsProps) {
  const storeMembers = useGroupStore((state) => state.members);

  // --- Date State ---
  const [reportStartDate, setReportStartDate] =
    useState<string>(getLocalDateString());
  const [reportEndDate, setReportEndDate] =
    useState<string>(getLocalDateString());

  // --- Data Hook ---
  const { report, sessions, members, loading, error, generateReport } =
    useReportData(group, storeMembers, reportStartDate, reportEndDate);

  // --- Views Hook ---
  const {
    views,
    activeViewIndex,
    defaultViewName,
    visibleColumns,
    setVisibleColumns,
    groupBy,
    setGroupBy,
    statusFilter,
    setStatusFilter,
    search,
    setSearch,
    isDirty,
    handleSave,
    handleSaveAs,
    handleDeleteView,
    handleViewChange,
  } = useReportViews(group.id, DEFAULT_COLUMNS);

  // --- Transform Hook ---
  const { groupedRows, daysTracked, allColumns } = useReportTransform(
    members,
    sessions,
    report,
    reportStartDate,
    reportEndDate,
    groupBy,
    statusFilter,
    search,
  );

  // --- Sync Effects ---
  // Debounce generateReport
  useEffect(() => {
    const timer = setTimeout(() => {
      generateReport();
    }, 300);
    return () => clearTimeout(timer);
  }, [generateReport]);

  // Sync daysTracked
  useEffect(() => {
    if (onDaysTrackedChange) {
      onDaysTrackedChange(daysTracked, loading);
    }
  }, [daysTracked, loading, onDaysTrackedChange]);

  // Export handlers
  const handleExportCSV = useCallback(() => {
    exportReportToCSV(
      groupedRows,
      visibleColumns,
      allColumns,
      group.name,
      reportStartDate,
      reportEndDate,
    );
  }, [
    groupedRows,
    visibleColumns,
    allColumns,
    group.name,
    reportStartDate,
    reportEndDate,
  ]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  useEffect(() => {
    if (onExportHandlersReady && members.length > 0 && !loading) {
      onExportHandlersReady({
        exportCSV: handleExportCSV,
        print: handlePrint,
      });
    }
  }, [
    onExportHandlersReady,
    handleExportCSV,
    handlePrint,
    members.length,
    loading,
  ]);

  // Empty State
  if (!loading && members.length === 0) {
    return (
      <section className="h-full flex flex-col overflow-hidden p-6">
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center justify-center p-12 rounded-3xl border border-white/5 bg-white/[0.02] shadow-2xl max-w-sm text-center">
            <div className="w-20 h-20 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-6 shadow-[0_0_20px_rgba(34,211,238,0.1)]">
              <i className="fa-solid fa-users-slash text-3xl text-cyan-400/60"></i>
            </div>
            <h2 className="text-lg font-bold text-white mb-2">
              No members found
            </h2>
            <p className="text-sm text-white/40 mb-8 leading-relaxed">
              This group doesn't have any members registered yet. Add some
              members to start tracking attendance.
            </p>
            {onAddMember && (
              <button
                onClick={onAddMember}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-100 hover:bg-cyan-500/30 transition-all font-bold text-sm"
              >
                <i className="fa-solid fa-plus-circle"></i>
                Register Members
              </button>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="h-full flex flex-col overflow-hidden p-6 custom-scroll">
      <div className="flex-1 overflow-hidden min-h-0">
        {error && (
          <div className="px-4 py-2 bg-red-600/20 border border-red-500/40 text-red-200 rounded-lg text-sm mb-4 animate-in fade-in slide-in-from-top-2">
            {error}
          </div>
        )}

        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <div className="relative w-12 h-12">
                <div className="absolute inset-0 border-4 border-cyan-500/10 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-cyan-500 rounded-full border-t-transparent animate-spin"></div>
              </div>
              <span className="text-sm font-medium text-white/40 tracking-wider uppercase">
                Generating Report
              </span>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col rounded-2xl border border-white/10 bg-white/[0.01] overflow-hidden shadow-2xl">
            {/* Unified Control Area (Header + Toolbar) */}
            <div className="bg-white/[0.02] border-b border-white/5">
              <div className="px-4 pt-3 pb-0">
                <ReportHeader
                  startDate={reportStartDate}
                  endDate={reportEndDate}
                  onStartDateChange={setReportStartDate}
                  onEndDateChange={setReportEndDate}
                  daysTracked={daysTracked}
                  loading={loading}
                />
              </div>

              <ReportToolbar
                views={views}
                activeViewIndex={activeViewIndex}
                defaultViewName={defaultViewName}
                onViewChange={handleViewChange}
                onSave={handleSave}
                onSaveAs={handleSaveAs}
                onDeleteView={handleDeleteView}
                isDirty={isDirty}
                visibleColumns={visibleColumns}
                setVisibleColumns={setVisibleColumns}
                groupBy={groupBy}
                setGroupBy={setGroupBy}
                statusFilter={statusFilter}
                setStatusFilter={setStatusFilter}
                search={search}
                setSearch={setSearch}
                allColumns={allColumns}
                defaultColumns={DEFAULT_COLUMNS}
              />
            </div>

            <ReportTable
              groupedRows={groupedRows}
              visibleColumns={visibleColumns}
              allColumns={allColumns}
              search={search}
              statusFilter={statusFilter}
              onResetSearch={() => setSearch("")}
              onResetFilter={() => setStatusFilter("all")}
            />
          </div>
        )}
      </div>
    </section>
  );
}
