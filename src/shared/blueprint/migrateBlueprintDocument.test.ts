import { describe, expect, it } from "vitest";
import { encodeCanonicalJson } from "../documents/canonicalJson";
import type { Blueprint, BlueprintDocument, BlueprintGraphIndex } from "../types/blueprint/document";
import { LEGACY_INLINE_SCRIPT_META_KEY } from "../types/blueprint/document";
import { listBlueprintEventIds, listBlueprintFunctionIds } from "./blueprintEventOrder";
import { listScriptLayers } from "./blueprintLayers";
import { encodeBlueprintOwnerKey } from "./ownerKey";
import {
    BLUEPRINT_DOCUMENT_MIN_SUPPORTED_VERSION,
    migrateBlueprintDocumentToLatest,
} from "./migrateBlueprintDocument";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "../types/blueprint/schema";

describe("migrateBlueprintDocumentToLatest (v9→v10 graph-slot order)", () => {
    /** Ids chosen so alphabetical order and authored order are different lists. */
    const AUTHORED = ["zeta", "alpha", "mid"];
    const AUTHORED_FNS = ["yield", "banner", "nudge"];

    function slots(ids: string[]): Record<string, unknown> {
        return Object.fromEntries(ids.map(id => [id, { id, name: id, graph: { nodes: {}, edges: [] } }]));
    }

    function documentText(schemaVersion: number, stale?: { eventIds?: string[]; functionIds?: string[] }): string {
        return JSON.stringify({
            schemaVersion,
            // A record naming it: a blueprint no slot names is unreachable, and the v14 pass drops
            // one rather than leaving it in the map to be linted and diffed while never running.
            ownerRecords: { globalMain: { activeBlueprintId: "bp", privateBlueprintIds: ["bp"] } },
            blueprints: {
                bp: {
                    id: "bp",
                    name: "Main",
                    owner: { kind: "globalMain" },
                    graphs: {
                        ...(stale?.eventIds ? { eventIds: stale.eventIds } : {}),
                        events: slots(AUTHORED),
                        ...(stale?.functionIds ? { functionIds: stale.functionIds } : {}),
                        functions: slots(AUTHORED_FNS),
                    },
                },
            },
        });
    }

    function graphsOf(doc: BlueprintDocument): BlueprintGraphIndex {
        const bp = doc.blueprints.bp;
        if (!bp) {
            throw new Error("test fixture lost its graph program");
        }
        return bp.graphs;
    }

    it("derives the order from the parsed key order of a v9 document", () => {
        const migrated = migrateBlueprintDocumentToLatest(JSON.parse(documentText(9)));

        expect(migrated.schemaVersion).toBe(BLUEPRINT_DOCUMENT_SCHEMA_VERSION);
        expect(graphsOf(migrated).eventIds).toEqual(AUTHORED);
        expect(graphsOf(migrated).functionIds).toEqual(AUTHORED_FNS);
    });

    it("keeps the authored order across a canonical write, which reorders the records themselves", () => {
        // The whole point of the milestone in one test: the records come back sorted, and the
        // slot lists do not follow them. Populate the arrays any later than the parse and these
        // assertions are the sorted lists, with no way left to tell that they are wrong.
        const migrated = migrateBlueprintDocumentToLatest(JSON.parse(documentText(9)));
        const reread = JSON.parse(encodeCanonicalJson(migrated)) as BlueprintDocument;

        expect(Object.keys(graphsOf(reread).events)).toEqual(["alpha", "mid", "zeta"]);
        expect(Object.keys(graphsOf(reread).functions)).toEqual(["banner", "nudge", "yield"]);
        expect(listBlueprintEventIds(graphsOf(reread))).toEqual(AUTHORED);
        expect(listBlueprintFunctionIds(graphsOf(reread))).toEqual(AUTHORED_FNS);
    });

    it("is a no-op on an already-migrated document", () => {
        const once = migrateBlueprintDocumentToLatest(JSON.parse(documentText(9)));
        const twice = migrateBlueprintDocumentToLatest(JSON.parse(JSON.stringify(once)));

        expect(graphsOf(twice).eventIds).toEqual(AUTHORED);
        expect(encodeCanonicalJson(twice)).toBe(encodeCanonicalJson(once));
    });

    it("does not throw on a current-version document that is missing the field", () => {
        // Reachable through a hand-edited file, or a blueprint pasted in from an older export.
        const migrated = migrateBlueprintDocumentToLatest(
            JSON.parse(documentText(BLUEPRINT_DOCUMENT_SCHEMA_VERSION)),
        );

        expect(graphsOf(migrated).eventIds).toEqual(AUTHORED);
        expect(graphsOf(migrated).functionIds).toEqual(AUTHORED_FNS);
    });

    it("drops a listed slot that is gone and appends one that was never listed", () => {
        const migrated = migrateBlueprintDocumentToLatest(
            JSON.parse(
                documentText(BLUEPRINT_DOCUMENT_SCHEMA_VERSION, {
                    eventIds: ["mid", "deleted-elsewhere", "zeta"],
                    functionIds: ["nudge", "deleted-elsewhere", "yield"],
                }),
            ),
        );

        expect(graphsOf(migrated).eventIds).toEqual(["mid", "zeta", "alpha"]);
        expect(graphsOf(migrated).functionIds).toEqual(["nudge", "yield", "banner"]);
    });

    it("upgrades a v9 document that has no blueprints at all", () => {
        const migrated = migrateBlueprintDocumentToLatest({
            schemaVersion: BLUEPRINT_DOCUMENT_MIN_SUPPORTED_VERSION,
            blueprints: {},
            ownerRecords: {},
        });

        expect(migrated.schemaVersion).toBe(BLUEPRINT_DOCUMENT_SCHEMA_VERSION);
    });

    it.each([[2], [5], [BLUEPRINT_DOCUMENT_MIN_SUPPORTED_VERSION - 1]])(
        "refuses a v%i document rather than opening it half-read",
        version => {
            // Below the floor the shapes differ by things no reader can recover - a v8 document
            // still carries `persistentVariables`, a v4 one still spells fields "declarations" - so
            // the only answers are a converter or a refusal, and the converters are gone.
            expect(() => migrateBlueprintDocumentToLatest({ schemaVersion: version, blueprints: {}, ownerRecords: {} }))
                .toThrow(/Unsupported BlueprintDocument schemaVersion/);
        },
    );

    it("refuses a document a newer Studio wrote", () => {
        expect(() => migrateBlueprintDocumentToLatest({
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION + 1,
            blueprints: {},
            ownerRecords: {},
        })).toThrow(/Unsupported BlueprintDocument schemaVersion/);
    });
});

