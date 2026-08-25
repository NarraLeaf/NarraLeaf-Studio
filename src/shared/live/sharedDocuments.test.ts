import { describe, expect, it } from "vitest";
import { charactersSpec, storyDocumentSpec } from "@shared/documents/specs";
import { isVersioned } from "@shared/vcs/workingSet";
import { opDocumentKind, type LiveOp } from "./ops";
import {
    liveDocumentPath,
    liveSessionCarries,
    liveSessionDocuments,
    liveSessionWritablePaths,
} from "./sharedDocuments";

const STORY = "story-1";

/**
 * The one table two things read: the write boundary, which asks which paths a session leaves
 * writable, and the host, which asks whether an operation is about a document it speaks for.
 *
 * The failure these guard is the pair disagreeing. A path the boundary allows that the vocabulary
 * cannot carry is an edit that lands on one machine and nowhere else, with no digest over it and
 * nothing anywhere reporting a problem.
 */
describe("the documents a session carries", () => {
    it("is the story it was opened on, and the cast", () => {
        expect(liveSessionDocuments(STORY)).toEqual([{ doc: "story", storyId: STORY }, { doc: "characters" }]);
    });

    it("addresses each one through its own document spec, so a document that moves takes this with it", () => {
        expect(liveDocumentPath({ doc: "story", storyId: STORY })).toBe(storyDocumentSpec.pathFor({ storyId: STORY }));
        expect(liveDocumentPath({ doc: "characters" })).toBe(charactersSpec.pathFor());
    });

    it("names paths the repository actually stores, or the freeze would be exempting nothing", () => {
        for (const path of liveSessionWritablePaths(STORY)) {
            expect(isVersioned(path)).toBe(true);
        }
    });

    it("carries the cast, and the story it opened on rather than every story", () => {
        // ⚠ The one that must not be widened to "every document of a shared kind". A session applies
        // operations about one story; making the second one writable would leave the boundary
        // allowing an edit the host refuses, which is a local change with no digest over it.
        expect(liveSessionCarries(STORY, { doc: "story", storyId: STORY })).toBe(true);
        expect(liveSessionCarries(STORY, { doc: "story", storyId: "story-2" })).toBe(false);
        expect(liveSessionCarries(STORY, { doc: "characters" })).toBe(true);
    });

    it("has a writable path for every document kind the vocabulary can carry, and no others", () => {
        // The invariant, stated as a test: a document is writable during a session exactly when the
        // session can carry its changes. A verb whose document is not here would be an operation the
        // room applies and every machine then fails to save.
        const carried = new Set<string>();
        const verbs: LiveOp[] = [
            { op: "rename-story", name: "x" },
            { op: "create-character", character: { profile: { id: "c" } } as never },
        ];
        for (const op of verbs) {
            carried.add(opDocumentKind(op));
        }
        expect([...carried].sort()).toEqual(["characters", "story"]);
        expect(liveSessionWritablePaths(STORY)).toHaveLength(carried.size);
    });
});
