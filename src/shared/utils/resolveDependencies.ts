import type {
    DependencyResolutionEntry,
    DependencyStatus,
    ProjectDependencyResolution,
    ProjectDependencyTable,
} from "../types/pluginDependencies";
import { classifyCompatibility } from "./semver";

/** The subset of an installed plugin the resolver needs. Derived from PluginListItem. */
export interface InstalledPluginInfo {
    id: string;
    version: string;
    enabled: boolean;
}

/**
 * Resolve a project's recorded dependency table against the plugins currently
 * installed on this machine. Pure and side-effect free so it can be unit-tested
 * and reused on both the authoring and import sides.
 *
 * A dependency is *suppressed* (the plugin will be skipped for this project) only
 * when it is a hard dependency AND the plugin is missing or its installed major
 * version is incompatible with the one the project was authored against.
 */
export function resolveDependencies(
    table: ProjectDependencyTable,
    installed: InstalledPluginInfo[],
): ProjectDependencyResolution {
    const installedById = new Map(installed.map(plugin => [plugin.id, plugin] as const));

    const entries: DependencyResolutionEntry[] = table.plugins.map((dependency) => {
        const match = installedById.get(dependency.id);
        if (!match) {
            return {
                dependency,
                status: "missing" as DependencyStatus,
                suppressed: dependency.hard,
            };
        }

        const verdict = classifyCompatibility(dependency.authoredVersion, match.version);
        const status: DependencyStatus = verdict === "incompatible"
            ? "incompatible"
            : verdict === "outdated"
                ? "outdated"
                : "satisfied";

        return {
            dependency,
            installedVersion: match.version,
            installedEnabled: match.enabled,
            status,
            suppressed: dependency.hard && verdict === "incompatible",
        };
    });

    const suppressedPluginIds = Array.from(
        new Set(entries.filter(entry => entry.suppressed).map(entry => entry.dependency.id)),
    );

    const overall: ProjectDependencyResolution["overall"] = suppressedPluginIds.length > 0
        ? "blocked"
        : entries.some(entry => entry.status !== "satisfied")
            ? "warnings"
            : "ok";

    return { entries, suppressedPluginIds, overall };
}
