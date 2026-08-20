import { describe, expect, it, vi } from "vitest";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import type { AssetTransferEntry } from "@shared/types/assetTransfer";
import { collectUnresolvedSpeakerRows } from "@/lib/workspace/services/story/storyModel";
import {
    collectStoryAssetIds,
    collectStoryCharacterIds,
    countUnresolvedAssetSites,
    importTransferredAssets,
    isStoryPasteFromAnotherProject,
    listSerializedBlocks,
    treatForeignCharacterRefs,
    type TransferredAssetPort,
} from "./storyForeignPaste";
import type { SerializedStoryBlock, StoryClipboardPayload } from "./storySceneEditorTypes";

/**
 * What a paste makes of rows that were copied somewhere else.
 *
 * The cases here are the rulings themselves, which is why they are tested against the functions
 * rather than through the editor: which reference survives a paste is not something a running app
 * shows you until it is already wrong, and two of these ("a character that resolves is left alone",
 * "a stage row keeps its id") are indistinguishable on screen from the mistakes they rule out.
 */

const KNOWN = new Set(["char-narra", "char-aoi"]);
const NAMES = { "char-kaede": "Kaede", "char-narra": "Narra" };

function dialogue(id: string, payload: { characterId?: string; speakerName?: string }): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: {
            action: "dialogue",
            ...payload,
            text: { textId: `t-${id}`, role: "dialogue", value: "Hi" },
        },
    };
}

/** A character's stage row: it carries an id and has no bare-name arm to fall back to. */
function characterEnter(id: string, characterId: string): StoryBlock {
    return {
        id,
        kind: "action",
        parentId: null,
        childrenIds: [],
        payload: { action: "character", operation: "enter", characterId },
    };
}

function setBackground(id: string, assetId: string): StoryBlock {
    return {
        id,
        kind: "action",
        parentId: null,
        childrenIds: [],
        payload: { action: "setBackground", assetId },
    };
}

function roots(...blocks: StoryBlock[]): SerializedStoryBlock[] {
    return blocks.map(block => ({ block, children: [] }));
}

function payloadOf(node: SerializedStoryBlock): Record<string, unknown> {
    return node.block.payload as unknown as Record<string, unknown>;
}

function payloadWith(payload: Partial<StoryClipboardPayload>): StoryClipboardPayload {
    return { version: 2, kind: "narraleaf.story.actions", roots: [], ...payload };
}

describe("telling a foreign paste from a paste that came home", () => {
    it("reads a payload with no source as this project's own", () => {
        // Written by a Studio from before the field existed, which can only have happened on this
        // machine. It pastes the way it was copied.
        expect(isStoryPasteFromAnotherProject(payloadWith({ version: 1 }), "/projects/a")).toBe(false);
    });

    it("compares paths through the project identity, not spelling", () => {
        const payload = payloadWith({ source: { path: "/projects/a/", identifier: "com.a", name: "A" } });

        expect(isStoryPasteFromAnotherProject(payload, "/projects/a")).toBe(false);
    });

    it("treats another directory as another project", () => {
        const payload = payloadWith({ source: { path: "/projects/a", identifier: "com.a", name: "A" } });

        expect(isStoryPasteFromAnotherProject(payload, "/projects/b")).toBe(true);
    });

    it("ignores the identifier, which two projects may share", () => {
        const payload = payloadWith({ source: { path: "/projects/a", identifier: "com.shared", name: "A" } });

        expect(isStoryPasteFromAnotherProject(payload, "/projects/b")).toBe(true);
    });
});

