import { describe, expect, it } from "vitest";
import type { DependencyResolutionEntry, ProjectPluginDependency } from "@shared/types/pluginDependencies";
import {
    describeUnmetPlugins,
    findFailedNamedPlugins,
    findUnmetPluginDependencies,
    type InstalledPluginState,
} from "./commandLinePlugins";

/**
 * Which of a project's declared plugins a command-line run cannot use, and how the log says so.
 *
 * Every state here is one in which the plugin contributes nothing to the project, so the project's
 * own nodes, widgets and story rows read as unknown types - the state the editor warns about on
 * open. The log names each one by its name and the version the project was made with: never by the
 * plugin's id alone, which is not what anybody installs it by.
 */
const GALLERY: ProjectPluginDependency = {
    id: "narraleaf.gallery",
    name: "Gallery",
    builtIn: true,
    authoredVersion: "3.1.0",
    hard: true,
    usedBy: {},
};

function entry(overrides: Partial<DependencyResolutionEntry> = {}): DependencyResolutionEntry {
    return {
        dependency: GALLERY,
        installedVersion: "3.1.0",
        installedEnabled: true,
        status: "satisfied",
        suppressed: false,
        ...overrides,
    };
}

function installed(overrides: Partial<InstalledPluginState> = {}): InstalledPluginState {
    return {
        pluginId: "narraleaf.gallery",
        enabled: true,
        status: "enabled",
        lastError: null,
        manifest: { name: "Gallery", version: "3.1.0", entries: { studio: "studio.js" } },
        ...overrides,
    } as InstalledPluginState;
}

describe("findUnmetPluginDependencies", () => {
    it("reports nothing for a declared plugin that is installed, on and running", () => {
        expect(findUnmetPluginDependencies([entry()], [installed()], {})).toEqual([]);
    });

    it("names a plugin that is not installed by its name and the version the project was made with", () => {
        const unmet = findUnmetPluginDependencies(
            [entry({ status: "missing", installedVersion: undefined, installedEnabled: undefined, suppressed: true })],
            [],
            {},
        );

        expect(unmet).toEqual([{ plugin: '"Gallery" 3.1.0', state: "is not installed in this profile" }]);
    });

    it("says a plugin the profile has switched off is switched off, and how to switch it on for the run", () => {
        const unmet = findUnmetPluginDependencies(
            [entry({ installedEnabled: false })],
            [installed({ enabled: false, status: "disabled" })],
            {},
        );

        expect(unmet).toEqual([{ plugin: '"Gallery" 3.1.0', state: "is switched off in this profile", switchOn: "Gallery" }]);
    });

    it("offers no switch for a plugin switched off because it was never granted, which the flag refuses", () => {
        const unmet = findUnmetPluginDependencies(
            [entry({ installedEnabled: false })],
            [installed({ enabled: false, status: "needsAuthorization" })],
            {},
        );

        expect(unmet[0].state).toBe("is switched off in this profile");
        expect(unmet[0].switchOn).toBeUndefined();
    });

    it("offers the id when another installed plugin shares the name, as the flag would ask for", () => {
        const unmet = findUnmetPluginDependencies(
            [entry({ installedEnabled: false })],
            [
                installed({ enabled: false, status: "disabled" }),
                installed({ pluginId: "acme.gallery", manifest: { name: "gallery", version: "1.0.0", entries: {} } } as never),
            ],
            {},
        );

        expect(unmet[0].switchOn).toBe("narraleaf.gallery");
    });

    it("says a plugin at another major version is held back, and which version is installed", () => {
        const unmet = findUnmetPluginDependencies(
            [entry({ status: "incompatible", installedVersion: "4.0.0", suppressed: true })],
            [installed({ manifest: { name: "Gallery", version: "4.0.0", entries: { studio: "studio.js" } } } as never)],
            {},
        );

        expect(unmet[0].state).toMatch(/^is installed at 4\.0\.0, a different major version/);
    });

    it("counts a plugin waiting for its permissions, which is on and loads nothing", () => {
        const unmet = findUnmetPluginDependencies([entry()], [installed({ status: "needsAuthorization" })], {});

        expect(unmet[0].state).toMatch(/^has not been allowed to run in this profile/);
    });

    it("counts a plugin that failed to start in this run, with its reason", () => {
        const unmet = findUnmetPluginDependencies([entry()], [installed()], { "narraleaf.gallery": "setup threw" });

        expect(unmet).toEqual([{ plugin: '"Gallery" 3.1.0', state: "could not start: setup threw" }]);
    });

    it("falls back to the installed plugin's name, then to its id, when the project recorded none", () => {
        const unnamed = { ...GALLERY, name: undefined };

        expect(findUnmetPluginDependencies(
            [entry({ dependency: unnamed, installedEnabled: false })],
            [installed({ enabled: false, status: "disabled" })],
            {},
        )[0].plugin).toBe('"Gallery" 3.1.0');
        expect(findUnmetPluginDependencies(
            [entry({ dependency: unnamed, status: "missing", installedVersion: undefined })],
            [],
            {},
        )[0].plugin).toBe('"narraleaf.gallery" 3.1.0');
    });
});

