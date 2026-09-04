import { describe, expect, it } from "vitest";
import { hasUnmetDependency, isUnmet, planDependencyRemedy } from "./dependencyRemedy";
import type { DependencyResolutionEntry, ProjectPluginDependency } from "@shared/types/pluginDependencies";
import type { PluginRegistryEntry } from "@shared/types/pluginRegistry";

const STUDIO = "1.0.0";

function dependency(overrides: Partial<ProjectPluginDependency> = {}): ProjectPluginDependency {
    return {
        id: "acme.gallery",
        authoredVersion: "1.0.0",
        builtIn: false,
        hard: true,
        usedBy: {},
        ...overrides,
    };
}

function entry(overrides: Partial<DependencyResolutionEntry> = {}): DependencyResolutionEntry {
    return {
        dependency: dependency(),
        status: "satisfied",
        suppressed: false,
        installedVersion: "1.0.0",
        installedEnabled: true,
        ...overrides,
    };
}

function published(version: string, studioVersion?: string): PluginRegistryEntry {
    return {
        id: "acme.gallery",
        name: "Gallery",
        version,
        description: "",
        publisher: "acme",
        targets: ["studio"],
        categories: [],
        keywords: [],
        license: "MIT",
        permissions: [],
        ...(studioVersion ? { studioVersion } : {}),
        release: { tag: `acme.gallery@${version}`, page: "", download: "" },
    };
}

function plan(
    resolution: DependencyResolutionEntry,
    registryEntry: PluginRegistryEntry | null = null,
    extra: { registryKnown?: boolean; installedStatus?: "enabled" | "disabled" | "needsAuthorization" | "error" } = {},
) {
    return planDependencyRemedy({
        entry: resolution,
        registryEntry,
        registryKnown: extra.registryKnown ?? true,
        studioVersion: STUDIO,
        ...(extra.installedStatus ? { installedStatus: extra.installedStatus } : {}),
    });
}

describe("planDependencyRemedy", () => {
    it("asks for nothing when the plugin is installed, compatible and switched on", () => {
        expect(plan(entry())).toEqual({ steps: [] });
    });

    it("installs an absent plugin the registry publishes", () => {
        const absent = entry({ status: "missing", suppressed: true, installedVersion: undefined, installedEnabled: undefined });
        expect(plan(absent, published("1.0.0")).steps).toEqual(["install"]);
    });

    /**
     * The case the screen has to state rather than offer: a project may name a plugin installed
     * from a folder, or one that was never published at all. A button here would only ever fail,
     * and it would fail in the main process, which is a worse place to read about it.
     */
    it("offers nothing for an absent plugin no registry publishes", () => {
        const absent = entry({ status: "missing", suppressed: true, installedVersion: undefined, installedEnabled: undefined });
        expect(plan(absent, null)).toEqual({ steps: [], obstacle: "notInRegistry" });
    });

    it("offers nothing for a plugin this Studio build is too old for", () => {
        const absent = entry({ status: "missing", suppressed: true, installedVersion: undefined, installedEnabled: undefined });
        expect(plan(absent, published("2.0.0", ">=2.0.0")))
            .toEqual({ steps: [], obstacle: "needsStudio", studioRange: ">=2.0.0" });
    });

    it("says nothing about availability before the registry has been read", () => {
        const absent = entry({ status: "missing", suppressed: true, installedVersion: undefined, installedEnabled: undefined });
        expect(plan(absent, null, { registryKnown: false }))
            .toEqual({ steps: [], obstacle: "registryUnavailable" });
    });

    it("enables a plugin the author switched off", () => {
        expect(plan(entry({ installedEnabled: false })).steps).toEqual(["enable"]);
    });

    it("updates a plugin whose installed version is older than the project's", () => {
        const older = entry({ status: "outdated", installedVersion: "1.0.0", dependency: dependency({ authoredVersion: "1.2.0" }) });
        expect(plan(older, published("1.2.0")).steps).toEqual(["update"]);
    });

    /**
     * A withheld plugin is refused by the loader whatever its switch says, so the update has to
     * come first - and both have to be planned, or the author presses once, sees the version move,
     * and still gets nothing.
     */
    it("updates before enabling when a withheld plugin is also switched off", () => {
        const withheld = entry({
            dependency: dependency({ authoredVersion: "2.0.0" }),
            status: "incompatible",
            suppressed: true,
            installedVersion: "1.0.0",
            installedEnabled: false,
        });
        expect(plan(withheld, published("2.0.0")).steps).toEqual(["update", "enable"]);
    });

    it("offers nothing when the published version is no more usable than the installed one", () => {
        // Authored against major 1, the registry has moved to major 2: installing it would trade
        // one stated incompatibility for the same one at a higher number.
        const withheld = entry({ status: "incompatible", suppressed: true, installedVersion: "2.0.0" });
        expect(plan(withheld, published("2.1.0"))).toEqual({ steps: [], obstacle: "noCompatibleVersion" });
    });

    it("leaves an outdated plugin alone when nothing newer is published", () => {
        // It loads, it registers everything it contributes, and the project works. Reporting the
        // unreachable registry on its row would bury the rows that do need reading.
        const older = entry({ status: "outdated", installedVersion: "1.0.0", dependency: dependency({ authoredVersion: "1.2.0" }) });
        expect(plan(older, published("1.0.0"))).toEqual({ steps: [] });
        expect(plan(older, null, { registryKnown: false })).toEqual({ steps: [] });
    });

    it("authorizes a plugin that is installed and waiting for a grant", () => {
        expect(plan(entry(), published("1.0.0"), { installedStatus: "needsAuthorization" }).steps)
            .toEqual(["authorize"]);
    });

    it("does not ask for a grant it is about to be asked for by an install", () => {
        // An install chains into the permission prompt itself; planning both would prompt twice.
        const older = entry({ status: "outdated", installedVersion: "1.0.0", dependency: dependency({ authoredVersion: "1.2.0" }) });
        expect(plan(older, published("1.2.0"), { installedStatus: "needsAuthorization" }).steps)
            .toEqual(["update"]);
    });
});

describe("isUnmet", () => {
    it("counts the three states in which the plugin contributes nothing", () => {
        expect(isUnmet(entry({ status: "missing", suppressed: true, installedVersion: undefined }))).toBe(true);
        expect(isUnmet(entry({ status: "incompatible", suppressed: true }))).toBe(true);
        expect(isUnmet(entry({ installedEnabled: false }))).toBe(true);
    });

    /**
     * The predicate behind a warning raised whenever a project opens, so the false positive matters
     * more than the false negative: an outdated plugin loads and the project works, and a warning
     * about it is one the author learns to close without reading.
     */
    it("does not count a plugin that is merely older than the project expects", () => {
        expect(isUnmet(entry({ status: "outdated", installedVersion: "1.0.0" }))).toBe(false);
        expect(hasUnmetDependency([entry(), entry({ status: "outdated" })])).toBe(false);
    });

    it("counts a soft dependency the same way: its data is there and nothing reads it", () => {
        const dataOnly = entry({
            dependency: dependency({ hard: false }),
            status: "missing",
            suppressed: false,
            installedVersion: undefined,
        });
        expect(isUnmet(dataOnly)).toBe(true);
    });
});