describe("character references in a foreign paste", () => {
    it("leaves a character id this project answers to", () => {
        // Not a corner: every project made from one template ships the same character ids, so two
        // projects genuinely share identities. Degrading this would throw away a correct binding.
        const result = treatForeignCharacterRefs(
            roots(dialogue("a", { characterId: "char-narra" })),
            { knownCharacterIds: KNOWN, characterNames: NAMES },
        );

        expect(payloadOf(result.roots[0])).toMatchObject({ characterId: "char-narra" });
        expect(payloadOf(result.roots[0])).not.toHaveProperty("speakerName");
        expect(result).toMatchObject({ degradedSpeakers: 0, unresolvedCharacterRows: 0 });
    });

    it("degrades an unresolvable speaker to the name it had", () => {
        const result = treatForeignCharacterRefs(
            roots(dialogue("a", { characterId: "char-kaede" })),
            { knownCharacterIds: KNOWN, characterNames: NAMES },
        );

        expect(payloadOf(result.roots[0])).toMatchObject({ speakerName: "Kaede" });
        expect(payloadOf(result.roots[0])).not.toHaveProperty("characterId");
        expect(result).toMatchObject({ degradedSpeakers: 1, unresolvedCharacterRows: 0 });
    });

    it("leaves the payload it was given alone", () => {
        const original = roots(dialogue("a", { characterId: "char-kaede" }));

        treatForeignCharacterRefs(original, { knownCharacterIds: KNOWN, characterNames: NAMES });

        expect(payloadOf(original[0])).toMatchObject({ characterId: "char-kaede" });
    });

    it("writes the shape the speaker repair recognises", () => {
        // The degraded row is what the story row's "bind these speakers" gesture repairs afterwards,
        // and it can only find it if the row carries a bare name and no id.
        const result = treatForeignCharacterRefs(
            roots(dialogue("a", { characterId: "char-kaede" })),
            { knownCharacterIds: KNOWN, characterNames: NAMES },
        );
        const document = documentOf(result.roots);

        // The speaker it reports back is the bare name, which is what the repair groups rows by.
        expect(collectUnresolvedSpeakerRows(document, ["a"], KNOWN)).toEqual([
            { sceneId: "scene-1", blockId: "a", speaker: { kind: "name", value: "Kaede" } },
        ]);
    });

    it("keeps the id on a character stage row", () => {
        // A stage row has no bare-name arm, and `story/character-missing` reports it as an error
        // with a jump to the row. Degrading it would trade that for a silently empty stage.
        const result = treatForeignCharacterRefs(
            roots(characterEnter("enter", "char-kaede")),
            { knownCharacterIds: KNOWN, characterNames: NAMES },
        );

        expect(payloadOf(result.roots[0])).toMatchObject({ characterId: "char-kaede" });
        expect(result).toMatchObject({ degradedSpeakers: 0, unresolvedCharacterRows: 1 });
    });

    it("leaves a speaker the copying project could not name either", () => {
        const result = treatForeignCharacterRefs(
            roots(dialogue("a", { characterId: "char-ghost" })),
            { knownCharacterIds: KNOWN, characterNames: NAMES },
        );

        expect(payloadOf(result.roots[0])).toMatchObject({ characterId: "char-ghost" });
        expect(result).toMatchObject({ degradedSpeakers: 0, unresolvedCharacterRows: 1 });
    });

    it("reaches rows nested inside a copied container", () => {
        const container: SerializedStoryBlock = {
            block: { id: "group", kind: "control", parentId: null, childrenIds: ["a"], payload: { action: "if" } } as unknown as StoryBlock,
            children: roots(dialogue("a", { characterId: "char-kaede" })),
        };

        const result = treatForeignCharacterRefs([container], { knownCharacterIds: KNOWN, characterNames: NAMES });

        expect(payloadOf(result.roots[0].children[0])).toMatchObject({ speakerName: "Kaede" });
    });

    it("collects the character ids the rows name, once each", () => {
        const blocks = listSerializedBlocks(roots(
            dialogue("a", { characterId: "char-kaede" }),
            characterEnter("enter", "char-kaede"),
            dialogue("b", { speakerName: "Nobody" }),
        ));

        expect(collectStoryCharacterIds(blocks)).toEqual(["char-kaede"]);
    });
});

