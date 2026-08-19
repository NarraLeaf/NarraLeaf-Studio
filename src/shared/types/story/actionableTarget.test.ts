import { describe, expect, it } from "vitest";
import {
    actionableSourceIdentity,
    actionableSubjectWord,
    resolveActionableTargetRef,
    soundStageObjectName,
} from "./actionableTarget";
import type { StoryActionPayload, StoryBlock, StoryScene } from "./document";

/**
 * What a video / vfx / sound reference means, which is the half `objectName` alone cannot state: the
 * row that declares the handle. These pin the rules a rename has to survive, and the one target that
 * has no row to point at.
 */

function scene(blocks: StoryBlock[]): StoryScene {
    return {
        id: "scene-1",
        name: "Scene",
        runtimeName: "scene",
        rootBlockIds: blocks.map(block => block.id),
        blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
    };
}

function action(id: string, payload: StoryActionPayload): StoryBlock {
    return { id, kind: "action", parentId: null, childrenIds: [], payload } as StoryBlock;
}

describe("actionableSourceIdentity", () => {
    it("answers for the row that creates the handle, and only that row", () => {
        expect(actionableSourceIdentity(action("a", { action: "video", operation: "create", objectName: "intro" })))
            .toEqual({ kind: "video", name: "intro", label: "intro" });
        // `play` addresses a clip that already exists; anchoring a reference here would bind it to a
        // row that does not define the object.
        expect(actionableSourceIdentity(action("b", { action: "video", operation: "play", objectName: "intro" })))
            .toBeNull();
        expect(actionableSourceIdentity(action("c", { action: "vfx", operation: "create", objectName: "rain" })))
            .toEqual({ kind: "vfx", name: "rain", label: "rain" });
        expect(actionableSourceIdentity(action("d", { action: "vfx", operation: "setRate", objectName: "rain", rate: 2 })))
            .toBeNull();
    });

    it("treats playSound as the declaration and setBgm as none", () => {
        expect(actionableSourceIdentity(action("a", { action: "audio", operation: "playSound", objectName: "piano" })))
            .toEqual({ kind: "audio", name: "piano", label: "piano" });
        // The music channel is the reserved built-in, referenced as such. Binding it to a row would
        // give one channel two identities, and a scene may hold no `/bgm` row at all.
        expect(actionableSourceIdentity(action("b", { action: "audio", operation: "setBgm", assetId: "asset-1" })))
            .toBeNull();
        expect(actionableSourceIdentity(action("c", { action: "audio", operation: "setVolume", objectName: "piano", volume: 0.5 })))
            .toBeNull();
    });

    it("keys an unnamed sound on its asset, and never renders that key", () => {
        // The compiler registers the handle under `objectName || assetId || "sound"`, so the lookup
        // key can be an asset UUID - which is exactly why `label` is a separate field.
        expect(soundStageObjectName({ action: "audio", operation: "playSound", assetId: "asset-7" }))
            .toBe("asset-7");
        expect(actionableSourceIdentity(action("a", { action: "audio", operation: "playSound", assetId: "asset-7" })))
            .toEqual({ kind: "audio", name: "asset-7", label: "Sound" });
    });

    it("ignores a block that is not an action", () => {
        const note = { id: "n", kind: "note", parentId: null, childrenIds: [], payload: { text: { textId: "n", value: "", role: "note" } } } as unknown as StoryBlock;
        expect(actionableSourceIdentity(note)).toBeNull();
    });
});

