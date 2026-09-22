import { describe, expect, it } from "vitest";
import type { DependencyResolutionEntry, ProjectPluginDependency } from "@shared/types/pluginDependencies";
import { findUnmetPluginDependencies, type InstalledPluginState } from "./commandLinePlugins";

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

    it("says a plugin the profile has switched off is switched off", () => {
        const unmet = findUnmetPluginDependencies(
            [entry({ installedEnabled: false })],
            [installed({ enabled: false, status: "disabled" })],
            {},
        );

        expect(unmet).toEqual([{ plugin: '"Gallery" 3.1.0', state: "is switched off in this profile" }]);
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
