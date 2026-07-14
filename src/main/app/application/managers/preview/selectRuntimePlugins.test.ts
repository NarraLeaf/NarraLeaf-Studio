import { describe, expect, it } from "vitest";
import type { ProjectDependencyTable } from "@shared/types/pluginDependencies";
import type { NormalizedPluginManifestV2 } from "@shared/types/plugins";
import { selectRuntimePluginsForPack } from "./selectRuntimePlugins";
import type { GameRuntimePluginSource } from "./compiler/gameRuntimeArtifactCompiler";

function manifest(id: string, version: string, blueprintNodes: string[] = [], widgets: string[] = []): NormalizedPluginManifestV2 {
    return {
        manifestVersion: 2,
        id,
        name: id,
        version,
        entries: { runtime: "runtime.js" },
        contributes: { blueprintNodes, widgets },
        permissions: [],
    };
}

function source(id: string, version: string, blueprintNodes: string[] = [], widgets: string[] = []): GameRuntimePluginSource {
    return {
        manifest: manifest(id, version, blueprintNodes, widgets),
        entry: "runtime.js",
        entryPath: `/plugins/${id}/runtime.js`,
    };
}

function table(plugins: ProjectDependencyTable["plugins"]): ProjectDependencyTable {
    return { schemaVersion: 1, plugins };
}

describe("selectRuntimePluginsForPack", () => {
    it("falls back to every enabled runtime plugin when the project has no dependency table", () => {
        const selection = selectRuntimePluginsForPack({
            dependencies: undefined,
            available: [source("acme.a", "1.0.0"), source("acme.b", "1.0.0")],
            installed: [],
        });

        expect(selection.fallbackAll).toBe(true);
        expect(selection.selected.map(item => item.manifest.id)).toEqual(["acme.a", "acme.b"]);
        expect(selection.errors).toEqual([]);
    });

    it("ships hard dependencies and skips unused enabled plugins", () => {
        const selection = selectRuntimePluginsForPack({
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
        expect(selection.skippedPluginIds).toEqual(["acme.unused"]);
        expect(selection.fallbackAll).toBe(false);
    });

    it("fails when a used blueprint node has no packaged runtime provider", () => {
        const selection = selectRuntimePluginsForPack({
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
        const selection = selectRuntimePluginsForPack({
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
        const selection = selectRuntimePluginsForPack({
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
        const selection = selectRuntimePluginsForPack({
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
        const selection = selectRuntimePluginsForPack({
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
        const selection = selectRuntimePluginsForPack({
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
        const selection = selectRuntimePluginsForPack({
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
