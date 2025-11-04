import { useState, useEffect, useMemo, useCallback } from "react";
import { attendanceManager } from "../../../services/AttendanceManager.js";
import { getLocalDateString } from "../../../utils/dateUtils.js";
import { createDisplayNameMap } from "../../../utils/displayNameUtils.js";
import type {
  AttendanceGroup,
  AttendanceReport,
  AttendanceSession,
  AttendanceMember,
} from "../../../types/recognition.js";

interface ReportsProps {
  group: AttendanceGroup;
}

export function Reports({ group }: ReportsProps) {
  const [report, setReport] = useState<AttendanceReport | null>(null);
  const [reportStartDate, setReportStartDate] =
    useState<string>(getLocalDateString());
  const [reportEndDate, setReportEndDate] =
    useState<string>(getLocalDateString());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Advanced, offline-first editable reports (field picker, filters, grouping, saved views)
  type ColumnKey =
    | "name"
    | "date"
    | "check_in_time"
    | "status"
    | "is_late"
    | "late_minutes"
    | "notes";
  const allColumns: Array<{
    key: ColumnKey;
    label: string;
    align?: "left" | "center";
  }> = [
    { key: "name", label: "Name", align: "left" },
    { key: "date", label: "Date", align: "left" },
    { key: "check_in_time", label: "Time In", align: "center" },
    { key: "status", label: "Status", align: "center" },
    { key: "is_late", label: "Late", align: "center" },
    { key: "late_minutes", label: "Minutes Late", align: "center" },
    { key: "notes", label: "Notes", align: "left" },
  ];

  type GroupByKey = "none" | "person" | "date";

  interface SavedViewConfig {
    name: string;
    columns: ColumnKey[];
    groupBy: GroupByKey;
    statusFilter: "all" | "present" | "absent";
    search: string;
  }

  const defaultColumns: ColumnKey[] = [
    "name",
    "date",
    "check_in_time",
    "status",
    "is_late",
  ];
  const [visibleColumns, setVisibleColumns] =
    useState<ColumnKey[]>(defaultColumns);
  const [groupBy, setGroupBy] = useState<GroupByKey>("none");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "present" | "absent"
  >("all");
  const [search, setSearch] = useState<string>("");

  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [members, setMembers] = useState<AttendanceMember[]>([]);

  // Saved views in localStorage (per group)
  const storageKey = `suri_report_views_${group.id}`;
  const [views, setViews] = useState<SavedViewConfig[]>([]);
  const [activeViewIndex, setActiveViewIndex] = useState<number | null>(null);
  const defaultViewNameKey = `suri_report_default_view_name_${group.id}`;
  const [defaultViewName, setDefaultViewName] = useState<string | null>(null);

  const generateReport = useCallback(async () => {
    const startDate = new Date(reportStartDate);
    const endDate = new Date(reportEndDate);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      setError("Please select valid report dates.");
      return;
    }

    if (startDate > endDate) {
      setError("The start date must be before the end date.");
      return;
    }

    setLoading(true);
    try {
      setError(null);
      // Load everything in parallel for faster response
      const [generatedReport, loadedSessions, loadedMembers] =
        await Promise.all([
          attendanceManager.generateReport(group.id, startDate, endDate),
          attendanceManager.getSessions({
            group_id: group.id,
            start_date: getLocalDateString(startDate),
            end_date: getLocalDateString(endDate),
          }),
          attendanceManager.getGroupMembers(group.id),
        ]);
      setReport(generatedReport);
      setSessions(loadedSessions);
      setMembers(loadedMembers);
    } catch (err) {
      console.error("Error generating report:", err);
      setError(
        err instanceof Error ? err.message : "Failed to generate report",
      );
    } finally {
      setLoading(false);
    }
  }, [group.id, reportStartDate, reportEndDate]);

  // Removed separate summary export to avoid confusion; main export is current view CSV below

  // Debounce report generation to avoid spamming API on date changes
  useEffect(() => {
    const timer = setTimeout(() => {
      generateReport();
    }, 300); // Wait 300ms after last change

    return () => clearTimeout(timer);
  }, [generateReport]);

  // Reset state when group changes
  useEffect(() => {
    setLoading(true);
    setReport(null);
    setSessions([]);
    setMembers([]);
    setError(null);
  }, [group.id]);

  // Load saved views on mount or group change
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed: SavedViewConfig[] = raw ? JSON.parse(raw) : [];
      setViews(parsed);
      const storedDefaultName = localStorage.getItem(defaultViewNameKey);
      setDefaultViewName(storedDefaultName);
      if (parsed.length > 0) {
        // Pick default view if stored, else first
        let indexToUse = 0;
        if (storedDefaultName) {
          const foundIdx = parsed.findIndex(
            (v) => v.name === storedDefaultName,
          );
          if (foundIdx >= 0) indexToUse = foundIdx;
        }
        setActiveViewIndex(indexToUse);
        const v = parsed[indexToUse];
        setVisibleColumns(v.columns);
        setGroupBy(v.groupBy);
        // Handle legacy array format for statusFilter
        const filterValue = Array.isArray(v.statusFilter)
          ? v.statusFilter.length === 0
            ? "all"
            : (v.statusFilter[0] as "present" | "absent")
          : v.statusFilter;
        setStatusFilter(filterValue);
        setSearch(v.search);
      } else {
        setActiveViewIndex(null);
        setVisibleColumns(defaultColumns);
        setGroupBy("none");
        setStatusFilter("all");
        setSearch("");
      }
    } catch {
      // ignore
      setViews([]);
      setActiveViewIndex(null);
    }
  }, [storageKey]);

  const saveViewsToStorage = (next: SavedViewConfig[]) => {
    setViews(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  };

  // Helpers to determine if current config differs from the selected view (or base defaults)
  const arraysEqualUnordered = (a: unknown[], b: unknown[]) => {
    if (a.length !== b.length) return false;
    const as = [...a].sort();
    const bs = [...b].sort();
    return as.every((v, i) => v === bs[i]);
  };

  const isDirty = useMemo(() => {
    const current: SavedViewConfig = {
      name: "",
      columns: visibleColumns,
      groupBy,
      statusFilter,
      search,
    };
    if (activeViewIndex !== null && views[activeViewIndex]) {
      const v = views[activeViewIndex];
      return (
        !arraysEqualUnordered(current.columns, v.columns) ||
        current.groupBy !== v.groupBy ||
        current.statusFilter !== v.statusFilter ||
        current.search !== v.search
      );
    }
    // Compare to base defaults when no saved view is selected
    return (
      !arraysEqualUnordered(current.columns, defaultColumns) ||
      current.groupBy !== "none" ||
      current.statusFilter !== "all" ||
      current.search !== ""
    );
  }, [visibleColumns, groupBy, statusFilter, search, activeViewIndex, views]);

  // Default view is now auto-set on selection; no explicit setter needed

  const handleSave = () => {
    const cfg: SavedViewConfig = {
      name:
        activeViewIndex !== null && views[activeViewIndex]
          ? views[activeViewIndex].name
          : "Default",
      columns: visibleColumns,
      groupBy,
      statusFilter,
      search,
    };
    if (activeViewIndex !== null && views[activeViewIndex]) {
      const next = views.slice();
      next[activeViewIndex] = cfg;
      saveViewsToStorage(next);
    } else {
      const next = [
        ...views,
        { ...cfg, name: cfg.name || `View ${views.length + 1}` },
      ];
      saveViewsToStorage(next);
      setActiveViewIndex(next.length - 1);
    }
  };

  const handleSaveAs = () => {
    // Auto-generate a unique name: View 1, View 2, ...
    const existingNames = new Set(views.map((v) => v.name));
    let counter = views.length + 1;
    let generated = `View ${counter}`;
    while (existingNames.has(generated)) {
      counter += 1;
      generated = `View ${counter}`;
    }
    const cfg: SavedViewConfig = {
      name: generated,
      columns: visibleColumns,
      groupBy,
      statusFilter,
      search,
    };
    const next = [...views, cfg];
    saveViewsToStorage(next);
    setActiveViewIndex(next.length - 1);
  };

  const handleDeleteView = () => {
    if (activeViewIndex === null) return;
    const name = views[activeViewIndex]?.name || "";
    if (!confirm(`Delete view "${name}"?`)) return;
    const next = views.filter((_, idx) => idx !== activeViewIndex);
    saveViewsToStorage(next);
    setActiveViewIndex(next.length ? 0 : null);
  };

  // Build table rows from sessions + members
  const displayNameMap = useMemo(() => {
    return createDisplayNameMap(members);
  }, [members]);

  const filteredRows = useMemo(() => {
    const rows = sessions.map((s) => ({
      person_id: s.person_id,
      name: displayNameMap.get(s.person_id) || "Unknown",
      date: s.date,
      check_in_time: s.check_in_time,
      status: s.status,
      is_late: s.is_late,
      late_minutes: s.late_minutes ?? 0,
      notes: s.notes || "",
    }));

    // Backend already filters by date range, so we only filter by status and search
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${r.name} ${r.status} ${r.notes}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [sessions, displayNameMap, statusFilter, search]);

  const groupedRows = useMemo(() => {
    if (groupBy === "none")
      return { __all__: filteredRows } as Record<string, typeof filteredRows>;
    const groups: Record<string, typeof filteredRows> = {};
    for (const r of filteredRows) {
      const key = groupBy === "person" ? `${r.name}` : r.date;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }
    return groups;
  }, [filteredRows, groupBy]);

  // Days tracked - calculate from date range (inclusive)
  const daysTracked = useMemo(() => {
    if (report?.summary?.total_working_days !== undefined) {
      return report.summary.total_working_days;
    }
    // Calculate days in range (inclusive)
    const start = new Date(reportStartDate);
    const end = new Date(reportEndDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end dates
    return diffDays;
  }, [report, reportStartDate, reportEndDate]);

  return (
    <section className="h-full flex flex-col overflow-hidden space-y-4">
      <div className="flex items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs">
            <span className="text-white/50">From</span>
            <input
              type="date"
              value={reportStartDate}
              onChange={(event) => setReportStartDate(event.target.value)}
              className="bg-transparent focus:outline-none w-36 text-white/90"
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <span className="text-white/50">To</span>
            <input
              type="date"
              value={reportEndDate}
              onChange={(event) => setReportEndDate(event.target.value)}
              className="bg-transparent focus:outline-none w-36 text-white/90"
            />
          </label>
          {/* Dynamic Days Tracked indicator */}
          {!loading && (
            <div className="text-xs text-white/60 ml-2 whitespace-nowrap">
              Days tracked:{" "}
              <span className="text-white/90 font-semibold">{daysTracked}</span>
            </div>
          )}
          <button
            onClick={() => {
              try {
                const cols = allColumns.filter((c) =>
                  visibleColumns.includes(c.key),
                );
                const header = cols.map((c) => c.label);
                const rows: string[][] = [];
                Object.values(groupedRows).forEach((groupArr) => {
                  groupArr.forEach((r) => {
                    const row = cols.map((c) => {
                      const v = (r as any)[c.key];
                      if (typeof v === "boolean") return v ? "true" : "false";
                      if (typeof v === "number") return String(v);
                      return v ?? "";
                    });
                    rows.push(row);
                  });
                });

                const csvContent = [header, ...rows]
                  .map((row) =>
                    row
                      .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
                      .join(","),
                  )
                  .join("\n");

                const blob = new Blob([csvContent], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = `attendance-view-${group.name}-${reportStartDate}-to-${reportEndDate}.csv`;
                document.body.appendChild(anchor);
                anchor.click();
                document.body.removeChild(anchor);
                URL.revokeObjectURL(url);
              } catch (err) {
                console.error("Error exporting view:", err);
                setError(
                  err instanceof Error ? err.message : "Failed to export view",
                );
              }
            }}
            className="btn-success text-xs px-2 py-1 disabled:opacity-50"
          >
            Export CSV (current view)
          </button>
          <button
            onClick={() => window.print()}
            className="text-xs px-2 py-1 border border-white/20 rounded hover:bg-white/10"
          >
            Print
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden min-h-0 pr-2">
        {error && (
          <div className="px-4 py-2 bg-red-600/20 border border-red-500/40 text-red-200 rounded-lg text-sm mb-2">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 rounded-full border-2 border-white/20 border-t-cyan-400 animate-spin" />
              <span className="text-sm text-white/60">
                Generating report...
              </span>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col">
            {/* Editable data view */}
            <div className="rounded-xl border border-white/10 bg-white/5 h-full flex flex-col">
              {/* Controls */}
              <div className="p-3 border-b border-white/10 grid grid-cols-1 lg:grid-cols-3 gap-3 flex-shrink-0">
                <div className="flex items-start gap-2 flex-wrap">
                  <select
                    className="bg-transparent text-xs border border-white/20 rounded px-4 py-1"
                    style={{ colorScheme: "dark" }}
                    value={activeViewIndex ?? ""}
                    onChange={(e) => {
                      const idx =
                        e.target.value === "" ? null : Number(e.target.value);
                      setActiveViewIndex(idx);
                      if (idx !== null) {
                        const v = views[idx];
                        if (v) {
                          setVisibleColumns(v.columns);
                          setGroupBy(v.groupBy);
                          setStatusFilter(v.statusFilter);
                          setSearch(v.search);
                          // Auto-set default to the selected view
                          setDefaultViewName(v.name);
                          localStorage.setItem(defaultViewNameKey, v.name);
                        }
                      } else {
                        // Reset to default values when "(Default View)" is selected
                        setVisibleColumns(defaultColumns);
                        setGroupBy("none");
                        setStatusFilter("all");
                        setSearch("");
                        setDefaultViewName(null);
                        localStorage.removeItem(defaultViewNameKey);
                      }
                    }}
                  >
                    <option className="bg-black text-white" value="">
                      (Default View)
                    </option>
                    {views.map((v, i) => (
                      <option
                        className="bg-black text-white"
                        key={v.name + i}
                        value={i}
                      >
                        {defaultViewName === v.name ? "★ " : ""}
                        {v.name}
                      </option>
                    ))}
                  </select>
                  {activeViewIndex === null ? (
                    // When "(default view)" is selected, only show "Save"
                    <button
                      className="text-xs px-2 py-1 border border-white/20 rounded hover:bg-white/10"
                      onClick={handleSaveAs}
                    >
                      Save
                    </button>
                  ) : (
                    // When a saved view is selected, show Save, Save as new, and Delete
                    <>
                      <button
                        className="text-xs px-2 py-1 border border-white/20 rounded hover:bg-white/10"
                        onClick={handleSave}
                      >
                        Save
                      </button>
                      <button
                        className="text-xs px-2 py-1 border border-white/20 rounded hover:bg-white/10"
                        onClick={handleSaveAs}
                      >
                        Save as new
                      </button>
                      <button
                        className="text-xs px-2 py-1 border border-white/20 rounded hover:bg-white/10"
                        onClick={handleDeleteView}
                      >
                        Delete
                      </button>
                    </>
                  )}
                  {isDirty && activeViewIndex !== null && (
                    <span className="text-[10px] text-amber-300 ml-1">
                      Unsaved changes
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-white/50">Group by</span>
                    <select
                      className="bg-transparent text-xs border border-white/20 rounded px-2 py-1"
                      style={{ colorScheme: "dark" }}
                      value={groupBy}
                      onChange={(e) => setGroupBy(e.target.value as GroupByKey)}
                    >
                      <option className="bg-black text-white" value="none">
                        None
                      </option>
                      <option className="bg-black text-white" value="person">
                        Person
                      </option>
                      <option className="bg-black text-white" value="date">
                        Date
                      </option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-white/50">Status</span>
                    {(["all", "present", "absent"] as const).map((st) => {
                      const active = statusFilter === st;
                      return (
                        <label
                          key={st}
                          className="text-[11px] flex items-center gap-1 cursor-pointer"
                        >
                          <input
                            type="radio"
                            name="statusFilter"
                            checked={active}
                            onChange={() => setStatusFilter(st)}
                            className="cursor-pointer"
                          />
                          <span className="capitalize">{st}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 flex-wrap">
                  {allColumns.map((c) => (
                    <label
                      key={c.key}
                      className="text-[11px] flex items-center gap-1 whitespace-nowrap"
                    >
                      <input
                        type="checkbox"
                        checked={visibleColumns.includes(c.key)}
                        onChange={(e) => {
                          setVisibleColumns((prev) =>
                            e.target.checked
                              ? Array.from(new Set([...prev, c.key]))
                              : prev.filter((k) => k !== c.key),
                          );
                        }}
                      />
                      <span>{c.label}</span>
                    </label>
                  ))}
                  <input
                    className="ml-auto bg-transparent text-xs border border-white/20 rounded px-2 py-1"
                    placeholder="Search name/id/notes"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>

              {/* Table */}
              <div className="flex-1 overflow-auto custom-scroll min-h-0">
                {Object.entries(groupedRows).map(([gkey, rows], gi) => (
                  <div key={gkey + gi} className="border-b border-white/10">
                    {groupBy !== "none" && (
                      <div className="px-4 py-2 text-xs text-white/60 bg-white/5">
                        {groupBy === "person" ? "Person" : "Date"}:{" "}
                        <span className="text-white/80 font-medium">
                          {gkey}
                        </span>{" "}
                        • Rows: {rows.length}
                      </div>
                    )}
                    <table className="w-full border-collapse">
                      <thead className="bg-black text-xs uppercase tracking-[0.2em] text-white sticky top-0 z-10">
                        <tr>
                          {allColumns
                            .filter((c) => visibleColumns.includes(c.key))
                            .map((col) => (
                              <th
                                key={col.key}
                                className={`px-4 py-3 ${col.align === "center" ? "text-center" : "text-left"}`}
                              >
                                {col.label}
                              </th>
                            ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, index) => (
                          <tr
                            key={`${r.person_id}-${r.date}-${index}`}
                            className={index % 2 === 0 ? "bg-white/5" : ""}
                          >
                            {visibleColumns.includes("name") && (
                              <td className="px-4 py-3 text-sm font-medium text-white">
                                {r.name}
                              </td>
                            )}
                            {visibleColumns.includes("date") && (
                              <td className="px-4 py-3 text-sm text-white/80">
                                {r.date}
                              </td>
                            )}
                            {visibleColumns.includes("check_in_time") && (
                              <td className="px-4 py-3 text-sm text-white/80 text-center">
                                {r.check_in_time
                                  ? new Date(
                                      r.check_in_time,
                                    ).toLocaleTimeString([], {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })
                                  : "-"}
                              </td>
                            )}
                            {visibleColumns.includes("status") && (
                              <td className="px-4 py-3 text-sm text-center">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                                    r.status === "present" && r.is_late
                                      ? "bg-amber-500/15 text-amber-200 border-amber-400/30"
                                      : r.status === "present"
                                        ? "bg-emerald-500/15 text-emerald-200 border-emerald-400/30"
                                        : "bg-rose-500/15 text-rose-200 border-rose-400/30"
                                  }`}
                                >
                                  {r.status === "present" && r.is_late
                                    ? "late"
                                    : r.status}
                                </span>
                              </td>
                            )}
                            {visibleColumns.includes("is_late") && (
                              <td className="px-4 py-3 text-sm text-center">
                                {r.is_late ? "Yes" : "No"}
                              </td>
                            )}
                            {visibleColumns.includes("late_minutes") && (
                              <td className="px-4 py-3 text-sm text-center">
                                {r.late_minutes}
                              </td>
                            )}
                            {visibleColumns.includes("notes") && (
                              <td className="px-4 py-3 text-sm text-white/80">
                                {r.notes}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