describe("migrateBlueprintDocumentToLatest (v10 to v11 owner keys)", () => {
    const BUILT_IN = "widgetMain:narraleaf-studio:main-surface:0443cfc4-b06c-483b-a1a5-f56306351f08";
    const ESCAPED = "widgetMain:narraleaf-studio%3Amain-surface:0443cfc4-b06c-483b-a1a5-f56306351f08";

    function record(blueprintId: string) {
        // The pre-v14 shape: a list with one of them marked active.
        return { activeBlueprintId: blueprintId, privateBlueprintIds: [blueprintId] };
    }

    function documentAt(schemaVersion: number, ownerRecords: Record<string, unknown>): unknown {
        // Every record's blueprint, because a record naming nothing is a document the validator
        // refuses and the v14 pass drops.
        const blueprints: Record<string, unknown> = {};
        for (const entry of Object.values(ownerRecords) as { activeBlueprintId: string }[]) {
            blueprints[entry.activeBlueprintId] = {
                id: entry.activeBlueprintId,
                name: entry.activeBlueprintId,
                owner: { kind: "globalMain" },
                program: { kind: "graph", graphs: { events: {}, functions: {} } },
            };
        }
        return JSON.parse(JSON.stringify({ schemaVersion, ownerRecords, blueprints }));
    }

    it("moves a record onto the escaped key, keeping the blueprint it points at", () => {
        // The ids must survive untouched: a blueprint id is a hash of the owner key, and `ensure*`
        // mints a new blueprint whenever a slot's key finds no record. A rewrite that lost the record
        // would show every slot as empty and orphan the author's work.
        const migrated = migrateBlueprintDocumentToLatest(
            documentAt(10, { [BUILT_IN]: record("bp-built-in"), "widgetMain:s-1:e-1": record("bp-plain") }),
        );

        expect(Object.keys(migrated.ownerRecords).sort()).toEqual([ESCAPED, "widgetMain:s-1:e-1"].sort());
        expect(migrated.ownerRecords[ESCAPED].blueprintId).toBe("bp-built-in");
    });

    it("cannot escape a key it has already escaped", () => {
        // The failure this guards is silent and total: escaping twice gives
        // `narraleaf-studio%253Amain-surface`, which no lookup finds, so every affected slot mints a
        // second blueprint and the author's becomes unreachable. The version gate is what stops it,
        // so a document already at the current version must come back byte-identical.
        const already = documentAt(BLUEPRINT_DOCUMENT_SCHEMA_VERSION, { [ESCAPED]: record("bp") });
        const once = migrateBlueprintDocumentToLatest(already);
        const twice = migrateBlueprintDocumentToLatest(JSON.parse(JSON.stringify(once)));

        expect(Object.keys(twice.ownerRecords)).toEqual([ESCAPED]);
        expect(encodeCanonicalJson(twice)).toBe(encodeCanonicalJson(once));
    });

    it("leaves a key it cannot read where it is", () => {
        // Dropping it would delete an author's blueprint over a spelling this code did not know.
        const migrated = migrateBlueprintDocumentToLatest(
            documentAt(10, { "somethingElse:x": record("bp-unknown") }),
        );
        expect(migrated.ownerRecords["somethingElse:x"].blueprintId).toBe("bp-unknown");
    });

    it("keeps both records when two old keys want one new key", () => {
        // Two slots claiming one record would silently discard whichever was written first. Neither
        // spelling can produce the other today; the loser keeps its original key so nothing is lost
        // on the day one can.
        const collides = { [BUILT_IN]: record("bp-a"), [ESCAPED]: record("bp-b") };
        const migrated = migrateBlueprintDocumentToLatest(documentAt(10, collides));
        const kept = Object.values(migrated.ownerRecords).map(entry => entry.blueprintId).sort();
        expect(kept).toEqual(["bp-a", "bp-b"]);
    });
});

