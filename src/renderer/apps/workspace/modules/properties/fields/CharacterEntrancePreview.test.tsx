// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CharacterEntrancePreview } from "./CharacterEntrancePreview";
import type { Character } from "@/lib/workspace/services/character/Character";

/**
 * The two measurements this box has to get right, because everything an author reads off it depends
 * on them: the frame is the project's own resolution in shape, and the sprite inside is the artwork
 * at its own pixels against the design width.
 *
 * Both used to be wrong in the same direction. The frame was fine, but the sprite was drawn at the
 * full width of it - the compiler asked the engine for `autoFit` on every character - so a 1600px
 * sprite and a 3000px one looked identical here and on stage, and the author's only way back to a
 * sensible size was a zoom computed from pixels nothing in the interface states.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key, has: () => false, tn: (key: string) => key, locale: "en" }),
}));

vi.mock("@/lib/workspace/hooks/useCompositedSprite", () => ({
    useCompositedSprite: () => ({ url: "blob:sprite", loading: false }),
}));

const character = { profile: { getId: () => "char-1" } } as unknown as Character;

function aspectOf(element: Element | null): string | undefined {
    return (element as HTMLElement | null)?.style.aspectRatio;
}

afterEach(cleanup);

describe("CharacterEntrancePreview", () => {
    it("frames the stage in the project's own resolution", () => {
        const { container, rerender } = render(
            <CharacterEntrancePreview
                character={character}
                value={undefined}
                stageSize={{ width: 1920, height: 1080 }}
                onCommit={() => undefined}
            />,
        );
        expect(aspectOf(container.firstElementChild)).toBe("1920 / 1080");

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
        expect(aspectOf(container.firstElementChild)).toBe("1080 / 1920");
    });

    it("draws the sprite at its artwork's share of the design width", () => {
        const { container } = render(
            <CharacterEntrancePreview
                character={character}
                value={undefined}
                stageSize={{ width: 1920, height: 1080 }}
                onCommit={() => undefined}
            />,
        );
        const image = container.querySelector("img");
        expect(image).not.toBeNull();

        // jsdom decodes nothing, so the load is reported by hand with the size a real one would
        // carry: 960px of artwork is half of a 1920px stage, and the frame has to say so.
        Object.defineProperty(image!, "naturalWidth", { value: 960, configurable: true });
        Object.defineProperty(image!, "naturalHeight", { value: 1440, configurable: true });
        act(() => {
            image!.dispatchEvent(new Event("load"));
        });

        const frame = image!.parentElement as HTMLElement;
        expect(frame.style.width).toBe("50%");
        expect(frame.style.aspectRatio).toBe("960 / 1440");
    });
});
