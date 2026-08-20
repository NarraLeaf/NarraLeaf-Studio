import { describe, expect, it, vi } from "vitest";
import type { LocalizationUnit } from "@shared/types/localization";
import type { StoryBlock } from "@shared/types/story";
import { cloneSerializedBlock, listBlockTextIds } from "./storySceneClipboard";
import {
    collectClipboardTranslations,
    planCarriedTranslations,
    carryTranslationsWithinProject,
    writeCarriedTranslations,
    type CarriedTranslationPort,
    type TranslationDocuments,
} from "./storyTranslationTransfer";
import type { SerializedStoryBlock } from "./storySceneEditorTypes";

/**
 * Whether a translation follows the line it belongs to across a copy.
 *
 * Every one of these is invisible in the running app until it is already wrong: a pasted row looks
 * exactly the same whether its translations came with it or were left behind, and the loss only
 * shows up in the language the author is not reading.
 */

function unit(target: string, extra: Partial<LocalizationUnit> = {}): LocalizationUnit {
    return { target, sourceHash: "fnv1a:0000", status: "translated", ...extra };
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

function choice(id: string, textId: string): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: { action: "choice", prompt: { textId, role: "choicePrompt", value: "Well?" } },
    };
}

/** A subtree as the clipboard serializes one: a root with its children beneath it. */
function subtree(block: StoryBlock, ...children: StoryBlock[]): SerializedStoryBlock {
    return { block, children: children.map(child => ({ block: child, children: [] })) };
}

function idFactory(): () => string {
    let issued = 0;
    return () => `new-${(issued += 1)}`;
}

describe("the lines a copy carries translations for", () => {
    it("reads the text id of every segment field, root and nested alike", () => {
        expect(listBlockTextIds([dialogue("b1", "t-1", "Hi"), choice("b2", "t-2")])).toEqual(["t-1", "t-2"]);
    });

    it("carries a translated line's unit for every language that has one", () => {
        const library: Record<string, Record<string, LocalizationUnit>> = {
            ja: { "t-1": unit("やあ") },
            zh: { "t-1": unit("你好") },
        };

        expect(collectClipboardTranslations(["t-1"], ["en", "ja", "zh"], locale => library[locale])).toEqual({
            ja: { "t-1": unit("やあ") },
            zh: { "t-1": unit("你好") },
        });
    });

    it("carries nothing at all for rows nobody has translated", () => {
        // Absent rather than an empty table: the field means "these lines have translations".
        expect(collectClipboardTranslations(["t-1"], ["ja"], () => ({}))).toBeUndefined();
        expect(collectClipboardTranslations(["t-1"], ["ja"], () => ({ "t-1": unit("") }))).toBeUndefined();
    });

    it("carries only the lines being copied, never the rest of the language", () => {
        const units = { "t-1": unit("やあ"), "t-elsewhere": unit("別の行") };

        expect(collectClipboardTranslations(["t-1"], ["ja"], () => units)).toEqual({ ja: { "t-1": unit("やあ") } });
    });

    it("carries nothing for a language whose document is not in memory", () => {
        expect(collectClipboardTranslations(["t-1"], ["ja"], () => undefined)).toBeUndefined();
    });
});

describe("following a line to the id the paste minted", () => {
    it("reports the renaming the clone performed, so a unit can be re-keyed onto it", () => {
        const textIds = new Map<string, string>();

        const cloned = cloneSerializedBlock(subtree(dialogue("b1", "t-1", "Hi"), choice("b2", "t-2")), idFactory(), textIds);

        // The clone's own ids are what the map has to name, or a translation lands on nothing.
        const clonedTextId = (node: SerializedStoryBlock) =>
            (node.block.payload as unknown as { text?: { textId: string }; prompt?: { textId: string } });
        expect(textIds.get("t-1")).toBe(clonedTextId(cloned).text?.textId);
        expect(textIds.get("t-2")).toBe(clonedTextId(cloned.children[0]).prompt?.textId);
    });

    it("puts each carried unit under the new id of its own line", () => {
        const textIds = new Map([["t-1", "new-1"], ["t-2", "new-2"]]);

        const plan = planCarriedTranslations(
            { ja: { "t-1": unit("やあ"), "t-2": unit("さて？") } },
            textIds,
            new Set(["ja"]),
        );

        expect(plan.writes).toEqual([{ locale: "ja", units: { "new-1": unit("やあ"), "new-2": unit("さて？") } }]);
        expect(plan.carried).toBe(2);
        expect(plan.droppedLocales).toBe(0);
    });

    it("keeps the source anchor, so a translation that was out of date still says so", () => {
        // The line arrived character for character. Re-anchoring the hash here would silently turn a
        // translation made against an older source line into a current one.
        const plan = planCarriedTranslations(
            { ja: { "t-1": unit("やあ", { sourceHash: "fnv1a:beforeTheRewrite" }) } },
            new Map([["t-1", "new-1"]]),
            new Set(["ja"]),
        );

        expect(plan.writes[0].units["new-1"].sourceHash).toBe("fnv1a:beforeTheRewrite");
    });

    it("does not inherit a review, and does keep a machine translation as one", () => {
        const plan = planCarriedTranslations(
            {
                ja: { "t-1": unit("やあ", { status: "reviewed" }) },
                zh: { "t-1": unit("你好", { status: "machine" }) },
            },
            new Map([["t-1", "new-1"]]),
            new Set(["ja", "zh"]),
        );

        expect(plan.writes[0].units["new-1"].status).toBe("translated");
        expect(plan.writes[1].units["new-1"].status).toBe("machine");
    });

    it("counts a language this project does not have, and writes nothing for it", () => {
        // Adding a language is a decision the author makes; a paste may not make it for them.
        const plan = planCarriedTranslations(
            { ja: { "t-1": unit("やあ") }, fr: { "t-1": unit("Salut"), "t-2": unit("Alors ?") } },
            new Map([["t-1", "new-1"], ["t-2", "new-2"]]),
            new Set(["ja"]),
        );

        expect(plan.writes).toEqual([{ locale: "ja", units: { "new-1": unit("やあ") } }]);
        expect(plan.carried).toBe(1);
        expect(plan.droppedLocales).toBe(2);
    });

    it("drops a unit for a line these rows do not contain", () => {
        const plan = planCarriedTranslations(
            { ja: { "t-elsewhere": unit("別の行") } },
            new Map([["t-1", "new-1"]]),
            new Set(["ja"]),
        );

        expect(plan).toEqual({ writes: [], carried: 0, droppedLocales: 0 });
    });

    it("survives a payload that says whatever it likes about itself", () => {
        // Written by another Studio process, of another version: what arrives is JSON of any shape.
        const plan = planCarriedTranslations(
            {
                ja: { "t-1": { target: 12 }, "t-2": unit("さて？") },
                "not a locale/../": { "t-1": unit("x") },
                zh: "nonsense",
            },
            new Map([["t-1", "new-1"], ["t-2", "new-2"]]),
            new Set(["ja", "zh"]),
        );

        expect(plan.writes).toEqual([{ locale: "ja", units: { "new-2": unit("さて？") } }]);
        expect(plan.droppedLocales).toBe(0);
    });

    it("has nothing to do when the payload carries no translations", () => {
        expect(planCarriedTranslations(undefined, new Map([["t-1", "new-1"]]), new Set(["ja"])))
            .toEqual({ writes: [], carried: 0, droppedLocales: 0 });
    });
});

