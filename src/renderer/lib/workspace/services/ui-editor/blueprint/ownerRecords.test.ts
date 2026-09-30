import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { createMainBlueprint } from "./blueprintFactories";
import { derivedBlueprintId } from "./derivedBlueprintId";
import { assertValidBlueprintDocument } from "./documentValidation";
import { widgetMainOwnerKey } from "./ownerKeys";
import { dropDisplacedEmptyBlueprints, setPrivateOwnerBlueprint } from "./ownerRecords";

const owner = { kind: "widgetMain", surfaceId: "page", elementId: "pasted" } as const;
const key = widgetMainOwnerKey("page", "pasted");

/** A slot holding the empty blueprint the lifecycle sweep gave a new element. */
function documentWithPlaceholder(): BlueprintDocument {
    const doc: BlueprintDocument = {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: {},
        ownerRecords: {},
        meta: {},
    };
    const placeholder = derivedBlueprintId(key);
    doc.blueprints[placeholder] = createMainBlueprint({ id: placeholder, name: "Widget", owner });
    doc.ownerRecords[key] = { blueprintId: placeholder };
    return doc;
}

function withLogic(id: string) {
    const blueprint = createMainBlueprint({ id, name: "Copied logic", owner });
    blueprint.graphs.events = {
        init: { id: "init", name: "Init", graph: { nodes: {}, edges: [], meta: {} } },
    } as typeof blueprint.graphs.events;
    blueprint.graphs.eventIds = ["init"];
    return blueprint;
}

describe("pointing a slot at another blueprint", () => {
    it("gives up the blueprint the slot held, so the document stays valid", () => {
        const doc = documentWithPlaceholder();
        doc.blueprints.copy = withLogic("copy");
        setPrivateOwnerBlueprint(doc, key, "copy");

        expect(Object.keys(doc.blueprints)).toEqual(["copy"]);
        expect(() => assertValidBlueprintDocument(doc)).not.toThrow();
    });
});

describe("dropDisplacedEmptyBlueprints", () => {
    it("opens a document a paste saved with the empty blueprint its slot had moved on from", () => {
        const doc = documentWithPlaceholder();
        doc.blueprints.copy = withLogic("copy");
        doc.ownerRecords[key] = { blueprintId: "copy" };
        expect(() => assertValidBlueprintDocument(doc)).toThrow(/is not the blueprint/);

        expect(dropDisplacedEmptyBlueprints(doc)).toEqual([derivedBlueprintId(key)]);
        expect(() => assertValidBlueprintDocument(doc)).not.toThrow();
        expect(doc.blueprints.copy.name).toBe("Copied logic");
    });

    it("leaves a displaced blueprint that holds anything, and every blueprint its slot names", () => {
        const doc = documentWithPlaceholder();
        doc.blueprints.written = withLogic("written");
        const placeholder = derivedBlueprintId(key);

        // The slot names the empty one: nothing is displaced but the one with content, which stays.
        expect(dropDisplacedEmptyBlueprints(doc)).toEqual([]);
        expect(Object.keys(doc.blueprints).sort()).toEqual([placeholder, "written"].sort());
    });
});
