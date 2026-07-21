/**
 * Per-project plugin dependency table.
 *
 * A project records which plugins its documents depend on, bound by plugin id,
 * so the dependency survives export/import ({@link file://../utils/projectPackage.ts})
 * and so Studio can resolve compatibility when a built-in plugin's version
 * changes across an app update. The table is embedded in the `.nlproj`
 * manifest (`ProjectConfig.dependencies`) and is machine-managed: it is derived
 * by scanning the project's actual plugin usage, never hand-authored.
 */

export const PROJECT_DEPENDENCY_SCHEMA_VERSION = 1;

/** The extension points a project can depend on a plugin through. */
export type DependencyKind = "blueprintNode" | "widget" | "storage" | "storyAction";

export interface ProjectPluginDependency {
    /** Namespaced plugin id, e.g. `narraleaf.gallery`. */
    id: string;
    /** Display name captured at authoring time; a fallback when the plugin is absent. */
    name?: string;
    publisher?: string;
    /** True when the plugin ships with Studio (its version is tied to the app version). */
    builtIn: boolean;
    /** Exact plugin version installed when the table was last recorded. */
    authoredVersion: string;
    /**
     * True when the project references a *type* owned by the plugin (blueprint
     * node / widget / story action) - the document breaks if the plugin is
     * absent, so a missing/incompatible hard dependency is suppressed. Soft
     * dependencies (storage data only) are informational.
     */
    hard: boolean;
    /** What references the plugin, keyed by kind - ids/types/namespaces, for display. */
    usedBy: Partial<Record<DependencyKind, string[]>>;
}

export interface ProjectDependencyTable {
    schemaVersion: number;
    /** Sorted by id for stable manifest diffs. */
    plugins: ProjectPluginDependency[];
}

// --- Resolution (computed at project open; not persisted) ---------------------

export type DependencyStatus = "satisfied" | "outdated" | "missing" | "incompatible";

export interface DependencyResolutionEntry {
    dependency: ProjectPluginDependency;
    /** Version currently installed for this plugin id, or undefined when absent. */
    installedVersion?: string;
    /** True when the installed plugin is enabled and eligible to load. */
    installedEnabled?: boolean;
    status: DependencyStatus;
    /** True when this dependency causes the plugin to be suppressed for the project. */
    suppressed: boolean;
}

export interface ProjectDependencyResolution {
    entries: DependencyResolutionEntry[];
    suppressedPluginIds: string[];
    overall: "ok" | "warnings" | "blocked";
}

export function createEmptyDependencyTable(): ProjectDependencyTable {
    return { schemaVersion: PROJECT_DEPENDENCY_SCHEMA_VERSION, plugins: [] };
}

/**
 * Coerce an untrusted value (e.g. a field read from a project manifest that may
 * be malformed or written by a future Studio version) into a well-formed
 * dependency table, or `undefined` when it is not a table at all. Never throws:
 * a broken table must not block loading the project.
 */
export function normalizeProjectDependencyTable(value: unknown): ProjectDependencyTable | undefined {
    if (!isRecord(value) || !Array.isArray(value.plugins)) {
        return undefined;
    }

    const plugins: ProjectPluginDependency[] = [];
    for (const raw of value.plugins) {
        const entry = normalizeDependency(raw);
        if (entry) {
            plugins.push(entry);
        }
    }
    plugins.sort((a, b) => a.id.localeCompare(b.id));

    const schemaVersion = typeof value.schemaVersion === "number" && Number.isFinite(value.schemaVersion)
        ? value.schemaVersion
        : PROJECT_DEPENDENCY_SCHEMA_VERSION;

    return { schemaVersion, plugins };
}

const DEPENDENCY_KINDS: DependencyKind[] = ["blueprintNode", "widget", "storage", "storyAction"];

function normalizeDependency(value: unknown): ProjectPluginDependency | null {
    if (!isRecord(value)) {
        return null;
    }
    const id = typeof value.id === "string" ? value.id.trim() : "";
    const authoredVersion = typeof value.authoredVersion === "string" ? value.authoredVersion.trim() : "";
    if (!id || !authoredVersion) {
        return null;
    }

    const usedBy: Partial<Record<DependencyKind, string[]>> = {};
    if (isRecord(value.usedBy)) {
        for (const kind of DEPENDENCY_KINDS) {
            const list = value.usedBy[kind];
            if (Array.isArray(list)) {
                const ids = Array.from(new Set(list.filter((item): item is string => typeof item === "string"))).sort();
                if (ids.length > 0) {
                    usedBy[kind] = ids;
                }
            }
        }
    }

    return {
        id,
        authoredVersion,
        builtIn: value.builtIn === true,
        hard: value.hard === true,
        ...(typeof value.name === "string" && value.name.trim() ? { name: value.name.trim() } : {}),
        ...(typeof value.publisher === "string" && value.publisher.trim() ? { publisher: value.publisher.trim() } : {}),
        usedBy,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
