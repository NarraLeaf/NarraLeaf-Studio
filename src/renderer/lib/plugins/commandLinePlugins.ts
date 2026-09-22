import { getInterface } from "@/lib/app/bridge";
import type { CommandLineRunPlugin } from "@shared/types/commandLineRun";
import type { DevModeConsoleLogLevel } from "@shared/types/devMode";
import type { DependencyResolutionEntry } from "@shared/types/pluginDependencies";
import type { PluginListItem } from "@shared/types/plugins";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { ProjectDependencyService } from "@/lib/workspace/services/core/ProjectDependencyService";
import { isUnmet } from "@/lib/workspace/project/dependencyRemedy";
import { loadWorkspacePlugins } from "./pluginRuntime";
import { workspacePluginSession } from "./workspacePluginSession";

/**
 * The plugins of a workspace opened by `--build`, `--test` or `--lint`.
 *
 * **The same plugins the author's workspace runs for this project, loaded the same way** -
 * `loadWorkspacePlugins`, which is what `useWorkspacePlugins` calls when the editor opens: every
 * plugin this profile has enabled and authorized, less the ones this project's dependency table
 * withholds for their version. A headless run used to load none at all, so any project whose
 * blueprints use a plugin's nodes - which is every project made from the starter template, whose
 * menus use the Gallery's - failed `--lint` on nodes "not loaded" while the Lint tab found nothing.
 * A person and a script have to get one answer, so the run now has what the editor has.
 *
 * Deliberately not "only the plugins the project declares". The declaration is written when the
 * project is saved, scanned or exported; what the editor loads is the profile's list, and a sweep
 * over a project whose table is out of date must see the nodes the Lint tab sees.
 *
 * ## A declared plugin this profile cannot run
 *
 * The editor raises a warning for it on open (`useDependencyOffer`) and lets the author carry on:
 * somebody is there to read it and to decide. A run with nobody there cannot decide, and carrying on
 * answers a question about a project that, on this machine, is missing part of itself - a sweep full
 * of unknown nodes, a build without the plugin's runtime. So it is the one place the run parts from
 * the editor: every such plugin is named on the log, by its name and the version the project was
 * made with, and the run ends as a Studio failure (exit 4) - a machine to look at, not a project to
 * change. The predicate is the editor's own (`isUnmet`), widened by the two states in which a
 * plugin is installed and switched on and still contributes nothing: waiting for its permissions to
 * be approved, and failing to start.
 *
 * ## Plugins the line switched on
 *
 * `--build-plugin`, `--test-plugin` and `--lint-plugin` switch a plugin on for the run. The main
 * process has already done that by the time this runs - its plugin list answers with them on, and
 * writes nothing to the profile (`main/.../utils/commandLinePlugins.ts`) - so they load through the
 * same `loadWorkspacePlugins` as every other. What is left here is to say so on the log, and to hold
 * each one the line named to starting: a job that asked for a plugin and got a run without it would
 * be answered about something it did not ask about, so one that fails ends the run as a declared
 * plugin that fails does.
 */

/** How long the plugins may take to start before the run stops waiting for them. */
const PLUGIN_START_TIMEOUT_MS = 60_000;

export type CommandLinePluginLog = (level: DevModeConsoleLogLevel, message: string) => void;

export type CommandLinePluginsResult =
    | { ok: true }
    /** Why this profile cannot run the project, as the run's closing sentence. */
    | { ok: false; error: string };

/** One declared plugin this run cannot use, as the log names it. */
export type UnmetPluginDependency = {
    /** The plugin as a person knows it: `"Gallery" 3.1.0` - its name, and the version the project was made with. */
    plugin: string;
    /** The rest of the sentence after "which". */
    state: string;
    /**
     * What `--lint-plugin=` (or its siblings) takes to switch it on for one run, when that would help:
     * a plugin this profile has installed, granted and switched off. Absent for every other state -
     * a plugin that is not here cannot be switched on, and one never granted is refused by the flag.
     */
    switchOn?: string;
    /**
     * Set for a plugin the project holds back because the installed version is a different major.
     * Nothing about the profile changes that - no install, no switch, no flag - only the author's
     * Rescan in Studio, so the closing sentence sends the reader there instead.
     */
    held?: true;
};

