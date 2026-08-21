import { describe, expect, it, vi } from "vitest";
import type { StoryBlock } from "@shared/types/story";
import type { VoiceUnit } from "@shared/types/voice";
import { cloneSerializedBlock, listBlockTextIds } from "./storySceneClipboard";
import {
    carryVoiceWithinProject,
    collectVoiceTakes,
    openVoiceLibraries,
    planCarriedVoice,
    writeCarriedVoice,
    type CarriedVoicePort,
    type VoiceDocuments,
} from "./storyVoiceTransfer";
import type { SerializedStoryBlock } from "./storySceneEditorTypes";

/**
 * Whether a recording follows the line it belongs to when that line is copied or moved.
 *
 * Invisible in the running app until it is already wrong, exactly as the translation transfer is: a
 * line pasted into the scene it now belongs in looks identical whether its take came with it or was
 * left behind, and what says otherwise is the voice table putting it back to `missing` and an
 * imported audio file nothing points at any more.
 */

function take(assetId: string, extra: Partial<VoiceUnit> = {}): VoiceUnit {
    return { assetId, sourceHash: "fnv1a:0000", status: "linked", ...extra };
}

function dialogue(id: string, textId: string, value: string): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: { action: "dialogue", characterId: "char-1", text: { textId, role: "dialogue", value } },
    };
}

function subtree(block: StoryBlock, ...children: StoryBlock[]): SerializedStoryBlock {
    return { block, children: children.map(child => ({ block: child, children: [] })) };
}

function idFactory(): () => string {
    let issued = 0;
    return () => `new-${(issued += 1)}`;
}

/**
 * A voice service holding one take, whose languages and whose readability the caller can change.
 *
 * `loaded` records which libraries were opened, because opening them is this transfer's own step -
 * a copy could not wait for a file, and a paste that skipped the wait would carry nothing for every
 * language the author had not already looked at.
 */
function voiceStub(options: {
    voicedLocales?: string[];
    units?: Record<string, Record<string, VoiceUnit>>;
    unreadable?: string[];
} = {}) {
    const voicedLocales = options.voicedLocales ?? ["ja"];
    const stored = options.units ?? { ja: { "text-1": take("clip-1") } };
    const unreadable = new Set(options.unreadable ?? []);
    const loaded = new Set<string>();
    const adopted: { locale: string; units: Record<string, VoiceUnit> }[] = [];
    const documents: VoiceDocuments = {
        getConfiguration: () => ({ voicedLocales: voicedLocales.map(code => ({ code })) }),
        getDocumentIfLoaded: locale => (loaded.has(locale) ? { units: stored[locale] ?? {} } : undefined),
        loadDocument: async locale => {
            if (unreadable.has(locale)) {
                throw new Error(`unreadable: ${locale}`);
            }
            loaded.add(locale);
            return { locale, units: stored[locale] ?? {} };
        },
        adoptUnits: (locale, units) => {
            adopted.push({ locale, units });
        },
    };
    return { documents, adopted, loaded };
}

describe("the lines a copy carries takes for", () => {
    it("carries a voiced line's take for every language that has one", () => {
        const library: Record<string, Record<string, VoiceUnit>> = {
            ja: { "text-1": take("clip-ja") },
            en: { "text-1": take("clip-en") },
        };

        expect(collectVoiceTakes(["text-1"], ["ja", "en"], locale => library[locale])).toEqual({
            ja: { "text-1": take("clip-ja") },
            en: { "text-1": take("clip-en") },
        });
    });

    it("carries nothing at all for lines nobody has recorded", () => {
        // Absent rather than an empty table, so the callers stop before writing anything.
        expect(collectVoiceTakes(["text-1"], ["ja"], () => ({}))).toBeUndefined();
        expect(collectVoiceTakes(["text-1"], ["ja"], () => ({ "text-1": take("") }))).toBeUndefined();
    });

    it("carries only the lines being copied, never the rest of the language", () => {
        const units = { "text-1": take("clip-1"), "text-elsewhere": take("clip-other") };

        expect(collectVoiceTakes(["text-1"], ["ja"], () => units)).toEqual({ ja: { "text-1": take("clip-1") } });
    });

    it("carries nothing for a language whose library is not in memory", () => {
        expect(collectVoiceTakes(["text-1"], ["ja"], () => undefined)).toBeUndefined();
    });
});

