import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { encodeCanonicalJson } from "../documents/canonicalJson";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "../types/blueprint/schema";
import {
    BLUEPRINT_DOCUMENT_MIN_SUPPORTED_VERSION,
    migrateBlueprintDocumentToLatest,
} from "./migrateBlueprintDocument";
import { decodeBlueprintOwnerKey } from "./ownerKey";

/**
 * The blueprints Studio ships in the factory skeleton, held to the version and the spelling this
 * build reads.
 *
 * Nothing pinned this. The interface document beside it has tests that read it off disk, but the
 * blueprint document did not, which left two ways to ship a project template nobody can open: raise
 * the floor past the templates, or migrate the templates and forget one of the three locales.
 *
 * The templates are the one corpus that must already be current, because a new project is a copy of
 * them. A migration they have not had is a first-run failure, and there is no author to blame it on.
 */

const LOCALES = ["content", "content.zh", "content.ja"] as const;

function skeletonPath(locale: string): string {
    return path.join(process.cwd(), "resources/templates/skeleton", locale, "editor/ui/uigraphs.json");
}

function blueprintDocument(locale: string): Record<string, unknown> {
    const file = JSON.parse(fs.readFileSync(skeletonPath(locale), "utf-8")) as Record<string, unknown>;
    return file.blueprintDocument as Record<string, unknown>;
}

describe("the factory skeleton's blueprint document", () => {
    it.each(LOCALES)("%s is at the version this build writes", locale => {
        // Not "at least the floor": a template below the current version would be migrated on first
        // open, so every new project would start by rewriting files it had just copied.
        expect(blueprintDocument(locale).schemaVersion).toBe(BLUEPRINT_DOCUMENT_SCHEMA_VERSION);
    });

    it.each(LOCALES)("%s passes through the migration unchanged", locale => {
        // The strong form of the check above: current by version *and* by content, so a conversion
        // added without the templates being regenerated fails here rather than on first run.
        const doc = blueprintDocument(locale);
        const migrated = migrateBlueprintDocumentToLatest(JSON.parse(JSON.stringify(doc)));
        expect(encodeCanonicalJson(migrated)).toBe(encodeCanonicalJson(doc));
    });

    it.each(LOCALES)("%s spells every owner key the way this build reads one", locale => {
        // The skeleton is the only corpus that carries the built-in surface id, which contains the
        // separator - so it is the one that catches an encoder and a decoder drifting apart.
        const records = blueprintDocument(locale).ownerRecords as Record<string, unknown>;
        const unreadable = Object.keys(records).filter(key => decodeBlueprintOwnerKey(key) === null);
        expect(unreadable).toEqual([]);
    });

    it("keeps the floor at or below what the templates carry", () => {
        // The two move together or a fresh install cannot open the project it just created.
        expect(BLUEPRINT_DOCUMENT_MIN_SUPPORTED_VERSION).toBeLessThanOrEqual(BLUEPRINT_DOCUMENT_SCHEMA_VERSION);
        for (const locale of LOCALES) {
            expect(blueprintDocument(locale).schemaVersion as number)
                .toBeGreaterThanOrEqual(BLUEPRINT_DOCUMENT_MIN_SUPPORTED_VERSION);
        }
    });

    it("has the same owner slots in all three locales", () => {
        // The locales are generated from the English one, so their blueprint structure is not
        // translated - only the strings inside it are. A key that differs means a generator run that
        // did not happen, and the two would then drift apart silently.
        const keys = LOCALES.map(locale => Object.keys(blueprintDocument(locale).ownerRecords as object).sort());
        expect(keys[1]).toEqual(keys[0]);
        expect(keys[2]).toEqual(keys[0]);
    });
});
