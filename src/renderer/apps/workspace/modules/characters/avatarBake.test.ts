import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterAppearanceSummary } from "@shared/types/devMode";
import type { CharacterAvatarTable } from "@/lib/workspace/services/character/types";
import {
    avatarBakeFingerprint,
    bakeCharacterAvatars,
    type AvatarBakeAppearance,
    type AvatarBakeIO,
    type AvatarRenderer,
} from "./avatarBake";

const PRESET: CharacterAppearanceSummary = {
    kind: "preset",
    poses: [
        { id: "p-neutral", name: "Neutral", assetId: "asset-neutral" },
        { id: "p-angry", name: "Angry", assetId: "asset-angry" },
    ],
    defaultPoseId: "p-neutral",
};

/** Every write lands here, so a test can tell a real write from a no-op reconcile. */
function createIO(overrides: Partial<AvatarBakeIO> = {}) {
    const files = new Map<string, Uint8Array>();
    const deleted: string[] = [];
    const io: AvatarBakeIO = {
        assetHash: assetId => `hash-of-${assetId}`,
        readProjectFile: async path => files.get(path) ?? null,
        projectFileExists: async path => files.has(path),
        writeProjectFile: async (path, bytes) => {
            const existing = files.get(path);
            if (existing && existing.length === bytes.length && existing.every((b, i) => b === bytes[i])) {
                return false;
            }
            files.set(path, bytes);
            return true;
        },
        deleteProjectFile: async path => {
            files.delete(path);
            deleted.push(path);
        },
        ...overrides,
    };
    return { io, files, deleted };
}

function appearanceOf(
    summary: CharacterAppearanceSummary,
    avatars: CharacterAvatarTable = {},
    drawList: (selection: { poseId?: string; tags?: Record<string, string> }) => (string | null)[] =
        selection => [summary.kind === "preset"
            ? summary.poses.find(pose => pose.id === selection.poseId)?.assetId ?? null
            : null],
): AvatarBakeAppearance {
    return {
        summary,
        avatars,
        resolveDrawList: drawList,
        portraitFor: () => undefined,
    };
}

