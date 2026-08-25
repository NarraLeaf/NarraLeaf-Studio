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
    it("is every story in the project, and the cast", () => {
        expect(liveSessionDocuments([STORY])).toEqual([{ doc: "story", storyId: STORY }, { doc: "characters" }]);
        expect(liveSessionDocuments([STORY, "story-2"])).toEqual([
            { doc: "story", storyId: STORY },
            { doc: "story", storyId: "story-2" },
            { doc: "characters" },
        ]);
    });

    it("addresses each one through its own document spec, so a document that moves takes this with it", () => {
        expect(liveDocumentPath({ doc: "story", storyId: STORY })).toBe(storyDocumentSpec.pathFor({ storyId: STORY }));
        expect(liveDocumentPath({ doc: "characters" })).toBe(charactersSpec.pathFor());
    });

    it("names paths the repository actually stores, or the freeze would be exempting nothing", () => {
        for (const path of liveSessionWritablePaths([STORY])) {
            expect(isVersioned(path)).toBe(true);
        }
    });

    it("carries the cast and the stories it was given, and nothing it was not", () => {
        // ⚠ Compared against the set rather than assumed. A story created DURING a session is in
        // nobody else's copy - the room agreed a revision on the way in - so an operation about it
        // would be one the others could not apply, and the boundary must not be allowing writes to
        // a document the host would refuse.
        expect(liveSessionCarries([STORY, "story-2"], { doc: "story", storyId: "story-2" })).toBe(true);
        expect(liveSessionCarries([STORY], { doc: "story", storyId: "story-2" })).toBe(false);
        expect(liveSessionCarries([STORY], { doc: "characters" })).toBe(true);
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
        // One path per story plus one for the cast: every document the vocabulary can carry, and no
        // path for a kind it cannot.
        expect(liveSessionWritablePaths([STORY, "story-2"])).toHaveLength(3);
    });
});