describe("migrateBlueprintDocumentToLatest (v11 to v12 shared asset removal)", () => {
    /**
     * A document carrying the owner kind that is gone.
     *
     * Nothing on disk has ever held one - a shared blueprint lived in a `.nlbp` asset file, not in
     * this document, and the owner record half was excluded from `ownerRecords` by construction.
     * The format permitted both, which is what this pass answers for.
     */
    function documentWithSharedAsset(schemaVersion: number): unknown {
        return JSON.parse(JSON.stringify({
            schemaVersion,
            ownerRecords: {
                globalMain: { activeBlueprintId: "bp-global", privateBlueprintIds: ["bp-global"] },
                "sharedAsset:asset-1": { activeBlueprintId: "bp-shared", privateBlueprintIds: ["bp-shared"] },
            },
            blueprints: {
                "bp-global": {
                    id: "bp-global",
                    name: "Global",
                    owner: { kind: "globalMain" },
                    graphs: { events: {}, functions: {} },
                },
                "bp-shared": {
                    id: "bp-shared",
                    name: "Shared",
                    owner: { kind: "sharedAsset", assetId: "asset-1" },
                    graphs: { events: {}, functions: {} },
                },
            },
        }));
    }

    it("drops the blueprint and the record that named it, keeping everything else", () => {
        // Left alone it is not inert. `encodeBlueprintOwnerKey` is exhaustive over the owner kinds
        // that exist, so an owner it has no arm for falls past the last case and comes back as the
        // owner object; `assertValidBlueprintDocument` then reports a missing record for the key
        // `[object Object]` and refuses the whole document. Refusing an author's project over a
        // record no writer produced is the worse of the two outcomes.
        const migrated = migrateBlueprintDocumentToLatest(documentWithSharedAsset(11));

        expect(Object.keys(migrated.blueprints)).toEqual(["bp-global"]);
        expect(Object.keys(migrated.ownerRecords)).toEqual(["globalMain"]);
        expect(migrated.schemaVersion).toBe(BLUEPRINT_DOCUMENT_SCHEMA_VERSION);
    });

    it("leaves a document with none of them byte-identical", () => {
        // The gate is what keeps the pass off the ordinary read path; the sweep itself must also not
        // rebuild a document it has nothing to remove from.
        const clean = JSON.parse(JSON.stringify({
            schemaVersion: 11,
            ownerRecords: { globalMain: { activeBlueprintId: "bp", privateBlueprintIds: ["bp"] } },
            blueprints: {
                bp: {
                    id: "bp",
                    name: "Global",
                    owner: { kind: "globalMain" },
                    program: { kind: "graph", graphs: { events: {}, functions: {} } },
                },
            },
        }));
        const migrated = migrateBlueprintDocumentToLatest(clean);

        expect(Object.keys(migrated.ownerRecords)).toEqual(["globalMain"]);
        expect(migrated.ownerRecords.globalMain.blueprintId).toBe("bp");
    });
});

