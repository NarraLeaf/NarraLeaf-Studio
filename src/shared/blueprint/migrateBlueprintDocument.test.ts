import { describe, expect, it } from "vitest";
import { encodeCanonicalJson } from "../documents/canonicalJson";
import type { BlueprintDocument, BlueprintGraphIndex } from "../types/blueprint/document";
import { listBlueprintEventIds, listBlueprintFunctionIds } from "./blueprintEventOrder";
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
            ownerRecords: {},
            blueprints: {
                bp: {
                    id: "bp",
                    name: "Main",
                    owner: { kind: "globalMain" },
                    frontend: "visual",
                    programKind: "graph",
                    program: {
                        kind: "graph",
                        graphs: {
                            ...(stale?.eventIds ? { eventIds: stale.eventIds } : {}),
                            events: slots(AUTHORED),
                            ...(stale?.functionIds ? { functionIds: stale.functionIds } : {}),
                            functions: slots(AUTHORED_FNS),
                        },
                    },
                },
            },
        });
    }

    function graphsOf(doc: BlueprintDocument): BlueprintGraphIndex {
        const bp = doc.blueprints.bp;
        if (!bp || bp.program.kind !== "graph") {
            throw new Error("test fixture lost its graph program");
        }
        return bp.program.graphs;
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

    function record(activeBlueprintId: string) {
        return { activeBlueprintId, privateBlueprintIds: [activeBlueprintId] };
    }

    function documentAt(schemaVersion: number, ownerRecords: Record<string, unknown>): unknown {
        return JSON.parse(JSON.stringify({ schemaVersion, ownerRecords, blueprints: {} }));
    }

    it("moves a record onto the escaped key, keeping the blueprint it points at", () => {
        // The ids must survive untouched: a blueprint id is a hash of the owner key, and `ensure*`
        // mints a new blueprint whenever a slot's key finds no record. A rewrite that lost the record
        // would show every slot as empty and orphan the author's work.
        const migrated = migrateBlueprintDocumentToLatest(
            documentAt(10, { [BUILT_IN]: record("bp-built-in"), "widgetMain:s-1:e-1": record("bp-plain") }),
        );

        expect(Object.keys(migrated.ownerRecords).sort()).toEqual([ESCAPED, "widgetMain:s-1:e-1"].sort());
        expect(migrated.ownerRecords[ESCAPED].activeBlueprintId).toBe("bp-built-in");
        expect(migrated.ownerRecords[ESCAPED].privateBlueprintIds).toEqual(["bp-built-in"]);
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
        expect(migrated.ownerRecords["somethingElse:x"].activeBlueprintId).toBe("bp-unknown");
    });

    it("keeps both records when two old keys want one new key", () => {
        // Two slots claiming one record would silently discard whichever was written first. Neither
        // spelling can produce the other today; the loser keeps its original key so nothing is lost
        // on the day one can.
        const collides = { [BUILT_IN]: record("bp-a"), [ESCAPED]: record("bp-b") };
        const migrated = migrateBlueprintDocumentToLatest(documentAt(10, collides));
        const kept = Object.values(migrated.ownerRecords).map(entry => entry.activeBlueprintId).sort();
        expect(kept).toEqual(["bp-a", "bp-b"]);
    });
});
