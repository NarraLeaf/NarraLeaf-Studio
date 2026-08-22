import { afterEach, describe, expect, it } from "vitest";
import type { LiveDerived } from "@shared/live/ops";
import type { LocaleCode, LocalizationUnit } from "@shared/types/localization";
import { freezeProjectWrites, refuseFrozenWrite, thawProjectWrites } from "@/lib/app/writeFreeze";
import {
    applyLiveDerived,
    classifyStoryPaste,
    derivedWritesFrozen,
    liveDerivedFor,
    liveSessionOnProject,
    rowsOnlyPayload,
    takeSessionRowsOnlyNotice,
    type LiveDerivedPorts,
} from "./storyLivePaste";
import type { CarriedTranslationPlan, CarriedTranslationPort } from "./storyTranslationTransfer";
import type { CarriedVoicePlan, CarriedVoicePort } from "./storyVoiceTransfer";
import type { StoryClipboardPayload, StoryClipboardTranslations } from "./storySceneEditorTypes";

/**
 * The two things a paste of story rows can be while a live session is open, and what an effect
 * carries so that the second machine ends up with the library the first one does.
 */

const PROJECT = "D:/projects/my-game";
const STORY = "editor/story/stories/s1/storydoc.json";
const LOCALIZATION = `${PROJECT}/editor/localization/ja.json`;

function payload(source?: { path: string }): StoryClipboardPayload {
    return {
        version: 2,
        kind: "narraleaf.story.actions",
        roots: [],
        ...(source ? { source: { path: source.path, identifier: "com.example.game", name: "Game" } } : {}),
    };
}

function armSession(session = "room-1"): void {
    freezeProjectWrites({
        projectPath: PROJECT,
        reason: { kind: "live-session", session, writable: [STORY] },
    });
}

/** A library that records what it was asked to file, and can be told to refuse or to throw. */
function libraryStub(options: { onAdopt?: () => void } = {}) {
    const adopted: { locale: string; units: Record<string, unknown> }[] = [];
    const windowOpen: boolean[] = [];
    const port = {
        open: async () => true,
        adopt: (locale: string, units: Record<string, unknown>) => {
            // What the write boundary would answer at the moment the write happens - the only
            // observation of the derived window that is worth anything, since it is the question
            // the boundary itself asks.
            windowOpen.push(refuseFrozenWrite(LOCALIZATION) === null);
            options.onAdopt?.();
            adopted.push({ locale, units });
            return true;
        },
        isFrozen: () => false,
    };
    return {
        adopted,
        windowOpen,
        ports: {
            translations: port as unknown as CarriedTranslationPort,
            voice: port as unknown as CarriedVoicePort,
        } satisfies LiveDerivedPorts,
    };
}

afterEach(() => {
    thawProjectWrites();
});

describe("telling the two pastes apart", () => {
    it("reads rows copied out of this project as its own", () => {
        expect(classifyStoryPaste(payload({ path: PROJECT }), PROJECT)).toBe("own");
    });

    it("reads rows copied out of another project as outside", () => {
        expect(classifyStoryPaste(payload({ path: "D:/projects/elsewhere" }), PROJECT)).toBe("outside");
    });

    /**
     * The case that looks like a third and is not. A session changes nothing about where the rows
     * were written, so rows copied here while a session is running and pasted back in are the same
     * derivable paste they would be with no session at all - the entries travel, and every machine
     * writes them.
     */
    it("still reads its own rows as its own while a session is running", () => {
        armSession();
        expect(classifyStoryPaste(payload({ path: PROJECT }), PROJECT)).toBe("own");
        expect(classifyStoryPaste(payload({ path: "D:/projects/elsewhere" }), PROJECT)).toBe("outside");
    });

    /** A payload from a Studio that predates the source field can only have been written here. */
    it("reads a payload with no source as its own", () => {
        expect(classifyStoryPaste(payload(), PROJECT)).toBe("own");
    });
});

