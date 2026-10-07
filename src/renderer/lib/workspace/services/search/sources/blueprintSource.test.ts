import { afterEach, describe, expect, it, vi } from "vitest";
import { blueprintSource, extractBlueprintEntries } from "./blueprintSource";
import { dedupSearchEntries } from "../searchSource";
import { indexEntries, querySearchIndex, type SearchIndexEntry } from "../searchIndexModel";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { createTranslator } from "@shared/i18n";
import { i18nStore } from "@/lib/i18n";
import { Services, type WorkspaceContext } from "../../services";
import { componentWidgetMainOwnerKey, widgetMainOwnerKey } from "../../ui-editor/blueprint/ownerKeys";

function blueprintDoc(): BlueprintDocument {
    return {
        schemaVersion: 1,
        ownerRecords: {
            globalMain: { blueprintId: "bp-global" },
            "surfaceMain:surf-1": { blueprintId: "bp-1" },
        },
        blueprints: {
            "bp-global": {
                id: "bp-global",
                name: "Global",
                owner: {} as never,
                graphs: { events: {}, functions: {} },
            },
            "bp-1": {
                id: "bp-1",
                name: "Main Menu Logic",
                owner: {} as never,
                members: {
                    variables: { mv1: { id: "mv1", name: "Menu Open" } as never },
                    fields: {},
                },
                graphs: {
                    events: {
                        "ev-1": {
                            name: "On Click",
                            graph: {
                                nodes: {
                                    n1: { id: "n1", type: "flow.branch" },
                                    // Three of a kind: two indistinguishable, one carrying a literal.
                                    s1: { id: "s1", type: "image.setAsset" },
                                    s2: { id: "s2", type: "image.setAsset" },
                                    s3: {
                                        id: "s3",
                                        type: "image.setAsset",
                                        params: {
                                            slot: 3,
                                            loop: true,
                                            assetId: "6f1c9a2e-2b7d-4c5e-9a10-77b3c0d1e2f4",
                                            label: "forest at dusk",
                                            note: "second pass",
                                        },
                                    },
                                },
                            },
                        } as never,
                        // A sibling layer with the SAME name — the shape that survived a
                        // per-graph dedup and put four identical rows on screen.
                        "ev-2": {
                            name: "On Click",
                            graph: { nodes: { s4: { id: "s4", type: "image.setAsset" } } },
                        } as never,
                    },
                    functions: {
                        "fn-1": { graph: { nodes: { n2: { id: "n2", type: "custom.unknown" } } } } as never,
                    },
                },
            },
            "bp-orphan": {
                id: "bp-orphan",
                name: "Orphan",
                owner: {} as never,
                members: { variables: { ov: { id: "ov", name: "Unreachable" } as never }, fields: {} },
                graphs: { events: {}, functions: {} },
            },
        },
    } as unknown as BlueprintDocument;
}

const labels = { unnamedEvent: "Unnamed event", unnamedFunction: "Unnamed function" };
const resolveNodeLabel = (type: string) => {
    if (type === "flow.branch") return "Branch";
    if (type === "image.setAsset") return "Set Image Asset";
    return undefined;
};

function extractRaw(resolveOwnerLabel?: (ownerKey: string) => string | undefined): SearchIndexEntry[] {
    return extractBlueprintEntries(blueprintDoc(), {
        resolveNodeLabel,
        resolveOwnerLabel,
        registryVariables: [
            { id: "pv1", name: "Total Playtime", valueType: "json", storageKey: "pv1", scope: "persistent" },
            { id: "sv1", name: "Chapter Reached", valueType: "number", storageKey: "sv1", scope: "saved" },
        ],
        labels,
    });
}

/**
 * What the index actually holds: the extractor's output run through the source's declared
 * `dedupKey`, exactly as `SearchIndexEngine` does it. The collapsing is the framework's now, so the
 * assertions about it are assertions about the composition.
 */
function extract(resolveOwnerLabel?: (ownerKey: string) => string | undefined): SearchIndexEntry[] {
    return dedupSearchEntries(extractRaw(resolveOwnerLabel), blueprintSource.dedupKey!);
}

