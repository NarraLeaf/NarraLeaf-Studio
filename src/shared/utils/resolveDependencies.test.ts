import { describe, expect, it } from "vitest";
import { resolveDependencies, type InstalledPluginInfo } from "./resolveDependencies";
import {
    PROJECT_DEPENDENCY_SCHEMA_VERSION,
    normalizeProjectDependencyTable,
    type ProjectDependencyTable,
    type ProjectPluginDependency,
} from "../types/pluginDependencies";

function dep(overrides: Partial<ProjectPluginDependency> & Pick<ProjectPluginDependency, "id">): ProjectPluginDependency {
    return {
        builtIn: true,
        authoredVersion: "1.0.0",
        hard: true,
        usedBy: {},
        ...overrides,
    };
}

function table(plugins: ProjectPluginDependency[]): ProjectDependencyTable {
    return { schemaVersion: PROJECT_DEPENDENCY_SCHEMA_VERSION, plugins };
}

function installed(entries: Array<Partial<InstalledPluginInfo> & Pick<InstalledPluginInfo, "id">>): InstalledPluginInfo[] {
    return entries.map(entry => ({ version: "1.0.0", enabled: true, ...entry }));
}

describe("resolveDependencies", () => {
    it("marks a matching plugin satisfied and not suppressed", () => {
        const result = resolveDependencies(table([dep({ id: "a.b", authoredVersion: "1.2.0" })]), installed([{ id: "a.b", version: "1.4.0" }]));
        expect(result.entries[0].status).toBe("satisfied");
        expect(result.suppressedPluginIds).toEqual([]);
        expect(result.overall).toBe("ok");
    });

    it("suppresses a hard dependency whose major is incompatible", () => {
        const result = resolveDependencies(table([dep({ id: "a.b", authoredVersion: "1.0.0" })]), installed([{ id: "a.b", version: "2.0.0" }]));
        expect(result.entries[0].status).toBe("incompatible");
        expect(result.entries[0].suppressed).toBe(true);
        expect(result.suppressedPluginIds).toEqual(["a.b"]);
        expect(result.overall).toBe("blocked");
    });

    it("does not suppress a soft dependency even when incompatible", () => {
        const result = resolveDependencies(table([dep({ id: "a.b", hard: false, authoredVersion: "1.0.0" })]), installed([{ id: "a.b", version: "2.0.0" }]));
        expect(result.entries[0].status).toBe("incompatible");
        expect(result.entries[0].suppressed).toBe(false);
        expect(result.overall).toBe("warnings");
    });

    it("suppresses a hard dependency that is missing entirely", () => {
        const result = resolveDependencies(table([dep({ id: "a.b" })]), installed([]));
        expect(result.entries[0].status).toBe("missing");
        expect(result.entries[0].suppressed).toBe(true);
        expect(result.overall).toBe("blocked");
    });

    it("reports an older same-major install as outdated (warn, not suppressed)", () => {
        const result = resolveDependencies(table([dep({ id: "a.b", authoredVersion: "1.5.0" })]), installed([{ id: "a.b", version: "1.2.0" }]));
        expect(result.entries[0].status).toBe("outdated");
        expect(result.entries[0].suppressed).toBe(false);
        expect(result.overall).toBe("warnings");
    });
});

describe("normalizeProjectDependencyTable", () => {
    it("returns undefined for non-table input", () => {
        expect(normalizeProjectDependencyTable(null)).toBeUndefined();
        expect(normalizeProjectDependencyTable({})).toBeUndefined();
        expect(normalizeProjectDependencyTable({ plugins: "nope" })).toBeUndefined();
    });

    it("drops malformed plugin entries and sorts the rest by id", () => {
        const normalized = normalizeProjectDependencyTable({
            schemaVersion: 1,
            plugins: [
                { id: "z.plugin", authoredVersion: "1.0.0", builtIn: true, hard: true },
                { id: "", authoredVersion: "1.0.0" },
                { authoredVersion: "1.0.0" },
                { id: "a.plugin", authoredVersion: "2.0.0", usedBy: { blueprintNode: ["a.plugin.x", "a.plugin.x", 5] } },
            ],
        });
        expect(normalized?.plugins.map(p => p.id)).toEqual(["a.plugin", "z.plugin"]);
        expect(normalized?.plugins[0].usedBy.blueprintNode).toEqual(["a.plugin.x"]);
        expect(normalized?.plugins[0].builtIn).toBe(false);
    });
});