describe("the session a paste is happening inside", () => {
    it("finds no session while nothing is frozen", () => {
        expect(liveSessionOnProject(PROJECT)).toBeNull();
        expect(derivedWritesFrozen(PROJECT)).toBe(false);
    });

    it("names the room while one is open on this project", () => {
        armSession("room-7");
        expect(liveSessionOnProject(PROJECT)).toBe("room-7");
        // The libraries are writable inside the window a session opens, which is why the transfer
        // ports may not ask the ordinary "is anything frozen" question.
        expect(derivedWritesFrozen(PROJECT)).toBe(false);
    });

    it("finds no session under a freeze that is not one, and refuses derived writes", () => {
        freezeProjectWrites({ projectPath: PROJECT, reason: { kind: "revision", revision: "aa" } });
        expect(liveSessionOnProject(PROJECT)).toBeNull();
        expect(derivedWritesFrozen(PROJECT)).toBe(true);
    });

    it("ignores a session open on some other project", () => {
        armSession();
        expect(liveSessionOnProject("D:/projects/other-game")).toBeNull();
        expect(derivedWritesFrozen("D:/projects/other-game")).toBe(true);
    });
});

describe("what one effect carries", () => {
    const TRANSLATIONS: CarriedTranslationPlan = {
        writes: [{
            locale: "ja" as LocaleCode,
            units: { "new-1": { target: "やあ", sourceHash: "fnv1a:older", status: "translated" } },
        }],
        carried: 1,
        droppedLocales: 0,
    };
    const VOICE: CarriedVoicePlan = {
        writes: [{
            locale: "ja" as LocaleCode,
            units: { "new-1": { assetId: "clip-1", sourceHash: "fnv1a:older", status: "approved" } },
        }],
        carried: 1,
    };

    /**
     * The entries themselves rather than ids to look up. A copy is a synchronous event that reads
     * the copier's own memory, so an effect saying "find this text id in your library" would derive
     * nothing on any other machine.
     *
     * And the WHOLE entry, not its words: the source hash it was written against, its status and its
     * note ride with it. Carrying the text alone would land every line with no hash - read as stale -
     * and with its review discarded, so a paste inside a session would quietly demote work that the
     * same paste outside one keeps.
     */
    it("carries the entries, keyed by the ids the paste minted", () => {
        expect(liveDerivedFor(TRANSLATIONS, VOICE)).toEqual({
            translations: { ja: { "new-1": { target: "やあ", sourceHash: "fnv1a:older", status: "translated" } } },
            voice: { ja: { "new-1": { assetId: "clip-1", sourceHash: "fnv1a:older", status: "approved" } } },
        });
    });

    it("carries nothing at all when a paste derived nothing", () => {
        expect(liveDerivedFor(
            { writes: [], carried: 0, droppedLocales: 0 },
            { writes: [], carried: 0 },
        )).toBeUndefined();
    });

    it("leaves out the half that is empty", () => {
        expect(liveDerivedFor(TRANSLATIONS, { writes: [], carried: 0 })).toEqual({
            translations: { ja: { "new-1": { target: "やあ", sourceHash: "fnv1a:older", status: "translated" } } },
        });
    });
});

