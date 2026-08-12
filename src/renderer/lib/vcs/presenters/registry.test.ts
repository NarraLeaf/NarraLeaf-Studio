import { describe, expect, it } from "vitest";
import type { DocumentDiffEntry } from "@shared/documents/diff";
import { genericChangePresenter } from "./GenericChangeDetail";
import { listChangePresenters, presenterFor, registerChangePresenter, type ChangePresenter } from "./registry";

/**
 * One answer, always, and never nothing.
 *
 * The two failures this guards are opposite and both silent. A lookup that can answer with nothing
 * gives the detail pane a blank half-screen for any format nobody has written a presenter for -
 * which is most of them, most of the time. A lookup that can answer with several turns the pane back
 * into the stack of lists this layout replaced.
 */

const entry = (path: string, documentKind?: DocumentDiffEntry["documentKind"]): DocumentDiffEntry => ({
    path,
    kind: "changed",
    ...(documentKind ? { documentKind } : {}),
    diff: { changes: [], complete: true, total: 0, tier: "semantic" },
});

const presenter = (id: string, matches: (entry: DocumentDiffEntry) => boolean): ChangePresenter => ({
    id,
    matches,
    Detail: () => null,
});

describe("presenterFor", () => {
    it("answers with the generic list for a format nobody has claimed", () => {
        expect(presenterFor(entry("something/nobody/declared.bin"))).toBe(genericChangePresenter);
    });

    it("answers with one presenter even when two of them match", () => {
        // Scoped to one path rather than matching everything: the registry is module state, and a
        // match-all presenter left behind by one test would decide the answer in the next.
        const claims = (item: DocumentDiffEntry) => item.path === "editor/story/index.json";
        registerChangePresenter(presenter("test-first", claims));
        registerChangePresenter(presenter("test-second", claims));

        const chosen = presenterFor(entry("editor/story/index.json"));

        // A single value, not a set - a caller cannot mount two even by accident. The later
        // registration wins, so adding a better presenter for a format does not need the earlier
        // one removed first.
        expect(chosen.id).toBe("test-second");
    });

    it("falls past a presenter that declines the document", () => {
        registerChangePresenter(presenter("test-story", item => item.documentKind === "story"));

        expect(presenterFor(entry("editor/story/stories/a/storydoc.json", "story")).id).toBe("test-story");
        // A document kind nothing here claims. This file deliberately does not import the real
        // presenters - the registry is module state, and the point of these tests is the lookup
        // rather than who is installed - so the only entries in it are the ones above.
        expect(presenterFor(entry("editor/audio/tracks.json", "audio-tracks"))).toBe(genericChangePresenter);
    });

    it("replaces a presenter registered twice under one id", () => {
        const before = listChangePresenters().length;
        registerChangePresenter(presenter("test-twice", () => false));
        registerChangePresenter(presenter("test-twice", () => false));

        expect(listChangePresenters().filter(item => item.id === "test-twice")).toHaveLength(1);
        expect(listChangePresenters().length).toBe(before + 1);
    });
});