const entries = extract(ownerKey => (ownerKey === "surfaceMain:surf-1" ? "Main Menu › Portrait" : undefined));

describe("extractBlueprintEntries", () => {
    it("indexes the blueprint itself, named by what it hangs on", () => {
        expect(entries.find(e => e.group === "blueprint" && e.text === "Main Menu Logic")).toMatchObject({
            text: "Main Menu Logic",
            detail: "Main Menu › Portrait",
            target: { kind: "blueprint", blueprintId: "bp-1", ownerKey: "surfaceMain:surf-1" },
        });
    });

    it("indexes member variables with the owner key for jumping", () => {
        const memberVar = entries.find(e => e.text === "Menu Open");
        expect(memberVar).toMatchObject({
            group: "variable",
            detail: "Main Menu Logic › Main Menu › Portrait",
            target: { kind: "blueprint", blueprintId: "bp-1", ownerKey: "surfaceMain:surf-1" },
        });
    });

    it("indexes persistent variables against the global blueprint", () => {
        const persistent = entries.find(e => e.text === "Total Playtime");
        expect(persistent).toMatchObject({ target: { kind: "blueprint", blueprintId: "bp-global", ownerKey: "globalMain" } });
    });

    // A saved variable that lives only in the registry - which, after the declaration migration, is
    // every saved variable - used to be unreachable from search entirely while its persistent
    // sibling was indexed.
    it("indexes registry SAVED variables too, not just persistent ones", () => {
        const saved = entries.find(e => e.text === "Chapter Reached");
        expect(saved).toMatchObject({
            group: "variable",
            target: { kind: "blueprint", blueprintId: "bp-global", ownerKey: "globalMain" },
        });
    });

    // The two scopes have separate entry id spaces, so the scope has to be in the id or one scope's
    // row could shadow the other's.
    it("keys a registry row by scope so the two id spaces cannot collide", () => {
        expect(entries.find(e => e.text === "Total Playtime")?.id).toBe("bpvar:persistent:pv1");
        expect(entries.find(e => e.text === "Chapter Reached")?.id).toBe("bpvar:saved:sv1");
    });

    it("resolves node labels through the catalog and falls back to the raw type", () => {
        const branch = entries.find(e => e.group === "blueprintNode" && e.text === "Branch");
        expect(branch).toMatchObject({
            target: { kind: "blueprint", blueprintId: "bp-1", focusEventId: "ev-1", focusNodeId: "n1" },
        });
        const raw = entries.find(e => e.group === "blueprintNode" && e.text === "custom.unknown");
        expect(raw).toMatchObject({
            target: { kind: "blueprint", focusFunctionId: "fn-1", focusNodeId: "n2" },
        });
    });

    it("says where a node lives: owner › graph, not just the blueprint's name", () => {
        expect(entries.find(e => e.group === "blueprintNode" && e.text === "Branch")?.detail)
            .toBe("Main Menu › Portrait › On Click");
    });

    it("falls back to the blueprint name when the owner cannot be named", () => {
        const anonymous = extract();
        expect(anonymous.find(e => e.group === "blueprintNode" && e.text === "Branch")?.detail)
            .toBe("Main Menu Logic › On Click");
    });

    // The reported failure: eight identical "Set Image Asset · Blueprint Nodes" rows.
    it("collapses indistinguishable nodes into one row carrying the count", () => {
        const setters = entries.filter(e => e.group === "blueprintNode" && e.text === "Set Image Asset");
        expect(setters).toHaveLength(2);
        const collapsed = setters.find(e => e.detail === "Main Menu › Portrait › On Click");
        // s1 + s2 in "On Click", plus s4 in the identically-named sibling layer.
        expect(collapsed?.count).toBe(3);
        expect(collapsed?.target).toMatchObject({ focusNodeId: "s1" });
    });

    it("never emits two rows a person could not tell apart", () => {
        const shown = entries
            .filter(e => e.group === "blueprintNode")
            .map(e => `${e.text}|${e.detail}`);
        expect(new Set(shown).size).toBe(shown.length);
    });

    it("keeps a node whose own literals tell it apart, and shows them", () => {
        const distinct = entries.find(e => e.group === "blueprintNode" && e.detail?.startsWith("forest at dusk"));
        expect(distinct).toMatchObject({
            text: "Set Image Asset",
            detail: "forest at dusk · Main Menu › Portrait › On Click",
            // Remaining literals stay searchable without crowding the row.
            aux: "second pass",
        });
        // It stands for itself alone, so no count badge.
        expect(distinct?.count).toBeUndefined();
    });

    it("ignores ids, numbers and booleans when looking for a distinguishing literal", () => {
        const distinct = entries.find(e => e.group === "blueprintNode" && e.detail?.startsWith("forest at dusk"));
        expect(distinct?.aux).not.toContain("6f1c9a2e");
        expect(distinct?.aux).not.toContain("true");
    });

    it("shows a called function by its name and a built-in surface not at all, never their ids", () => {
        const doc = {
            schemaVersion: 1,
            ownerRecords: { "surfaceMain:surf-1": { blueprintId: "bp-1" } },
            blueprints: {
                "bp-1": {
                    id: "bp-1",
                    name: "Title Button",
                    owner: {} as never,
                    graphs: {
                        events: {
                            "ev-1": {
                                name: "On Click",
                                graph: {
                                    nodes: {
                                        c1: { id: "c1", type: "fn.call", params: { fn: "fn:885e69e4-c4dd-497d-bc30-d6a4895eaf1b:cueConfirmHead" } },
                                        c2: { id: "c2", type: "fn.call", params: { fn: "fn:885e69e4-c4dd-497d-bc30-d6a4895eaf1b:cueHoverHead" } },
                                        q1: { id: "q1", type: "app.quit", params: { surface: "narraleaf-studio:main-surface" } },
                                    },
                                },
                            } as never,
                        },
                        functions: {},
                    },
                },
            },
        } as unknown as BlueprintDocument;
        const rows = dedupSearchEntries(extractBlueprintEntries(doc, { resolveNodeLabel, labels }), blueprintSource.dedupKey!)
            .filter(e => e.group === "blueprintNode");
        const shown = rows.map(e => `${e.detail ?? ""} ${e.aux ?? ""}`).join(" | ");
        expect(shown).toContain("cueConfirmHead");
        expect(shown).toContain("cueHoverHead");
        expect(shown).not.toMatch(/885e69e4|fn:|narraleaf-studio:/);
    });

    it("names an unnamed graph rather than showing its id", () => {
        expect(entries.find(e => e.text === "custom.unknown")?.detail)
            .toBe("Main Menu › Portrait › Unnamed function");
    });

    it("skips blueprints without an owner record", () => {
        expect(entries.find(e => e.text === "Unreachable")).toBeUndefined();
        expect(entries.find(e => e.text === "Orphan")).toBeUndefined();
    });

    it("appends node rows after every blueprint and variable row", () => {
        const firstNode = entries.findIndex(e => e.group === "blueprintNode");
        const lastNonNode = entries.map(e => e.group !== "blueprintNode").lastIndexOf(true);
        expect(firstNode).toBeGreaterThan(lastNonNode);
    });
});

