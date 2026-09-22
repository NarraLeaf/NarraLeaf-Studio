import { describe, expect, it } from "vitest";
import {
    attributeByNamespace,
    buildDependencyTable,
    collectBlueprintDocumentUsage,
    collectInterfaceDocumentUsage,
    type DependencyUsageRecord,
    type InstalledPlugin,
    type TypeOwnership,
} from "./ProjectDependencyService";
import { PROJECT_DEPENDENCY_SCHEMA_VERSION, type ProjectDependencyTable } from "@shared/types/pluginDependencies";
import type { BlueprintDocument } from "@shared/types/blueprint/document";

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

/** A node of a plugin that is not loaded, recognised by the name of its type. */
function namedUsage(pluginId: string, id: string, kind: DependencyUsageRecord["kind"] = "blueprintNode"): DependencyUsageRecord {
    return { pluginId, kind, id, hard: true, byName: true };
}

function table(...plugins: ProjectDependencyTable["plugins"]): ProjectDependencyTable {
    return { schemaVersion: PROJECT_DEPENDENCY_SCHEMA_VERSION, plugins };
}

const EFFECTS_ROW = {
    id: "acme.effects",
    name: "Acme Effects",
    builtIn: false,
    authoredVersion: "2.1.0",
    hard: true,
    usedBy: { blueprintNode: ["acme.effects.shake"] },
};

