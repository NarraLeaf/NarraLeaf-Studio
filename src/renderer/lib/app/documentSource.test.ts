import { afterEach, describe, expect, it } from "vitest";
import type { DocumentSource } from "@shared/documents/documentSource";
import { clearProjectDocumentSource, getProjectDocumentSource, pushProjectDocumentSource, readProjectDataFromSource } from "./documentSource";

function revision(id: string): DocumentSource {
    return {
        origin: { kind: "revision", revision: id },
        read: async path => `${id}:${path}`,
        prewarm: async () => undefined,
    };
}

afterEach(() => clearProjectDocumentSource());

describe("project document source lifetime", () => {
    it("keeps a replacement revision when the previous reload releases its hold", async () => {
        const old = revision("old");
        const next = revision("next");
        const releaseOldView = pushProjectDocumentSource("/project", old);
        const releaseOldReload = pushProjectDocumentSource("/project", old);
        releaseOldView();
        clearProjectDocumentSource();
        const releaseNextView = pushProjectDocumentSource("/project", next);

        releaseOldReload();
        expect(getProjectDocumentSource()).toBe(next);
        expect(await readProjectDataFromSource("/project/editor/story/index.json"))
            .toEqual({ text: "next:editor/story/index.json" });

        releaseNextView();
        expect(getProjectDocumentSource()).toBeNull();
    });

    it("does not let a stale release clear a new hold of the same source", () => {
        const source = revision("one");
        const releaseOld = pushProjectDocumentSource("/project", source);
        clearProjectDocumentSource();
        const releaseNew = pushProjectDocumentSource("/project", source);

        releaseOld();
        expect(getProjectDocumentSource()).toBe(source);
        releaseNew();
        expect(getProjectDocumentSource()).toBeNull();
    });

    it("holds one source until its last distinct release", () => {
        const source = revision("one");
        const first = pushProjectDocumentSource("/project", source);
        const second = pushProjectDocumentSource("/project", source);
        first();
        first();
        expect(getProjectDocumentSource()).toBe(source);
        second();
        expect(getProjectDocumentSource()).toBeNull();
    });
});