describe("the assets a foreign paste needs", () => {
    const MANIFEST = { token: "token-1", declaredAssetIds: ["asset-cg"] };
    const GRANTED: AssetTransferEntry[] = [
        { assetId: "asset-cg", fileName: "kaede-cg.png", type: "image", sourcePath: "/projects/a/assets/content/as/se/t-cg" },
    ];

    function port(overrides: Partial<TransferredAssetPort> = {}): TransferredAssetPort {
        return {
            redeem: async () => GRANTED,
            has: () => false,
            read: async () => new Uint8Array([1, 2, 3]),
            create: async () => "created",
            isFrozen: () => false,
            ...overrides,
        };
    }

    it("collects the asset ids the rows name", () => {
        const blocks = listSerializedBlocks(roots(setBackground("bg", "asset-cg"), dialogue("a", {})));

        expect(collectStoryAssetIds(blocks)).toEqual(["asset-cg"]);
    });

    it("counts a missing file once per field that names it", async () => {
        // What the author is told matches what the lint will report: `assets/missing` names each
        // site and carries a jump to it, so two rows on one file are two things to look at.
        const blocks = listSerializedBlocks(roots(
            setBackground("bg", "asset-cg"),
            setBackground("bg2", "asset-cg"),
            setBackground("bg3", "asset-here"),
        ));

        expect(countUnresolvedAssetSites(blocks, assetId => assetId === "asset-here")).toBe(2);
    });

    it("imports a file the project does not have, under the id it already carries", async () => {
        const create = vi.fn(async () => "created" as const);

        const result = await importTransferredAssets(port({ create }), MANIFEST, ["asset-cg"]);

        expect(result).toEqual({ imported: 1, failed: 0, frozen: false });
        expect(create).toHaveBeenCalledWith(GRANTED[0], new Uint8Array([1, 2, 3]));
    });

    it("keeps the reference and imports nothing when the manifest is gone", async () => {
        // The offering window closed, or the copy came from another Studio process. Not an error:
        // the rows still paste and `assets/missing` reports what they point at.
        const read = vi.fn();

        const result = await importTransferredAssets(port({ redeem: async () => null, read }), MANIFEST, ["asset-cg"]);

        expect(result).toEqual({ imported: 0, failed: 0, frozen: false });
        expect(read).not.toHaveBeenCalled();
    });

    it("does nothing for a payload that carries no manifest at all", async () => {
        const redeem = vi.fn();

        const result = await importTransferredAssets(port({ redeem }), undefined, ["asset-cg"]);

        expect(result).toEqual({ imported: 0, failed: 0, frozen: false });
        expect(redeem).not.toHaveBeenCalled();
    });

    it("leaves an asset this project already holds alone", async () => {
        const redeem = vi.fn();

        const result = await importTransferredAssets(port({ has: () => true, redeem }), MANIFEST, ["asset-cg"]);

        expect(result).toEqual({ imported: 0, failed: 0, frozen: false });
        expect(redeem).not.toHaveBeenCalled();
    });

    it("counts an id the library turns out to hold as arrived, not as a failure", async () => {
        const result = await importTransferredAssets(port({ create: async () => "present" }), MANIFEST, ["asset-cg"]);

        expect(result).toEqual({ imported: 0, failed: 0, frozen: false });
    });

    it("counts a file it could not read without giving up the rest", async () => {
        const granted: AssetTransferEntry[] = [
            { ...GRANTED[0] },
            { assetId: "asset-bgm", fileName: "theme.ogg", type: "audio", sourcePath: "/projects/a/assets/content/as/se/t-bgm" },
        ];
        const read = vi.fn(async (path: string) => (path.endsWith("t-cg") ? null : new Uint8Array([9])));

        const result = await importTransferredAssets(
            port({ redeem: async () => granted, read }),
            { token: "token-1", declaredAssetIds: ["asset-cg", "asset-bgm"] },
            ["asset-cg", "asset-bgm"],
        );

        expect(result).toEqual({ imported: 1, failed: 1, frozen: false });
    });

    it("ignores a granted file the pasted rows never named", async () => {
        const granted: AssetTransferEntry[] = [
            { assetId: "asset-elsewhere", fileName: "other.png", type: "image", sourcePath: "/projects/a/assets/content/x/y/z" },
        ];
        const create = vi.fn(async () => "created" as const);

        const result = await importTransferredAssets(port({ redeem: async () => granted, create }), MANIFEST, ["asset-cg"]);

        expect(result).toEqual({ imported: 0, failed: 0, frozen: false });
        expect(create).not.toHaveBeenCalled();
    });

    it("imports nothing the copy did not declare", async () => {
        // The token stands for a whole manifest. What a paste takes out of it is what its own rows
        // name AND what the payload said it was carrying.
        const redeem = vi.fn();

        const result = await importTransferredAssets(
            port({ redeem }),
            { token: "token-1", declaredAssetIds: [] },
            ["asset-cg"],
        );

        expect(result).toEqual({ imported: 0, failed: 0, frozen: false });
        expect(redeem).not.toHaveBeenCalled();
    });

    it("stops the moment the workspace freezes, and says so", async () => {
        // The caller must then abandon the paste: rows written into a frozen workspace reach the
        // in-memory scene, are refused at the file-system boundary and are gone at the thaw.
        let frozen = false;
        const create = vi.fn(async () => {
            frozen = true;
            return "created" as const;
        });

        const result = await importTransferredAssets(
            port({ create, isFrozen: () => frozen }),
            MANIFEST,
            ["asset-cg"],
        );

        expect(result.frozen).toBe(true);
    });
});

/** The degraded rows as a document, so the repair gesture's own collector can be asked about them. */
function documentOf(nodes: readonly SerializedStoryBlock[]): StoryDocument {
    const blocks: Record<string, StoryBlock> = {};
    for (const block of listSerializedBlocks(nodes)) {
        blocks[block.id] = block;
    }
    return {
        scenes: {
            "scene-1": { id: "scene-1", blocks, rootBlockIds: nodes.map(node => node.block.id) },
        },
    } as unknown as StoryDocument;
}