/**
 * Node rows in the author's language. The blueprint editor draws a node under the translation of
 * its catalogue name; search used to list the catalogue's English, so the row and the node it
 * opens named the same thing differently.
 */
describe("node rows in the interface language", () => {
    const TRANSLATED: Record<string, string> = { "flow.branch": "分支", "image.setAsset": "设置图片资产" };
    const CATALOGUED: Record<string, string> = { "flow.branch": "Branch", "image.setAsset": "Set Image Asset" };
    const translated = dedupSearchEntries(
        extractBlueprintEntries(blueprintDoc(), {
            resolveNodeLabel: type => TRANSLATED[type],
            resolveNodeAlias: type => CATALOGUED[type],
            resolveOwnerLabel: ownerKey => (ownerKey === "surfaceMain:surf-1" ? "Main Menu › Portrait" : undefined),
            labels,
        }),
        blueprintSource.dedupKey!,
    );
    const nodeTitles = (query: string) =>
        querySearchIndex(indexEntries(translated), query)
            .find(group => group.group === "blueprintNode")
            ?.hits.map(hit => hit.entry.text) ?? [];

    it("titles a node row with the label the editor draws", () => {
        const titles = translated.filter(e => e.group === "blueprintNode").map(e => e.text);
        expect(titles).toContain("分支");
        expect(titles).toContain("设置图片资产");
        expect(titles).not.toContain("Branch");
    });

    it("finds a node by that label", () => {
        expect(nodeTitles("分支")).toEqual(["分支"]);
    });

    it("still finds it by its catalogue name, which is searchable but not shown", () => {
        expect(nodeTitles("Branch")).toEqual(["分支"]);
        expect(translated.find(e => e.text === "分支")?.aux).toBe("Branch");
        // A node's own literals stay first; the catalogue name follows them.
        expect(translated.find(e => e.detail?.startsWith("forest at dusk"))?.aux).toBe("second pass Set Image Asset");
    });

    it("does not repeat a name that is the label itself", () => {
        const english = extractBlueprintEntries(blueprintDoc(), {
            resolveNodeLabel: type => CATALOGUED[type],
            resolveNodeAlias: type => CATALOGUED[type],
            labels,
        });
        expect(english.find(e => e.group === "blueprintNode" && e.text === "Branch")?.aux).toBeUndefined();
    });
});