describe("migrateBlueprintDocumentToLatest (v12 to v13 script references)", () => {
    function inlineScript(id: string, name: string, code: string): Record<string, unknown> {
        return {
            id,
            name,
            owner: { kind: "globalMain" },
            program: { kind: "scriptModule", source: { language: "typescript", code } },
        };
    }

    function documentWith(blueprints: Record<string, unknown>, schemaVersion = 12): unknown {
        // One record per blueprint, on a slot of its own, so nothing is dropped as unreachable.
        // Keys through the encoder, never spelled here: `ownerKeySpelling.test.ts` is what says so.
        const ownerRecords = Object.fromEntries(
            Object.keys(blueprints).map((id, index) => [
                encodeBlueprintOwnerKey({ kind: "surfaceMain", surfaceId: `s-${index}` }),
                { activeBlueprintId: id, privateBlueprintIds: [id] },
            ]),
        );
        return JSON.parse(JSON.stringify({ schemaVersion, ownerRecords, blueprints }));
    }

    it("points a script blueprint at a file named after it, keeping the text for whoever writes it", () => {
        const migrated = migrateBlueprintDocumentToLatest(
            documentWith({ a: inlineScript("a", "Quit Game", "export function onMouseClick() {}") }),
        );

        const blueprint = migrated.blueprints.a;
        expect(scriptRefsOf(blueprint)).toEqual(["scripts/quit-game.ts"]);
        // The text never ran - nothing mounted these modules - but the editor accepted typing, so
        // it is carried to the one open that can write it to disk rather than dropped.
        expect(blueprint.meta?.[LEGACY_INLINE_SCRIPT_META_KEY]).toBe("export function onMouseClick() {}");
        expect(migrated.schemaVersion).toBe(BLUEPRINT_DOCUMENT_SCHEMA_VERSION);
    });

    it("names a file rather than a UUID, and counts up when two blueprints share a name", () => {
        const migrated = migrateBlueprintDocumentToLatest(
            documentWith({
                a: inlineScript("2f0c9a1e-0000-4000-8000-000000000001", "Quit", "a"),
                b: inlineScript("2f0c9a1e-0000-4000-8000-000000000002", "Quit", "b"),
                // A name with nothing usable in it still has to produce a filename.
                c: inlineScript("2f0c9a1e-0000-4000-8000-000000000003", "!!!", "c"),
            }),
        );

        const refs = Object.values(migrated.blueprints).flatMap(scriptRefsOf);
        expect(refs).toEqual(["scripts/quit.ts", "scripts/quit-2.ts", "scripts/script.ts"]);
        // A filename is as much interface as a title bar is.
        for (const ref of refs) {
            expect(ref).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
        }
    });

    it("carries no text for a blueprint the author never typed in", () => {
        const migrated = migrateBlueprintDocumentToLatest(documentWith({ a: inlineScript("a", "Empty", "") }));
        expect(migrated.blueprints.a.meta?.[LEGACY_INLINE_SCRIPT_META_KEY]).toBeUndefined();
    });

    it("leaves a document that is already at v13 exactly as it is", () => {
        const current = documentWith(
            {
                a: {
                    id: "a",
                    name: "Quit",
                    owner: { kind: "globalMain" },
                    program: { kind: "scriptModule", scriptRef: "scripts/menus/quit.ts" },
                },
            },
            BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        );
        const before = encodeCanonicalJson(current as Record<string, unknown>);

        const migrated = migrateBlueprintDocumentToLatest(current);

        // Running the pass again would re-derive the path from the name and move the author's file
        // out from under their reference - so the version gate is what makes it safe, not the pass.
        expect(encodeCanonicalJson(migrated as unknown as Record<string, unknown>)).toEqual(before);
    });

    it("leaves graph blueprints alone", () => {
        const migrated = migrateBlueprintDocumentToLatest(
            documentWith({
                g: {
                    id: "g",
                    name: "Visual",
                    owner: { kind: "globalMain" },
                    graphs: { events: {}, functions: {} },
                },
            }),
        );
        expect(scriptRefsOf(migrated.blueprints.g)).toEqual([]);
        expect(migrated.blueprints.g.meta).toBeUndefined();
    });
});

