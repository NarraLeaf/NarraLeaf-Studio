/**
 * What has to happen for one recorded dependency to become a plugin this project can actually use.
 *
 * The dependency table says what the project needs; {@link resolveDependencies} says what state
 * that need is in. Neither says what to do about it, and the three answers are genuinely
 * different: a plugin that is absent has to be installed, one the author switched off has to be
 * enabled, one at the wrong major has to be updated. A screen that offered a single button for all
 * three would be wrong twice out of three times.
 *
 * Pure, and separate from the surface that renders it, because the same verdict decides two things
 * that must not disagree: which control a row carries, and what the one-press run does.
 */

import type { DependencyResolutionEntry } from "@shared/types/pluginDependencies";
import type { PluginRegistryEntry } from "@shared/types/pluginRegistry";
import type { PluginStatus } from "@shared/types/plugins";
import { classifyCompatibility, compareSemver, satisfiesRange } from "@shared/utils/semver";

/** One operation, in the order it has to be applied. */
export type DependencyRemedyStep = "install" | "update" | "authorize" | "enable";

/**
 * Why a row cannot be put right here.
 *
 * A dependency names a plugin id, and nothing guarantees such a plugin exists: the project may
 * have been authored against a plugin installed from a folder, or one that was never published.
 * The row says so rather than carrying a button whose only outcome is a failure.
 */
export type DependencyRemedyObstacle =
    /** The registry index carries no plugin under this id. */
    | "notInRegistry"
    /** The registry has it, but declares a Studio range this build is outside of. */
    | "needsStudio"
    /** The registry's version is not one this project can use - typically a newer major. */
    | "noCompatibleVersion"
    /** The registry has not been read, so nothing about availability can be stated yet. */
    | "registryUnavailable";

export interface DependencyRemedy {
    steps: DependencyRemedyStep[];
    obstacle?: DependencyRemedyObstacle;
    /** The range the registry entry declares; carried so the row can name it. */
    studioRange?: string;
}

export interface DependencyRemedyInput {
    entry: DependencyResolutionEntry;
    /** The store index's entry for this plugin id, or null when the index does not carry one. */
    registryEntry: PluginRegistryEntry | null;
    /** False until the store index has been read; the registry cannot be spoken for before that. */
    registryKnown: boolean;
    /** Version of the running Studio, tested against the entry's declared range. */
    studioVersion: string;
    /**
     * The installed record's own status, where there is one.
     *
     * A plugin waiting for authorization is installed, switched on and at the right version, so
     * the version verdict has nothing to say about it - and it still loads nothing. It is the
     * state an author lands in by closing the permission prompt, which is one press away from
     * every install this screen makes.
     */
    installedStatus?: PluginStatus;
}

/** True when the remedy is something this screen can actually carry out. */
export function isActionable(remedy: DependencyRemedy): boolean {
    return remedy.steps.length > 0;
}

/**
 * Plan the remedy for one dependency.
 *
 * Update comes before enable, and both may be planned for the same row: a plugin at an
 * incompatible version is withheld from the project whatever its switch says, so switching it on
 * first would change nothing the author could see.
 */
export function planDependencyRemedy(input: DependencyRemedyInput): DependencyRemedy {
    const { entry, registryEntry, registryKnown, studioVersion } = input;
    const installedVersion = entry.installedVersion;

    if (!installedVersion) {
        if (!registryKnown) {
            return { steps: [], obstacle: "registryUnavailable" };
        }
        if (!registryEntry) {
            return { steps: [], obstacle: "notInRegistry" };
        }
        if (!satisfiesRange(studioVersion, registryEntry.studioVersion)) {
            return { steps: [], obstacle: "needsStudio", studioRange: registryEntry.studioVersion };
        }
        return { steps: ["install"] };
    }

    const steps: DependencyRemedyStep[] = [];
    if (entry.status === "incompatible" || entry.status === "outdated") {
        const update = planUpdate(input, installedVersion);
        if (update.obstacle) {
            // An outdated plugin still loads and still works, so an unreachable registry is not
            // worth reporting on its row - it is reported once, for the panel. An incompatible one
            // is withheld from the project, so the row has to say why nothing can be done.
            if (entry.status === "incompatible") {
                return update;
            }
        } else {
            steps.push("update");
        }
    }

    // Reached only when the version is either right or about to be: every path above that leaves an
    // incompatible version in place has returned an obstacle.
    //
    // An install carries its own permission prompt, so a row that is about to be installed or
    // updated is not also asked to authorize: that would prompt twice for one grant.
    if (input.installedStatus === "needsAuthorization" && steps.length === 0) {
        steps.push("authorize");
    }
    if (entry.installedEnabled === false) {
        steps.push("enable");
    }

    return { steps };
}

/** Whether the registry offers a version that resolves this row, and what stops it when it does not. */
function planUpdate(input: DependencyRemedyInput, installedVersion: string): DependencyRemedy {
    const { entry, registryEntry, registryKnown, studioVersion } = input;
    if (!registryKnown) {
        return { steps: [], obstacle: "registryUnavailable" };
    }
    if (!registryEntry) {
        return { steps: [], obstacle: "notInRegistry" };
    }
    if (!satisfiesRange(studioVersion, registryEntry.studioVersion)) {
        return { steps: [], obstacle: "needsStudio", studioRange: registryEntry.studioVersion };
    }
    if (compareSemver(registryEntry.version, installedVersion) <= 0) {
        return { steps: [], obstacle: "noCompatibleVersion" };
    }
    // The published version has to be one the project can use. A dependency authored against major
    // 1 is not helped by a registry that has moved on to major 2, and installing it would trade a
    // stated incompatibility for the same one at a higher number.
    if (classifyCompatibility(entry.dependency.authoredVersion, registryEntry.version) === "incompatible") {
        return { steps: [], obstacle: "noCompatibleVersion" };
    }
    return { steps: ["update"] };
}

/**
 * Whether this project has a dependency it cannot use as things stand.
 *
 * The predicate behind the warning raised on open, and it is deliberately narrower than "not
 * satisfied": an outdated plugin loads, registers everything it contributes, and the project works.
 * What this asks is whether a plugin the project names contributes *nothing* right now - absent,
 * withheld, or switched off - because that is the state in which the author's own blueprints,
 * widgets and story rows quietly become unknown types.
 */
export function hasUnmetDependency(entries: readonly DependencyResolutionEntry[]): boolean {
    return entries.some(isUnmet);
}

/** One dependency whose plugin contributes nothing to this project as things stand. */
export function isUnmet(entry: DependencyResolutionEntry): boolean {
    return entry.status === "missing" || entry.suppressed || entry.installedEnabled === false;
}
