import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import type { PluginListItem } from "@shared/types/plugins";
import type { PluginRegistryEntry } from "@shared/types/pluginRegistry";
import { forgetStoreIcon } from "./useStoreIcon";

/** How long a "done" line stays before the surface goes quiet again. */
const SUCCESS_LINGER_MS = 4000;

export type PluginCatalogTask =
  | { status: "idle"; message?: string }
  | { status: "working"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

/**
 * What the hosting surface wants done around a change, beyond what the main process does.
 *
 * The Launcher passes none: no window there is running the plugin, so writing the record IS the
 * whole change. The workspace passes both, because it has the plugin loaded and a record that
 * disagrees with what is executing is exactly the state the panel exists to prevent.
 *
 * `beforeDeactivate` runs before the plugin stops being available (disable, uninstall, and the
 * unload half of an update); `afterActivate` runs once it should be live again. Both may throw —
 * the caller reports it and continues, since the main-process half already succeeded.
 */
export interface PluginCatalogHooks {
  beforeDeactivate?: (pluginId: string) => Promise<void> | void;
  afterActivate?: (pluginId: string) => Promise<void> | void;
  /** A folder install landed. Both surfaces use it to show the list the new plugin is now in. */
  onLocalInstalled?: (pluginId: string) => void;
  /**
   * The installed set changed in a way the author asked for (installed, authorized, enabled,
   * disabled, updated, uninstalled). Fired once per successful operation, after the list has been
   * re-read; the workspace panel uses it to raise its restart hint.
   */
  onChanged?: (pluginId: string) => void;
}

export interface PluginCatalog {
  plugins: PluginListItem[];
  registry: PluginRegistryEntry[] | null;
  registryError: string | null;
  registryLoading: boolean;
  task: PluginCatalogTask;
  busy: boolean;
  /** Installed records and store entries, keyed by plugin id for cross-referencing. */
  installedById: Map<string, PluginListItem>;
  registryById: Map<string, PluginRegistryEntry>;
  /** Re-read the installed list only. */
  refresh: () => Promise<void>;
  /** Re-read both halves and drop cached store thumbnails. */
  refreshAll: () => void;
  setTask: (task: PluginCatalogTask) => void;
  installLocal: () => void;
  approve: (pluginId: string) => void;
  setEnabled: (pluginId: string, enabled: boolean) => void;
  uninstall: (pluginId: string) => void;
  /** Install a store entry, or update an installed plugin to the store's version. */
  installFromStore: (pluginId: string) => void;
  /** Run an arbitrary plugin operation through the same busy/report machinery. */
  runTask: (message: string, action: () => Promise<void>) => Promise<void>;
}

/**
 * The installed list, the store index, and every operation that changes either.
 *
 * Shared by the Launcher's Plugins tab and the workspace's Plugins panel. The two render very
 * differently — a full-width tab with rows and a modal, a narrow sidebar with a sub-page — but the
 * async choreography underneath is identical, and it is the part with the traps in it: install
 * chaining into the permission prompt, an update inheriting an unchanged grant, the store index
 * being what tells the *installed* list that an update exists.
 */
export function usePluginCatalog(hooks?: PluginCatalogHooks): PluginCatalog {
  const { t } = useTranslation();
  const [plugins, setPlugins] = useState<PluginListItem[]>([]);
  const [registry, setRegistry] = useState<PluginRegistryEntry[] | null>(null);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [task, setTask] = useState<PluginCatalogTask>({ status: "idle" });

  // Held in a ref so a surface may pass fresh closures every render without restarting anything.
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;

  const busy = task.status === "working";
  // Read through a ref inside callbacks: `busy` is captured at render, and two clicks in the same
  // frame would otherwise both see `false` and run.
  const busyRef = useRef(false);
  busyRef.current = busy;

  const refresh = useCallback(async () => {
    const result = await getInterface().plugins.list();
    if (!result.success) {
      setTask({ status: "error", message: result.error ?? t("plugins.error.load") });
      return;
    }
    setPlugins(result.data.plugins);
  }, [t]);

  const refreshRegistry = useCallback(async () => {
    setRegistryLoading(true);
    setRegistryError(null);
    try {
      const result = await getInterface().plugins.registryFetch();
      if (!result.success) {
        setRegistry(null);
        setRegistryError(result.error ?? t("plugins.error.registry"));
        return;
      }
      setRegistry(result.data.index.plugins);
    } finally {
      setRegistryLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Fetch the store index as soon as the surface is open, not when a Store segment is first
  // selected: the installed list needs the same index to mark updates, and gating the fetch on
  // that segment made every update invisible to anyone who never went looking for one. A manual
  // refresh or retry clears `registry`/`registryError` to trigger this again.
  useEffect(() => {
    if (registry === null && !registryError && !registryLoading) {
      void refreshRegistry();
    }
  }, [registry, registryError, registryLoading, refreshRegistry]);

  // A success is news for a moment and clutter after it. Failures stay: the author has to be able
  // to read one that arrived while they were looking elsewhere.
  useEffect(() => {
    if (task.status !== "success") {
      return;
    }
    const timer = setTimeout(() => {
      setTask((current) => (current.status === "success" ? { status: "idle" } : current));
    }, SUCCESS_LINGER_MS);
    return () => clearTimeout(timer);
  }, [task]);

  const runTask = useCallback(async (message: string, action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setTask({ status: "working", message });
    try {
      await action();
    } catch (error) {
      setTask({ status: "error", message: getErrorMessage(error) });
    }
  }, []);

  /** Refresh means both halves: the installed list's update markers are only as fresh as the index. */
  const refreshAll = useCallback(() => {
    void refresh();
    setRegistry(null);
    setRegistryError(null);
    // Main gives previously-unreachable thumbnails another chance on a registry fetch; drop our
    // own memo so we actually ask it again.
    plugins.forEach((plugin) => forgetStoreIcon(plugin.pluginId));
    (registry ?? []).forEach((entry) => forgetStoreIcon(entry.id));
  }, [plugins, refresh, registry]);

  const installLocal = useCallback(
    () =>
      void runTask(t("plugins.task.installing"), async () => {
        const result = await getInterface().plugins.installLocal();
        if (!result.success) {
          throw new Error(result.error ?? t("plugins.error.install"));
        }
        if (result.data.canceled) {
          setTask({ status: "idle" });
          return;
        }
        await refresh();
        if (result.data.plugin.status === "enabled") {
          await hooksRef.current?.afterActivate?.(result.data.plugin.pluginId);
        }
        hooksRef.current?.onLocalInstalled?.(result.data.plugin.pluginId);
        hooksRef.current?.onChanged?.(result.data.plugin.pluginId);
        setTask({ status: "success", message: t("plugins.task.installed") });
      }),
    [refresh, runTask, t]
  );

  const approve = useCallback(
    (pluginId: string) =>
      void runTask(t("plugins.task.authorizing"), async () => {
        const result = await getInterface().plugins.approve(pluginId);
        if (!result.success) {
          throw new Error(result.error ?? t("plugins.error.approve"));
        }
        await refresh();
        if (result.data.approved) {
          await hooksRef.current?.afterActivate?.(pluginId);
          hooksRef.current?.onChanged?.(pluginId);
        }
        setTask({
          status: result.data.approved ? "success" : "idle",
          message: result.data.approved ? t("plugins.task.authorized") : ""
        });
      }),
    [refresh, runTask, t]
  );

  const setEnabled = useCallback(
    (pluginId: string, enabled: boolean) =>
      void runTask(enabled ? t("plugins.task.enabling") : t("plugins.task.disabling"), async () => {
        // Stop it before the record says it is off, so the window is never running a plugin the
        // records disown. Enabling is the mirror: write first, then start.
        if (!enabled) {
          await hooksRef.current?.beforeDeactivate?.(pluginId);
        }
        const result = await getInterface().plugins.setEnabled(pluginId, enabled);
        if (!result.success) {
          // The record refused the change, so the plugin we just stopped is still supposed to
          // be running. Put it back rather than leaving the window and the record disagreeing
          // in the other direction - a silently-unloaded plugin reads as a broken one.
          if (!enabled) {
            await restoreQuietly(hooksRef.current, pluginId);
          }
          throw new Error(result.error ?? t("plugins.error.update"));
        }
        await refresh();
        if (enabled) {
          await hooksRef.current?.afterActivate?.(pluginId);
        }
        hooksRef.current?.onChanged?.(pluginId);
        setTask({
          status: "success",
          message: enabled ? t("plugins.task.enabled") : t("plugins.task.disabled")
        });
      }),
    [refresh, runTask, t]
  );

  const uninstall = useCallback(
    (pluginId: string) =>
      void runTask(t("plugins.task.uninstalling"), async () => {
        await hooksRef.current?.beforeDeactivate?.(pluginId);
        const result = await getInterface().plugins.uninstall(pluginId);
        if (!result.success) {
          // Still installed, so it should still be running - see the note in `setEnabled`.
          await restoreQuietly(hooksRef.current, pluginId);
          throw new Error(result.error ?? t("plugins.error.uninstall"));
        }
        await refresh();
        hooksRef.current?.onChanged?.(pluginId);
        setTask({ status: "success", message: t("plugins.task.uninstalled") });
      }),
    [refresh, runTask, t]
  );

  // Install (or update) from the store, then chain straight into the permission prompt so
  // browse → install → authorize is one gesture. An update that widens no permission inherits the
  // grant it already has and skips the prompt entirely — asking again for an unchanged permission
  // set is friction with nothing behind it.
  const installFromStore = useCallback(
    (pluginId: string) =>
      void runTask(t("plugins.task.downloading"), async () => {
        // An update replaces code that may already be running here; the old copy goes first.
        await hooksRef.current?.beforeDeactivate?.(pluginId);
        const result = await getInterface().plugins.installFromRegistry(pluginId);
        if (!result.success) {
          throw new Error(result.error ?? t("plugins.error.download"));
        }
        if (result.data.canceled) {
          setTask({ status: "idle" });
          return;
        }
        // The installed package now carries its own icon, and main dropped the one it had cached
        // for the version that just moved.
        forgetStoreIcon(pluginId);
        await refresh();
        if (result.data.plugin.status !== "needsAuthorization") {
          if (result.data.plugin.status === "enabled") {
            await hooksRef.current?.afterActivate?.(pluginId);
          }
          hooksRef.current?.onChanged?.(pluginId);
          setTask({ status: "success", message: t("plugins.task.installed") });
          return;
        }
        const approval = await getInterface().plugins.approve(pluginId);
        if (!approval.success) {
          throw new Error(approval.error ?? t("plugins.error.approve"));
        }
        await refresh();
        if (approval.data.approved) {
          await hooksRef.current?.afterActivate?.(pluginId);
        }
        hooksRef.current?.onChanged?.(pluginId);
        setTask({
          status: approval.data.approved ? "success" : "idle",
          message: approval.data.approved ? t("plugins.task.installed") : ""
        });
      }),
    [refresh, runTask, t]
  );

  const registryById = useMemo(() => {
    const map = new Map<string, PluginRegistryEntry>();
    (registry ?? []).forEach((entry) => map.set(entry.id, entry));
    return map;
  }, [registry]);

  const installedById = useMemo(() => {
    const map = new Map<string, PluginListItem>();
    plugins.forEach((plugin) => map.set(plugin.pluginId, plugin));
    return map;
  }, [plugins]);

  return {
    plugins,
    registry,
    registryError,
    registryLoading,
    task,
    busy,
    installedById,
    registryById,
    refresh,
    refreshAll,
    setTask,
    installLocal,
    approve,
    setEnabled,
    uninstall,
    installFromStore,
    runTask
  };
}

/** Filter an installed list by a free-text query over name, id, and publisher. */
export function filterInstalled(plugins: PluginListItem[], query: string): PluginListItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return plugins;
  return plugins.filter(
    (plugin) =>
      plugin.manifest.name.toLowerCase().includes(q) ||
      plugin.pluginId.toLowerCase().includes(q) ||
      (plugin.manifest.publisher ?? "").toLowerCase().includes(q)
  );
}

/** Filter store entries by a free-text query over name, id, publisher, and description. */
export function filterStore(entries: PluginRegistryEntry[], query: string): PluginRegistryEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    (entry) =>
      entry.name.toLowerCase().includes(q) ||
      entry.id.toLowerCase().includes(q) ||
      entry.publisher.toLowerCase().includes(q) ||
      entry.description.toLowerCase().includes(q)
  );
}

/**
 * Put back a plugin that was stopped for an operation the main process then refused. Best effort by
 * design: the error worth reporting is the one that caused the rollback, not a failure to undo it.
 */
async function restoreQuietly(
  hooks: PluginCatalogHooks | undefined,
  pluginId: string
): Promise<void> {
  try {
    await hooks?.afterActivate?.(pluginId);
  } catch (error) {
    console.error(`[plugins] failed to restore ${pluginId} after a rejected change:`, error);
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
