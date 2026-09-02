import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectDependencyTable } from "@shared/types/pluginDependencies";
import type { NormalizedPluginManifestV2 } from "@shared/types/plugins";
import { selectProjectRuntimePlugins } from "./selectRuntimePlugins";
import type { GameRuntimePluginSource } from "./compiler/gameRuntimeArtifactCompiler";

function manifest(id: string, version: string, blueprintNodes: string[] = [], widgets: string[] = []): NormalizedPluginManifestV2 {
    return {
        manifestVersion: 2,
        id,
        name: id,
        version,
        entries: { runtime: "runtime.js" },
        contributes: {
            blueprintNodes,
            widgets,
            tests: [],
            runtimeData: [],
            locales: [],
            runtimeCapabilities: [],
            sidecars: [],
            buildDependencies: [],
            buildConfig: [],
            externalLinks: [],
            network: [],
        },
        permissions: [],
    };
}

function source(id: string, version: string, blueprintNodes: string[] = [], widgets: string[] = []): GameRuntimePluginSource {
    return {
        manifest: manifest(id, version, blueprintNodes, widgets),
        entry: "runtime.js",
        entryPath: `/plugins/${id}/runtime.js`,
        installPath: `/plugins/${id}`,
    };
}

function table(plugins: ProjectDependencyTable["plugins"]): ProjectDependencyTable {
    return { schemaVersion: 1, plugins };
}

