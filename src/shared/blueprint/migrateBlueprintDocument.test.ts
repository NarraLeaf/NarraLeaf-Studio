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
