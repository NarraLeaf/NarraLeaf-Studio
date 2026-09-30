import { describe, expect, it } from "vitest";
import { CATALOGS, SUPPORTED_LOCALES } from "@shared/i18n";
import {
    PROJECT_DOCUMENT_KINDS,
    ProjectDocumentTooNewError,
    refuseNewerProjectDocument,
} from "@shared/documents/newerSchema";
import { StoryDocumentTooNewError } from "@shared/story/migrateStoryDocument";
import { describeProjectDocumentTooNew, localizeProjectDocumentRefusal, rethrowIfTooNew } from "./projectDocumentGate";

describe("the refusal a newer project document gets", () => {
    /**
     * The kind list and the nouns are one closed set, held together here.
     *
     * `describeProjectDocumentTooNew` composes the message key from the kind, so a kind with no noun
     * produces a sentence with a raw key in the middle of it - which no translator and no reviewer
     * would ever see, because it only appears in front of an author holding a file from the future.
     */
    it.each(SUPPORTED_LOCALES)("names every document kind in %s", locale => {
        const nouns = (CATALOGS[locale] as { documents: { tooNew: { kind: Record<string, string> } } })
            .documents.tooNew.kind;
        expect(Object.keys(nouns).sort()).toEqual([...PROJECT_DOCUMENT_KINDS].sort());
        for (const noun of Object.values(nouns)) {
            expect(noun.trim().length).toBeGreaterThan(0);
        }
    });

    it("puts the file, the noun and both versions in the sentence", () => {
        const said = describeProjectDocumentTooNew(
            new ProjectDocumentTooNewError("uiDocument", "editor/ui/uidoc.json", 13, 12),
            "en",
        );

        expect(said).toContain("editor/ui/uidoc.json");
        expect(said).toContain("interface");
        expect(said).toContain("v13");
        expect(said).toContain("v12");
    });

    it("says it in the language the assembly was asked in", () => {
        const refusal = new ProjectDocumentTooNewError("story", "Chapter One", 27, 25);

        expect(describeProjectDocumentTooNew(refusal, "zh")).toContain("故事");
        expect(describeProjectDocumentTooNew(refusal, "ja")).toContain("ストーリー");
        // Both numbers survive every language, which is the half a translation cannot be trusted
        // with and the half the author actually acts on.
        for (const locale of SUPPORTED_LOCALES) {
            expect(describeProjectDocumentTooNew(refusal, locale)).toContain("27");
            expect(describeProjectDocumentTooNew(refusal, locale)).toContain("25");
        }
    });

    it("finds the refusal however deep the wrappers go", () => {
        const refusal = new ProjectDocumentTooNewError("brand", "editor/brand.json", 4, 3);
        const wrapped = new Error("bundle failed", { cause: new Error("load failed", { cause: refusal }) });

        expect((localizeProjectDocumentRefusal(wrapped, "en") as Error).message)
            .toContain("editor/brand.json");
    });

    it("leaves every other failure exactly as it was", () => {
        const other = new Error("Invalid JSON in editor/brand.json: Unexpected token }");

        expect(localizeProjectDocumentRefusal(other, "en")).toBe(other);
    });

    it("refuses only a version strictly above the supported one", () => {
        const gate = { kind: "voice" as const, subject: "editor/voice/ja.json", supportedVersion: 1 };

        expect(() => refuseNewerProjectDocument({ schemaVersion: 2 }, gate)).toThrow(ProjectDocumentTooNewError);
        expect(() => refuseNewerProjectDocument({ schemaVersion: 1 }, gate)).not.toThrow();
        // A file that states no version was written before these formats stated one, and every build
        // has always read it. Inventing a requirement here would refuse files that read perfectly.
        expect(() => refuseNewerProjectDocument({}, gate)).not.toThrow();
        expect(() => refuseNewerProjectDocument(null, gate)).not.toThrow();
    });

    it("reads the field a format actually versions itself with", () => {
        const gate = {
            kind: "characters" as const,
            subject: "editor/services/character.json",
            supportedVersion: 2,
            field: "version",
        };

        expect(() => refuseNewerProjectDocument({ version: 3 }, gate)).toThrow(ProjectDocumentTooNewError);
        // The character store predates `schemaVersion`, so gating on that field would gate nothing.
        expect(() => refuseNewerProjectDocument({ schemaVersion: 99, version: 2 }, gate)).not.toThrow();
    });

    describe("what a degrading loader may swallow", () => {
        it("lets a damaged file through, because booting on the default is a state the author sees", () => {
            expect(() => rethrowIfTooNew(new Error("Invalid JSON in editor/brand.json"))).not.toThrow();
        });

        it("stops the assembly on a document from the future, which the default would silently hide", () => {
            const refusal = new ProjectDocumentTooNewError("assetSets", "editor/asset-sets.json", 2, 1);

            expect(() => rethrowIfTooNew(new Error("wrapped", { cause: refusal }))).toThrow(refusal);
        });

        it("stops on the story ladder's own refusal too", () => {
            const refusal = new StoryDocumentTooNewError(27, 25);

            expect(() => rethrowIfTooNew(refusal)).toThrow(refusal);
        });
    });
});