describe("resolveActionableTargetRef", () => {
    it("reports the declaring row's current name, so the reference follows a rename", () => {
        const document = scene([action("create-1", { action: "video", operation: "create", objectName: "opening" })]);
        // The reference still carries the name the row had when it was written.
        const resolved = resolveActionableTargetRef(document, { name: "intro", sourceBlockId: "create-1" }, "video");
        expect(resolved).toEqual({ name: "opening", label: "opening", resolved: true });
    });

    it("falls back to the stored name when the declaring row was deleted", () => {
        const resolved = resolveActionableTargetRef(scene([]), { name: "intro", sourceBlockId: "gone" }, "video");
        // Not an error: the name is the last one the author saw, and it is still what a row that
        // never got a reference would have resolved to.
        expect(resolved).toEqual({ name: "intro", label: "intro", resolved: false });
    });

    it("shows the stored label, not the registry key, when an unnamed sound's row was deleted", () => {
        // The combination that makes `label` a separate field rather than a nicety: an unnamed
        // `playSound` keys on its `assetId`, so falling back to `name` here would put a UUID in front
        // of the author. The key still has to be the key - it is what a lookup would use.
        const resolved = resolveActionableTargetRef(scene([]), { name: "asset-7", label: "Sound", sourceBlockId: "gone" }, "audio");
        expect(resolved).toEqual({ name: "asset-7", label: "Sound", resolved: false });
        expect(resolved.label).not.toBe("asset-7");
    });

    it("falls back to the name when a reference predates the label field", () => {
        // Every reference written before `label` existed. Nothing changes for them: `name` stands,
        // exactly as it did when it was the only thing stored.
        expect(resolveActionableTargetRef(scene([]), { name: "piano", sourceBlockId: "gone" }, "audio"))
            .toEqual({ name: "piano", label: "piano", resolved: false });
    });

    it("falls back when the bound row declares a different kind", () => {
        // An edit that turned a `/video` row into a `/vfx` row leaves references behind; resolving
        // through the wrong kind would silently address someone else's handle.
        const document = scene([action("create-1", { action: "vfx", operation: "create", objectName: "rain" })]);
        expect(resolveActionableTargetRef(document, { name: "intro", sourceBlockId: "create-1" }, "video"))
            .toEqual({ name: "intro", label: "intro", resolved: false });
    });

    it("resolves a legacy reference that carries only a name", () => {
        const document = scene([action("create-1", { action: "vfx", operation: "create", objectName: "rain" })]);
        // A document authored before stable ids: no id to follow, so the name stands - which is the
        // behaviour every consumer had before references existed.
        expect(resolveActionableTargetRef(document, { name: "rain" }, "vfx"))
            .toEqual({ name: "rain", label: "rain", resolved: false });
    });

    it("resolves the music channel through its built-in, ignoring any name or id beside it", () => {
        const document = scene([action("create-1", { action: "audio", operation: "playSound", objectName: "piano" })]);
        expect(resolveActionableTargetRef(document, { name: "bgm", builtin: "bgm" }, "audio"))
            .toEqual({ name: "bgm", label: "Background music", resolved: true });
        // The built-in wins outright - a stale name or a stray id beside it is display fallback only.
        expect(resolveActionableTargetRef(document, { name: "piano", sourceBlockId: "create-1", builtin: "bgm" }, "audio"))
            .toEqual({ name: "bgm", label: "Background music", resolved: true });
    });

    it("keeps a sound reference on the handle its row declared, asset key included", () => {
        const document = scene([action("play-1", { action: "audio", operation: "playSound", assetId: "asset-7" })]);
        expect(resolveActionableTargetRef(document, { name: "asset-7", sourceBlockId: "play-1" }, "audio"))
            .toEqual({ name: "asset-7", label: "Sound", resolved: true });
    });
});

describe("actionableSubjectWord", () => {
    it("follows a rename of the declaring row", () => {
        const document = scene([action("play-1", { action: "audio", operation: "playSound", objectName: "keys" })]);
        expect(actionableSubjectWord(document, { name: "piano", label: "piano", sourceBlockId: "play-1" }, "audio", "piano"))
            .toBe("keys");
    });

    it("leaves a document written before references exactly as it read", () => {
        const document = scene([action("create-1", { action: "video", operation: "create", objectName: "opening" })]);
        expect(actionableSubjectWord(document, undefined, "video", "intro")).toBe("intro");
    });

    it("shows the stored label for a reference whose declaring row is gone", () => {
        expect(actionableSubjectWord(scene([]), { name: "intro", label: "intro", sourceBlockId: "gone" }, "video", "intro"))
            .toBe("intro");
    });

    it("never prints the asset key a nameless sound is registered under", () => {
        // The special case the whole guard exists for: the declaring row named nothing, so the key is
        // an asset id and the label the placeholder `Sound`. The declaring line prints no name either,
        // so there is no word to address the handle by - the row keeps the last one an author saw.
        const document = scene([action("play-1", { action: "audio", operation: "playSound", assetId: "asset-7" })]);
        const word = actionableSubjectWord(document, { name: "piano", label: "piano", sourceBlockId: "play-1" }, "audio", "piano");
        expect(word).toBe("piano");
        expect(word).not.toBe("asset-7");
        expect(word).not.toBe("Sound");
    });

    it("spells the music channel by its reserved word, never by its label", () => {
        // "Background music" is two tokens and a subject slot takes one.
        expect(actionableSubjectWord(scene([]), { builtin: "bgm", name: "bgm", label: "Background music" }, "audio", "bgm"))
            .toBe("bgm");
        // A row the script view built states the bus with a word instead of a name, so it stores none.
        expect(actionableSubjectWord(scene([]), { builtin: "bgm", name: "bgm", label: "Background music" }, "audio", undefined))
            .toBe("");
    });
});