describe("selectProjectRuntimePlugins", () => {
    it("falls back to every enabled runtime plugin when the project has no dependency table", () => {
        const selection = selectProjectRuntimePlugins({
            dependencies: undefined,
            available: [source("acme.a", "1.0.0"), source("acme.b", "1.0.0")],
            installed: [],
        });

        expect(selection.fallbackAll).toBe(true);
        expect(selection.selected.map(item => item.manifest.id)).toEqual(["acme.a", "acme.b"]);
        expect(selection.errors).toEqual([]);
    });

    it("ships hard dependencies and skips unused enabled plugins", () => {
        const selection = selectProjectRuntimePlugins({
            dependencies: table([{
                id: "acme.used",
                builtIn: false,
                authoredVersion: "1.0.0",
                hard: true,
                usedBy: { blueprintNode: ["acme.used.node"] },
            }]),
            available: [
                source("acme.used", "1.0.0", ["acme.used.node"]),
                source("acme.unused", "1.0.0", ["acme.unused.node"]),
            ],
            installed: [
                { id: "acme.used", version: "1.0.0", enabled: true },
                { id: "acme.unused", version: "1.0.0", enabled: true },
            ],
        });

        expect(selection.errors).toEqual([]);
        expect(selection.selected.map(item => item.manifest.id)).toEqual(["acme.used"]);
        expect(selection.excluded.map(entry => entry.pluginId)).toEqual(["acme.unused"]);
        expect(selection.fallbackAll).toBe(false);
    });

    it("fails when a used blueprint node has no packaged runtime provider", () => {
        const selection = selectProjectRuntimePlugins({
            dependencies: table([{
                id: "acme.gone",
                builtIn: false,
                authoredVersion: "1.0.0",
                hard: true,
                usedBy: { blueprintNode: ["acme.gone.node"] },
            }]),
            available: [],
            installed: [{ id: "acme.gone", version: "1.0.0", enabled: false }],
        });

        expect(selection.errors).toHaveLength(1);
        expect(selection.errors[0]).toContain("acme.gone");
        expect(selection.errors[0]).toContain("no enabled runtime entry");
    });

    it("fails when used node types are not declared in contributes", () => {
        const selection = selectProjectRuntimePlugins({
            dependencies: table([{
                id: "acme.partial",
                builtIn: false,
                authoredVersion: "1.0.0",
                hard: true,
                usedBy: { blueprintNode: ["acme.partial.declared", "acme.partial.undeclared"] },
            }]),
            available: [source("acme.partial", "1.0.0", ["acme.partial.declared"])],
            installed: [{ id: "acme.partial", version: "1.0.0", enabled: true }],
        });

        expect(selection.errors).toHaveLength(1);
        expect(selection.errors[0]).toContain("acme.partial.undeclared");
        expect(selection.errors[0]).toContain("contributes.blueprintNodes");
        expect(selection.selected).toEqual([]);
    });

    it("fails with a version diagnostic when a required plugin is incompatible", () => {
        const selection = selectProjectRuntimePlugins({
            dependencies: table([{
                id: "acme.old",
                builtIn: false,
                authoredVersion: "1.0.0",
                hard: true,
                usedBy: { blueprintNode: ["acme.old.node"] },
            }]),
            available: [source("acme.old", "2.0.0", ["acme.old.node"])],
            installed: [{ id: "acme.old", version: "2.0.0", enabled: true }],
        });

        expect(selection.errors).toHaveLength(1);
        expect(selection.errors[0]).toContain("incompatible version 2.0.0");
        expect(selection.selected).toEqual([]);
    });

    it("skips missing soft dependencies without errors", () => {
        const selection = selectProjectRuntimePlugins({
            dependencies: table([{
                id: "acme.soft",
                builtIn: false,
                authoredVersion: "1.0.0",
                hard: false,
                usedBy: { storage: ["plugin.acme.soft.items.json"] },
            }]),
            available: [],
            installed: [],
        });

        expect(selection.errors).toEqual([]);
        expect(selection.selected).toEqual([]);
    });

    it("ships hard widget dependencies whose renderers are declared", () => {
        const selection = selectProjectRuntimePlugins({
            dependencies: table([{
                id: "acme.widgets",
                builtIn: false,
                authoredVersion: "1.0.0",
                hard: true,
                usedBy: { widget: ["acme.widgets.badge"] },
            }]),
            available: [source("acme.widgets", "1.0.0", [], ["acme.widgets.badge"])],
            installed: [{ id: "acme.widgets", version: "1.0.0", enabled: true }],
        });

        expect(selection.errors).toEqual([]);
        expect(selection.selected.map(item => item.manifest.id)).toEqual(["acme.widgets"]);
    });

    it("fails when used widgets are not declared in contributes", () => {
        const selection = selectProjectRuntimePlugins({
            dependencies: table([{
                id: "acme.widgets",
                builtIn: false,
                authoredVersion: "1.0.0",
                hard: true,
                usedBy: { widget: ["acme.widgets.badge"] },
            }]),
            available: [source("acme.widgets", "1.0.0")],
            installed: [{ id: "acme.widgets", version: "1.0.0", enabled: true }],
        });

        expect(selection.errors).toHaveLength(1);
        expect(selection.errors[0]).toContain("acme.widgets.badge");
        expect(selection.errors[0]).toContain("contributes.widgets");
        expect(selection.selected).toEqual([]);
    });

    it("ships hard dependencies with no recorded node or widget usage", () => {
        const selection = selectProjectRuntimePlugins({
            dependencies: table([{
                id: "acme.misc",
                builtIn: false,
                authoredVersion: "1.0.0",
                hard: true,
                usedBy: {},
            }]),
            available: [source("acme.misc", "1.0.0")],
            installed: [{ id: "acme.misc", version: "1.0.0", enabled: true }],
        });

        expect(selection.errors).toEqual([]);
        expect(selection.selected.map(item => item.manifest.id)).toEqual(["acme.misc"]);
    });
});

/**
 * A Dev Mode session runs the plugins a build carries.
 *
 * Dev Mode used to load every enabled runtime plugin and only drop the version-suppressed ones, so
 * a plugin the project never declared worked there and silently did not exist in the build - the
 * author's node ran in the window they were testing in and was an unknown-node stub in the game
 * they shipped. Both sides ask this one function now; these check that they are given the same
 * question, and that the handler has not gone back to answering it for itself.
 */
