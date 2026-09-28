// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { StoryTransformProps } from "@shared/types/story";
import { CharacterEntrancePreview } from "./CharacterEntrancePreview";
import type { Character } from "@/lib/workspace/services/character/Character";

/**
 * The measurements this box has to get right, because everything an author reads off it depends on
 * them: the frame is the project's own resolution in shape, and the sprite inside is the artwork at
 * its own pixels against the design width.
 *
 * The first two used to be wrong in the same direction. The sprite was drawn at the full width of
 * the frame - the compiler asked the engine for `autoFit` on every character - so a 1600px sprite and
 * a 3000px one looked identical here and on stage. Once that was fixed the size was read off the
 * picture this box displays, which is a composite capped at 512px on its longest edge, so every
 * sprite bigger than that was drawn smaller here than the stage draws her, by exactly the cap.
 *
 * That is why the sprite here goes through the real hook, compositor and stack renderer, with only
 * the canvas, the bitmap decode and the workspace faked: the cap lives in that chain, and a test that
 * mocks the hook and hands the picture its artwork's size cannot see it.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key, has: () => false, tn: (key: string) => key, locale: "en" }),
}));

const env = vi.hoisted(() => {
    const state = {
        /** What decoding the next character's art gives - its size in artwork pixels. */
        artwork: { width: 0, height: 0 },
        /** Every canvas the compositor drew, by the picture it became. */
        drawnByBlob: new Map<Blob, { width: number; height: number }>(),
        drawnByUrl: new Map<string, { width: number; height: number }>(),
    };
    // One service for the whole file, because the sprite hook keeps one compositor per assets
    // service. Every test poses a character of its own, so no two share a cache entry.
    const assetsService = {
        getAssets: () => ({ image: new Proxy({}, { get: (_target, id) => ({ id }) }) }),
        fetch: async () => ({ success: true, data: { data: [0] } }),
        getEvents: () => ({ on: () => () => undefined }),
    };
    const workspace = { context: { services: { get: () => assetsService } }, isInitialized: true };
    return { state, workspace };
});

vi.mock("@/apps/workspace/context", () => ({ useWorkspace: () => env.workspace }));

class FakeOffscreenCanvas {
    constructor(public width: number, public height: number) {}
    getContext() {
        return { imageSmoothingQuality: "low", drawImage: () => undefined };
    }
    async convertToBlob() {
        const blob = new Blob(["composite"], { type: "image/png" });
        env.state.drawnByBlob.set(blob, { width: this.width, height: this.height });
        return blob;
    }
}

let objectUrls = 0;
beforeAll(() => {
    vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
    vi.stubGlobal("createImageBitmap", async () => ({ ...env.state.artwork, close: () => undefined }));
    // jsdom has no object URLs; the compositor only ever makes and revokes them.
    URL.createObjectURL = (blob: Blob) => {
        const url = `blob:composite-${++objectUrls}`;
        const drawn = env.state.drawnByBlob.get(blob);
        if (drawn) {
            env.state.drawnByUrl.set(url, drawn);
        }
        return url;
    };
    URL.revokeObjectURL = () => undefined;
});
afterAll(() => vi.unstubAllGlobals());
afterEach(cleanup);

const STAGE = { width: 1920, height: 1080 };

/** The shipped skeleton's Narra: her 1600x1586 artwork, and the defaults her entrances fall back to. */
const NARRA_DEFAULTS: StoryTransformProps = { position: { xalign: 0.5, yalign: 0.5, yoffset: -50 }, zoom: 0.624 };

function characterWithArt(id: string, artwork: { width: number; height: number }): Character {
    env.state.artwork = artwork;
    return {
        profile: { getId: () => id, appearance: { resolveDrawList: () => [`${id}-art`] } },
        subscribe: () => () => undefined,
    } as unknown as Character;
}

/**
 * Mount the box and wait for her picture. jsdom decodes nothing, so the picture's load is reported
 * by hand - with the canvas the compositor actually drew, which is what a browser would decode.
 */
async function mountWithPicture(character: Character, value: StoryTransformProps | undefined) {
    const view = render(
        <CharacterEntrancePreview character={character} value={value} stageSize={STAGE} onCommit={() => undefined} />,
    );
    const image = await waitFor(() => {
        const found = view.container.querySelector("img");
        expect(found).not.toBeNull();
        return found!;
    });
    const drawn = env.state.drawnByUrl.get(image.getAttribute("src") ?? "");
    if (!drawn) {
        throw new Error(`no canvas was drawn for ${image.getAttribute("src")}`);
    }
    Object.defineProperty(image, "naturalWidth", { value: drawn.width, configurable: true });
    Object.defineProperty(image, "naturalHeight", { value: drawn.height, configurable: true });
    act(() => {
        image.dispatchEvent(new Event("load"));
    });
    return { view, frame: image.parentElement as HTMLElement, drawn };
}

function percent(value: string): number {
    return Number.parseFloat(value);
}

describe("CharacterEntrancePreview", () => {
    it("frames the stage in the project's own resolution", () => {
        const character = characterWithArt("frame-only", { width: 960, height: 1440 });
        const { container, rerender } = render(
            <CharacterEntrancePreview character={character} value={undefined} stageSize={STAGE} onCommit={() => undefined} />,
        );
        expect((container.firstElementChild as HTMLElement).style.aspectRatio).toBe("1920 / 1080");

        // A project is not always 16:9 - a phone-shaped one is a portrait stage, and a preview that
        // kept a landscape box would put her feet in the wrong place at every size.
        rerender(
            <CharacterEntrancePreview
                character={character}
                value={undefined}
                stageSize={{ width: 1080, height: 1920 }}
                onCommit={() => undefined}
            />,
        );
        expect((container.firstElementChild as HTMLElement).style.aspectRatio).toBe("1080 / 1920");
    });

    it("draws the skeleton's Narra at the share of the stage the game gives her, not the picture's", async () => {
        const { frame, drawn } = await mountWithPicture(characterWithArt("narra", { width: 1600, height: 1586 }), NARRA_DEFAULTS);

        // The picture really is the capped one - that is the premise, not the finding.
        expect(drawn).toEqual({ width: 512, height: 508 });
        // Her artwork is 1600px on a 1920px stage...
        expect(percent(frame.style.width)).toBeCloseTo((1600 / 1920) * 100, 3);
        expect(frame.style.aspectRatio).toBe("1600 / 1586");
        // ...scaled by her zoom, which is 52% of the stage: the share the skeleton's numbers were
        // chosen to give her (1920 x 0.52 = 1600 x 0.624).
        expect(frame.style.transform).toContain("scale(0.624, 0.624)");
        expect((percent(frame.style.width) / 100) * 0.624).toBeCloseTo(0.52, 3);
    });

    it("sizes a narrow but tall sprite from its artwork too - the cap is on the longest edge", async () => {
        const { frame, drawn } = await mountWithPicture(characterWithArt("tall", { width: 480, height: 720 }), undefined);

        expect(drawn).toEqual({ width: 341, height: 512 });
        expect(percent(frame.style.width)).toBeCloseTo(25, 3);
        expect(frame.style.aspectRatio).toBe("480 / 720");
    });

    it("keeps a sprite that fits under the cap at the share it always had", async () => {
        const { frame, drawn } = await mountWithPicture(characterWithArt("small", { width: 480, height: 500 }), undefined);

        expect(drawn).toEqual({ width: 480, height: 500 });
        expect(percent(frame.style.width)).toBeCloseTo(25, 3);
        expect(frame.style.aspectRatio).toBe("480 / 500");
    });
});
