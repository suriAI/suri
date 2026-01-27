import { useState, useRef, useEffect } from "react";
import type {
  SavedViewConfig,
  ColumnKey,
  GroupByKey,
  ReportStatusFilter,
} from "../types";

interface ReportToolbarProps {
  // Views
  views: SavedViewConfig[];
  activeViewIndex: number | null;
  defaultViewName: string | null;
  onViewChange: (idx: number | null) => void;
  onSave: () => void;
  onSaveAs: () => void;
  onDeleteView: () => void;
  isDirty: boolean;

  // View State
  visibleColumns: ColumnKey[];
  setVisibleColumns: (cols: ColumnKey[]) => void;
  groupBy: GroupByKey;
  setGroupBy: (key: GroupByKey) => void;
  statusFilter: ReportStatusFilter;
  setStatusFilter: (filter: ReportStatusFilter) => void;
  search: string;
  setSearch: (val: string) => void;

  // Static Config
  allColumns: ReadonlyArray<{ key: ColumnKey; label: string }>;
  defaultColumns: ColumnKey[];
}

export function ReportToolbar({
  views,
  activeViewIndex,
  defaultViewName,
  onViewChange,
  onSave,
  onSaveAs,
  onDeleteView,
  isDirty,
  visibleColumns,
  setVisibleColumns,
  groupBy,
  setGroupBy,
  statusFilter,
  setStatusFilter,
  search,
  setSearch,
  allColumns,
}: ReportToolbarProps) {
  const [showColumnDropdown, setShowColumnDropdown] = useState(false);
  const columnDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        columnDropdownRef.current &&
        !columnDropdownRef.current.contains(event.target as Node)
      ) {
        setShowColumnDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="flex flex-col flex-shrink-0 bg-white/[0.01]">
      {/* Row 1: Date Range, Search, Coverage & Columns */}
      <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between gap-4">
        {/* Date Selector + Search (Left Group) */}
        <div className="flex items-center gap-3 flex-1">
          {/* We'll pass children or move the date logic here if needed, 
              but for now let's assume parent provides children for spacing efficiency */}
          <div className="relative flex-1 max-w-md">
            <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-white/20 text-[10px]"></i>
            <input
              type="search"
              placeholder="Search..."
              className="w-full bg-white/5 border border-white/5 rounded-lg pl-8 pr-3 py-1.5 text-[11px] text-white placeholder:text-white/20 focus:outline-none focus:border-cyan-500/30 transition-all font-medium"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Right Group: Visibility */}
        <div className="flex items-center gap-3">
          {/* Column Visibility */}
          <div className="relative" ref={columnDropdownRef}>
            <button
              onClick={() => setShowColumnDropdown(!showColumnDropdown)}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border transition-all text-[11px] font-bold uppercase tracking-wider ${showColumnDropdown
                  ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-400"
                  : "bg-white/5 border-white/5 text-white/40 hover:text-white/60"
                }`}
            >
              <i className="fa-solid fa-columns text-[9px]"></i>
              Options
            </button>

            {showColumnDropdown && (
              <div className="absolute right-0 mt-2 w-48 bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl py-2 z-50 animate-in fade-in zoom-in-95 duration-100">
                <div className="px-3 py-1 mb-1 border-b border-white/5">
                  <span className="text-[9px] font-black uppercase tracking-widest text-white/20">
                    Columns
                  </span>
                </div>
                {allColumns.map((c) => (
                  <label
                    key={c.key}
                    className="flex items-center gap-3 px-3 py-1.5 hover:bg-white/5 cursor-pointer transition-colors"
                  >
                    <div className="relative flex items-center">
                      <input
                        type="checkbox"
                        checked={visibleColumns.includes(c.key)}
                        onChange={(e) => {
                          e.stopPropagation();
                          const checked = e.target.checked;
                          if (checked) {
                            setVisibleColumns([...visibleColumns, c.key]);
                          } else {
                            setVisibleColumns(
                              visibleColumns.filter((k) => k !== c.key),
                            );
                          }
                        }}
                        className="peer h-3.5 w-3.5 appearance-none rounded border border-white/10 bg-white/5 checked:bg-cyan-500 checked:border-cyan-500 transition-all cursor-pointer"
                      />
                      <i className="fa-solid fa-check absolute opacity-0 peer-checked:opacity-100 text-[9px] text-black left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"></i>
                    </div>
                    <span className="text-[11px] text-white/50 peer-checked:text-white/90 font-medium">
                      {c.label}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Row 2: View Management, Status Filter, Grouping */}
      <div className="px-4 py-2 border-b border-white/10 flex items-center justify-between gap-4 bg-white/[0.01]">
        <div className="flex items-center gap-3">
          {/* View Toggle */}
          <div className="flex bg-white/5 border border-white/5 rounded-lg p-0.5 items-center">
            <select
              className="bg-transparent text-[11px] font-bold text-white/60 px-2 py-1 focus:outline-none cursor-pointer min-w-[120px]"
              style={{ colorScheme: "dark" }}
              value={activeViewIndex ?? ""}
              onChange={(e) => {
                const val =
                  e.target.value === "" ? null : Number(e.target.value);
                onViewChange(val);
              }}
            >
              <option className="bg-[#0f0f0f]" value="">
                Default View
              </option>
              {views.map((v, i) => (
                <option className="bg-[#0f0f0f]" key={v.name + i} value={i}>
                  {defaultViewName === v.name ? "★ " : ""}
                  {v.name}
                </option>
              ))}
            </select>

            <div className="w-px h-3 bg-white/5" />

            {activeViewIndex === null ? (
              <button
                className="text-[10px] font-black uppercase tracking-widest px-3 py-1 text-white/30 hover:text-cyan-400 transition-colors"
                onClick={onSaveAs}
              >
                Save
              </button>
            ) : (
              <div className="flex items-center">
                <button
                  className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 transition-colors border-r border-white/5 ${isDirty
                      ? "text-amber-500 hover:text-amber-400"
                      : "text-white/30 hover:text-white/60"
                    }`}
                  onClick={onSave}
                >
                  {isDirty ? "Unsaved" : "Saved"}
                </button>
                <button
                  className="text-[10px] font-black uppercase tracking-widest px-3 py-1 text-white/30 hover:text-white/60 transition-colors border-r border-white/5"
                  onClick={onSaveAs}
                  title="Save as new"
                >
                  <i className="fa-solid fa-copy"></i>
                </button>
                <button
                  className="text-[10px] font-black uppercase tracking-widest px-3 py-1 text-red-500/30 hover:text-red-500/60 transition-colors"
                  onClick={onDeleteView}
                >
                  <i className="fa-solid fa-trash-can"></i>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Center: Status Pills */}
        <div className="flex bg-white/5 border border-white/5 rounded-lg p-0.5 gap-0.5">
          {(["all", "present", "absent", "no_records"] as const).map((st) => {
            const active = statusFilter === st;
            return (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-widest transition-all ${active
                    ? "bg-cyan-500/20 text-cyan-400 shadow-sm"
                    : "text-white/20 hover:text-white/40 hover:bg-white/5"
                  }`}
              >
                {st === "all" ? "All" : st === "no_records" ? "N/A" : st}
              </button>
            );
          })}
        </div>

        {/* Right: Grouping */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-black uppercase tracking-widest text-white/20">
            Group
          </span>
          <select
            className="bg-white/5 text-[11px] font-bold text-white/60 border border-white/5 rounded-lg px-2 py-1 focus:outline-none focus:border-cyan-500/30 cursor-pointer"
            style={{ colorScheme: "dark" }}
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupByKey)}
          >
            <option className="bg-[#0f0f0f]" value="none">
              None
            </option>
            <option className="bg-[#0f0f0f]" value="person">
              Person
            </option>
            <option className="bg-[#0f0f0f]" value="date">
              Date
            </option>
          </select>
        </div>
      </div>
    </div>
  );
}
