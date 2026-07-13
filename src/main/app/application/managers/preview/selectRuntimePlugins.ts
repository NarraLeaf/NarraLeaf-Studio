/**
 * Selects which plugin runtime entries ship inside a game pack and statically
 * validates the project's plugin blueprint node usage against them.
 *
 * The project dependency table (machine-derived, embedded in the .nlproj
 * manifest) is the authority on what the project actually uses. Packing rule:
 * hard dependencies ship; enabled-but-unused plugins do not. Validation rule:
 * every blueprint node type the project uses must have a shipping plugin that
 * declares it in manifest contributes.blueprintNodes — otherwise the pack
 * build fails instead of the node silently failing on a player's machine.
 */

import type { ProjectDependencyTable } from "@shared/types/pluginDependencies";
import { resolveDependencies, type InstalledPluginInfo } from "@shared/utils/resolveDependencies";
import type { GameRuntimePluginSource } from "./compiler/gameRuntimeArtifactCompiler";

export type RuntimePluginPackSelection = {
    selected: GameRuntimePluginSource[];
    /** Enabled runtime plugins excluded because the project does not depend on them. */
    skippedPluginIds: string[];
    /** Fail-the-build problems, human-readable. */
    errors: string[];
    /**
     * True when the project has no dependency table (never scanned): every
     * enabled runtime plugin is included as a conservative fallback.
     */
    fallbackAll: boolean;
};

export function selectRuntimePluginsForPack(input: {
    dependencies: ProjectDependencyTable | undefined;
    /** Enabled plugins with a runtime entry, from PluginManager. */
    available: GameRuntimePluginSource[];
    /** Every installed plugin (for version-compatibility resolution). */
    installed: InstalledPluginInfo[];
}): RuntimePluginPackSelection {
    const { dependencies, available, installed } = input;
    if (!dependencies) {
        return {
            selected: [...available],
            skippedPluginIds: [],
            errors: [],
            fallbackAll: true,
        };
    }

    const availableById = new Map(available.map(source => [source.manifest.id, source]));
    const resolution = resolveDependencies(dependencies, installed);
    const statusById = new Map(resolution.entries.map(entry => [entry.dependency.id, entry]));

    const errors: string[] = [];
    const selected: GameRuntimePluginSource[] = [];

    for (const dependency of dependencies.plugins) {
        if (!dependency.hard) {
            continue; // soft (data-only) dependencies have no runtime role
        }
        const usedNodes = dependency.usedBy.blueprintNode ?? [];
        const source = availableById.get(dependency.id);
        const entry = statusById.get(dependency.id);

        if (entry?.suppressed) {
            if (usedNodes.length > 0) {
                const detail = entry.status === "missing"
                    ? "is not installed"
                    : `is installed at incompatible version ${entry.installedVersion} (project authored against ${dependency.authoredVersion})`;
                errors.push(
                    `Plugin "${dependency.id}" provides blueprint node(s) used by this project ` +
                    `(${usedNodes.join(", ")}) but ${detail}.`,
                );
            }
            continue;
        }

        if (usedNodes.length > 0) {
            if (!source) {
                errors.push(
                    `Plugin "${dependency.id}" provides blueprint node(s) used by this project ` +
                    `(${usedNodes.join(", ")}) but has no enabled runtime entry to package.`,
                );
                continue;
            }
            const declared = new Set(source.manifest.contributes.blueprintNodes);
            const missing = usedNodes.filter(type => !declared.has(type));
            if (missing.length > 0) {
                errors.push(
                    `Plugin "${dependency.id}" does not declare runtime support for blueprint node(s): ` +
                    `${missing.join(", ")} (add them to manifest contributes.blueprintNodes).`,
                );
                continue;
            }
            selected.push(source);
            continue;
        }

        // Hard dependency without recorded node usage (e.g. widgets). Ship its
        // runtime entry when present — harmless and forward-compatible.
        if (source) {
            selected.push(source);
        }
    }

    const selectedIds = new Set(selected.map(source => source.manifest.id));
    const skippedPluginIds = available
        .filter(source => !selectedIds.has(source.manifest.id))
        .map(source => source.manifest.id);

    return { selected, skippedPluginIds, errors, fallbackAll: false };
}
