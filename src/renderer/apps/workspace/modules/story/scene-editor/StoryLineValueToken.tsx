import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { StoryBlock } from "@shared/types/story";
import { isStoryBezierEasing, STORY_DEFAULT_BEZIER_EASING } from "@shared/utils/storyEasing";
import { useCommandTranslation } from "@/lib/i18n";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { EasingCurveEditor } from "@/apps/workspace/components/ui/EasingCurveEditor";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import { normalizeHex } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { localizedEnumValue } from "./commands/localizedEnums";
import type { StoryCommandLineControl, StoryCommandLineEdit } from "./storyCommandLine";

/**
 * A value inside a committed command line, clickable.
 *
 * Every option a row carries is editable from the row itself — durations, transition words,
 * placements, volumes, flags, colours — because the row now prints them all, and a printed value an
 * author cannot touch is one they have to go hunting through the inspector for.
 *
 * **Which control opens is decided by the grammar, not here.** The projection reads the slot's
 * declared type and hands over a {@link StoryCommandLineEdit}; this file renders one of five shapes
 * for it and knows no command, param or word by name. That is what makes a param editable the day a
 * spec declares it.
 *
 * The write goes through `onApply`, the row's ordinary payload-update path, so an inline edit is one
 * undo step exactly like an inspector edit.
 */

const TOKEN_CLASS = "cursor-pointer rounded-md px-0.5 underline decoration-dotted decoration-fg-subtle/60 underline-offset-2 transition-colors hover:bg-fill";

export function StoryLineValueToken(props: {
    edit: StoryCommandLineEdit;
    /** The value as the line drew it — coloured spans, unit and all. */
    children: ReactNode;
    onApply: (payload: StoryBlock["payload"]) => void;
}) {
    const { edit } = props;
    const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null);

    const open = (event: ReactMouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        // A boolean flips in place — a popover for two states is friction, not affordance.
        if (edit.control.kind === "boolean") {
            props.onApply(edit.apply(edit.value === "true" ? "false" : "true"));
            return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        setAnchor({ left: rect.left, bottom: rect.bottom });
    };

    return (
        <>
            <button type="button" className={TOKEN_CLASS} onMouseDown={event => event.stopPropagation()} onClick={open}>
                {props.children}
            </button>
            {anchor ? (
                <ValuePopover edit={edit} anchor={anchor} onApply={props.onApply} onClose={() => setAnchor(null)} />
            ) : null}
        </>
    );
}