/**
 * A plugin the line switched on with `--lint-plugin` (or its siblings) is held to starting: a job
 * that asked for it and got a run without it would be answered about something it did not ask about.
 */
describe("findFailedNamedPlugins", () => {
    const STATS = { id: "acme.stats", name: "Stats", version: "1.2.0", enabledForRun: true };

    it("names a plugin the line named that failed to start, by its name and installed version", () => {
        expect(findFailedNamedPlugins([STATS], [], { "acme.stats": "setup threw" }))
            .toEqual([{ plugin: '"Stats" 1.2.0', state: "could not start: setup threw" }]);
    });

    it("holds a plugin the profile already ran to starting as well, since the line asked for it", () => {
        expect(findFailedNamedPlugins([{ ...STATS, enabledForRun: false }], [], { "acme.stats": "setup threw" }))
            .toHaveLength(1);
    });

    it("says nothing about one that started, or one with nothing to start in the editor", () => {
        expect(findFailedNamedPlugins([STATS], [], {})).toEqual([]);
    });

    it("leaves a plugin the project declares to the declared list, so it is not named twice", () => {
        const declaredStats = entry({ dependency: { ...GALLERY, id: "acme.stats", name: "Stats" } });

        expect(findFailedNamedPlugins([STATS], [declaredStats], { "acme.stats": "setup threw" })).toEqual([]);
    });
});

/**
 * The run's closing sentence ends on the line that fixes it, where a flag would: in the throwaway
 * profile a job runs in, a switched-off built-in is the usual reason for exit 4.
 */
describe("describeUnmetPlugins", () => {
    it("ends on the flag that switches the plugin on for this run", () => {
        expect(describeUnmetPlugins(
            [{ plugin: '"Gallery" 3.1.0', state: "is switched off in this profile", switchOn: "Gallery" }],
            "--lint-plugin",
        )).toBe('This profile cannot run a plugin this project needs: "Gallery" 3.1.0. Install or switch it on in'
            + " Studio's plugin list with this profile, or run with a profile that has it."
            + " To switch it on for this run only, add --lint-plugin=Gallery.");
    });

    it("quotes a name with a space, and names only the ones a flag can switch on", () => {
        const sentence = describeUnmetPlugins([
            { plugin: '"Menu Bar" 1.0.0', state: "is switched off in this profile", switchOn: "Menu Bar" },
            { plugin: '"Stats" 1.2.0', state: "is not installed in this profile" },
        ], "--build-plugin");

        expect(sentence).toMatch(/ To switch the ones switched off on for this run only, add --build-plugin="Menu Bar"\.$/);
    });

    it("says nothing about a flag when none would help", () => {
        expect(describeUnmetPlugins([{ plugin: '"Stats" 1.2.0', state: "is not installed in this profile" }], "--lint-plugin"))
            .not.toContain("--lint-plugin");
    });
});
