import { RecentlyOpenedProject } from "@shared/types/state/appStateTypes";
import { GlobalState, GlobalStateKeys } from "@shared/types/state/globalState";
import { normalizeProjectPath } from "@shared/utils/recentProject";

/** Fallback when the setting holds something unusable (absent, zero, negative, not a number). */
const DEFAULT_LIMIT = 10;

/**
 * The recently-opened history.
 *
 * Reads the list; the mutators only *compute* the next one and leave persisting to the caller,
 * which writes it through `App.setGlobalStateAndBroadcast`. That is deliberate: the history is
 * shared by every window, so a change has to reach all of them plus the native "Open Recent" menu,
 * and routing writes through the one broadcasting path is what makes that automatic. It also keeps
 * the read-modify-write in the main process, where it is atomic - a renderer that sends back a
 * whole array it read earlier would silently erase whatever happened in between.
 */
export class RecentlyOpened {
    private readonly key = "app.recentProjects" satisfies GlobalStateKeys;

    constructor(private readonly state: GlobalState) {
    }

    public list(): RecentlyOpenedProject[] {
        return this.state.getItem(this.key);
    }

    /** The history with `project` promoted to the front, deduped by path and trimmed to the limit. */
    public withProject({ name, path, icon, securityScopedBookmark }: RecentlyOpenedProject): RecentlyOpenedProject[] {
        const target = normalizeProjectPath(path);
        return [
            { path, name, icon, openedAt: Date.now(), securityScopedBookmark },
            ...this.list().filter(item => normalizeProjectPath(item.path) !== target),
        ].slice(0, this.limit());
    }

    /** The history without `projectPath`. */
    public without(projectPath: string): RecentlyOpenedProject[] {
        const target = normalizeProjectPath(projectPath);
        return this.list().filter(item => normalizeProjectPath(item.path) !== target);
    }

    private limit(): number {
        const configured = Number(this.state.getItem("workspace.recentProjectsLimit"));
        return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : DEFAULT_LIMIT;
    }
}