describe("applying a paste effect", () => {
    const DERIVED: LiveDerived = {
        translations: { ja: { "new-1": { target: "やあ", sourceHash: "h1", status: "reviewed" } } },
        voice: { ja: { "new-1": { assetId: "clip-1", sourceHash: "h1", status: "approved" } } },
    };

    it("writes the entries the effect names, into both libraries", async () => {
        armSession();
        const library = libraryStub();

        const outcome = await applyLiveDerived(PROJECT, DERIVED, library.ports);

        expect(outcome).toEqual({ translations: 1, voice: 1 });
        // The hash and the sign-off arrive with the words. Rebuilding a unit from its text alone
        // would land this line unanchored and unreviewed, which is a demotion of somebody's work
        // that nobody would see until they re-read the language.
        expect(library.adopted).toEqual([
            { locale: "ja", units: { "new-1": { target: "やあ", sourceHash: "h1", status: "reviewed" } } },
            { locale: "ja", units: { "new-1": { assetId: "clip-1", sourceHash: "h1", status: "approved" } } },
        ]);
    });

    /**
     * The point of carrying the entries: the machine that pasted and the machine that only received
     * the effect run the same applier over the same payload, so their libraries hold the same bytes.
     */
    it("writes the same entries a second machine writes", async () => {
        armSession();
        const paster = libraryStub();
        const guest = libraryStub();

        await applyLiveDerived(PROJECT, DERIVED, paster.ports);
        await applyLiveDerived(PROJECT, DERIVED, guest.ports);

        expect(guest.adopted).toEqual(paster.adopted);
    });

    it("opens the derived window for the write and closes it afterwards", async () => {
        armSession();
        const library = libraryStub();

        // Refused before: a session leaves its story document writable and nothing else.
        expect(refuseFrozenWrite(LOCALIZATION)).not.toBeNull();

        await applyLiveDerived(PROJECT, DERIVED, library.ports);

        expect(library.windowOpen).toEqual([true, true]);
        expect(refuseFrozenWrite(LOCALIZATION)).not.toBeNull();
    });

    /**
     * A window leaked here does not cost a refused write - it leaves the localization and voice
     * libraries quietly writable for the rest of the session, which is the one thing the window
     * exists to prevent.
     */
    it("closes the window when the write throws", async () => {
        armSession();
        const library = libraryStub({ onAdopt: () => { throw new Error("disk is gone"); } });

        await expect(applyLiveDerived(PROJECT, DERIVED, library.ports)).rejects.toThrow("disk is gone");

        expect(refuseFrozenWrite(LOCALIZATION)).not.toBeNull();
    });

    it("writes nothing for a library this window has no service for", async () => {
        armSession();

        const outcome = await applyLiveDerived(PROJECT, DERIVED, { translations: null, voice: null });

        expect(outcome).toEqual({ translations: 0, voice: 0 });
    });

    /** The message came from another Studio, of another version, and says whatever it likes. */
    it("drops entries that are not a language, an id and a string", async () => {
        armSession();
        const library = libraryStub();

        await applyLiveDerived(PROJECT, {
            translations: {
                "not a locale": { "new-1": { target: "nope", sourceHash: "", status: "translated" } },
                ja: {
                    "new-1": 42 as unknown as LocalizationUnit,
                    "new-2": { target: "こんばんは", sourceHash: "h2", status: "reviewed" },
                },
            },
        }, library.ports);

        expect(library.adopted).toEqual([
            { locale: "ja", units: { "new-2": { target: "こんばんは", sourceHash: "h2", status: "reviewed" } } },
        ]);
    });
});

describe("a payload stripped down to its rows", () => {
    it("drops the translations and the asset grant, and keeps everything the rows need", () => {
        const full: StoryClipboardPayload = {
            ...payload({ path: "D:/projects/elsewhere" }),
            characterNames: { "char-1": "林" },
            assets: { token: "grant-1", entries: [] },
            translations: { ja: { "text-1": { target: "やあ", sourceHash: "", status: "translated" } } } as StoryClipboardTranslations,
        };

        const rows = rowsOnlyPayload(full);

        expect(rows).not.toHaveProperty("assets");
        expect(rows).not.toHaveProperty("translations");
        expect(rows.characterNames).toEqual({ "char-1": "林" });
        expect(rows.source?.path).toBe("D:/projects/elsewhere");
    });
});

describe("telling the author once", () => {
    it("says it for a session, and never again for that session", () => {
        expect(takeSessionRowsOnlyNotice("room-once")).toBe(true);
        expect(takeSessionRowsOnlyNotice("room-once")).toBe(false);
        expect(takeSessionRowsOnlyNotice("room-once")).toBe(false);
    });

    it("says it again for a different session", () => {
        expect(takeSessionRowsOnlyNotice("room-a")).toBe(true);
        expect(takeSessionRowsOnlyNotice("room-b")).toBe(true);
        expect(takeSessionRowsOnlyNotice("room-a")).toBe(true);
    });
});