describe("following a take to the id the paste minted", () => {
    it("puts each carried take under the new id of its own line", () => {
        const textIds = new Map([["text-1", "new-1"], ["text-2", "new-2"]]);

        const plan = planCarriedVoice(
            { ja: { "text-1": take("clip-1"), "text-2": take("clip-2") } },
            textIds,
        );

        expect(plan.writes).toEqual([{
            locale: "ja",
            units: { "new-1": take("clip-1"), "new-2": take("clip-2") },
        }]);
        expect(plan.carried).toBe(2);
    });

    it("keeps the source anchor, so a take that was out of date still says so", () => {
        // The line arrived character for character. Re-anchoring the hash here would silently turn a
        // recording made against a line that has since been rewritten into a current one.
        const plan = planCarriedVoice(
            { ja: { "text-1": take("clip-1", { sourceHash: "fnv1a:older" }) } },
            new Map([["text-1", "new-1"]]),
        );

        expect(plan.writes[0].units["new-1"].sourceHash).toBe("fnv1a:older");
    });

    /**
     * The sign-off travels, which is where this parts company with the translation transfer.
     *
     * A paste creates no new recording: both lines point at the same audio file, of the same text,
     * and the director's judgement was about that file against that text. Withholding it would send
     * an unchanged file back to the queue with nothing new to listen to.
     */
    it("keeps an approved take approved", () => {
        const plan = planCarriedVoice(
            { ja: { "text-1": take("clip-1", { status: "approved", note: "softer", duration: 2.5 }) } },
            new Map([["text-1", "new-1"]]),
        );

        expect(plan.writes[0].units["new-1"]).toEqual({
            assetId: "clip-1",
            sourceHash: "fnv1a:0000",
            status: "approved",
            duration: 2.5,
            note: "softer",
        });
    });

    it("never invents an approval for a take that has not had one", () => {
        const plan = planCarriedVoice(
            { ja: { "text-1": take("clip-1", { status: "linked" }) } },
            new Map([["text-1", "new-1"]]),
        );

        expect(plan.writes[0].units["new-1"].status).toBe("linked");
    });

    it("drops a take whose line this paste did not write", () => {
        const plan = planCarriedVoice(
            { ja: { "text-elsewhere": take("clip-other") } },
            new Map([["text-1", "new-1"]]),
        );

        expect(plan.writes).toEqual([]);
        expect(plan.carried).toBe(0);
    });

    it("plans nothing when the paste renamed nothing", () => {
        expect(planCarriedVoice({ ja: { "text-1": take("clip-1") } }, new Map())).toEqual({ writes: [], carried: 0 });
        expect(planCarriedVoice(undefined, new Map([["text-1", "new-1"]]))).toEqual({ writes: [], carried: 0 });
    });

    it("re-keys onto the ids the clone actually minted", () => {
        const textIds = new Map<string, string>();

        const cloned = cloneSerializedBlock(subtree(dialogue("b1", "text-1", "Hi")), idFactory(), textIds);

        const mintedId = (cloned.block.payload as unknown as { text: { textId: string } }).text.textId;
        const plan = planCarriedVoice({ ja: { "text-1": take("clip-1") } }, textIds);
        expect(listBlockTextIds([dialogue("b1", "text-1", "Hi")])).toEqual(["text-1"]);
        expect(plan.writes[0].units[mintedId]).toEqual(take("clip-1"));
    });
});

describe("opening the voice libraries a paste needs", () => {
    function port(overrides: Partial<CarriedVoicePort> = {}): CarriedVoicePort {
        return {
            open: async () => true,
            adopt: () => true,
            isFrozen: () => false,
            ...overrides,
        };
    }

    it("reports the languages that answered", async () => {
        const opened = await openVoiceLibraries(port(), ["ja", "en"]);

        expect(opened).toEqual({ opened: ["ja", "en"], frozen: false });
    });

    it("skips a language whose library cannot be read and keeps the rest", async () => {
        // That language costs the author its recordings and nothing else: the rows are already in
        // the scene by the time this runs.
        const opened = await openVoiceLibraries(port({ open: async locale => locale !== "ja" }), ["ja", "en"]);

        expect(opened).toEqual({ opened: ["en"], frozen: false });
    });

    it("stops the moment the workspace freezes", async () => {
        const frozen = { value: false };
        const open = vi.fn(async () => {
            frozen.value = true;
            return true;
        });

        const opened = await openVoiceLibraries(port({ open, isFrozen: () => frozen.value }), ["ja", "en"]);

        expect(opened.frozen).toBe(true);
        expect(open).toHaveBeenCalledTimes(1);
    });
});

