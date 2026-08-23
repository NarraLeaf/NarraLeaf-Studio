import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { createPortal } from "react-dom";
import { Minus, Plus } from "lucide-react";
import { Input } from "@/lib/components/elements/Input";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import { useTranslation } from "@/lib/i18n";
import { useDismissWhenHidden } from "@/lib/components/layout";
import { TooltipGroup } from "@/lib/tooltip";
import type { StoryTextEmphasis } from "@shared/types/story";
import type { TypeTarget } from "./RichTextInput";
import {
    STORY_FONT_SIZE_STEP_MAX,
    STORY_FONT_SIZE_STEP_MIN,
    STORY_TEXT_EMPHASIS_VALUES,
} from "@shared/utils/storyTextMarks";

/**
 * One sample character wearing one of the marks, drawn with the very class the row uses so what the
 * panel offers and what the line gets cannot drift apart.
 *
 * The leading is what keeps the five samples on one baseline. A mark grows the line box it sits in -
 * upwards for `over`, downwards for `under` - unless the line already has room for it, so a sample
 * set solid would put the unmarked character 5px below the one whose mark hangs underneath. At this
 * leading every mark fits inside the space the line already had and all five boxes measure alike;
 * it is the same bargain the ruby reading strikes one file over, in styles.css.
 */
const EMPHASIS_SAMPLE_LEADING = 2.8;

function EmphasisSample(props: { sample: string; emphasis?: StoryTextEmphasis }) {
    return (
        <span
            className="story-rt-emphasis"
            style={{ lineHeight: EMPHASIS_SAMPLE_LEADING }}
            data-emphasis={props.emphasis}
        >
            {props.sample}
        </span>
    );
}

/** One catalog key per emphasis value, written out so the keys stay findable by search. */
const EMPHASIS_LABELS = {
    "dot": "story.textType.emphasisDot",
    "circle": "story.textType.emphasisCircle",
    "sesame": "story.textType.emphasisSesame",
    "under-dot": "story.textType.emphasisUnderDot",
} as const;

/**
 * The three run marks that are set rather than toggled: the emphasis beside the characters, the size
 * the run is set at, and the speed it is typed out at.
 *
 * They share a panel because they share a shape. None of them is a one-press answer - each needs a
 * value chosen - and none of them belongs in the strip at that price. The strip stays the marks an
 * author reaches for mid-sentence; what needs a decision is one press further in.
 *
 * Every control writes through immediately, like {@link PausePopover} and unlike {@link RubyPopover}:
 * each value here is complete on its own, so there is no half-typed state to protect and the author
 * sees the sentence change under the choice they just made.
 *
 * What each control shows is held here rather than read back off the row, and the characters written
 * to are the ones captured when the panel opened. The panel is portalled to the body, so the first
 * press takes the focus - and with it the selection - out of the field: a control reading the live
 * marks would find none the moment it had written one, and the second press would have nothing left
 * to write to.
 */