/** What the log needs to know about an installed plugin. A subset of `PluginListItem`. */
export type InstalledPluginState = Pick<PluginListItem, "pluginId" | "enabled" | "status" | "lastError"> & {
    manifest: Pick<PluginListItem["manifest"], "name" | "version" | "entries">;
};

/**
 * Start this workspace's plugins for a command-line run and say which ones it has.
 *
 * Resolves `ok: false` when the run cannot answer for the project here - a declared plugin this
 * profile cannot run, a list that could not be read, plugins that never finished starting. The
 * caller decides what that means for its job; every line it would need has been logged by then.
 */
export async function startCommandLinePlugins(
    context: WorkspaceContext,
    log: CommandLinePluginLog,
    options: {
        /**
         * How loudly a plugin this run needs and cannot have is logged. An error for a job that will
         * stop on it; a warning for `--test-list`, which reports it and lists the tests anyway.
         */
        unmetLevel?: DevModeConsoleLogLevel;
        /** The plugins the line named, as the main process found them. */
        named?: readonly CommandLineRunPlugin[];
        /** The flag they were named with, for the sentences: `--lint-plugin`. */
        flag?: string;
    } = {},
): Promise<CommandLinePluginsResult> {
    const { unmetLevel = "error", named = [], flag = "--test-plugin" } = options;
    let installed: InstalledPluginState[];
    try {
        installed = await listInstalledPlugins();
    } catch (error) {
        return { ok: false, error: `Studio could not read this profile's plugin list: ${describeError(error)}` };
    }

    let results: Awaited<ReturnType<typeof loadWorkspacePlugins>>;
    try {
        const loaded = await withDeadline(loadWorkspacePlugins(context), PLUGIN_START_TIMEOUT_MS);
        if (loaded === TIMED_OUT) {
            const activity = workspacePluginSession(context).getActivity();
            const pending = installed.filter(plugin => plugin.status === "enabled"
                && plugin.manifest.entries.studio
                && !activity.running.includes(plugin.pluginId)
                && !(plugin.pluginId in activity.failed));
            return {
                ok: false,
                error: `${pending.length > 0 ? pending.map(describeInstalled).join(", ") : "This profile's plugins"}`
                    + ` did not finish starting within ${PLUGIN_START_TIMEOUT_MS / 1000} seconds, so the run stopped waiting.`,
            };
        }
        results = loaded;
    } catch (error) {
        return { ok: false, error: `Studio could not start this profile's plugins: ${describeError(error)}` };
    }

    const byId = new Map(installed.map(plugin => [plugin.pluginId, plugin] as const));
    const failed: Record<string, string> = {};
    for (const result of results) {
        if (!result.ok) {
            failed[result.pluginId] = result.error;
            const plugin = byId.get(result.pluginId);
            log("error", `plugin ${plugin ? describeInstalled(plugin) : result.pluginId} could not start: ${result.error}`);
        }
    }
    const running = workspacePluginSession(context).getActivity().running
        .map(id => byId.get(id))
        .filter((plugin): plugin is InstalledPluginState => plugin !== undefined);
    // Always said, including when it is nothing: the log is the only record a job keeps of what this
    // run had, and a Studio that loaded no plugins answers differently from one that loaded three.
    // A plugin the line switched on says so, because the profile the run leaves behind does not.
    const switchedOn = new Set(named.filter(plugin => plugin.enabledForRun).map(plugin => plugin.id));
    log("info", running.length > 0
        ? `loaded ${running.map(plugin => describeInstalled(plugin)
            + (switchedOn.has(plugin.pluginId) ? " (enabled for this run)" : "")).join(", ")}`
        : "none loaded");

    const entries = context.services.get<ProjectDependencyService>(Services.ProjectDependency)
        .getResolution()?.entries ?? [];
    const unmet = findUnmetPluginDependencies(entries, installed, failed);
    for (const entry of unmet) {
        log(unmetLevel, `this project needs ${entry.plugin}, which ${entry.state}`);
    }
    const failedNamed = findFailedNamedPlugins(named, entries, failed);
    for (const entry of failedNamed) {
        log(unmetLevel, `${flag} named ${entry.plugin}, which ${entry.state}`);
    }
    if (unmet.length > 0 || failedNamed.length > 0) {
        return {
            ok: false,
            error: [
                ...(unmet.length > 0 ? [describeUnmetPlugins(unmet, flag)] : []),
                ...(failedNamed.length > 0 ? [describeFailedNamed(failedNamed, flag)] : []),
            ].join(" "),
        };
    }
    return { ok: true };
}

