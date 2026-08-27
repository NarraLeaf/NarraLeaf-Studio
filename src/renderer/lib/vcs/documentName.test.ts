import { describe, expect, it } from "vitest";
import type { TranslationKey } from "@shared/i18n";
import {
    NO_DOCUMENT_NAMES,
    documentNameOf,
    isAuthoredName,
    listDocumentNames,
    renderDocumentName,
} from "./documentName";

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


/**
 * The short list a notice can carry.
 *
 * The sync that ends in conflicts is what this is for, and what it is guarding is that the notice
 * and the panel it sends the author to are about the same things said the same way - the notice
 * used to print repository paths beside a panel calling the very same files by their titles.
 */
describe("listing a few documents for a notice", () => {
    const conflicts = [story("s-1"), story("s-2"), "editor/ui/uidoc.json"];

    it("lists what the author made, one per line, and no file names", () => {
        const lines = listDocumentNames(conflicts, titles({ "s-1": "The Forest", "s-2": "The Harbour" }), t, 5);

        expect(lines.split("\n")).toEqual([
            "The Forest",
            "The Harbour",
            "documentDiff.name.uiDocument",
        ]);
        expect(lines).not.toContain("storydoc");
        expect(lines).not.toContain(".json");
        expect(lines).not.toContain("editor/");
    });

    /**
     * A merge can leave hundreds of files behind and a notice is read at a glance. Truncation is
     * silent here because the sentence around it states the whole count - see `listDocumentNames`.
     */
    it("stops at the caller's limit", () => {
        const lines = listDocumentNames(conflicts, NO_DOCUMENT_NAMES, t, 2);

        expect(lines.split("\n")).toHaveLength(2);
    });

    it("still tells two unreadable titles apart, rather than repeating one word", () => {
        const lines = listDocumentNames([story("s-1"), story("s-2")], NO_DOCUMENT_NAMES, t, 5).split("\n");

        expect(lines[0]).not.toBe(lines[1]);
        expect(lines[0]).toContain("s-1");
        expect(lines[0]).not.toContain("storydoc");
    });
});
