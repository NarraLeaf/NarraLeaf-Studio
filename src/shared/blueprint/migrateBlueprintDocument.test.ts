import { describe, expect, it } from "vitest";
import { migrateBlueprintDocumentToLatest } from "./migrateBlueprintDocument";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "../types/blueprint/schema";

describe("migrateBlueprintDocumentToLatest", () => {
    it("upgrades schema 6 documents with empty persistent variables", () => {
        const migrated = migrateBlueprintDocumentToLatest({
            schemaVersion: 6,
            blueprints: {},
            ownerRecords: {},
        });

        expect(migrated.schemaVersion).toBe(BLUEPRINT_DOCUMENT_SCHEMA_VERSION);
        expect(migrated.persistentVariables).toEqual({});
    });
});
