import { Fragment } from "react";
import type { RowData, ColumnKey } from "../types";

interface ReportTableProps {
  groupedRows: Record<string, RowData[]>;
  visibleColumns: ColumnKey[];
  allColumns: ReadonlyArray<{ key: ColumnKey; label: string; align?: string }>;
  search?: string;
  statusFilter?: string;
  onResetSearch?: () => void;
  onResetFilter?: () => void;
}

export function ReportTable({
  groupedRows,
  visibleColumns,
  allColumns,
  search,
  statusFilter,
  onResetSearch,
  onResetFilter,
}: ReportTableProps) {
  const visibleColDefs = allColumns.filter((c) =>
    visibleColumns.includes(c.key),
  );

  return (
    <div className="flex-1 overflow-auto custom-scroll">
      <table className="w-full text-left border-separate border-spacing-0">
        <thead className="sticky top-0 bg-[#0f0f0f] z-10">
          <tr>
            {visibleColDefs.map((c, i) => {
              let alignClass = "text-left";
              if (c.align === "center") alignClass = "text-center";
              else if (c.align === "right") alignClass = "text-right";
              return (
                <th
                  key={c.key}
                  className={`px-4 py-4 border-b border-white/10 text-[10px] uppercase font-bold tracking-widest text-white/30 bg-[#0f0f0f] ${alignClass} ${i === 0 ? "rounded-tl-xl" : ""} ${i === visibleColDefs.length - 1 ? "rounded-tr-xl" : ""}`}
                >
                  {c.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="text-sm divide-y divide-white/5">
          {Object.keys(groupedRows).length === 0 ||
          Object.values(groupedRows).every((rows) => rows.length === 0) ? (
            <tr>
              <td colSpan={visibleColDefs.length} className="py-24">
                <div className="flex flex-col items-center justify-center text-center px-6">
                  {/* Icon with contextual pulse */}
                  <div className="relative mb-6">
                    <div className="w-20 h-20 rounded-3xl bg-white/[0.02] border border-white/5 flex items-center justify-center shadow-inner">
                      <i
                        className={`fa-solid ${search ? "fa-magnifying-glass-slash" : "fa-calendar-xmark"} text-3xl text-white/10`}
                      ></i>
                    </div>
                  </div>

                  <h3 className="text-base font-bold text-white/80 mb-2">
                    {search
                      ? `No matches for "${search}"`
                      : statusFilter !== "all"
                        ? `No results for "${statusFilter}"`
                        : "No results found"}
                  </h3>

                  <p className="text-xs text-white/30 max-w-[280px] mb-8 leading-relaxed">
                    {search
                      ? "We couldn't find anything matching your search. Try a different keyword."
                      : statusFilter !== "all"
                        ? `None of the records currently match the "${statusFilter}" filter.`
                        : "There are no attendance records for this period."}
                  </p>

                  <div className="flex items-center gap-3">
                    {search && (
                      <button
                        onClick={onResetSearch}
                        className="px-4 py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/20 transition-all text-xs font-bold uppercase tracking-wider"
                      >
                        Clear Search
                      </button>
                    )}
                    {statusFilter !== "all" && (
                      <button
                        onClick={onResetFilter}
                        className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white/50 hover:bg-white/10 hover:text-white transition-all text-xs font-bold uppercase tracking-wider"
                      >
                        Reset Filter
                      </button>
                    )}
                    {!search && statusFilter === "all" && (
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-[10px] text-white/20 font-black uppercase tracking-[0.2em] mb-2">
                          Suggestions
                        </span>
                        <div className="flex gap-2">
                          <span className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/5 text-[10px] text-white/40 font-bold">
                            Try Previous Week
                          </span>
                          <span className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/5 text-[10px] text-white/40 font-bold">
                            Expand Range
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </td>
            </tr>
          ) : (
            Object.entries(groupedRows).map(([groupInfo, rows]) => {
              if (rows.length === 0) return null;
              return (
                <Fragment key={groupInfo}>
                  {groupInfo !== "__all__" && (
                    <tr>
                      <td
                        colSpan={visibleColDefs.length}
                        className="px-4 py-3 bg-white/[0.03] border-b border-white/5"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-bold text-cyan-100/90 tracking-wide">
                            {groupInfo}
                          </span>
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-white/5 border border-white/5 text-[10px] text-white/40 font-medium">
                            {rows.length}{" "}
                            {rows.length === 1 ? "record" : "records"}
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                  {rows.map((row, rIdx) => (
                    <tr
                      key={rIdx}
                      className="group hover:bg-cyan-500/[0.03] transition-all duration-200 cursor-default"
                    >
                      {visibleColDefs.map((c, cIdx) => {
                        const val = row[c.key];
                        let content: React.ReactNode = val as string;

                        if (c.key === "status") {
                          const s = row.status;
                          let badgeClass =
                            "bg-white/5 text-white/40 border-white/10";
                          if (s === "present")
                            badgeClass =
                              "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
                          if (s === "absent")
                            badgeClass =
                              "bg-rose-500/10 text-rose-400 border-rose-500/20";
                          if (s === "no_records")
                            badgeClass =
                              "bg-white/[0.02] text-white/20 border-white/5";

                          content = (
                            <div
                              className={`inline-flex items-center px-2 py-1 rounded-lg text-[10px] uppercase tracking-wider font-bold border ${badgeClass} transition-transform group-hover:scale-105`}
                            >
                              {s === "no_records" ? "N/A" : s}
                            </div>
                          );
                        } else if (c.key === "is_late") {
                          content = row.is_late ? (
                            <div className="flex items-center gap-1.5 text-amber-400 font-bold text-[11px] uppercase tracking-tight">
                              <i className="fa-solid fa-clock text-[9px]"></i>
                              Late
                            </div>
                          ) : (
                            <span className="text-white/10">-</span>
                          );
                        } else if (c.key === "check_in_time") {
                          if (row.check_in_time) {
                            content = (
                              <div className="flex flex-col">
                                <span className="text-white/90 font-medium">
                                  {new Date(
                                    row.check_in_time,
                                  ).toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                                {row.is_late && row.late_minutes > 0 && (
                                  <span className="text-[10px] text-amber-500/70 font-bold uppercase mt-0.5">
                                    +{row.late_minutes}m
                                  </span>
                                )}
                              </div>
                            );
                          } else {
                            content = <span className="text-white/10">-</span>;
                          }
                        } else if (c.key === "late_minutes") {
                          content =
                            row.late_minutes > 0 ? (
                              <span className="text-amber-400 font-bold">
                                {row.late_minutes}m
                              </span>
                            ) : (
                              <span className="text-white/10">-</span>
                            );
                        } else if (c.key === "date") {
                          content = (
                            <span className="text-white/60 font-medium">
                              {new Date(row.date).toLocaleDateString(
                                undefined,
                                {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                },
                              )}
                            </span>
                          );
                        } else if (c.key === "name") {
                          content = (
                            <span className="text-white font-semibold">
                              {val as string}
                            </span>
                          );
                        }

                        // Cell alignment
                        let alignClass = "text-left";
                        if (c.align === "center") alignClass = "text-center";
                        else if (c.align === "right") alignClass = "text-right";

                        return (
                          <td
                            key={c.key}
                            className={`px-4 py-3.5 whitespace-nowrap border-b border-white/[0.04] ${alignClass} ${cIdx === 0 ? "relative" : ""}`}
                          >
                            {cIdx === 0 && (
                              <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-cyan-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                            )}
                            {content}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