/**
 * Every plugin the line named that did not start, which the project does not also declare.
 *
 * A declared one is already in {@link findUnmetPluginDependencies}' answer, under the version the
 * project was made with, and naming it twice would read as two problems. Only a plugin that tried and
 * failed counts: one with nothing to start in the editor - a plugin that only extends the game - is
 * doing what it was switched on to do by being in the game the run builds.
 */
export function findFailedNamedPlugins(
    named: readonly CommandLineRunPlugin[],
    entries: readonly DependencyResolutionEntry[],
    failedToStart: Readonly<Record<string, string>>,
): UnmetPluginDependency[] {
    const declared = new Set(entries.map(entry => entry.dependency.id));
    return named
        .filter(plugin => !declared.has(plugin.id) && failedToStart[plugin.id] !== undefined)
        .map(plugin => ({
            plugin: `"${plugin.name}" ${plugin.version}`,
            state: `could not start: ${failedToStart[plugin.id]}`,
        }));
}

/**
 * Every plugin the project declares that contributes nothing to this run, and why.
 *
 * Pure over the three answers, so the states are tested without a workspace. The order of the
 * checks is the order in which each state hides the next: a plugin that is not installed is not
 * also switched off, and one withheld for its version would not have started if it were on.
 */
export function findUnmetPluginDependencies(
    entries: readonly DependencyResolutionEntry[],
    installed: readonly InstalledPluginState[],
    failedToStart: Readonly<Record<string, string>>,
): UnmetPluginDependency[] {
    const byId = new Map(installed.map(plugin => [plugin.pluginId, plugin] as const));
    const unmet: UnmetPluginDependency[] = [];
    for (const entry of entries) {
        const plugin = byId.get(entry.dependency.id);
        const state = unmetState(entry, plugin, failedToStart[entry.dependency.id]);
        if (state) {
            const name = entry.dependency.name?.trim() || plugin?.manifest.name?.trim() || entry.dependency.id;
            const switchOn = state === SWITCHED_OFF && plugin && !plugin.enabled && plugin.status === "disabled"
                ? switchOnValue(plugin, installed)
                : null;
            unmet.push({
                plugin: `"${name}" ${entry.dependency.authoredVersion}`,
                state,
                ...(switchOn ? { switchOn } : {}),
                ...(plugin && entry.status !== "missing" && entry.suppressed ? { held: true as const } : {}),
            });
        }
    }
    return unmet;
}

const SWITCHED_OFF = "is switched off in this profile";

/**
 * How the plugin flags would name this plugin: by the name Studio shows for it, as a person would
 * write it, unless another installed plugin shares that name - then by its manifest id, which the
 * flag would otherwise ask for.
 */
function switchOnValue(plugin: InstalledPluginState, installed: readonly InstalledPluginState[]): string {
    const name = plugin.manifest.name?.trim() || plugin.pluginId;
    const shared = installed.some(other => other.pluginId !== plugin.pluginId
        && (other.manifest.name?.trim() || other.pluginId).toLowerCase() === name.toLowerCase());
    return shared ? plugin.pluginId : name;
}

function unmetState(
    entry: DependencyResolutionEntry,
    plugin: InstalledPluginState | undefined,
    failure: string | undefined,
): string | null {
    if (entry.status === "missing" || !plugin) {
        return "is not installed in this profile";
    }
    if (entry.suppressed) {
        return `is installed at ${entry.installedVersion ?? plugin.manifest.version}, a different major version,`
            + " so Studio holds it back from this project";
    }
    // The editor's own predicate has nothing left to say past this point but "switched off"; asked
    // rather than restated, so the two cannot come to disagree about what that means.
    if (isUnmet(entry) || !plugin.enabled) {
        return SWITCHED_OFF;
    }
    if (plugin.status === "needsAuthorization") {
        return "has not been allowed to run in this profile: its permissions were never approved";
    }
    if (failure !== undefined) {
        return `could not start: ${failure}`;
    }
    if (plugin.status === "error") {
        return `could not start the last time it was loaded, and is held back until it is switched off and on: ${plugin.lastError ?? "no reason recorded"}`;
    }
    return null;
}