describe("writing the carried translations", () => {
    function port(overrides: Partial<CarriedTranslationPort> = {}): CarriedTranslationPort {
        return {
            open: vi.fn(async () => true),
            adopt: vi.fn(() => true),
            isFrozen: () => false,
            ...overrides,
        };
    }

    const PLAN = {
        writes: [
            { locale: "ja", units: { "new-1": unit("やあ") } },
            { locale: "zh", units: { "new-1": unit("你好") } },
        ],
        carried: 2,
        droppedLocales: 0,
    };

    it("writes every language's share and counts what landed", async () => {
        const target = port();

        await expect(writeCarriedTranslations(target, PLAN)).resolves.toEqual({ written: 2, frozen: false });
        expect(target.adopt).toHaveBeenCalledTimes(2);
    });

    it("stops the moment the workspace freezes under it", async () => {
        // Rows written into a frozen workspace reach memory, are refused at the file-system boundary
        // and are gone at the thaw. A translation file is no different.
        const frozen = { value: false };
        const target = port({
            open: vi.fn(async () => {
                frozen.value = true;
                return true;
            }),
            isFrozen: () => frozen.value,
        });

        await expect(writeCarriedTranslations(target, PLAN)).resolves.toEqual({ written: 0, frozen: true });
        expect(target.adopt).not.toHaveBeenCalled();
    });

    it("costs the author one language when that language's file cannot be opened", async () => {
        const target = port({ open: vi.fn(async (locale: string) => locale !== "ja") });

        await expect(writeCarriedTranslations(target, PLAN)).resolves.toEqual({ written: 1, frozen: false });
        expect(target.adopt).toHaveBeenCalledWith("zh", { "new-1": unit("你好") });
    });
});

describe("duplicating rows inside one project", () => {
    // Ctrl+D and Ctrl+C/Ctrl+V mint ids the same way, so they have to answer this the same way too;
    // an author who finds them disagreeing has no way to tell which one is right.
    function documents(units: Record<string, Record<string, LocalizationUnit>>): TranslationDocuments & { written: Record<string, Record<string, LocalizationUnit>> } {
        const written: Record<string, Record<string, LocalizationUnit>> = {};
        return {
            written,
            getConfiguration: () => ({ locales: [{ code: "zh" }, { code: "ja" }] }),
            getDocumentIfLoaded: (locale: string) => (units[locale] ? { units: units[locale] } : undefined),
            loadDocument: async () => undefined,
            adoptUnits: (locale: string, adopted: Record<string, LocalizationUnit>) => {
                written[locale] = { ...(written[locale] ?? {}), ...adopted };
            },
        };
    }

    it("carries every language of the rows it duplicates", async () => {
        const docs = documents({ zh: { "old-1": unit("你好") }, ja: { "old-1": unit("こんにちは") } });

        const outcome = await carryTranslationsWithinProject(docs, () => false, ["old-1"], new Map([["old-1", "new-1"]]));

        expect(outcome).toEqual({ written: 2, frozen: false });
        expect(docs.written).toEqual({ zh: { "new-1": unit("你好") }, ja: { "new-1": unit("こんにちは") } });
    });

    it("writes nothing when the duplicated rows were never translated", async () => {
        const docs = documents({ zh: { "someone-else": unit("你好") } });

        await expect(carryTranslationsWithinProject(docs, () => false, ["old-1"], new Map([["old-1", "new-1"]])))
            .resolves.toEqual({ written: 0, frozen: false });
        expect(docs.written).toEqual({});
    });

    it("writes nothing once the workspace has frozen", async () => {
        const docs = documents({ zh: { "old-1": unit("你好") } });

        await expect(carryTranslationsWithinProject(docs, () => true, ["old-1"], new Map([["old-1", "new-1"]])))
            .resolves.toEqual({ written: 0, frozen: true });
        expect(docs.written).toEqual({});
    });
});