describe("buildDependencyTable", () => {
    it("maps a used plugin node to a hard dependency with the installed version", () => {
        const result = buildDependencyTable({
            usage: [usage("narraleaf.gallery", "narraleaf.gallery.add")],
            installed: [GALLERY],
            complete: true,
        });
        expect(result.schemaVersion).toBe(PROJECT_DEPENDENCY_SCHEMA_VERSION);
        expect(result.plugins).toEqual([
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
        const result = buildDependencyTable({
            usage: [usage("narraleaf.gallery", "narraleaf.gallery.add")],
            installed: [GALLERY],
            existing: table({
                id: "narraleaf.gallery",
                builtIn: true,
                authoredVersion: "1.0.0",
                hard: true,
                usedBy: { blueprintNode: ["narraleaf.gallery.add", "narraleaf.gallery.clear"] },
            }),
            complete: true,
        });
        expect(result.plugins[0].authoredVersion).toBe("1.2.0");
        expect(result.plugins[0].usedBy.blueprintNode).toEqual(["narraleaf.gallery.add"]);
    });

    it("drops a loaded plugin that is no longer used at all", () => {
        const result = buildDependencyTable({
            usage: [],
            installed: [GALLERY],
            existing: table({ id: "narraleaf.gallery", builtIn: true, authoredVersion: "1.0.0", hard: true, usedBy: {} }),
            complete: true,
        });
        expect(result.plugins).toEqual([]);
    });

    it("drops a plugin that is not installed once nothing in the project refers to it", () => {
        // The trap this rule closes: an absent plugin cannot claim its types, so its row used to be
        // kept whatever the project did - and a headless run refuses a project whose declared
        // plugin it cannot load, over a plugin the project no longer uses and the author cannot
        // remove from a table nobody edits by hand.
        const result = buildDependencyTable({
            usage: [],
            installed: [GALLERY],
            existing: table(EFFECTS_ROW),
            complete: true,
        });
        expect(result.plugins).toEqual([]);
    });

    it("drops a plugin that is switched off once nothing in the project refers to it", () => {
        const result = buildDependencyTable({
            usage: [],
            installed: [{ id: "acme.effects", version: "2.1.0", enabled: false, builtIn: false, name: "Acme Effects" }],
            existing: table(EFFECTS_ROW),
            complete: true,
        });
        expect(result.plugins).toEqual([]);
    });

    it("keeps an absent plugin's row while its types are still in the project", () => {
        const result = buildDependencyTable({
            usage: [namedUsage("acme.effects", "acme.effects.shake")],
            installed: [GALLERY],
            existing: table(EFFECTS_ROW),
            complete: true,
        });
        expect(result.plugins).toEqual([EFFECTS_ROW]);
    });

    it("keeps the recorded version of a plugin known only by the names of its types", () => {
        // Installed at another major, so withheld from the project and not loaded: moving the
        // recorded version to the installed one would lift that suppression on the next scan.
        const result = buildDependencyTable({
            usage: [namedUsage("acme.effects", "acme.effects.shake")],
            installed: [{ id: "acme.effects", version: "3.0.0", enabled: true, builtIn: false, name: "Acme Effects" }],
            existing: table(EFFECTS_ROW),
            complete: true,
        });
        expect(result.plugins[0].authoredVersion).toBe("2.1.0");
    });

    it("records what the project uses now, not what it once did, for a plugin that is not loaded", () => {
        const result = buildDependencyTable({
            usage: [namedUsage("acme.effects", "acme.effects.glow", "widget")],
            installed: [],
            existing: table(EFFECTS_ROW),
            complete: true,
        });
        expect(result.plugins[0].usedBy).toEqual({ widget: ["acme.effects.glow"] });
    });

    it("gives a switched-off plugin whose types the project uses a row, at the installed version", () => {
        const result = buildDependencyTable({
            usage: [namedUsage("narraleaf.gallery", "narraleaf.gallery.add")],
            installed: [{ ...GALLERY, enabled: false }],
            complete: true,
        });
        expect(result.plugins).toEqual([{
            id: "narraleaf.gallery",
            name: "NarraLeaf Gallery",
            publisher: "NarraLeaf",
            builtIn: true,
            authoredVersion: "1.2.0",
            hard: true,
            usedBy: { blueprintNode: ["narraleaf.gallery.add"] },
        }]);
    });

    it("keeps a store's uses and a node's together for a plugin that is not loaded", () => {
        // A store is attributable from its filename and a node from its name, so neither is allowed
        // to rewrite the row as though the other were not there.
        const result = buildDependencyTable({
            usage: [
                namedUsage("narraleaf.gallery", "narraleaf.gallery.add"),
                { pluginId: "narraleaf.gallery", kind: "storage", id: "plugin__narraleaf.gallery__items", hard: true },
            ],
            installed: [{ ...GALLERY, enabled: false }],
            existing: table({ id: "narraleaf.gallery", builtIn: true, authoredVersion: "1.2.0", hard: true, usedBy: {} }),
            complete: true,
        });
        expect(result.plugins[0].hard).toBe(true);
        expect(result.plugins[0].usedBy).toEqual({
            blueprintNode: ["narraleaf.gallery.add"],
            storage: ["plugin__narraleaf.gallery__items"],
        });
    });

    it("drops nothing when the scan could not read every document", () => {
        const result = buildDependencyTable({
            usage: [],
            installed: [GALLERY],
            existing: table(EFFECTS_ROW, { id: "narraleaf.gallery", builtIn: true, authoredVersion: "1.2.0", hard: true, usedBy: {} }),
            complete: false,
        });
        expect(result.plugins.map(plugin => plugin.id)).toEqual(["acme.effects", "narraleaf.gallery"]);
    });

    it("keeps recorded uses alongside the ones found when the scan was incomplete", () => {
        const result = buildDependencyTable({
            usage: [usage("narraleaf.gallery", "narraleaf.gallery.add")],
            installed: [GALLERY],
            existing: table({
                id: "narraleaf.gallery",
                builtIn: true,
                authoredVersion: "1.2.0",
                hard: true,
                usedBy: { widget: ["narraleaf.gallery.card"] },
            }),
            complete: false,
        });
        expect(result.plugins[0].usedBy).toEqual({
            blueprintNode: ["narraleaf.gallery.add"],
            widget: ["narraleaf.gallery.card"],
        });
    });

    it("records a storage-only usage as a soft dependency", () => {
        const result = buildDependencyTable({
            usage: [{ pluginId: "acme.data", kind: "storage", id: "plugin__acme.data__prefs", hard: false }],
            installed: [{ id: "acme.data", version: "1.0.0", enabled: true, builtIn: false }],
            existing: undefined,
            complete: true,
        });
        expect(result.plugins).toHaveLength(1);
        expect(result.plugins[0].hard).toBe(false);
        expect(result.plugins[0].usedBy.storage).toEqual(["plugin__acme.data__prefs"]);
    });

    it("keeps a store hard when the plugin whose manifest says so is not installed to ask", () => {
        const result = buildDependencyTable({
            usage: [{ pluginId: "acme.menu", kind: "storage", id: "plugin__acme.menu__acme.menu.items", hard: false }],
            installed: [],
            existing: table({
                id: "acme.menu",
                builtIn: false,
                authoredVersion: "1.0.0",
                hard: true,
                usedBy: { storage: ["plugin__acme.menu__acme.menu.items"] },
            }),
            complete: true,
        });
        expect(result.plugins[0].hard).toBe(true);
    });

    it("drops a plugin whose only use was a store that is gone", () => {
        const result = buildDependencyTable({
            usage: [],
            installed: [{ id: "acme.menu", version: "1.0.0", enabled: true, builtIn: false }],
            existing: table({
                id: "acme.menu",
                builtIn: false,
                authoredVersion: "1.0.0",
                hard: true,
                usedBy: { storage: ["plugin__acme.menu__acme.menu.items"] },
            }),
            complete: true,
        });
        expect(result.plugins).toEqual([]);
    });

    it("records a published storage namespace as a hard dependency", () => {
        // The case a data-only plugin lives or dies by: it contributes no node and no widget, so a
        // soft classification drops it from every pack as "enabled but unused" and its feature
        // silently does not exist in the built game.
        const result = buildDependencyTable({
            usage: [{
                pluginId: "narraleaf.menu-bar",
                kind: "storage",
                id: "plugin__narraleaf.menu-bar__narraleaf.menu-bar.menu",
                hard: true,
            }],
            installed: [],
            existing: undefined,
            complete: true,
        });
        expect(result.plugins[0]?.hard).toBe(true);
    });

    it("marks a plugin hard when it has both a node reference and storage", () => {
        const result = buildDependencyTable({
            usage: [
                usage("acme.kit", "acme.kit.spin"),
                { pluginId: "acme.kit", kind: "storage", id: "plugin__acme.kit__state", hard: false },
            ],
            installed: [{ id: "acme.kit", version: "1.0.0", enabled: true, builtIn: false }],
            complete: true,
        });
        expect(result.plugins[0].hard).toBe(true);
        expect(Object.keys(result.plugins[0].usedBy).sort()).toEqual(["blueprintNode", "storage"]);
    });

    it("merges usedBy across kinds and dedupes/sorts ids", () => {
        const result = buildDependencyTable({
            usage: [
                { pluginId: "acme.kit", kind: "widget", id: "acme.kit.card", hard: true },
                { pluginId: "acme.kit", kind: "widget", id: "acme.kit.card", hard: true },
                { pluginId: "acme.kit", kind: "blueprintNode", id: "acme.kit.spin", hard: true },
            ],
            installed: [{ id: "acme.kit", version: "3.0.0", enabled: true, builtIn: false }],
            complete: true,
        });
        expect(result.plugins[0].usedBy).toEqual({
            blueprintNode: ["acme.kit.spin"],
            widget: ["acme.kit.card"],
        });
    });
});

describe("attributeByNamespace", () => {
    it("reads a plugin's id off the front of its type", () => {
        expect(attributeByNamespace("acme.fx.shake", ["narraleaf.gallery", "acme.fx"])).toBe("acme.fx");
    });

    it("takes the longest id that the type is namespaced under", () => {
        expect(attributeByNamespace("acme.fx.pro.glow", ["acme.fx", "acme.fx.pro"])).toBe("acme.fx.pro");
        expect(attributeByNamespace("acme.fx.pro.glow", ["acme.fx.pro", "acme.fx"])).toBe("acme.fx.pro");
    });

    it("needs the whole id, not a prefix of one", () => {
        expect(attributeByNamespace("acme.fxtra.shake", ["acme.fx"])).toBeUndefined();
        expect(attributeByNamespace("acme.fx", ["acme.fx"])).toBeUndefined();
    });

    it("answers nothing for a type no candidate owns", () => {
        expect(attributeByNamespace("nl.text", ["acme.fx"])).toBeUndefined();
    });
});

/** Studio knows `nl.*` and `blueprint.*`; `acme.kit` is loaded; `acme.fx` is recorded but not loaded. */
const OWNERSHIP: TypeOwnership = {
    ownerOf: type => (type.startsWith("acme.kit.") ? "acme.kit" : undefined),
    isRegistered: type => type.startsWith("nl.") || type.startsWith("blueprint.") || type.startsWith("acme.kit."),
    candidatePluginIds: ["acme.kit", "acme.fx"],
};

describe("collectInterfaceDocumentUsage", () => {
    it("claims a loaded plugin's widget through its registration and an unloaded one's by name", () => {
        const records = collectInterfaceDocumentUsage({
            elements: {
                a: { type: "nl.text" },
                b: { type: "acme.kit.card" },
                c: { type: "acme.fx.badge" },
                d: { type: "someone.else.widget" },
            },
            components: [{ elements: { e: { type: "acme.fx.meter" } } }],
        }, OWNERSHIP);
        expect(records).toEqual([
            { pluginId: "acme.kit", kind: "widget", id: "acme.kit.card", hard: true },
            { pluginId: "acme.fx", kind: "widget", id: "acme.fx.badge", hard: true, byName: true },
            { pluginId: "acme.fx", kind: "widget", id: "acme.fx.meter", hard: true, byName: true },
        ]);
    });
});

describe("collectBlueprintDocumentUsage", () => {
    it("reads nodes from event layers, functions and macros alike", () => {
        const graph = (types: string[]) => ({
            graph: { nodes: Object.fromEntries(types.map((type, index) => [`n${index}`, { type }])) },
        });
        const document = {
            blueprints: {
                one: {
                    graphs: {
                        events: { main: graph(["blueprint.event.init", "acme.fx.shake"]) },
                        functions: { f: graph(["acme.kit.spin"]) },
                        macros: { m: graph(["acme.fx.glow"]) },
                    },
                },
            },
        } as unknown as BlueprintDocument;
        expect(collectBlueprintDocumentUsage(document, OWNERSHIP)).toEqual([
            { pluginId: "acme.fx", kind: "blueprintNode", id: "acme.fx.shake", hard: true, byName: true },
            { pluginId: "acme.kit", kind: "blueprintNode", id: "acme.kit.spin", hard: true },
            { pluginId: "acme.fx", kind: "blueprintNode", id: "acme.fx.glow", hard: true, byName: true },
        ]);
    });
});