/** Every file the layers of one blueprint run, in authored order. */
function scriptRefsOf(blueprint: Blueprint): string[] {
    return listScriptLayers(blueprint.graphs).map(entry => entry.script.scriptRef);
}

describe("migrateBlueprintDocumentToLatest (v13 to v14 scripts become layers)", () => {
    function documentAt13(blueprints: Record<string, unknown>, ownerRecords: Record<string, unknown>): unknown {
        return JSON.parse(JSON.stringify({ schemaVersion: 13, blueprints, ownerRecords }));
    }

    it("folds a script blueprint into a blueprint holding one script layer", () => {
        const migrated = migrateBlueprintDocumentToLatest(documentAt13(
            {
                s: {
                    id: "s",
                    name: "Quit",
                    owner: { kind: "globalMain" },
                    frontend: "typescript",
                    programKind: "scriptModule",
                    program: { kind: "scriptModule", scriptRef: "scripts/quit.ts" },
                },
            },
            { globalMain: { activeBlueprintId: "s", privateBlueprintIds: ["s"] } },
        ));

        // The same file, under the same slot, through the same blueprint id: what moved is where
        // the path is written, not what runs.
        expect(scriptRefsOf(migrated.blueprints.s)).toEqual(["scripts/quit.ts"]);
        expect(migrated.ownerRecords.globalMain.blueprintId).toBe("s");
        // The three fields that answered the same question are gone with the wrapper.
        expect((migrated.blueprints.s as unknown as Record<string, unknown>).program).toBeUndefined();
        expect((migrated.blueprints.s as unknown as Record<string, unknown>).frontend).toBeUndefined();
        expect((migrated.blueprints.s as unknown as Record<string, unknown>).programKind).toBeUndefined();
    });

    it("keeps the blueprint a slot was running and drops the revisions beside it", () => {
        const graphBlueprint = (id: string) => ({
            id,
            name: id,
            owner: { kind: "globalMain" },
            program: { kind: "graph", graphs: { events: {}, functions: {} } },
        });
        const migrated = migrateBlueprintDocumentToLatest(documentAt13(
            { active: graphBlueprint("active"), spare: graphBlueprint("spare") },
            { globalMain: { activeBlueprintId: "active", privateBlueprintIds: ["spare", "active"] } },
        ));

        expect(migrated.ownerRecords.globalMain.blueprintId).toBe("active");
        // Dropped rather than left in the map: nothing resolves a blueprint by walking it, so one
        // its slot does not name would be linted and diffed while never running.
        expect(Object.keys(migrated.blueprints)).toEqual(["active"]);
    });

    it("drops a record naming nothing rather than leaving it pointing at a hole", () => {
        const migrated = migrateBlueprintDocumentToLatest(documentAt13(
            {},
            { globalMain: { activeBlueprintId: "gone", privateBlueprintIds: ["gone"] } },
        ));

        expect(migrated.ownerRecords).toEqual({});
    });

    it("keeps the authored layer order of a graph blueprint across the fold", () => {
        const migrated = migrateBlueprintDocumentToLatest(documentAt13(
            {
                g: {
                    id: "g",
                    name: "Global",
                    owner: { kind: "globalMain" },
                    program: {
                        kind: "graph",
                        graphs: {
                            events: { second: { id: "second" }, first: { id: "first" } },
                            functions: {},
                        },
                    },
                },
            },
            { globalMain: { activeBlueprintId: "g", privateBlueprintIds: ["g"] } },
        ));

        expect(migrated.blueprints.g.graphs.eventIds).toEqual(["second", "first"]);
    });
});
