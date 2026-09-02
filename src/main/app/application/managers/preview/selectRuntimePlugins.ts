/**
 * Which plugin runtime entries a project runs, and a static check of the plugin
 * blueprint node / widget types it uses against them.
 *
 * The project dependency table (machine-derived, embedded in the .nlproj
 * manifest) is the authority on what the project actually uses. Selection rule:
 * hard dependencies run; enabled-but-unused plugins do not. Validation rule:
 * every blueprint node / widget type the project uses must have a selected
 * plugin that declares it in manifest contributes - otherwise the pack build
 * fails instead of the node/widget silently failing on a player's machine.
 *
 * ## One answer, not one per host
 *
 * A build, a preview, a test run and a Dev Mode session all ask the same
 * question, so they all ask this function. Dev Mode used to answer it for
 * itself, by loading every enabled runtime plugin - which made it the only
 * place where a plugin the project never declared still worked. An author who
 * dropped a plugin's node into a graph without the dependency table catching up
 * saw it run in Dev Mode and saw it die, silently, in the build. The whole
 * point of Dev Mode is that what happens there is what a player gets.
 */

import type {
    NormalizedPluginManifestV2,
    RuntimePluginExclusion,
    RuntimePluginExclusionReason,
} from "@shared/types/plugins";
import type { ProjectDependencyTable } from "@shared/types/pluginDependencies";
import { resolveDependencies, type InstalledPluginInfo } from "@shared/utils/resolveDependencies";
import type { GameRuntimePluginSource } from "./compiler/gameRuntimeArtifactCompiler";

/** The only thing selection reads off a candidate; a pack source and a Dev Mode descriptor both have it. */
export type RuntimePluginCandidate = { manifest: NormalizedPluginManifestV2 };

export type RuntimePluginSelection<T extends RuntimePluginCandidate> = {
    selected: T[];
    /** Enabled runtime plugins left out, with the reason each one was left out. */
    excluded: RuntimePluginExclusion[];
    /** Fail-the-build problems, human-readable. */
    errors: string[];
    /**
     * True when the project has no dependency table (never scanned): every
     * enabled runtime plugin is included as a conservative fallback.
     */
    fallbackAll: boolean;
};

/** The selection a pack is built from. */
export type RuntimePluginPackSelection = RuntimePluginSelection<GameRuntimePluginSource>;

export function selectProjectRuntimePlugins<T extends RuntimePluginCandidate>(input: {
    dependencies: ProjectDependencyTable | undefined;
    /** Enabled plugins with a runtime entry, from PluginManager. */
    available: T[];
    /** Every installed plugin (for version-compatibility resolution). */
    installed: InstalledPluginInfo[];
}): RuntimePluginSelection<T> {
    const { dependencies, available, installed } = input;
    if (!dependencies) {
        return {
            selected: [...available],
            excluded: [],
            errors: [],
            fallbackAll: true,
        };
    }

    const availableById = new Map(available.map(source => [source.manifest.id, source]));
    const resolution = resolveDependencies(dependencies, installed);
    const statusById = new Map(resolution.entries.map(entry => [entry.dependency.id, entry]));

    const errors: string[] = [];
    const selected: T[] = [];
    /** Ids the table depends on and selection still refused, so the reason is not read as "unused". */
    const unusable = new Set<string>();

    for (const dependency of dependencies.plugins) {
        if (!dependency.hard) {
            continue; // soft (data-only) dependencies have no runtime role
        }
        const requirements = [
            {
                kindLabel: "blueprint node(s)",
                used: dependency.usedBy.blueprintNode ?? [],
                declaredOf: (source: T) => source.manifest.contributes.blueprintNodes,
                contributesKey: "contributes.blueprintNodes",
            },
            {
                kindLabel: "widget(s)",
                used: dependency.usedBy.widget ?? [],
                declaredOf: (source: T) => source.manifest.contributes.widgets,
                contributesKey: "contributes.widgets",
            },
        ].filter(requirement => requirement.used.length > 0);
        const source = availableById.get(dependency.id);
        const entry = statusById.get(dependency.id);

        if (entry?.suppressed) {
            unusable.add(dependency.id);
            for (const requirement of requirements) {
                const detail = entry.status === "missing"
                    ? "is not installed"
                    : `is installed at incompatible version ${entry.installedVersion} (project authored against ${dependency.authoredVersion})`;
                errors.push(
                    `Plugin "${dependency.id}" provides ${requirement.kindLabel} used by this project ` +
                    `(${requirement.used.join(", ")}) but ${detail}.`,
                );
            }
            continue;
        }

        if (requirements.length > 0) {
            if (!source) {
                for (const requirement of requirements) {
                    errors.push(
                        `Plugin "${dependency.id}" provides ${requirement.kindLabel} used by this project ` +
                        `(${requirement.used.join(", ")}) but has no enabled runtime entry to package.`,
                    );
                }
                continue;
            }
            let valid = true;
            for (const requirement of requirements) {
                const declared = new Set(requirement.declaredOf(source));
                const missing = requirement.used.filter(type => !declared.has(type));
                if (missing.length > 0) {
                    valid = false;
                    errors.push(
                        `Plugin "${dependency.id}" does not declare runtime support for ${requirement.kindLabel}: ` +
                        `${missing.join(", ")} (add them to manifest ${requirement.contributesKey}).`,
                    );
                }
            }
            if (valid) {
                selected.push(source);
            } else {
                unusable.add(dependency.id);
            }
            continue;
        }

        // Hard dependency without recorded node/widget usage. Ship its runtime
        // entry when present - harmless and forward-compatible.
        if (source) {
            selected.push(source);
        }
    }

    const selectedIds = new Set(selected.map(source => source.manifest.id));
    const excluded: RuntimePluginExclusion[] = available
        .filter(source => !selectedIds.has(source.manifest.id))
        .map(source => {
            const reason: RuntimePluginExclusionReason = unusable.has(source.manifest.id)
                ? "unusable"
                : "notDeclared";
            return {
                pluginId: source.manifest.id,
                pluginName: source.manifest.name || source.manifest.id,
                reason,
            };
        });

    return {
        selected,
        excluded,
        errors,
        fallbackAll: false,
    };
}
