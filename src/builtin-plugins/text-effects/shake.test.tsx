/**
 * Shaking text as the game draws it, and the panel's words in every language Studio ships.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RuntimeInlineTextEffectRenderProps } from "narraleaf-studio/runtime";
import manifest from "./manifest.json";
import { TEXT_EFFECTS_MESSAGES } from "./messages";
import { SHAKE_EFFECT_ID, SHAKE_PARAMS, ShakeText, shakePhase } from "./shake";

function props(overrides: Partial<RuntimeInlineTextEffectRenderProps> = {}): RuntimeInlineTextEffectRenderProps {
    return {
        children: "别过来",
        text: "别过来",
        fullText: "别过来",
        revealed: true,
        done: true,
        style: {},
        hasRuby: false,
        params: {},
        ...overrides,
    };
}

describe("ShakeText", () => {
    it("moves each revealed character on its own, out of step with its neighbours", () => {
        const html = renderToStaticMarkup(<ShakeText {...props({ text: "别过", fullText: "别过来", revealed: false, done: false })} />);
        expect(html.match(/class="nlfx-shake[^"]*"/g)).toHaveLength(2);
        expect(html).toContain(">别</span>");
        expect(html).toContain(">过</span>");
        expect(html).not.toContain("来");
        expect(shakePhase(0)).not.toBe(shakePhase(1));
    });

    it("scales the distance with intensity and the cycle with speed, inside the ranges the sliders offer", () => {
        const html = renderToStaticMarkup(<ShakeText {...props({ params: { intensity: 5, speed: 2 } })} />);
        expect(html).toContain("--nlfx-a:0.100em");
        expect(html).toContain("--nlfx-d:0.200s");
        const clamped = renderToStaticMarkup(<ShakeText {...props({ params: { intensity: 99, speed: "fast" } })} />);
        expect(clamped).toContain(`--nlfx-a:${(SHAKE_PARAMS.intensity.max * 0.02).toFixed(3)}em`);
        expect(clamped).toContain(`--nlfx-d:${(0.4 / SHAKE_PARAMS.speed.default).toFixed(3)}s`);
    });

    it("shakes a word with a reading as one piece, keeping the reading the engine laid out", () => {
        const html = renderToStaticMarkup(
            <ShakeText {...props({ hasRuby: true, children: <ruby>彼女<rt>かのじょ</rt></ruby> })} />,
        );
        expect(html.match(/nlfx-shake/g)).toHaveLength(1);
        expect(html).toContain("<rt>かのじょ</rt>");
    });

    it("fades in only the characters typed out after the run first drew", () => {
        const html = renderToStaticMarkup(<ShakeText {...props({ text: "别", fullText: "别过来", revealed: false, done: false })} />);
        expect(html).not.toContain("nlfx-enter");
    });
});

describe("Text Effects plugin", () => {
    it("declares the effect it registers", () => {
        expect(manifest.contributes.inlineTextEffects).toEqual([SHAKE_EFFECT_ID]);
    });

    it("names everything in every language, without a closing full stop", () => {
        const { en, zh, ja } = TEXT_EFFECTS_MESSAGES.messages;
        for (const table of [zh, ja]) {
            expect(Object.keys(table).sort()).toEqual(Object.keys(en).sort());
        }
        for (const value of [...Object.values(zh), ...Object.values(ja)]) {
            expect(value).not.toMatch(/[。.]$/);
        }
    });
});