/**
 * The run's closing sentence for the plugins it could not have.
 *
 * Ends on the flag that switches a plugin on for this run, where one would: in a throwaway profile a
 * switched-off built-in is the usual reason, and the line that fixes it is what a job's author needs
 * to read, not a menu in an editor the job never opens.
 *
 * A plugin the project holds back for its version gets a sentence of its own. No profile runs it -
 * installing, switching on and the flag all leave the hold where it is - and what releases it is the
 * author's Rescan in Studio, which is where that sentence sends the reader.
 */
export function describeUnmetPlugins(unmet: readonly UnmetPluginDependency[], flag: string): string {
    const held = unmet.filter(entry => entry.held);
    const unrunnable = unmet.filter(entry => !entry.held);
    return [
        ...(unrunnable.length > 0 ? [describeUnrunnable(unrunnable, flag)] : []),
        ...(held.length > 0 ? [describeHeld(held)] : []),
    ].join(" ");
}

function describeUnrunnable(unmet: readonly UnmetPluginDependency[], flag: string): string {
    const plugins = unmet.map(entry => entry.plugin).join(", ");
    const sentence = unmet.length === 1
        ? `This profile cannot run a plugin this project needs: ${plugins}. Install or switch it on in`
            + " Studio's plugin list with this profile, or run with a profile that has it."
        : `This profile cannot run ${unmet.length} plugins this project needs: ${plugins}. Install or switch`
            + " each one on in Studio's plugin list with this profile, or run with a profile that has them.";
    const switchable = unmet.flatMap(entry => entry.switchOn ? [entry.switchOn] : []);
    if (switchable.length === 0) {
        return sentence;
    }
    const flags = switchable.map(value => `${flag}=${value.includes(" ") ? `"${value}"` : value}`).join(" ");
    const which = unmet.length === 1 ? "it" : switchable.length === unmet.length ? "them" : "the ones switched off";
    return `${sentence} To switch ${which} on for this run only, add ${flags}.`;
}

function describeHeld(held: readonly UnmetPluginDependency[]): string {
    const plugins = held.map(entry => entry.plugin).join(", ");
    return held.length === 1
        ? `This project holds back a plugin it needs, installed here at a different major version: ${plugins}.`
            + " To use the installed version, open the project in Studio and press Rescan under Project ▸ App."
        : `This project holds back ${held.length} plugins it needs, installed here at a different major version:`
            + ` ${plugins}. To use the installed versions, open the project in Studio and press Rescan under`
            + " Project ▸ App.";
}

/** The run's closing sentence for the plugins the line named that would not start. */
function describeFailedNamed(failed: readonly UnmetPluginDependency[], flag: string): string {
    const plugins = failed.map(entry => entry.plugin).join(", ");
    return failed.length === 1
        ? `A plugin ${flag} named could not start: ${plugins}. The run needs it and stops here.`
        : `${failed.length} plugins ${flag} named could not start: ${plugins}. The run needs them and stops here.`;
}

function describeInstalled(plugin: InstalledPluginState): string {
    return `"${plugin.manifest.name?.trim() || plugin.pluginId}" ${plugin.manifest.version}`;
}

async function listInstalledPlugins(): Promise<InstalledPluginState[]> {
    const result = await getInterface().plugins.list();
    if (!result.success || !result.data) {
        throw new Error(result.success ? "the list came back empty" : (result.error ?? "no reason given"));
    }
    return result.data.plugins;
}

const TIMED_OUT = Symbol("timed out");

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
    return new Promise<T | typeof TIMED_OUT>((resolve, reject) => {
        const timer = setTimeout(() => resolve(TIMED_OUT), ms);
        promise.then(
            value => {
                clearTimeout(timer);
                resolve(value);
            },
            error => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
