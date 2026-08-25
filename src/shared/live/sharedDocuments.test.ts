import { describe, expect, it } from "vitest";
import {
    charactersSpec,
    localizationDocumentSpec,
    storyDocumentSpec,
    voiceDocumentSpec,
} from "@shared/documents/specs";
import { isVersioned } from "@shared/vcs/workingSet";
import { opDocumentKind, type LiveOp } from "./ops";
import {
    liveDocumentPath,
    liveSessionCarries,
    liveSessionDocuments,
    liveSessionWritablePaths,
    type LiveSessionLocales,
} from "./sharedDocuments";

const STORY = "story-1";
const LOCALES: LiveSessionLocales = { translations: ["ja", "fr"], voice: ["ja"] };

/**
 * The one table two things read: the write boundary, which asks which paths a session leaves
 * writable, and the host, which asks whether an operation is about a document it speaks for.
 *
 * The failure these guard is the pair disagreeing. A path the boundary allows that the vocabulary
 * cannot carry is an edit that lands on one machine and nowhere else, with no digest over it and
 * nothing anywhere reporting a problem.
 */
describe("the documents a session carries", () => {
    it("is every story in the project, the cast, and each language's two libraries", () => {
        expect(liveSessionDocuments([STORY])).toEqual([{ doc: "story", storyId: STORY }, { doc: "characters" }]);
        expect(liveSessionDocuments([STORY, "story-2"], LOCALES)).toEqual([
            { doc: "story", storyId: STORY },
            { doc: "story", storyId: "story-2" },
            { doc: "characters" },
            { doc: "localization", locale: "ja" },
            { doc: "localization", locale: "fr" },
            { doc: "voice", locale: "ja" },
        ]);
    });

    it("takes the two lists apart, because the two are configured apart", () => {
        // A project can be translated into a language nobody records voice for, which is the ordinary
        // case rather than an edge one: recording is expensive and translating is not.
        expect(liveSessionDocuments([], { translations: ["fr"], voice: [] })).toEqual([
            { doc: "characters" },
            { doc: "localization", locale: "fr" },
        ]);
    });

    it("addresses each one through its own document spec, so a document that moves takes this with it", () => {
        expect(liveDocumentPath({ doc: "story", storyId: STORY })).toBe(storyDocumentSpec.pathFor({ storyId: STORY }));
        expect(liveDocumentPath({ doc: "characters" })).toBe(charactersSpec.pathFor());
        expect(liveDocumentPath({ doc: "localization", locale: "ja" }))
            .toBe(localizationDocumentSpec.pathFor({ locale: "ja" }));
        expect(liveDocumentPath({ doc: "voice", locale: "ja" })).toBe(voiceDocumentSpec.pathFor({ locale: "ja" }));
    });

    it("names paths the repository actually stores, or the freeze would be exempting nothing", () => {
        for (const path of liveSessionWritablePaths([STORY], LOCALES)) {
            expect(isVersioned(path)).toBe(true);
        }
    });

    it("carries what it was given, and nothing it was not", () => {
        // ⚠ Compared against the set rather than assumed. A story created DURING a session is in
        // nobody else's copy - the room agreed a revision on the way in - so an operation about it
        // would be one the others could not apply, and the boundary must not be allowing writes to
        // a document the host would refuse.
        expect(liveSessionCarries([STORY, "story-2"], { doc: "story", storyId: "story-2" })).toBe(true);
        expect(liveSessionCarries([STORY], { doc: "story", storyId: "story-2" })).toBe(false);
        expect(liveSessionCarries([STORY], { doc: "characters" })).toBe(true);
    });

    it("carries a language by name, never a kind, so an unread library is not writable", () => {
        // The trap this file exists to keep shut, one document along: widening to "every path of
        // every shared kind" would leave the French library writable while the host refused every
        // operation about it - a translation that lands here and nowhere else, with no digest over
        // it. A language a machine could not read is one no effect can ever reach.
        expect(liveSessionCarries([STORY], { doc: "localization", locale: "ja" }, LOCALES)).toBe(true);
        expect(liveSessionCarries([STORY], { doc: "localization", locale: "de" }, LOCALES)).toBe(false);
        // And a language translated but not voiced is carried on one side only.
        expect(liveSessionCarries([STORY], { doc: "localization", locale: "fr" }, LOCALES)).toBe(true);
        expect(liveSessionCarries([STORY], { doc: "voice", locale: "fr" }, LOCALES)).toBe(false);
    });

    it("has a writable path for every document kind the vocabulary can carry, and no others", () => {
        // The invariant, stated as a test: a document is writable during a session exactly when the
        // session can carry its changes. A verb whose document is not here would be an operation the
        // room applies and every machine then fails to save.
        const carried = new Set<string>();
        const verbs: LiveOp[] = [
            { op: "rename-story", name: "x" },
            { op: "create-character", character: { profile: { id: "c" } } as never },
            { op: "set-translation", locale: "ja", unitId: "t", unit: null },
            { op: "set-take", locale: "ja", unitId: "t", unit: null },
        ];
        for (const op of verbs) {
            carried.add(opDocumentKind(op));
        }
        expect([...carried].sort()).toEqual(["characters", "localization", "story", "voice"]);
        // Two stories, the cast, two translation libraries and one voice library: every document the
        // vocabulary can carry, and no path for a kind it cannot.
        expect(liveSessionWritablePaths([STORY, "story-2"], LOCALES)).toHaveLength(6);
    });

    it("leaves the named-key registry out, which is the invariant working rather than an omission", () => {
        // `editor/localization/keys.json` has no verbs, so declaring a UI string stays frozen for the
        // length of a session and says so - the harmless half of the trade this table enforces.
        expect(liveSessionWritablePaths([STORY], LOCALES).some(path => path.endsWith("keys.json"))).toBe(false);
    });
});
