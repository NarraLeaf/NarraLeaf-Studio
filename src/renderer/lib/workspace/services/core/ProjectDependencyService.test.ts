import { describe, expect, it } from "vitest";
import {
    buildDependencyTable,
    type DependencyUsageRecord,
    type InstalledPlugin,
} from "./ProjectDependencyService";
import { PROJECT_DEPENDENCY_SCHEMA_VERSION, type ProjectDependencyTable } from "@shared/types/pluginDependencies";

const GALLERY: InstalledPlugin = {
    id: "narraleaf.gallery",
    version: "1.2.0",
    enabled: true,
    builtIn: true,
    name: "NarraLeaf Gallery",
    publisher: "NarraLeaf",
};

function usage(pluginId: string, id: string): DependencyUsageRecord {
    return { pluginId, kind: "blueprintNode", id, hard: true };
}

describe("buildDependencyTable", () => {
    it("maps a used plugin node to a hard dependency with the installed version", () => {
        const table = buildDependencyTable({
            usage: [usage("narraleaf.gallery", "narraleaf.gallery.add")],
            authoritativePluginIds: ["narraleaf.gallery"],
            installed: [GALLERY],
        });
        expect(table.schemaVersion).toBe(PROJECT_DEPENDENCY_SCHEMA_VERSION);
        expect(table.plugins).toEqual([
            {
                id: "narraleaf.gallery",
                name: "NarraLeaf Gallery",
                publisher: "NarraLeaf",
                builtIn: true,
                authoredVersion: "1.2.0",
                hard: true,
                usedBy: { blueprintNode: ["narraleaf.gallery.add"] },
            },
        ]);
    });

    it("refreshes authoredVersion and drops now-unused types for a loaded plugin", () => {
        const existing: ProjectDependencyTable = {
            schemaVersion: PROJECT_DEPENDENCY_SCHEMA_VERSION,
            plugins: [{
                id: "narraleaf.gallery",
                builtIn: true,
                authoredVersion: "1.0.0",
                hard: true,
                usedBy: { blueprintNode: ["narraleaf.gallery.add", "narraleaf.gallery.clear"] },
            }],
        };
        const table = buildDependencyTable({
            usage: [usage("narraleaf.gallery", "narraleaf.gallery.add")],
            authoritativePluginIds: ["narraleaf.gallery"],
            installed: [GALLERY],
            existing,
        });
        expect(table.plugins[0].authoredVersion).toBe("1.2.0");
        expect(table.plugins[0].usedBy.blueprintNode).toEqual(["narraleaf.gallery.add"]);
    });

    it("drops a loaded plugin that is no longer used at all", () => {
        const existing: ProjectDependencyTable = {
            schemaVersion: PROJECT_DEPENDENCY_SCHEMA_VERSION,
            plugins: [{ id: "narraleaf.gallery", builtIn: true, authoredVersion: "1.0.0", hard: true, usedBy: {} }],
        };
        const table = buildDependencyTable({
            usage: [],
            authoritativePluginIds: ["narraleaf.gallery"], // loaded but unused now
            installed: [GALLERY],
            existing,
        });
        expect(table.plugins).toEqual([]);
    });

    it("preserves a recorded dependency whose plugin is currently absent", () => {
        const existing: ProjectDependencyTable = {
            schemaVersion: PROJECT_DEPENDENCY_SCHEMA_VERSION,
            plugins: [{
                id: "acme.effects",
                name: "Acme Effects",
                builtIn: false,
                authoredVersion: "2.1.0",
                hard: true,
                usedBy: { blueprintNode: ["acme.effects.shake"] },
            }],
        };
        const table = buildDependencyTable({
            usage: [],
            authoritativePluginIds: [], // acme.effects not installed/loaded → cannot re-derive
            installed: [GALLERY],
            existing,
        });
        expect(table.plugins).toEqual(existing.plugins);
    });

    it("records a storage-only usage as a soft dependency", () => {
        const table = buildDependencyTable({
            usage: [{ pluginId: "acme.data", kind: "storage", id: "plugin__acme.data__prefs", hard: false }],
            authoritativePluginIds: [], // storage owners are not authoritative
            installed: [],
            existing: undefined,
        });
        expect(table.plugins).toHaveLength(1);
        expect(table.plugins[0].hard).toBe(false);
        expect(table.plugins[0].usedBy.storage).toEqual(["plugin__acme.data__prefs"]);
    });

    it("marks a plugin hard when it has both a node reference and storage", () => {
        const table = buildDependencyTable({
            usage: [
                usage("acme.kit", "acme.kit.spin"),
                { pluginId: "acme.kit", kind: "storage", id: "plugin__acme.kit__state", hard: false },
            ],
            authoritativePluginIds: ["acme.kit"],
            installed: [{ id: "acme.kit", version: "1.0.0", enabled: true, builtIn: false }],
        });
        expect(table.plugins[0].hard).toBe(true);
        expect(Object.keys(table.plugins[0].usedBy).sort()).toEqual(["blueprintNode", "storage"]);
    });

    it("merges usedBy across kinds and dedupes/sorts ids", () => {
        const table = buildDependencyTable({
            usage: [
                { pluginId: "acme.kit", kind: "widget", id: "acme.kit.card", hard: true },
                { pluginId: "acme.kit", kind: "widget", id: "acme.kit.card", hard: true },
                { pluginId: "acme.kit", kind: "blueprintNode", id: "acme.kit.spin", hard: true },
            ],
            authoritativePluginIds: ["acme.kit"],
            installed: [{ id: "acme.kit", version: "3.0.0", enabled: true, builtIn: false }],
        });
        expect(table.plugins[0].usedBy).toEqual({
            blueprintNode: ["acme.kit.spin"],
            widget: ["acme.kit.card"],
        });
    });
});
