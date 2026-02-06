import { useState, useEffect, useMemo } from "react";
import { persistentSettings } from "@/services/PersistentSettingsService";
import type { DialogAPI } from "@/components/shared";
import type {
  SavedViewConfig,
  ColumnKey,
  GroupByKey,
  ReportStatusFilter,
} from "@/components/group/sections/reports/types";

export function useReportViews(
  groupId: string,
  defaultColumns: ColumnKey[],
  dialog?: Pick<DialogAPI, "confirm">,
) {
  const [views, setViews] = useState<SavedViewConfig[]>([]);
  const [activeViewIndex, setActiveViewIndex] = useState<number | null>(null);
  const [defaultViewName, setDefaultViewName] = useState<string | null>(null);

  // Current view state
  const [visibleColumns, setVisibleColumns] =
    useState<ColumnKey[]>(defaultColumns);
  const [groupBy, setGroupBy] = useState<GroupByKey>("none");
  const [statusFilter, setStatusFilter] = useState<ReportStatusFilter>("all");
  const [search, setSearch] = useState<string>("");

  // Track if we are currently loading state to avoid overwriting during init
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    const loadViews = async () => {
      try {
        const parsed = (await persistentSettings.getReportViews(
          groupId,
        )) as SavedViewConfig[];
        setViews(parsed);
        const storedDefaultName =
          await persistentSettings.getReportDefaultViewName(groupId);
        setDefaultViewName(storedDefaultName);

        if (parsed.length > 0) {
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

          // Legacy check
          const filterValue = Array.isArray(v.statusFilter)
            ? v.statusFilter.length === 0
              ? "all"
              : (v.statusFilter[0] as ReportStatusFilter)
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
        setViews([]);
        setActiveViewIndex(null);
      } finally {
        setIsInitializing(false);
      }
    };
    loadViews();
  }, [groupId, defaultColumns]);

  // Load Scratchpad (Unsaved tweaks)
  useEffect(() => {
    if (activeViewIndex === null) {
      persistentSettings
        .getReportScratchpad(groupId)
        .then((scratch: unknown) => {
          const s = (scratch || null) as null | Partial<{
            columns: unknown;
            groupBy: unknown;
            statusFilter: unknown;
          }>;
          if (!s) return;

          if (s.columns) setVisibleColumns(s.columns as ColumnKey[]);
          if (s.groupBy) setGroupBy(s.groupBy as GroupByKey);
          if (s.statusFilter)
            setStatusFilter(s.statusFilter as ReportStatusFilter);
        });
    }
  }, [groupId, activeViewIndex]);

  // Save Scratchpad
  useEffect(() => {
    if (!isInitializing && activeViewIndex === null) {
      persistentSettings
        .setReportScratchpad(groupId, {
          columns: visibleColumns,
          groupBy,
          statusFilter,
        })
        .catch(console.error);
    }
  }, [
    groupId,
    activeViewIndex,
    visibleColumns,
    groupBy,
    statusFilter,
    isInitializing,
  ]);

  const saveViewsToStorage = (next: SavedViewConfig[]) => {
    setViews(next);
    persistentSettings.setReportViews(groupId, next).catch(console.error);
  };

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
    return (
      !arraysEqualUnordered(current.columns, defaultColumns) ||
      current.groupBy !== "none" ||
      current.statusFilter !== "all" ||
      current.search !== ""
    );
  }, [
    visibleColumns,
    groupBy,
    statusFilter,
    search,
    activeViewIndex,
    views,
    defaultColumns,
  ]);

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

  const handleDeleteView = async () => {
    if (activeViewIndex === null) return;
    const name = views[activeViewIndex]?.name || "";

    if (dialog) {
      const ok = await dialog.confirm({
        title: "Delete view",
        message: `Delete view "${name}"?`,
        confirmText: "Delete",
        cancelText: "Cancel",
        confirmVariant: "danger",
      });
      if (!ok) return;
    } else {
      if (!confirm(`Delete view "${name}"?`)) return;
    }

    const next = views.filter((_, idx) => idx !== activeViewIndex);
    saveViewsToStorage(next);

    // If deleted, try to select 0 or null
    if (next.length > 0) {
      setActiveViewIndex(0);
      // Apply the new active view
      const v = next[0];
      setVisibleColumns(v.columns);
      setGroupBy(v.groupBy);
      setStatusFilter(v.statusFilter as ReportStatusFilter);
      setSearch(v.search);
      setDefaultViewName(v.name);
      persistentSettings
        .setReportDefaultViewName(groupId, v.name)
        .catch(console.error);
    } else {
      setActiveViewIndex(null);
      setVisibleColumns(defaultColumns);
      setGroupBy("none");
      setStatusFilter("all");
      setSearch("");
      setDefaultViewName(null);
      persistentSettings
        .setReportDefaultViewName(groupId, null)
        .catch(console.error);
    }
  };

  const handleViewChange = (idx: number | null) => {
    setActiveViewIndex(idx);
    if (idx !== null) {
      const v = views[idx];
      if (v) {
        setVisibleColumns(v.columns);
        setGroupBy(v.groupBy);
        setStatusFilter(v.statusFilter as ReportStatusFilter);
        setSearch(v.search);

        setDefaultViewName(v.name);
        persistentSettings
          .setReportDefaultViewName(groupId, v.name)
          .catch(console.error);
      }
    } else {
      setVisibleColumns(defaultColumns);
      setGroupBy("none");
      setStatusFilter("all");
      setSearch("");
      setDefaultViewName(null);
      persistentSettings
        .setReportDefaultViewName(groupId, null)
        .catch(console.error);
    }
  };

  return {
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
  };
}
