import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { Slider, useSliderDraft } from "@/lib/components/elements/Slider";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { useFloatingLayer, useHostDocument } from "@/lib/components/layout";
import type { InlineTextEffectEntry, PluginInlineTextEffectParamDef } from "@/lib/plugins/inlineTextEffectRegistry";
import type { StoryTextEffect } from "@shared/types/story";
import type { TypeTarget } from "./RichTextInput";
import { keepStoryKeysInPopover } from "./PausePopover";

const ROW = "flex w-full items-center rounded-md px-2 py-1 text-left text-xs text-fg-muted transition-colors hover:bg-fill hover:text-fg";
const ROW_ACTIVE = "bg-fill text-fg";

/**
 * The inline effects the loaded plugins offer, and the parameters of the one on the selection.
 *
 * Built like {@link TypePopover} and for the same reasons: every control writes through at once,
 * the characters written to are the ones captured when the panel opened, and what each control shows
 * is held here rather than read back off a row that no longer has the focus.
 *
 * A run carries one effect. Picking another replaces it, and its parameters start from the new
 * effect's defaults; a parameter at its default is not stored, so a run keeps following the plugin's
 * default until the author moves the slider.
 */
export function EffectPopover(props: {
    anchor: { top: number; left: number; bottom: number };
    anchorRef?: RefObject<HTMLElement | null>;
    target: TypeTarget;
    effects: readonly InlineTextEffectEntry[];
    onSet: (value: StoryTextEffect | null, target: { start: number; end: number }) => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const doc = useHostDocument();
    const panelRef = useRef<HTMLDivElement | null>(null);
    useFloatingLayer({
        open: true,
        onClose: props.onClose,
        panelRef,
        ownerRefs: props.anchorRef ? [props.anchorRef] : undefined,
    });
    const [effect, setEffect] = useState<StoryTextEffect | undefined>(props.target.effect);
    const range = { start: props.target.start, end: props.target.end };
    const write = (next: StoryTextEffect | undefined) => {
        setEffect(next);
        props.onSet(next ?? null, range);
    };
    const selected = effect ? props.effects.find(entry => entry.id === effect.id) : undefined;

    useEffect(() => {
        const onDown = (event: MouseEvent) => {
            const target = event.target as Node;
            if (panelRef.current?.contains(target) || props.anchorRef?.current?.contains(target)) {
                return;
            }
            props.onClose();
        };
        doc.addEventListener("mousedown", onDown, true);
        return () => doc.removeEventListener("mousedown", onDown, true);
    }, [doc, props]);

    const setParam = (param: PluginInlineTextEffectParamDef, value: number) => {
        if (!effect) {
            return;
        }
        const params = { ...effect.params };
        if (value === param.default) {
            delete params[param.key];
        } else {
            params[param.key] = value;
        }
        write(Object.keys(params).length > 0 ? { id: effect.id, params } : { id: effect.id });
    };

    const view = doc.defaultView ?? window;
    const top = Math.min(props.anchor.bottom + 6, view.innerHeight - 240);
    const left = Math.min(props.anchor.left, view.innerWidth - 236);

    return createPortal(
        <div
            ref={panelRef}
            className="fixed z-[70] w-56 rounded-lg border border-edge bg-surface-raised p-2 shadow-2xl"
            style={{ top, left: Math.max(8, left) }}
            onMouseDown={event => event.stopPropagation()}
            onKeyDown={keepStoryKeysInPopover}
        >
            <div className="text-2xs font-medium tracking-wide text-fg-muted">{t("story.textEffect.effect")}</div>
            <div className="mt-1 flex flex-col gap-0.5" role="radiogroup" aria-label={t("story.textEffect.effect")}>
                <button
                    type="button"
                    role="radio"
                    aria-checked={!effect}
                    className={cn(ROW, !effect && ROW_ACTIVE)}
                    onClick={() => write(undefined)}
                >
                    {t("story.textEffect.none")}
                </button>
                {props.effects.map(entry => (
                    <button
                        key={entry.id}
                        type="button"
                        role="radio"
                        aria-checked={effect?.id === entry.id}
                        className={cn(ROW, effect?.id === entry.id && ROW_ACTIVE)}
                        onClick={() => {
                            if (effect?.id !== entry.id) {
                                write({ id: entry.id });
                            }
                        }}
                    >
                        {entry.label}
                    </button>
                ))}
                {effect && !selected ? (
                    // The run names an effect no loaded plugin offers. It is kept as it is, and shown
                    // so the author can see why none of the rows above is picked.
                    <div className={cn(ROW, ROW_ACTIVE, "cursor-default")} role="radio" aria-checked>
                        {t("story.textEffect.unavailable", { id: effect.id })}
                    </div>
                ) : null}
            </div>
            {selected && selected.params.length > 0 ? (
                <div className="mt-2 flex flex-col gap-2 border-t border-edge pt-2">
                    {selected.params.map(param => (
                        <EffectParamSlider
                            key={`${selected.id}:${param.key}`}
                            param={param}
                            value={numericParam(effect?.params?.[param.key], param.default)}
                            onCommit={value => setParam(param, value)}
                        />
                    ))}
                </div>
            ) : null}
        </div>,
        doc.body,
    );
}

function numericParam(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * One parameter. The run is written when the drag settles rather than on every step of it: each
 * write is an undo step and a re-render of the row, and the effect cannot be seen moving in the
 * editor anyway.
 */
function EffectParamSlider(props: {
    param: PluginInlineTextEffectParamDef;
    value: number;
    onCommit: (value: number) => void;
}) {
    const draft = useSliderDraft(props.value, props.onCommit);
    const decimals = decimalsOf(props.param.step ?? 1);
    return (
        <label className="flex flex-col gap-1">
            <span className="flex items-center justify-between text-2xs text-fg-muted">
                <span>{props.param.label}</span>
                <span className="tabular-nums text-fg">{draft.value.toFixed(decimals)}</span>
            </span>
            <Slider
                value={draft.value}
                min={props.param.min}
                max={props.param.max}
                step={props.param.step}
                onValueChange={draft.onValueChange}
                onValueCommit={draft.onValueCommit}
            />
        </label>
    );
}

/** How many decimals a step needs to be read back: `0.25` shows two, `1` shows none. */
function decimalsOf(step: number): number {
    const text = String(step);
    const dot = text.indexOf(".");
    return dot < 0 ? 0 : Math.min(3, text.length - dot - 1);
}
