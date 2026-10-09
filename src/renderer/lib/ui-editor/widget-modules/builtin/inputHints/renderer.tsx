import type { CSSProperties } from "react";
import type { UIInputBinding } from "@shared/types/ui-editor/inputAction";
import {
    normalizeUIInputHintsProps,
    uiInputHintDirectionsGlyph,
    uiInputHintGamepadGlyph,
    uiInputHintKeyGlyph,
    uiInputHintLabelProp,
    UI_INPUT_HINTS_ELEMENT_TYPE,
    type UIInputHintControllerFamily,
    type UIInputHintGlyph,
    type UIInputHintWord,
} from "@shared/types/ui-editor/inputHints";
import { uiTextSitesOf } from "@shared/types/ui-editor/textSource";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { useInputHints, type InputHint, type InputHintsSnapshot } from "@/lib/ui-editor/runtime/input/inputHints";
import {
    useLocalizedWidgetSites,
    usePlayerWords,
    type PlayerWords,
} from "@/lib/ui-editor/runtime/localization/GameLocalizationContext";

/**
 * What the bar shows on the canvas, where no game is running to say what the buttons do: the three
 * a menu most often has, on a pad, so the author styles the bar against something it will draw.
 */
const PREVIEW: InputHintsSnapshot = {
    device: "gamepad",
    controller: "xbox",
    hints: [
        { id: "select", label: { kind: "word", word: "select" }, bindings: [{ kind: "gamepad", button: "D-pad Up" }], directions: true },
        { id: "confirm", label: { kind: "word", word: "confirm" }, bindings: [{ kind: "gamepad", button: "A" }] },
        { id: "back", label: { kind: "word", word: "back" }, bindings: [{ kind: "gamepad", button: "B" }] },
    ],
};

function studioWord(word: UIInputHintWord, words: PlayerWords): string {
    switch (word) {
        case "select":
            return words("game.inputHints.select");
        case "confirm":
            return words("game.inputHints.confirm");
        case "back":
            return words("game.inputHints.back");
        case "advance":
            return words("game.inputHints.advance");
        case "stageControls":
            return words("game.inputHints.stageControls");
    }
}

function glyphsOf(hint: InputHint, device: "gamepad" | "key", family: UIInputHintControllerFamily): UIInputHintGlyph[] {
    if (hint.directions) {
        return [uiInputHintDirectionsGlyph(device)];
    }
    // Two at most: "Enter / Space" says the keyboard has a choice; a third is a list nobody reads.
    return hint.bindings.slice(0, 2).map((binding: UIInputBinding) =>
        binding.kind === "gamepad"
            ? uiInputHintGamepadGlyph(binding.button, family)
            : uiInputHintKeyGlyph(binding.kind === "key" ? binding.key : binding.gesture),
    );
}

function Glyph({ glyph, size, background, color }: { glyph: UIInputHintGlyph; size: number; background: string; color: string }) {
    const height = Math.round(size * 1.3);
    const style: CSSProperties = glyph.shape === "round"
        ? {
            width: height,
            height,
            borderRadius: "50%",
        }
        : {
            minWidth: height,
            height,
            padding: `0 ${Math.round(size * 0.4)}px`,
            borderRadius: Math.round(size * 0.3),
        };
    return (
        <span
            style={{
                ...style,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                boxSizing: "border-box",
                background,
                color,
                fontSize: Math.round(size * (glyph.text.length > 2 ? 0.62 : 0.78)),
                fontWeight: 700,
                lineHeight: 1,
                whiteSpace: "nowrap",
                flexShrink: 0,
            }}
        >
            {glyph.text}
        </span>
    );
}

/**
 * The input hint bar: one "glyph - words" pair per thing the buttons do right now (see
 * `runtime/input/inputHints.ts` for what is listed and `@shared/types/ui-editor/inputHints` for what
 * the author sets). Draws nothing while a mouse player has the game, unless told to.
 */
export function InputHintsRenderer(props: WidgetRendererProps) {
    const { element, hostAdapter } = props;
    const live = useInputHints();
    const words = usePlayerWords();
    const localized = useLocalizedWidgetSites(element, uiTextSitesOf(UI_INPUT_HINTS_ELEMENT_TYPE));
    const p = normalizeUIInputHintsProps(localized.props);
    const inGame = Boolean(hostAdapter?.blueprintRuntime);
    const snapshot = inGame ? live : PREVIEW;
    if (!snapshot) {
        return null;
    }
    const pointing = snapshot.device === "pointer" || snapshot.device === "touch";
    if ((p.showFor === "gamepad" && snapshot.device !== "gamepad") || (p.showFor === "keysAndGamepad" && pointing)) {
        return null;
    }
    const device = snapshot.device === "gamepad" ? "gamepad" : "key";
    const family = p.glyphStyle === "auto" ? snapshot.controller : p.glyphStyle;
    const label = (hint: InputHint) => {
        if (hint.label.kind === "action") {
            return hint.label.name;
        }
        const own = (p as Record<string, unknown>)[uiInputHintLabelProp(hint.label.word)];
        return typeof own === "string" && own.trim().length > 0 ? own : studioWord(hint.label.word, words);
    };
    return (
        <div
            data-ui-input-hints=""
            style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: p.align === "start" ? "flex-start" : p.align === "center" ? "center" : "flex-end",
                gap: p.gap,
                overflow: "hidden",
                pointerEvents: "none",
                color: p.color,
                fontSize: p.fontSize,
                lineHeight: 1.2,
                whiteSpace: "nowrap",
            }}
        >
            {snapshot.hints.map(hint => (
                <span key={hint.id} style={{ display: "inline-flex", alignItems: "center", gap: Math.round(p.fontSize * 0.4) }}>
                    {glyphsOf(hint, device, family).map((glyph, index) => (
                        <Glyph
                            key={index}
                            glyph={glyph}
                            size={p.fontSize}
                            background={p.glyphBackground}
                            color={p.glyphColor}
                        />
                    ))}
                    <span>{label(hint)}</span>
                </span>
            ))}
        </div>
    );
}
