import { useCallback, useMemo, useSyncExternalStore } from "react";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { Service } from "@/lib/workspace/services/Service";
import { ProjectDependencyService } from "@/lib/workspace/services/core/ProjectDependencyService";
import {
  workspacePluginSession,
  type WorkspacePluginActivity
} from "@/lib/plugins/workspacePluginSession";
import type { PluginListItem } from "@shared/types/plugins";
import { useWorkspace } from "../../context";

/**
 * What a plugin is doing in THIS window, as one word the panel can render.
 *
 * `running` is the quiet default and says nothing in the list; the rest each explain a plugin that
 * is installed and switched on yet contributing nothing to the editor, which is precisely the state
 * an author would otherwise file as "the plugin is broken".
 */
export type PluginActivity =
  /** Loaded here, contributing. */
  | "running"
  /** Ships no `studio` entry: it extends the running game only, so there is nothing to load here. */
  | "runtimeOnly"
  /** Held back by this project's dependency table (major-version mismatch). */
  | "suppressed"
  /** Tried to load in this window and threw. */
  | "failed"
  /** Enabled, has a studio entry, and still is not up - a recovery window, or a change awaiting a reopen. */
  | "stopped"
  /** Switched off (or not yet authorized) in the installed record; nothing to say about this window. */
  | "off";

export interface WorkspacePluginActivityState {
  /** Live session state: what is loaded, what failed. */
  session: WorkspacePluginActivity;
  /** Plugin ids this project's dependency resolution refuses to load. */
  suppressed: ReadonlySet<string>;
  activityOf: (plugin: PluginListItem) => PluginActivity;
}

const EMPTY_ACTIVITY: WorkspacePluginActivity = { running: [], failed: {} };
const NO_SUPPRESSION: ReadonlySet<string> = new Set<string>();

/**
 * A workspace service, or null when this window does not have it.
 *
 * A recovery window registers the plugins panel deliberately - switching a misbehaving plugin off is
 * most of why anyone opens one - and a recovery window is exactly the one whose services may have
 * failed to initialize. Asking for one that is not there must return "no answer", not throw inside
 * a panel body.
 */
function serviceOrNull<T extends Service>(
  ctx: WorkspaceContext | null,
  service: Services
): T | null {
  if (!ctx) {
    return null;
  }
  try {
    return ctx.services.get<T>(service) ?? null;
  } catch {
    return null;
  }
}

export function useWorkspacePluginActivity(): WorkspacePluginActivityState {
  const { context, recovery } = useWorkspace();

  const session = useSyncExternalStore(
    useCallback(
      (listener: () => void) =>
        context ? workspacePluginSession(context).subscribe(listener) : () => {},
      [context]
    ),
    useCallback(
      () => (context ? workspacePluginSession(context).getActivity() : EMPTY_ACTIVITY),
      [context]
    )
  );

  const dependencies = useMemo(
    () => serviceOrNull<ProjectDependencyService>(context, Services.ProjectDependency),
    [context]
  );

  // The resolution OBJECT, not `getSuppressedPluginIds()`: that one builds a fresh `[]` whenever
  // nothing has resolved yet, and a snapshot with a new identity on every call is what makes
  // `useSyncExternalStore` re-render forever.
  const resolution = useSyncExternalStore(
    useCallback(
      (listener: () => void) => dependencies?.onResolutionChanged(listener) ?? (() => {}),
      [dependencies]
    ),
    useCallback(() => dependencies?.getResolution() ?? null, [dependencies])
  );

  const suppressed = useMemo<ReadonlySet<string>>(
    () =>
      resolution?.suppressedPluginIds.length
        ? new Set(resolution.suppressedPluginIds)
        : NO_SUPPRESSION,
    [resolution]
  );

  const running = useMemo(() => new Set(session.running), [session.running]);

  const activityOf = useCallback(
    (plugin: PluginListItem): PluginActivity => {
      if (plugin.status !== "enabled") {
        return "off";
      }
      if (running.has(plugin.pluginId)) {
        return "running";
      }
      if (session.failed[plugin.pluginId]) {
        return "failed";
      }
      if (suppressed.has(plugin.pluginId)) {
        return "suppressed";
      }
      if (!plugin.manifest.entries.studio) {
        return "runtimeOnly";
      }
      // Recovery windows load nothing on purpose; everything else here is a plugin whose record
      // says it should be up and whose code is not, which the panel offers a reload for.
      return recovery ? "off" : "stopped";
    },
    [recovery, running, session.failed, suppressed]
  );

  return { session, suppressed, activityOf };
}