describe("writing the takes", () => {
    const PLAN = {
        writes: [
            { locale: "ja", units: { "new-1": take("clip-ja") } },
            { locale: "en", units: { "new-1": take("clip-en") } },
        ],
        carried: 2,
    };

    it("writes every language's share", () => {
        const adopt = vi.fn(() => true);

        expect(writeCarriedVoice({ open: async () => true, adopt, isFrozen: () => false }, PLAN))
            .toEqual({ written: 2, frozen: false });
        expect(adopt).toHaveBeenCalledTimes(2);
    });

    it("writes nothing more once the workspace has frozen", () => {
        const adopt = vi.fn(() => true);

        expect(writeCarriedVoice({ open: async () => true, adopt, isFrozen: () => true }, PLAN))
            .toEqual({ written: 0, frozen: true });
        expect(adopt).not.toHaveBeenCalled();
    });

    it("costs the author only the language that refused the write", () => {
        const adopt = vi.fn((locale: string) => locale !== "ja");

        expect(writeCarriedVoice({ open: async () => true, adopt, isFrozen: () => false }, PLAN))
            .toEqual({ written: 1, frozen: false });
    });
});

describe("takes carried inside one project", () => {
    const TEXT_IDS = new Map([["text-1", "new-1"]]);

    it("opens a library nobody had read yet and carries its take onto the new line", async () => {
        const voice = voiceStub();

        const outcome = await carryVoiceWithinProject(voice.documents, () => false, ["text-1"], TEXT_IDS);

        expect(voice.loaded.has("ja")).toBe(true);
        expect(outcome).toEqual({ written: 1, frozen: false });
        expect(voice.adopted).toEqual([{ locale: "ja", units: { "new-1": take("clip-1") } }]);
    });

    it("carries nothing when the project dubs into no language at all", async () => {
        const voice = voiceStub({ voicedLocales: [] });

        await expect(carryVoiceWithinProject(voice.documents, () => false, ["text-1"], TEXT_IDS))
            .resolves.toEqual({ written: 0, frozen: false });
        expect(voice.loaded.size).toBe(0);
    });

    it("carries nothing for a line that has no take", async () => {
        const voice = voiceStub({ units: { ja: {} } });

        await expect(carryVoiceWithinProject(voice.documents, () => false, ["text-1"], TEXT_IDS))
            .resolves.toEqual({ written: 0, frozen: false });
        expect(voice.adopted).toEqual([]);
    });

    it("carries what it can when one language's library is unreadable", async () => {
        const voice = voiceStub({
            voicedLocales: ["ja", "en"],
            units: { ja: { "text-1": take("clip-ja") }, en: { "text-1": take("clip-en") } },
            unreadable: ["ja"],
        });

        const outcome = await carryVoiceWithinProject(voice.documents, () => false, ["text-1"], TEXT_IDS);

        expect(outcome).toEqual({ written: 1, frozen: false });
        expect(voice.adopted).toEqual([{ locale: "en", units: { "new-1": take("clip-en") } }]);
    });

    it("writes nothing when the workspace froze while the libraries were opening", async () => {
        const voice = voiceStub();

        await expect(carryVoiceWithinProject(voice.documents, () => true, ["text-1"], TEXT_IDS))
            .resolves.toEqual({ written: 0, frozen: true });
        expect(voice.adopted).toEqual([]);
    });

    it("carries nothing while the project configuration is still unreadable", async () => {
        const documents: VoiceDocuments = {
            getConfiguration: () => {
                throw new Error("not ready");
            },
            getDocumentIfLoaded: () => undefined,
            loadDocument: async () => undefined,
            adoptUnits: () => undefined,
        };

        await expect(carryVoiceWithinProject(documents, () => false, ["text-1"], TEXT_IDS))
            .resolves.toEqual({ written: 0, frozen: false });
    });
});