export function TypePopover(props: {
    anchor: { top: number; left: number; bottom: number };
    /** The button this opened from; it counts as inside for light dismiss. */
    anchorRef?: RefObject<HTMLElement | null>;
    /** The characters this panel writes to, and the marks they carried when it opened. */
    target: TypeTarget;
    onSet: (mark: "emphasis" | "fontSizeStep" | "cps", value: string | number | null, target: { start: number; end: number }) => void;
    onClose: () => void;
}) {
    useDismissWhenHidden(props.onClose);
    const { t } = useTranslation();
    const panelRef = useRef<HTMLDivElement | null>(null);
    const [emphasis, setEmphasis] = useState(props.target.emphasis);
    const [step, setStepValue] = useState(props.target.fontSizeStep ?? 0);
    const [cps, setCps] = useState(props.target.cps === undefined ? "" : String(props.target.cps));
    const range = { start: props.target.start, end: props.target.end };
    const set = (mark: "emphasis" | "fontSizeStep" | "cps", value: string | number | null) => {
        props.onSet(mark, value, range);
    };

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape") {
                return;
            }
            // One rung per press: this takes the panel down and leaves the row in edit mode, which
            // the row's own Escape would not.
            event.stopPropagation();
            props.onClose();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [props]);

    useEffect(() => {
        const onDown = (event: MouseEvent) => {
            const target = event.target as Node;
            if (panelRef.current?.contains(target) || props.anchorRef?.current?.contains(target)) {
                return;
            }
            props.onClose();
        };
        globalThis.document.addEventListener("mousedown", onDown, true);
        return () => globalThis.document.removeEventListener("mousedown", onDown, true);
    }, [props]);

    const setStep = (next: number) => {
        const clamped = Math.min(STORY_FONT_SIZE_STEP_MAX, Math.max(STORY_FONT_SIZE_STEP_MIN, next));
        setStepValue(clamped);
        set("fontSizeStep", clamped === 0 ? null : clamped);
    };

    const onFieldKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
        // The field sits inside the row being edited and `KeybindingService` listens on `window`,
        // where Enter commits the row and Tab indents it.
        event.stopPropagation();
        if (event.key === "Enter") {
            event.preventDefault();
            props.onClose();
        }
    };

    const top = Math.min(props.anchor.bottom + 6, window.innerHeight - 220);
    const left = Math.min(props.anchor.left, window.innerWidth - 236);

    return createPortal(
        <div
            ref={panelRef}
            className="fixed z-[70] w-56 rounded-lg border border-edge bg-surface-raised p-2 shadow-2xl"
            style={{ top, left: Math.max(8, left) }}
            onMouseDown={event => event.stopPropagation()}
        >
            <div className="text-2xs font-medium tracking-wide text-fg-muted">{t("story.textType.emphasis")}</div>
            <TooltipGroup className="mt-1 flex items-center gap-1">
                <ToolbarButton
                    size="xs"
                    className="h-9 w-9 text-xs"
                    active={emphasis === undefined}
                    aria-label={t("story.textType.emphasisNone")}
                    data-tip={t("story.textType.emphasisNone")}
                    onClick={() => {
                        setEmphasis(undefined);
                        set("emphasis", null);
                    }}
                >
                    <EmphasisSample sample={t("story.textType.emphasisSample")} />
                </ToolbarButton>
                {STORY_TEXT_EMPHASIS_VALUES.map(value => (
                    <ToolbarButton
                        key={value}
                        size="xs"
                        className="h-9 w-9 text-xs"
                        active={emphasis === value}
                        aria-label={t(EMPHASIS_LABELS[value])}
                        data-tip={t(EMPHASIS_LABELS[value])}
                        // Pressing the mark already on the text takes it off, the way every other
                        // toggle in the strip does.
                        onClick={() => {
                            const next = emphasis === value ? undefined : value;
                            setEmphasis(next);
                            set("emphasis", next ?? null);
                        }}
                    >
                        <EmphasisSample sample={t("story.textType.emphasisSample")} emphasis={value} />
                    </ToolbarButton>
                ))}
            </TooltipGroup>

            <div className="mt-2 text-2xs font-medium tracking-wide text-fg-muted">{t("story.textType.size")}</div>
            <TooltipGroup className="mt-1 flex items-center gap-1">
                <ToolbarButton
                    size="xs"
                    aria-label={t("story.textType.sizeSmaller")}
                    data-tip={t("story.textType.sizeSmaller")}
                    disabled={step <= STORY_FONT_SIZE_STEP_MIN}
                    onClick={() => setStep(step - 1)}
                >
                    <Minus className="h-3.5 w-3.5" />
                </ToolbarButton>
                {/*
                  * The size is a distance from the line's own, so it is written as one: `0` is the
                  * line, and a run set away from it always carries its sign.
                  */}
                <span className="min-w-8 text-center text-xs tabular-nums text-fg">
                    {step > 0 ? `+${step}` : String(step)}
                </span>
                <ToolbarButton
                    size="xs"
                    aria-label={t("story.textType.sizeLarger")}
                    data-tip={t("story.textType.sizeLarger")}
                    disabled={step >= STORY_FONT_SIZE_STEP_MAX}
                    onClick={() => setStep(step + 1)}
                >
                    <Plus className="h-3.5 w-3.5" />
                </ToolbarButton>
                <span className="ml-1 text-2xs text-fg-subtle">{t("story.textType.sizeUnit")}</span>
            </TooltipGroup>

            <div className="mt-2 text-2xs font-medium tracking-wide text-fg-muted">{t("story.textType.speed")}</div>
            <div className="mt-1 flex items-center gap-1.5">
                <Input
                    size="sm"
                    type="number"
                    min={1}
                    className="w-20"
                    value={cps}
                    placeholder={t("story.textType.speedPlaceholder")}
                    onChange={event => {
                        const raw = event.target.value;
                        setCps(raw);
                        const numeric = Number(raw.trim());
                        set("cps", raw.trim() === "" || !Number.isFinite(numeric) || numeric <= 0 ? null : numeric);
                    }}
                    onKeyDown={onFieldKeyDown}
                />
                <span className="text-2xs text-fg-subtle">{t("story.textType.speedUnit")}</span>
            </div>
        </div>,
        document.body,
    );
}