describe("blueprintSource in a workspace", () => {
    /** One global blueprint holding a single Play Sound node, and the services the source reads. */
    function workspace(): WorkspaceContext {
        const document = {
            schemaVersion: 1,
            ownerRecords: { globalMain: { blueprintId: "bp-global" } },
            blueprints: {
                "bp-global": {
                    id: "bp-global",
                    name: "全局",
                    owner: {},
                    graphs: {
                        events: { "ev-1": { name: "界面音效", graph: { nodes: { n1: { id: "n1", type: "blueprint.sound.play" } } } } },
                        functions: {},
                    },
                },
            },
        };
        const services: Partial<Record<Services, unknown>> = {
            [Services.LocalBlueprint]: {
                getBlueprintDocument: () => document,
                listPersistentVariables: () => [],
                listSavedVariables: () => [],
            },
            [Services.BlueprintNodeCatalog]: {
                resolveCatalogEntry: (type: string) => ({ type, displayName: type === "blueprint.sound.play" ? "Play Sound" : type }),
            },
            [Services.UIDocument]: { getDocument: () => ({ surfaces: [], components: [], elements: {} }) },
            [Services.UIGraph]: { onGraphsChanged: () => () => undefined },
            [Services.VariableRegistry]: { onRegistryChanged: () => () => undefined },
        };
        return { services: { get: (id: Services) => services[id] } } as unknown as WorkspaceContext;
    }

    afterEach(() => {
        i18nStore.setLocale("en");
    });

    it("names a node the way the blueprint editor's own map translates it", async () => {
        i18nStore.setLocale("zh");
        const entries = await blueprintSource.extract(workspace(), undefined);
        const node = entries.find(e => e.group === "blueprintNode");
        expect(node?.text).toBe(createTranslator("zh").t("blueprint.node.playSound"));
        expect(node?.text).not.toBe("Play Sound");
        expect(node?.aux).toBe("Play Sound");
    });

    // A slice is built in one language; without this it kept that language until a blueprint was
    // next edited.
    it("rebuilds when the interface language changes, and stops listening when it is unwatched", () => {
        const invalidate = vi.fn();
        const stop = blueprintSource.watch(workspace(), { invalidate, invalidateAll: vi.fn() });
        i18nStore.setLocale("zh");
        expect(invalidate).toHaveBeenCalled();
        stop();
        invalidate.mockClear();
        i18nStore.setLocale("ja");
        expect(invalidate).not.toHaveBeenCalled();
    });
});

