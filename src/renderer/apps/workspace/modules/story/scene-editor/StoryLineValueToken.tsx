import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { FLOATING_OWN_KEYS_ATTRIBUTE, useFloatingLayer, useHostDocument } from "@/lib/components/layout";
import type { StoryBlock } from "@shared/types/story";
import { isStoryBezierEasing, STORY_DEFAULT_BEZIER_EASING } from "@shared/utils/storyEasing";
import { useCommandTranslation } from "@/lib/i18n";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { EasingCurveEditor } from "@/apps/workspace/components/ui/EasingCurveEditor";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import { normalizeHex } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { cn } from "@/lib/utils/cn";
import { localizedEnumValue } from "./commands/localizedEnums";
import type { StoryCommandLineControl, StoryCommandLineEdit, StoryCommandLineRef } from "./storyCommandLine";
import { REF_TOKEN_ARMED_CLASS } from "./StoryLineRefToken";
import { useStoryRefLink } from "./storyRefNavigation";
import { isJumpModifierEvent } from "./useJumpModifier";
import { keepStoryKeysInPopover } from "./PausePopover";

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

/** The rows of a word list, for the floating layer's keyboard walk. */
const OPTION_SELECTOR = "[data-value-option]";

const TOKEN_CLASS = "cursor-pointer rounded-md px-0.5 underline decoration-dotted decoration-fg-subtle/60 underline-offset-2 transition-colors hover:bg-fill";

export function StoryLineValueToken(props: {
    edit: StoryCommandLineEdit;
    /**
     * What this same word points at, when it points at anything.
     *
     * Most of the row's names are both: `/show Narra` opens a character picker on `Narra` AND says
     * who Narra is. Two intentions on one token, so the gesture picks between them — modifier+click
     * follows the reference, a plain click does what the token has always done. The reverse split
     * (a second, adjacent control for the link) was never on the table: the word is one word.
     */
    target?: StoryCommandLineRef;
    /** The value as the line drew it — coloured spans, unit and all. */
    children: ReactNode;
    onApply: (payload: StoryBlock["payload"]) => void;
}) {
    const { edit } = props;
    const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null);
    const tokenRef = useRef<HTMLButtonElement | null>(null);
    const link = useStoryRefLink(props.target);

    const open = (event: ReactMouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        // Following the reference outranks editing the value, because the author had to hold a key to
        // ask for it. A modifier press with nothing behind it falls through to the editor rather than
        // doing nothing, which is the only reading that never loses a click.
        if (link && isJumpModifierEvent(event)) {
            link.open();
            return;
        }
        // A boolean flips in place — a popover for two states is friction, not affordance.
        if (edit.control.kind === "boolean") {
            props.onApply(edit.apply(edit.value === "true" ? "false" : "true"));
            return;
        }
        // The token toggles its popover: it is the popover's owner, so the press that closes it is
        // not also the outside press that would close it a moment before the token reopened it.
        if (anchor) {
            setAnchor(null);
            return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        setAnchor({ left: rect.left, bottom: rect.bottom });
    };

    return (
        <>
            <button
                ref={tokenRef}
                type="button"
                aria-expanded={anchor !== null}
                // The dotted quick-edit underline turns solid and takes the accent while the modifier
                // is held, so a word that is both says which of the two a click is about to mean.
                className={cn(TOKEN_CLASS, link?.armed && REF_TOKEN_ARMED_CLASS)}
                onMouseDown={event => event.stopPropagation()}
                onClick={open}
            >
                {props.children}
            </button>
            {anchor ? (
                <ValuePopover edit={edit} anchor={anchor} ownerRef={tokenRef} onApply={props.onApply} onClose={() => setAnchor(null)} />
            ) : null}
        </>
    );
}

function ValuePopover(props: {
    edit: StoryCommandLineEdit;
    anchor: { left: number; bottom: number };
    /** The token that opened it: inside for light dismiss, and where the focus goes back to. */
    ownerRef: RefObject<HTMLElement | null>;
    onApply: (payload: StoryBlock["payload"]) => void;
    onClose: () => void;
}) {
    // Subscribed to, not called for the words below, which resolve through the imperative
    // `localizedEnumValue` - a snapshot with no way to tell React it went stale. The one string this
    // file names itself (the curve option) goes through the same translator, since it is offered
    // beside those words rather than beneath them.
    const { t: ct } = useCommandTranslation();
    const panelRef = useRef<HTMLDivElement | null>(null);
    const doc = useHostDocument();
    const { edit } = props;
    const control = edit.control;
    /**
     * The colour picker a colour value opens. It is portalled to the body on its own, so it is named
     * as part of this popover: a press or the focus landing in it is not leaving.
     */
    const colorPickerPanelRef = useMemo(() => ({
        get current(): HTMLElement | null {
            return doc.querySelector<HTMLElement>("[data-color-picker-panel]");
        },
    }), [doc]);
    // Opens on the number field, or on the value that is set in a word list, whose rows the arrows
    // then walk. Escape closes this alone - not the scene editor's own Escape behind it - and focus
    // goes back to the token.
    useFloatingLayer({
        open: true,
        onClose: props.onClose,
        panelRef,
        ownerRefs: [props.ownerRef, colorPickerPanelRef],
        itemSelector: control.kind === "enum" || control.kind === "choice" ? OPTION_SELECTOR : undefined,
    });

    useEffect(() => {
        const onDown = (event: MouseEvent) => {
            const target = event.target as Node;
            if (
                panelRef.current?.contains(target)
                || props.ownerRef.current?.contains(target)
                || colorPickerPanelRef.current?.contains(target)
            ) {
                return;
            }
            props.onClose();
        };
        doc.addEventListener("mousedown", onDown, true);
        return () => doc.removeEventListener("mousedown", onDown, true);
    }, [colorPickerPanelRef, doc, props]);

    const apply = (next: string) => props.onApply(edit.apply(next));
    const pick = (next: string) => {
        apply(next);
        props.onClose();
    };

    // A word list is as narrow as its longest word. The curve editor is a graph with a ruler down its
    // side and the `cubic-bezier(…)` it spells along the bottom, and at the list's width both of
    // those would be the things that had to shrink.
    const curve = control.kind === "enum" && control.curve && isStoryBezierEasing(edit.value);
    const width = curve ? "w-64" : control.kind === "number" ? "w-56" : "w-48";
    const view = doc.defaultView ?? window;

    return createPortal(
        <div
            ref={panelRef}
            className={`fixed z-[70] rounded-lg border border-edge bg-surface-raised p-2 shadow-2xl ${width}`}
            style={{
                top: Math.max(8, Math.min(props.anchor.bottom + 6, view.innerHeight - 220)),
                // Held clear of the right edge by its own width plus the margin, since that width
                // is no longer one number.
                left: Math.max(8, Math.min(props.anchor.left, view.innerWidth - (curve ? 268 : 236))),
            }}
            onMouseDown={event => event.stopPropagation()}
            onKeyDown={keepStoryKeysInPopover}
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
                        // The curve answers its own keys: the arrows nudge a handle and Escape in its
                        // value field drops what was typed there. An Escape it leaves alone still
                        // reaches the layer, and closes the popover.
                        <div {...{ [FLOATING_OWN_KEYS_ATTRIBUTE]: "" }}>
                            <EasingCurveEditor easing={edit.value} onChange={apply} />
                        </div>
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
        doc.body,
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
            data-value-option=""
            data-selected={props.selected ? "true" : undefined}
            // Opens on the value that is set, ahead of the curve's own text field above the list.
            data-autofocus={props.selected ? "" : undefined}
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
