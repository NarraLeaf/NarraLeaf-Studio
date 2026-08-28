import { describe, expect, it } from "vitest";
import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import {
    acquireBlueprintWidgetLocals,
    BLUEPRINT_MEMO_SLOT_PREFIX,
    releaseBlueprintWidgetLocals,
} from "./blueprintWidgetLocals";
import { resolveWidgetPrivateBlueprintId } from "./widgetPrivateBlueprintHeads";

const SURFACE_ID = "surface-1";
const ELEMENT_ID = "btn";

function ownerRecord(ownerKey: string, blueprintId: string): BlueprintDocument {
    return {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        ownerRecords: { [ownerKey]: { activeBlueprintId: blueprintId, privateBlueprintIds: [blueprintId] } },
        blueprints: {},
    } as unknown as BlueprintDocument;
}

describe("resolveWidgetPrivateBlueprintId", () => {
    /**
     * The regression this exists for. The only thing that drops a widget's lifecycle locals reads
     * this, and reading it off the element instead answered "nothing" for every widget the editor
     * wires - so their stores were created on every dispatch and never removed.
     */
    it("names the blueprint an owner record points at", () => {
        expect(resolveWidgetPrivateBlueprintId(
            ownerRecord(`widgetMain:${SURFACE_ID}:${ELEMENT_ID}`, "bp-own"),
            { surfaceId: SURFACE_ID },
            ELEMENT_ID,
        )).toBe("bp-own");
    });

    it("reads a component's element from the component's own owner key, not the surface's", () => {
        const document = ownerRecord(`componentWidgetMain:comp-1:${ELEMENT_ID}`, "bp-comp");

        expect(resolveWidgetPrivateBlueprintId(document, { surfaceId: SURFACE_ID, componentId: "comp-1" }, ELEMENT_ID))
            .toBe("bp-comp");
        // Without the component id the same element resolves against a key nothing holds.
        expect(resolveWidgetPrivateBlueprintId(document, { surfaceId: SURFACE_ID }, ELEMENT_ID)).toBeUndefined();
    });

    it("answers nothing rather than throwing when there is no blueprint document", () => {
        expect(resolveWidgetPrivateBlueprintId(undefined, { surfaceId: SURFACE_ID }, ELEMENT_ID)).toBeUndefined();
    });
});

describe("the locals a released widget leaves behind", () => {
    const blueprint = {
        id: "bp-own",
        name: "Button logic",
        owner: { kind: "widgetMain", surfaceId: SURFACE_ID, elementId: ELEMENT_ID },
        program: { kind: "graph", graphs: { events: {}, functions: {} } },
    } as unknown as Blueprint;

    /**
     * A Memo slot rather than a plain key, because `acquire` prunes anything the blueprint does not
     * declare - every execution - and Memo slots are the one thing it deliberately keeps. So a value
     * parked in one surviving a re-acquire is exactly the store not having been released.
     */
    const MEMO = `${BLUEPRINT_MEMO_SLOT_PREFIX}remembered`;

    it("are gone once the blueprint the element owns is released", () => {
        const scope = "surface-1:7";
        acquireBlueprintWidgetLocals(SURFACE_ID, ELEMENT_ID, "bp-own", blueprint, scope)[MEMO] = "from the last visit";
        expect(acquireBlueprintWidgetLocals(SURFACE_ID, ELEMENT_ID, "bp-own", blueprint, scope)[MEMO])
            .toBe("from the last visit");

        const owned = resolveWidgetPrivateBlueprintId(
            ownerRecord(`widgetMain:${SURFACE_ID}:${ELEMENT_ID}`, "bp-own"),
            { surfaceId: SURFACE_ID },
            ELEMENT_ID,
        );
        expect(owned).toBeDefined();
        releaseBlueprintWidgetLocals(SURFACE_ID, ELEMENT_ID, owned!, scope);

        expect(acquireBlueprintWidgetLocals(SURFACE_ID, ELEMENT_ID, "bp-own", blueprint, scope)[MEMO])
            .toBeUndefined();
    });

    it("survive a release aimed at another element in the same scope", () => {
        const scope = "surface-1:9";
        acquireBlueprintWidgetLocals(SURFACE_ID, ELEMENT_ID, "bp-own", blueprint, scope)[MEMO] = "mine";

        releaseBlueprintWidgetLocals(SURFACE_ID, "someone-else", "bp-own", scope);

        expect(acquireBlueprintWidgetLocals(SURFACE_ID, ELEMENT_ID, "bp-own", blueprint, scope)[MEMO]).toBe("mine");
    });
});