describe("what a blueprint hit says it hangs on", () => {
    /**
     * A page with a Start button, and a component with a control of its own. The page's element table
     * also holds an element under the component control's id, so a lookup in the wrong table is seen
     * printing the wrong name rather than just printing nothing.
     */
    function workspace(): WorkspaceContext {
        const pageButton = widgetMainOwnerKey("title", "start");
        const cardLabel = componentWidgetMainOwnerKey("card", "label");
        const document = {
            schemaVersion: 1,
            ownerRecords: { [pageButton]: { blueprintId: "bp-start" }, [cardLabel]: { blueprintId: "bp-label" } },
            blueprints: {
                "bp-start": { id: "bp-start", name: "Button", owner: {}, graphs: { events: {}, functions: {} } },
                "bp-label": { id: "bp-label", name: "Text", owner: {}, graphs: { events: {}, functions: {} } },
            },
        };
        const uiDocument = {
            surfaces: [{ id: "title", name: "Title" }],
            components: [{ id: "card", name: "Save card", elements: { label: { id: "label", type: "nl.text", name: "Slot name" } } }],
            elements: {
                start: { id: "start", type: "nl.button", name: "Start" },
                label: { id: "label", type: "nl.text", name: "Not the component's" },
            },
        };
        const services: Partial<Record<Services, unknown>> = {
            [Services.LocalBlueprint]: {
                getBlueprintDocument: () => document,
                listPersistentVariables: () => [],
                listSavedVariables: () => [],
            },
            [Services.BlueprintNodeCatalog]: { resolveCatalogEntry: (type: string) => ({ type, displayName: type }) },
            [Services.UIDocument]: { getDocument: () => uiDocument },
        };
        return { services: { get: (id: Services) => services[id] } } as unknown as WorkspaceContext;
    }

    async function detailOf(blueprintId: string): Promise<string | undefined> {
        const entries = await blueprintSource.extract(workspace(), undefined);
        return entries.find(e => e.group === "blueprint" && e.target.kind === "blueprint" && e.target.blueprintId === blueprintId)
            ?.detail;
    }

    it("names a page control by its page and its own name", async () => {
        expect(await detailOf("bp-start")).toBe("Title › Start");
    });

    // The control's name was looked up in the page document's element table, where a component's
    // controls never are, so the hit said only which component and never which control in it.
    it("names a component control by its component and its own name, from the component's table", async () => {
        expect(await detailOf("bp-label")).toBe("Save card › Slot name");
    });
});

describe("blueprintSource.dedupKey", () => {
    it("collapses only node rows, and only the ones whose title and context line both match", () => {
        const raw = extractRaw(ownerKey => (ownerKey === "surfaceMain:surf-1" ? "Main Menu › Portrait" : undefined));
        // One entry per node before the pass: s1, s2, s3, s4 are four separate nodes.
        expect(raw.filter(e => e.group === "blueprintNode" && e.text === "Set Image Asset")).toHaveLength(4);
        expect(raw.every(e => e.count === undefined)).toBe(true);
    });

    it("never collapses a blueprint or a variable, however alike they look", () => {
        const twins: SearchIndexEntry[] = [
            { id: "bp:a", group: "blueprint", text: "Image", detail: "Main Menu", target: { kind: "blueprint", blueprintId: "a", ownerKey: "surfaceMain:s" } },
            { id: "bp:b", group: "blueprint", text: "Image", detail: "Main Menu", target: { kind: "blueprint", blueprintId: "b", ownerKey: "surfaceMain:s" } },
        ];
        expect(dedupSearchEntries(twins, blueprintSource.dedupKey!)).toHaveLength(2);
    });
});

describe("story blueprints nobody named", () => {
    function storyDoc(): BlueprintDocument {
        const story = (id: string) => ({
            id,
            name: "Story Action",
            owner: { kind: "storyAction", blueprintId: id },
            graphs: { events: {}, functions: {} },
        });
        return {
            schemaVersion: 1,
            ownerRecords: { [`storyAction:${"s-1"}`]: { blueprintId: "s-1" }, [`storyAction:${"s-2"}`]: { blueprintId: "s-2" } },
            blueprints: { "s-1": story("s-1"), "s-2": story("s-2") },
        } as unknown as BlueprintDocument;
    }

    it("are listed by what they do, so two of them read differently", () => {
        const entries = extractBlueprintEntries(storyDoc(), {
            resolveNodeLabel: () => undefined,
            labels,
            describeStoryBlueprint: blueprint => (blueprint.id === "s-1" ? "Confirm sound" : "Back sound"),
        });
        const titles = entries.filter(entry => entry.group === "blueprint").map(entry => entry.text).sort();
        expect(titles).toEqual(["Back sound", "Confirm sound"]);
    });
});