describe("bakeCharacterAvatars", () => {
    let render: AvatarRenderer;

    beforeEach(() => {
        render = vi.fn(async () => new Uint8Array([1, 2, 3]));
    });

    it("bakes one PNG per differential, into the project", async () => {
        const { io, files } = createIO();
        const report = await bakeCharacterAvatars(io, render, {
            characterId: "alice",
            appearance: appearanceOf(PRESET),
        });

        expect(report.written.sort()).toEqual(["p-angry", "p-neutral"]);
        expect([...files.keys()].sort()).toEqual([
            "resources/characters/avatars/alice/p-angry.png",
            "resources/characters/avatars/alice/p-neutral.png",
        ]);
        expect(Object.keys(report.avatars).sort()).toEqual(["p-angry", "p-neutral"]);
    });

    it("performs reads only when the character is already current", async () => {
        const { io } = createIO();
        const first = await bakeCharacterAvatars(io, render, {
            characterId: "alice",
            appearance: appearanceOf(PRESET),
        });

        const second = await bakeCharacterAvatars(io, render, {
            characterId: "alice",
            appearance: appearanceOf(PRESET, first.avatars),
        });

        // The baked files are version-controlled project content: a reconcile that rewrote them
        // would show up as a change nobody made, on every panel open.
        expect(second.written).toEqual([]);
        expect(render).toHaveBeenCalledTimes(2);
    });

    it("re-bakes when a sprite's bytes change", async () => {
        const { io } = createIO();
        const first = await bakeCharacterAvatars(io, render, {
            characterId: "alice",
            appearance: appearanceOf(PRESET),
        });

        const moved = createIO({ assetHash: assetId => assetId === "asset-angry" ? "hash-v2" : `hash-of-${assetId}` });
        // Carry the first run's files across so only the fingerprint differs.
        moved.io.projectFileExists = async () => true;
        const second = await bakeCharacterAvatars(moved.io, render, {
            characterId: "alice",
            appearance: appearanceOf(PRESET, first.avatars),
        });

        expect(second.written).toEqual(["p-angry"]);
    });

    it("never bakes a differential the author overrode, and clears its stale bake", async () => {
        const { io, deleted } = createIO();
        const first = await bakeCharacterAvatars(io, render, {
            characterId: "alice",
            appearance: appearanceOf(PRESET),
        });

        // Fresh IO so nothing is current: `p-neutral` must render, and `p-angry` must not. Reusing
        // the first run's store would have skipped both - for two different reasons - and the test
        // would have proved nothing about the override.
        const fresh = createIO();
        (render as ReturnType<typeof vi.fn>).mockClear();
        const second = await bakeCharacterAvatars(fresh.io, render, {
            characterId: "alice",
            appearance: appearanceOf(PRESET, {
                "p-angry": { baked: first.avatars["p-angry"].baked, overrideAssetId: "asset-hand-drawn" },
            }),
        });

        expect(render).toHaveBeenCalledTimes(1);
        expect(second.written).toEqual(["p-neutral"]);
        // The override is the answer, so the bake under that key is dead weight on disk.
        expect(second.avatars["p-angry"]).toEqual({ overrideAssetId: "asset-hand-drawn" });
        expect(fresh.deleted).toContain("resources/characters/avatars/alice/p-angry.png");
        expect(deleted).toEqual([]);
    });

    it("reports a differential with no art instead of baking an empty square", async () => {
        const { io, files } = createIO({ assetHash: () => null });
        const report = await bakeCharacterAvatars(io, render, {
            characterId: "alice",
            appearance: appearanceOf(PRESET),
        });

        expect(report.unresolved.sort()).toEqual(["p-angry", "p-neutral"]);
        expect(report.written).toEqual([]);
        expect(files.size).toBe(0);
    });

    it("drops the bake of a differential that no longer exists", async () => {
        const { io, deleted } = createIO();
        const first = await bakeCharacterAvatars(io, render, {
            characterId: "alice",
            appearance: appearanceOf(PRESET),
        });

        const withoutAngry: CharacterAppearanceSummary = {
            kind: "preset",
            poses: [PRESET.kind === "preset" ? PRESET.poses[0] : { id: "x", name: "x", assetId: null }],
            defaultPoseId: "p-neutral",
        };
        const second = await bakeCharacterAvatars(io, render, {
            characterId: "alice",
            appearance: appearanceOf(withoutAngry, first.avatars),
        });

        // Left behind it would ship in the package, referenced by a table nothing rebuilt.
        expect(second.removed).toEqual(["p-angry"]);
        expect(deleted).toContain("resources/characters/avatars/alice/p-angry.png");
        expect(Object.keys(second.avatars)).toEqual(["p-neutral"]);
    });

    it("re-bakes when the file is gone even though the fingerprint matches", async () => {
        const { io } = createIO();
        const first = await bakeCharacterAvatars(io, render, {
            characterId: "alice",
            appearance: appearanceOf(PRESET),
        });

        const wiped = createIO();
        const second = await bakeCharacterAvatars(wiped.io, render, {
            characterId: "alice",
            appearance: appearanceOf(PRESET, first.avatars),
        });

        // A fingerprint alone is not evidence the PNG is there - a teammate may have pulled the
        // appearance without the derived files.
        expect(second.written.sort()).toEqual(["p-angry", "p-neutral"]);
    });
});

describe("avatarBakeFingerprint", () => {
    it("moves when a layer's bytes move", () => {
        const a = avatarBakeFingerprint({ layerHashes: ["h1", "h2"], crop: undefined, size: 256 });
        const b = avatarBakeFingerprint({ layerHashes: ["h1", "h9"], crop: undefined, size: 256 });
        expect(a).not.toBe(b);
    });

    it("moves when the layers are reordered", () => {
        const a = avatarBakeFingerprint({ layerHashes: ["h1", "h2"], crop: undefined, size: 256 });
        const b = avatarBakeFingerprint({ layerHashes: ["h2", "h1"], crop: undefined, size: 256 });
        // Stacking order is what the picture is; this is not a set.
        expect(a).not.toBe(b);
    });

    it("moves when the framing moves", () => {
        const a = avatarBakeFingerprint({ layerHashes: ["h1"], crop: undefined, size: 256 });
        const b = avatarBakeFingerprint({ layerHashes: ["h1"], crop: { x: 0, y: 0, w: 0.5, h: 0.5 }, size: 256 });
        expect(a).not.toBe(b);
    });

    it("holds still when nothing that affects the picture changed", () => {
        const crop = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
        expect(avatarBakeFingerprint({ layerHashes: ["h1", null], crop, size: 256 }))
            .toBe(avatarBakeFingerprint({ layerHashes: ["h1", null], crop, size: 256 }));
    });
});
