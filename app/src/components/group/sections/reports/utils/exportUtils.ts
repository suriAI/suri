import type {
  RowData,
  ColumnKey,
} from "@/components/group/sections/reports/types";
import { parseLocalDate } from "@/utils";

export function exportReportToCSV(
  groupedRows: Record<string, RowData[]>,
  visibleColumns: ColumnKey[],
  allColumns: ReadonlyArray<{ key: ColumnKey; label: string }>,
  groupName: string,
  startDate: string,
  endDate: string,
) {
  try {
    const pad = (n: number, len: number = 2) => String(n).padStart(len, "0");
    const formatLocalDateTime = (d: Date): string => {
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };

    const sanitizeFilename = (name: string): string =>
      name.replace(/[\\/:*?"<>|]/g, "_").trim();

    const cols = allColumns.filter((c) => visibleColumns.includes(c.key));
    const header = cols.map((c) => c.label);
    const rows: string[][] = [];
    Object.values(groupedRows).forEach((groupArr) => {
      groupArr.forEach((r) => {
        const row = cols.map((c) => {
          const v = (r as RowData)[c.key];
          if (typeof v === "boolean") return v ? "true" : "false";
          if (typeof v === "number") return String(v);
          if (v instanceof Date) return formatLocalDateTime(v);
          return v ?? "";
        });
        rows.push(row);
      });
    });

    const csvContent = [header, ...rows]
      .map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
      )
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    let appended = false;

    try {
      anchor.href = url;

    const formatDateForFilename = (dateString: string): string => {
      const date = parseLocalDate(dateString);
      const month = date.toLocaleString("en-US", { month: "long" });
      const day = date.getDate();
      const year = date.getFullYear();
      return `${month} ${day}, ${year}`;
    };

    const formattedStartDate = formatDateForFilename(startDate);
    const formattedEndDate = formatDateForFilename(endDate);

    const dateRange =
      startDate === endDate
        ? formattedStartDate
        : `${formattedStartDate} to ${formattedEndDate}`;

      anchor.download = sanitizeFilename(`${groupName} (${dateRange}).csv`);
      document.body.appendChild(anchor);
      appended = true;
      anchor.click();
    } finally {
      if (appended) {
        document.body.removeChild(anchor);
      }
      URL.revokeObjectURL(url);
    }
    return { success: true };
  } catch (err) {
    console.error("Error exporting view:", err);
    return { success: false, error: err };
  }
}
