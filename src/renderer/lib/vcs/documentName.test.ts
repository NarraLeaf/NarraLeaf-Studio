import { describe, expect, it } from "vitest";
import type { TranslationKey } from "@shared/i18n";
import { NO_DOCUMENT_NAMES, documentNameOf, isAuthoredName, renderDocumentName } from "./documentName";

const story = (id: string) => `editor/story/stories/${id}/storydoc.json`;
const titles = (entries: Record<string, string>) => ({ storyTitles: new Map(Object.entries(entries)) });

/** Echoes the key and its parameters, so a test can see which key was chosen without a catalogue. */
const t = ((key: TranslationKey, params?: Record<string, unknown>) =>
    params ? `${key}(${Object.values(params).join(",")})` : String(key)) as never;

describe("what the author calls a document", () => {
    it("gives a story its own title, and never the file it is stored in", () => {
        const forest = documentNameOf(story("s-1"), titles({ "s-1": "The Forest" }));
        const harbour = documentNameOf(story("s-2"), titles({ "s-2": "The Harbour" }));

        expect(forest).toEqual({ source: "authored", text: "The Forest" });
        expect(renderDocumentName(forest, t)).toBe("The Forest");
        expect(renderDocumentName(harbour, t)).toBe("The Harbour");
        for (const name of [forest, harbour]) {
            expect(renderDocumentName(name, t)).not.toContain("storydoc");
            expect(renderDocumentName(name, t)).not.toContain(".json");
        }
    });

    it("keeps two stories apart when it cannot read either title", () => {
        // The sibling index was unreadable, absent from the comparison, or dropped by the read
        // budget. The names must still be two names: a column of identical rows is the failure this
        // is guarding, and inventing a title would be worse than admitting there is none.
        const first = documentNameOf(story("s-1"), NO_DOCUMENT_NAMES);
        const second = documentNameOf(story("s-2"), NO_DOCUMENT_NAMES);

        expect(isAuthoredName(first)).toBe(false);
        expect(renderDocumentName(first, t)).not.toBe(renderDocumentName(second, t));
        expect(renderDocumentName(first, t)).toContain("s-1");
        expect(renderDocumentName(first, t)).not.toContain("storydoc");
    });

    it("names a document that has no name of its own after its kind", () => {
        for (const path of ["editor/brand.json", "editor/variables.json", "editor/save-schema.json"]) {
            const name = documentNameOf(path, NO_DOCUMENT_NAMES);
            expect(name.source).toBe("kind");
            const drawn = renderDocumentName(name, t);
            expect(drawn).toContain("documentDiff.name.");
            expect(drawn).not.toContain(".json");
        }
    });

    it("leaves a file Studio has no concept for its whole path, not its last segment", () => {
        // Two build.js in two directories are two files, and an author has to be able to tell them
        // apart - so this is the one case where a path IS the name.
        const one = documentNameOf("scripts/a/build.js", NO_DOCUMENT_NAMES);
        const two = documentNameOf("scripts/b/build.js", NO_DOCUMENT_NAMES);

        expect(one).toEqual({ source: "file", path: "scripts/a/build.js" });
        expect(renderDocumentName(one, t)).not.toBe(renderDocumentName(two, t));
    });
});
