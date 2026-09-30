import type { CommandLineRunPlugin } from "@shared/types/commandLineRun";
import type { PluginListItem } from "@shared/types/plugins";

/**
 * `--build-plugin`, `--test-plugin` and `--lint-plugin`: switch a plugin on for one command-line run.
 *
 * ## Why these exist
 *
 * A command-line run loads the plugins the editor loads - the ones the profile has switched on and
 * whose permissions it granted - and ends with exit 4 when the project declares one it cannot have
 * (`renderer/lib/plugins/commandLinePlugins.ts`). That is right, and it left a CI machine with no
 * way through: a job runs in a throwaway profile, a throwaway profile has the built-in Gallery and
 * Menu Bar switched off, and a project made from the starter template declares Gallery. The only way
 * to switch it on was to edit the profile's registry by hand.
 *
 * ## What they may and may not do
 *
 * **They change what this run loads, never the profile.** A headless run does not inherit hidden
 * state and does not leave any behind: nothing here is written to the plugin registry, so a job
 * pointed at somebody's own profile leaves their editor as it found it. `PluginManager` holds the
 * switch in memory for the life of the process.
 *
 * **They do not grant permissions.** A plugin whose permissions this profile has never granted is
 * refused, not granted silently: the permission prompt exists to protect people from third-party
 * code, and a name on a command line is not consent to it. Built-in plugins are granted when Studio
 * installs them, whether or not they are switched on, so enabling one never asks - the same as its
 * switch in the plugin list.
 *
 * ## Naming a plugin
 *
 * By the name Studio shows for it - its manifest's `name`, without regard to case - or by its
 * manifest id (`narraleaf.gallery`), which its publisher wrote and which is not a generated id. The id
 * is looked for first, since no two plugins share one. A name two installed plugins share is refused,
 * and the refusal gives each one's id to write instead.
 *
 * Every refusal here is exit 4 (`studio-failed`), not a bad invocation: which plugins a profile has
 * is a property of the machine the line runs on, and the same line is right on another.
 */

export type CommandLinePluginResolution =
    | { ok: true; plugins: CommandLineRunPlugin[] }
    | { ok: false; reason: string };

/** What resolution needs of an installed plugin. A subset of `PluginListItem`. */
export type CommandLinePluginCandidate = Pick<PluginListItem, "pluginId" | "status" | "grantedManifestVersion"> & {
    manifest: Pick<PluginListItem["manifest"], "name" | "version">;
};

/**
 * Find each plugin the line named in this profile's list, or say why one cannot run.
 *
 * Pure over the list, so every refusal is decided without a profile. The plugins come back in the
 * order the line first named them, each once however many times it was named.
 */
export function resolveCommandLinePlugins(input: {
    requested: readonly string[];
    installed: readonly CommandLinePluginCandidate[];
    /** The flag the names came through, for the sentences: `--lint-plugin`. */
    flag: string;
}): CommandLinePluginResolution {
    const { requested, installed, flag } = input;
    const plugins: CommandLineRunPlugin[] = [];
    for (const raw of requested) {
        const found = findPlugin(installed, raw, flag);
        if (!found.ok) {
            return found;
        }
        const plugin = found.plugin;
        if (plugins.some(entry => entry.id === plugin.pluginId)) {
            continue;
        }
        // The grant rather than the status: a plugin that failed to start reads as "error" whether or
        // not it was ever granted anything, and the grant is what `PluginManager` holds the line to.
        if (plugin.grantedManifestVersion !== plugin.manifest.version) {
            return {
                ok: false,
                reason: `${describe(plugin)} (${flag}) needs permissions this profile has not granted, and naming it`
                    + " on the command line does not grant them. Grant them once in Studio's plugin list with"
                    + " this profile, then run again.",
            };
        }
        plugins.push({
            id: plugin.pluginId,
            name: nameOf(plugin),
            version: plugin.manifest.version,
            // "enabled" is the one status in which a plugin loads today. A plugin switched off, and
            // one held back since it last failed to start, both start in this run because of the line.
            enabledForRun: plugin.status !== "enabled",
        });
    }
    return { ok: true, plugins };
}

function findPlugin(
    installed: readonly CommandLinePluginCandidate[],
    raw: string,
    flag: string,
): { ok: true; plugin: CommandLinePluginCandidate } | { ok: false; reason: string } {
    const wanted = raw.trim().toLowerCase();
    const byId = installed.find(plugin => plugin.pluginId.toLowerCase() === wanted);
    if (byId) {
        return { ok: true, plugin: byId };
    }
    const byName = installed.filter(plugin => nameOf(plugin).toLowerCase() === wanted);
    if (byName.length === 1) {
        return { ok: true, plugin: byName[0] };
    }
    if (byName.length > 1) {
        const listed = byName.map(plugin => `${describe(plugin)} (${plugin.pluginId})`);
        return {
            ok: false,
            reason: `${byName.length === 2 ? "Two" : byName.length} plugins in this profile are called "${raw.trim()}"`
                + ` (${flag}): ${listed.slice(0, -1).join(", ")} and ${listed[listed.length - 1]}.`
                + ` Name the one this run needs by its id, as ${flag}=${byName[0].pluginId}.`,
        };
    }
    const names = [...new Set(installed.map(nameOf))]
        .sort((left, right) => left.localeCompare(right))
        .map(name => `"${name}"`);
    return {
        ok: false,
        reason: `This profile has no plugin "${raw.trim()}" (${flag}).`
            + (names.length > 0 ? ` It has: ${names.join(", ")}.` : " It has none installed."),
    };
}

/** The name Studio shows for a plugin, which is what the line names it by. */
function nameOf(plugin: CommandLinePluginCandidate): string {
    return plugin.manifest.name?.trim() || plugin.pluginId;
}

function describe(plugin: CommandLinePluginCandidate): string {
    return `"${nameOf(plugin)}" ${plugin.manifest.version}`;
}

/** The two things a run asks of the plugin manager. Narrowed so the step is tested without one. */
export type CommandLinePluginSwitch = {
    listPlugins(): Promise<CommandLinePluginCandidate[]>;
    enableForCommandLineRun(pluginIds: readonly string[]): Promise<void>;
};

/**
 * Find the plugins the line named and switch them on for the rest of this process.
 *
 * Reads nothing when the line named none: a run that asked for no plugin must not be refused because
 * the list could not be read. The caller ends the run with exit 4 on `ok: false`.
 */
export async function enableCommandLinePlugins(
    manager: CommandLinePluginSwitch,
    requested: readonly string[],
    flag: string,
): Promise<CommandLinePluginResolution> {
    if (requested.length === 0) {
        return { ok: true, plugins: [] };
    }
    let installed: CommandLinePluginCandidate[];
    try {
        installed = await manager.listPlugins();
    } catch (error) {
        return {
            ok: false,
            reason: `Studio could not read this profile's plugin list to find the plugins ${flag} names: ${describeError(error)}`,
        };
    }
    const resolved = resolveCommandLinePlugins({ requested, installed, flag });
    if (!resolved.ok) {
        return resolved;
    }
    try {
        await manager.enableForCommandLineRun(resolved.plugins.map(plugin => plugin.id));
    } catch (error) {
        return {
            ok: false,
            reason: `Studio could not switch on the plugins ${flag} names: ${describeError(error)}`,
        };
    }
    return resolved;
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