function ValuePopover(props: {
    edit: StoryCommandLineEdit;
    anchor: { left: number; bottom: number };
    onApply: (payload: StoryBlock["payload"]) => void;
    onClose: () => void;
}) {
    // Subscribed to, not called for the words below, which resolve through the imperative
    // `localizedEnumValue` - a snapshot with no way to tell React it went stale. The one string this
    // file names itself (the curve option) goes through the same translator, since it is offered
    // beside those words rather than beneath them.
    const { t: ct } = useCommandTranslation();
    const panelRef = useRef<HTMLDivElement | null>(null);
    const { edit } = props;
    const control = edit.control;

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                props.onClose();
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [props]);

    useEffect(() => {
        const onDown = (event: MouseEvent) => {
            if (panelRef.current?.contains(event.target as Node)) {
                return;
            }
            props.onClose();
        };
        document.addEventListener("mousedown", onDown, true);
        return () => document.removeEventListener("mousedown", onDown, true);
    }, [props]);

    const apply = (next: string) => props.onApply(edit.apply(next));
    const pick = (next: string) => {
        apply(next);
        props.onClose();
    };

    return createPortal(
        <div
            ref={panelRef}
            className={`fixed z-[70] rounded-lg border border-edge bg-surface-raised p-2 shadow-2xl ${control.kind === "number" ? "w-56" : "w-48"}`}
            style={{
                top: Math.max(8, Math.min(props.anchor.bottom + 6, window.innerHeight - 220)),
                left: Math.max(8, Math.min(props.anchor.left, window.innerWidth - 236)),
            }}
            onMouseDown={event => event.stopPropagation()}
        >
            {control.kind === "number" ? <NumberControl control={control} value={edit.value} onCommit={apply} onPick={pick} /> : null}
            {control.kind === "enum" ? (
                <div className="grid gap-2">
                    {/*
                      * A slot that takes a drawn curve edits it here rather than sending the author to
                      * the inspector for the one value the word list cannot say. `apply`, not `pick`:
                      * the popover stays open through the drag, which is the gesture itself.
                      */}
                    {control.curve && isStoryBezierEasing(edit.value) ? (
                        <EasingCurveEditor easing={edit.value} onChange={apply} />
                    ) : null}
                    <div className="max-h-56 overflow-y-auto">
                        {control.options.map(option => (
                            <OptionRow
                                key={option.value}
                                label={localizedEnumValue({ kind: "enum", options: control.options }, option)}
                                selected={option.value === edit.value}
                                onClick={() => pick(option.value)}
                            />
                        ))}
                        {control.curve ? (
                            <OptionRow
                                label={ct("storyInspector.easing.custom")}
                                selected={isStoryBezierEasing(edit.value)}
                                onClick={() => apply(isStoryBezierEasing(edit.value) ? edit.value : STORY_DEFAULT_BEZIER_EASING)}
                            />
                        ) : null}
                    </div>
                </div>
            ) : null}
            {control.kind === "choice" ? (
                <div className="max-h-56 overflow-y-auto">
                    {control.options.map(option => (
                        <OptionRow
                            key={option.value}
                            label={option.label}
                            selected={option.value === edit.value}
                            onClick={() => pick(option.value)}
                        />
                    ))}
                </div>
            ) : null}
            {control.kind === "color" ? (
                <div className="flex items-center gap-2">
                    <ColorPickerTrigger
                        value={{ hex: normalizeHex(edit.value) ?? "#FFFFFF", alpha: 1 }}
                        displayMode="swatch"
                        allowOpacity={false}
                        onChange={next => apply(normalizeHex(next.hex) ?? next.hex)}
                        onCommit={next => apply(normalizeHex(next.hex) ?? next.hex)}
                    />
                    <span className="font-mono text-xs text-fg-muted">{edit.value}</span>
                </div>
            ) : null}
        </div>,
        document.body,
    );
}

function NumberControl(props: {
    control: Extract<StoryCommandLineControl, { kind: "number" }>;
    value: string;
    onCommit: (next: string) => void;
    onPick: (next: string) => void;
}) {
    const { control } = props;
    return (
        <div>
            <div className="flex items-center gap-1.5">
                <NumericDraftEnhancedInput
                    committedDisplay={props.value}
                    // Clamped to the slot's own bounds — the same ones the parser enforces on a typed
                    // line, so an inline edit can never write a value the line could not carry.
                    onFiniteNumber={next => props.onCommit(String(clamp(next, control)))}
                    onEmpty={() => props.onCommit(String(control.min ?? 0))}
                    type="text"
                    inputMode="decimal"
                    autoFocus
                    popoverWhenNarrow={false}
                    className="w-24"
                />
                {control.unit ? <span className="text-xs text-fg-muted">{control.unit}</span> : null}
            </div>
            {control.presets ? (
                <div className="mt-2 flex flex-wrap gap-1">
                    {control.presets.map(preset => (
                        <button
                            key={preset}
                            type="button"
                            className="h-6 rounded-md border border-edge bg-surface px-1.5 text-2xs text-fg-muted transition-colors hover:bg-fill hover:text-fg"
                            onClick={() => props.onPick(String(preset))}
                        >
                            {preset}{control.unit}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function OptionRow(props: { label: string; selected: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            className={`flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                props.selected ? "bg-primary/15 text-fg" : "text-fg-muted hover:bg-fill hover:text-fg"
            }`}
            onClick={props.onClick}
        >
            <span className="truncate">{props.label}</span>
        </button>
    );
}

function clamp(value: number, control: Extract<StoryCommandLineControl, { kind: "number" }>): number {
    const bounded = Math.min(control.max ?? Number.POSITIVE_INFINITY, Math.max(control.min ?? Number.NEGATIVE_INFINITY, value));
    return control.integer ? Math.round(bounded) : bounded;
}