describe("Dev Mode and a build select the same plugins", () => {
    /** What Dev Mode hands over: the descriptor the window gets, which carries the same manifest. */
    function descriptor(id: string, version: string, blueprintNodes: string[] = []) {
        return {
            plugin: { id, version },
            manifest: manifest(id, version, blueprintNodes),
            entryUrl: `app://plugins/${id}/${version}/runtime.js`,
        };
    }

    const dependencies = table([
        {
            id: "acme.declared",
            builtIn: false,
            authoredVersion: "1.0.0",
            hard: true,
            usedBy: { blueprintNode: ["acme.declared.node"] },
        },
        {
            id: "acme.soft",
            builtIn: false,
            authoredVersion: "1.0.0",
            hard: false,
            usedBy: { storage: ["plugin.acme.soft.items.json"] },
        },
    ]);
    const installed = [
        { id: "acme.declared", version: "1.0.0", enabled: true },
        { id: "acme.soft", version: "1.0.0", enabled: true },
        // Enabled, and the project's table has never heard of it. This is the case that used to
        // divide the two.
        { id: "acme.undeclared", version: "1.0.0", enabled: true },
    ];

    it("answers the same plugin ids for a pack source and for a Dev Mode descriptor", () => {
        const build = selectProjectRuntimePlugins({
            dependencies,
            available: [
                source("acme.declared", "1.0.0", ["acme.declared.node"]),
                source("acme.soft", "1.0.0"),
                source("acme.undeclared", "1.0.0", ["acme.undeclared.node"]),
            ],
            installed,
        });
        const devMode = selectProjectRuntimePlugins({
            dependencies,
            available: [
                descriptor("acme.declared", "1.0.0", ["acme.declared.node"]),
                descriptor("acme.soft", "1.0.0"),
                descriptor("acme.undeclared", "1.0.0", ["acme.undeclared.node"]),
            ],
            installed,
        });

        expect(devMode.selected.map(item => item.manifest.id)).toEqual(["acme.declared"]);
        expect(devMode.selected.map(item => item.manifest.id))
            .toEqual(build.selected.map(item => item.manifest.id));
        expect(devMode.excluded).toEqual(build.excluded);
    });

    it("says why each excluded plugin is excluded, so a host can name it", () => {
        const selection = selectProjectRuntimePlugins({
            dependencies: table([{
                id: "acme.old",
                name: "Acme Old",
                builtIn: false,
                authoredVersion: "1.0.0",
                hard: true,
                usedBy: { blueprintNode: ["acme.old.node"] },
            }]),
            available: [
                descriptor("acme.old", "2.0.0", ["acme.old.node"]),
                descriptor("acme.undeclared", "1.0.0"),
            ],
            installed: [
                { id: "acme.old", version: "2.0.0", enabled: true },
                { id: "acme.undeclared", version: "1.0.0", enabled: true },
            ],
        });

        // Two different silences, and an author acts on them differently: one is a rescan, the
        // other is a plugin that cannot serve this project whatever the table says.
        expect(selection.excluded).toEqual([
            { pluginId: "acme.old", pluginName: "acme.old", reason: "unusable" },
            { pluginId: "acme.undeclared", pluginName: "acme.undeclared", reason: "notDeclared" },
        ]);
    });

    it("is the function the Dev Mode window's plugin list actually calls", () => {
        // The seam no fixture can hold: the handler could filter the list itself again and every
        // test above would still pass. That is exactly what it used to do.
        const handler = fs.readFileSync(
            path.resolve(__dirname, "../window/handlers/pluginManagerAction.ts"),
            "utf8",
        );
        expect(handler).toContain("selectProjectRuntimePlugins(");
        expect(
            handler.includes("resolveDependencies("),
            "the Dev Mode plugin list resolves the dependency table itself again, which is how its "
            + "rule drifted from the build's in the first place",
        ).toBe(false);
    });
});
