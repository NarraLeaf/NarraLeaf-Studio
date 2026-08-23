import { useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { createPortal } from "react-dom";
import { Minus, Plus } from "lucide-react";
import { Input } from "@/lib/components/elements/Input";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import { useTranslation } from "@/lib/i18n";
import { useDismissWhenHidden } from "@/lib/components/layout";
import { TooltipGroup } from "@/lib/tooltip";
import type { StoryTextEmphasis } from "@shared/types/story";
import {
    STORY_FONT_SIZE_STEP_MAX,
    STORY_FONT_SIZE_STEP_MIN,
    STORY_TEXT_EMPHASIS_VALUES,
} from "@shared/utils/storyTextMarks";

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
 */
export function TypePopover(props: {
    anchor: { top: number; left: number; bottom: number };
    /** The button this opened from; it counts as inside for light dismiss. */
    anchorRef?: RefObject<HTMLElement | null>;
    emphasis?: StoryTextEmphasis;
    fontSizeStep?: number;
    cps?: number;
    onSet: (mark: "emphasis" | "fontSizeStep" | "cps", value: string | number | null) => void;
    onClose: () => void;
}) {
    useDismissWhenHidden(props.onClose);
    const { t } = useTranslation();
    const panelRef = useRef<HTMLDivElement | null>(null);

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

    const step = props.fontSizeStep ?? 0;
    const setStep = (next: number) => {
        const clamped = Math.min(STORY_FONT_SIZE_STEP_MAX, Math.max(STORY_FONT_SIZE_STEP_MIN, next));
        props.onSet("fontSizeStep", clamped === 0 ? null : clamped);
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
                    className="h-7 w-7 text-xs"
                    active={props.emphasis === undefined}
                    aria-label={t("story.textType.emphasisNone")}
                    data-tip={t("story.textType.emphasisNone")}
                    onClick={() => props.onSet("emphasis", null)}
                >
                    {t("story.textType.emphasisSample")}
                </ToolbarButton>
                {STORY_TEXT_EMPHASIS_VALUES.map(value => (
                    <ToolbarButton
                        key={value}
                        size="xs"
                        className="h-7 w-7 text-xs"
                        active={props.emphasis === value}
                        aria-label={t(EMPHASIS_LABELS[value])}
                        data-tip={t(EMPHASIS_LABELS[value])}
                        // Pressing the mark already on the text takes it off, the way every other
                        // toggle in the strip does.
                        onClick={() => props.onSet("emphasis", props.emphasis === value ? null : value)}
                    >
                        {/*
                          * The sample wears the very class the row does, so what the panel offers and
                          * what the line gets cannot drift apart.
                          */}
                        <span className="story-rt-emphasis leading-none" data-emphasis={value}>
                            {t("story.textType.emphasisSample")}
                        </span>
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
                    value={props.cps === undefined ? "" : String(props.cps)}
                    placeholder={t("story.textType.speedPlaceholder")}
                    onChange={event => {
                        const raw = event.target.value.trim();
                        const numeric = Number(raw);
                        props.onSet("cps", raw === "" || !Number.isFinite(numeric) || numeric <= 0 ? null : numeric);
                    }}
                    onKeyDown={onFieldKeyDown}
                />
                <span className="text-2xs text-fg-subtle">{t("story.textType.speedUnit")}</span>
            </div>
        </div>,
        document.body,
    );
}
