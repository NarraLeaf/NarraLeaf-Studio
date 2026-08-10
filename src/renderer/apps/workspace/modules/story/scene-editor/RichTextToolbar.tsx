import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { createPortal } from "react-dom";
import { Bold, Braces, ChevronDown, ChevronRight, Italic, Palette, Pause as PauseIcon, Smile, Superscript, Type } from "lucide-react";
import { ProjectPalette } from "@/apps/workspace/modules/properties/framework/fields/ProjectPalette";
import { addRecentColor, useRecentColors } from "@/apps/workspace/modules/properties/framework/fields/recentColors";
import { parseColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { useTranslation } from "@/lib/i18n";
import { useRichToolbarExpanded } from "./storyEditorSessionStore";
import { defaultInterpolationForKind, getLastInterpolationKind } from "./storyInterpolation";
import { RubyPopover } from "./RubyPopover";
import type { ActiveMarks, RichTextInputHandle } from "./RichTextInput";

/** Fallback quick colors shown until the author has built up a recent-colors history. */
const DEFAULT_SWATCHES = ["#ffffff", "#f87171", "#fb923c", "#facc15", "#4ade80", "#38bdf8", "#a78bfa"];
const SWATCH_COUNT = 7;
/**
 * The keyboard's cursor inside the strip. See `.nl-focus-ring` in styles.css for why it is a hand-
 * written rule and not `focus:ring-2`: a global `button:focus { box-shadow: none !important }`
 * discards Tailwind's ring while leaving every one of its custom properties correctly resolved, so
 * the utility measures as applied and photographs as absent.
 *
 * Plain `:focus`, not `:focus-visible`. The strip's `onMouseDown` calls `preventDefault`, so a
 * pointer press never focuses one of these buttons at all — focus arrives here by exactly one route,
 * the keyboard, and the indicator can be unconditional instead of resting on a browser heuristic
 * about whether a programmatic `.focus()` counts as "visible".
 */
const FOCUS_RING = "nl-focus-ring";
/**
 * The keys the strip owns while it has focus — navigation, exit, and the two the browser turns into
 * a button press. They are held back from the global keybinding service; see `onStripKeyDown`.
 */
const STRIP_KEYS = new Set(["Tab", "Escape", "Enter", " ", "Spacebar"]);
const BTN = `grid h-6 w-6 place-items-center rounded-md text-fg-muted hover:bg-fill hover:text-fg ${FOCUS_RING}`;
const BTN_ACTIVE = `grid h-6 w-6 place-items-center rounded-md bg-primary/25 text-primary ${FOCUS_RING}`;
/**
 * A control with nothing in reach to act on. Kept in the strip rather than hidden - the strip is the
 * list of what this editor can do to a line, and a tool that comes and goes with the selection has
 * to be hunted for every time.
 *
 * `aria-disabled` and an inert handler rather than the `disabled` attribute, which is what carries
 * the hint: a disabled control takes no pointer events, so its `title` never appears, and the one
 * thing an author standing in front of an unavailable tool needs is the sentence saying what would
 * make it available. It also stays in the strip's Tab cycle, so the keyboard reaches that sentence
 * on the same terms the pointer does.
 */
const BTN_INERT = `grid h-6 w-6 place-items-center rounded-md text-fg-subtle ${FOCUS_RING}`;
/** Rendered heights of the two strips, and the breathing room between strip and row. */
const TOOLBAR_HEIGHT = 24;
const TOOLBAR_HEIGHT_EXPANDED = 30;
const TOOLBAR_GAP = 4;

/**
 * The rect of the nearest ancestor that actually scrolls — the pane the toolbar has to stay inside.
 * The toolbar is a `fixed` portal, so nothing clips it for free: without this it happily floats over
 * the tab strip, or stays pinned in place after its row has scrolled away.
 */
function scrollClipRect(el: HTMLElement): DOMRect | null {
    for (let node = el.parentElement; node; node = node.parentElement) {
        const overflowY = globalThis.window.getComputedStyle(node).overflowY;
        if (overflowY === "auto" || overflowY === "scroll") {
            return node.getBoundingClientRect();
        }
    }
    return null;
}

/** Case-insensitive normalized hex key so colors from mixed sources compare reliably. */
function colorKey(color: string): string {
    return parseColorValue(color, { hex: color, alpha: 1 }).hex.toLowerCase();
}

/** Keep the contentEditable selection alive when a toolbar control is pressed. */
function keepFocus(event: { preventDefault: () => void }) {
    event.preventDefault();
}

export type RichTextToolbarHandle = {
    /**
     * `Tab` (or `Shift+Tab`) arrived from the field. Collapsed, this opens the strip and leaves the
     * caret where it is — the author asked to *see* the tools, and one keystroke should not also move
     * them out of their sentence; a second Tab then walks in. Expanded, focus enters the strip.
     *
     * Returns whether the key was taken, so the field can fall back to the browser if there is no
     * strip to enter (a read-only row never mounts one).
     */
    enterFromEditor: (backwards: boolean) => boolean;
};

/**
 * Floating rich-text control strip shown above the row being edited. Rendered in a portal with a
 * high z-index (positioned from the edit box) so it always reliably receives clicks regardless of
 * row stacking. Collapsed to a small chip by default; its expanded state is shared across the whole
 * Studio session (see {@link useRichToolbarExpanded}).
 *
 * Reachable by keyboard as well as by pointer: `Tab` from the field walks in, `Tab`/`Shift+Tab` cycle
 * the controls, `Escape` hands the line back. The two input routes are deliberately not symmetric —
 * a pointer press never focuses a control (see {@link FOCUS_RING}), a keyboard one always does — and
 * every command below therefore has to put focus back where the author left it (see `keepKeyboard`).
 */
export const RichTextToolbar = forwardRef<RichTextToolbarHandle, {
    editor: RefObject<RichTextInputHandle | null>;
    anchorRef: RefObject<HTMLElement | null>;
    commitGuard?: RefObject<boolean>;
    active?: ActiveMarks;
    /** Whether any story variable is declared; the interpolation button hints when none exist. */
    hasVariables?: boolean;
    /** True on a dialogue row with a speaking character — the only place an expression token applies. */
    canInsertEvent?: boolean;
    /** Insert a reveal-time expression event for the row's character. */
    onInsertEvent?: () => void;
    /** `Escape` inside the strip, or collapsing it: put the caret back in the line being edited. */
    onReturnToText?: () => void;
}>(function RichTextToolbar(props, ref) {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useRichToolbarExpanded();
    const stripRef = useRef<HTMLDivElement | null>(null);
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
    const [palette, setPalette] = useState<{ top: number; left: number } | null>(null);
    const paletteBtnRef = useRef<HTMLButtonElement | null>(null);
    const palettePanelRef = useRef<HTMLDivElement | null>(null);
    /**
     * The ruby popover's anchor, and the reading it opened on. The reading is captured at open time
     * rather than read live: writing it re-renders the strip, and a popover reading `active.ruby`
     * would reset its own field to what it had just written.
     */
    const [ruby, setRuby] = useState<{ top: number; left: number; bottom: number; value?: string } | null>(null);
    const rubyBtnRef = useRef<HTMLButtonElement | null>(null);
    const active = props.active ?? { bold: false, italic: false, canRuby: false };
    const recent = useRecentColors();
    // Quick swatches favour the author's recently used colors, padded with defaults so the strip
    // always stays full and stable-width.
    const swatches = useMemo(() => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const color of [...recent, ...DEFAULT_SWATCHES]) {
            const key = colorKey(color);
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            out.push(color);
            if (out.length >= SWATCH_COUNT) {
                break;
            }
        }
        return out;
    }, [recent]);
    const activeKey = active.color ? colorKey(active.color) : null;

    useLayoutEffect(() => {
        let raf1 = 0;
        let raf2 = 0;
        const update = () => {
            const anchor = props.anchorRef.current;
            if (!anchor) {
                setPos(null);
                return;
            }
            const rect = anchor.getBoundingClientRect();
            const clip = scrollClipRect(anchor);
            // The row has been scrolled out of its pane. A chip still floating over whatever now
            // occupies that spot reads as part of it, so there is nothing useful to show.
            if (clip && (rect.bottom <= clip.top || rect.top >= clip.bottom)) {
                setPos(null);
                return;
            }
            const height = expanded ? TOOLBAR_HEIGHT_EXPANDED : TOOLBAR_HEIGHT;
            const ceiling = clip ? clip.top : 0;
            const floor = (clip ? clip.bottom : globalThis.window.innerHeight) - height;
            const above = rect.top - height - TOOLBAR_GAP;
            // Sit above the row; drop below it when the pane has no room above (the top row, or a
            // scrolled-to-edge one) rather than escaping the pane and covering the tab strip.
            const top = above >= ceiling ? above : rect.bottom + TOOLBAR_GAP;
            setPos({ top: Math.min(Math.max(top, ceiling), Math.max(ceiling, floor)), left: rect.left });
        };
        update();
        // Re-measure across the next frames: entering edit mode focuses the row, which can scroll
        // it into view after the first measure — without this the toolbar can appear misplaced /
        // off-screen until the next scroll.
        raf1 = requestAnimationFrame(() => {
            update();
            raf2 = requestAnimationFrame(update);
        });
        window.addEventListener("scroll", update, true);
        window.addEventListener("resize", update);
        return () => {
            cancelAnimationFrame(raf1);
            cancelAnimationFrame(raf2);
            window.removeEventListener("scroll", update, true);
            window.removeEventListener("resize", update);
        };
    }, [props.anchorRef, expanded]);

    // --- keyboard navigation ------------------------------------------------------------------
    //
    // Read off the DOM rather than kept in state. The strip's contents are conditional (the
    // expression button only exists on a dialogue row with a speaker) and re-ordering (applying a
    // colour promotes it in the recent-colours list), so any index table held in React would be a
    // second source of truth that drifts from the one the author is actually looking at.

    /** Every control in the strip, in visual order. Index 0 is the collapse chevron. */
    const controls = () => Array.from(stripRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);

    /** Focus the nth control, wrapping in both directions. `-1` is the last one. */
    const focusControl = (index: number) => {
        const items = controls();
        if (items.length === 0) {
            return false;
        }
        items[((index % items.length) + items.length) % items.length].focus();
        return true;
    };

    /**
     * Run a command and leave the keyboard where it was.
     *
     * Every command here ends up calling `editor.focus()` — the field owns the caret, and a mark has
     * to be applied to a live selection. That is right for a pointer press, where the button never
     * had focus to begin with, and wrong for a keyboard one: the author is still walking the strip
     * and expects the next `Tab` to reach the next control, not to leave the toolbar entirely.
     *
     * The re-focus is deferred a frame because the command re-renders the strip underneath it. It
     * prefers the same *element* over the same index, so applying a colour keeps the author on that
     * colour rather than on whatever the promotion pushed into that slot.
     */
    const keepKeyboard = (run: () => void) => {
        const from = stripRef.current?.contains(globalThis.document.activeElement)
            ? (globalThis.document.activeElement as HTMLElement)
            : null;
        const index = from ? controls().indexOf(from as HTMLButtonElement) : -1;
        run();
        if (!from) {
            return;
        }
        requestAnimationFrame(() => {
            if (from.isConnected && stripRef.current?.contains(from)) {
                from.focus();
            } else if (index >= 0) {
                focusControl(index);
            }
        });
    };

    const collapse = () => {
        setExpanded(false);
        // The control the author was standing on is about to unmount. Without this the row would be
        // left with focus on <body>, which reads to the commit guard as "the author left the row".
        props.onReturnToText?.();
    };

    useImperativeHandle(ref, () => ({
        enterFromEditor: (backwards) => {
            if (!expanded) {
                setExpanded(true);
                return true;
            }
            // Index 1, not 0: the collapse chevron is the way *out* of the strip, so landing on it
            // would put the author one keystroke from undoing the thing they just asked for. It stays
            // in the cycle — `Shift+Tab` off bold reaches it — it is just never where you arrive.
            return focusControl(backwards ? -1 : 1);
        },
        // `controls`/`focusControl` read refs only; `expanded` is the whole state this depends on.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [expanded, setExpanded]);

    const onStripKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (!STRIP_KEYS.has(event.key)) {
            // Everything else still reaches the global bindings — Mod+Z should undo from in here too.
            return;
        }
        // `KeybindingService` listens on `window` and only stands aside for *editable* targets. A
        // focused toolbar button is not editable, so without this every key pressed in the strip also
        // runs the row's own binding: Tab indents the row, Escape closes the inspector, and — the one
        // that made the whole strip look broken — Enter hits the service's `preventDefault()` before
        // the browser can turn it into a click, so activating a control did nothing whatsoever.
        //
        // Stopping here is enough because React attaches a portal's listener to the portal container
        // (`document.body`), which the native event reaches before `window`. Enter and Space are then
        // deliberately left to fall through this handler: the browser's own button activation is the
        // thing being protected, so it must not be prevented, only shielded.
        event.stopPropagation();
        if (event.key === "Tab") {
            event.preventDefault();
            const at = controls().indexOf(globalThis.document.activeElement as HTMLButtonElement);
            focusControl(at + (event.shiftKey ? -1 : 1));
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            // One rung per press (interaction model, rule 1). An open palette is its own rung and
            // closes first, with focus staying on the button that opened it; only the next Escape
            // hands the line back. Neither rung commits anything.
            if (palette) {
                closePalette("trigger");
                return;
            }
            props.onReturnToText?.();
        }
    };

    /**
     * The ruby popover is a rung of the same Escape ladder as the palette, but it owns its own
     * Escape: it holds a draft to discard, which no other rung has, and its field takes the focus,
     * so the key never reaches `onStripKeyDown` at all.
     */
    const openRuby = () => {
        const rect = rubyBtnRef.current?.getBoundingClientRect();
        if (props.commitGuard) {
            props.commitGuard.current = true;
        }
        setRuby({
            top: rect?.top ?? 120,
            left: rect?.left ?? 120,
            bottom: rect?.bottom ?? 140,
            value: active.ruby,
        });
    };
    /**
     * Always back to the line, where the palette splits by how it was left. There is no split to
     * make: the popover autofocuses its field, so by the time it closes the author is standing in
     * the popover and not in the strip, whichever way they arrived.
     */
    const closeRuby = () => {
        if (props.commitGuard) {
            props.commitGuard.current = false;
        }
        setRuby(null);
        props.editor.current?.focus();
    };

    const applyColor = (color: string) => {
        props.editor.current?.setColor(color);
        addRecentColor(color);
    };
    const openPalette = () => {
        const rect = paletteBtnRef.current?.getBoundingClientRect();
        if (props.commitGuard) {
            props.commitGuard.current = true;
        }
        setPalette(rect
            ? { top: Math.min(rect.bottom + 6, window.innerHeight - 260), left: Math.max(8, Math.min(rect.left, window.innerWidth - 224)) }
            : { top: 120, left: 120 });
    };
    /**
     * `returnTo` says where the caret goes. "editor" is the pointer path — the palette is done, the
     * author is back in their sentence. "trigger" is the keyboard path: they are still walking the
     * strip and only closed one rung of the ladder, so focus stays on the button they opened it from.
     */
    const closePalette = (returnTo: "editor" | "trigger" = "editor") => {
        if (props.commitGuard) {
            props.commitGuard.current = false;
        }
        setPalette(null);
        if (returnTo === "trigger") {
            paletteBtnRef.current?.focus();
            return;
        }
        props.editor.current?.focus();
    };

    // Light dismiss: close the palette on any pointerdown outside it, but let the event fall through
    // to whatever was clicked (a toolbar swatch, the editor) so the author keeps working without a
    // second click. The nested color-picker panel and the palette button count as "inside".
    useEffect(() => {
        if (!palette) {
            return;
        }
        const onDown = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            if (
                palettePanelRef.current?.contains(target) ||
                paletteBtnRef.current?.contains(target) ||
                target?.closest?.("[data-color-picker-panel]")
            ) {
                return;
            }
            closePalette();
        };
        globalThis.document.addEventListener("mousedown", onDown, true);
        return () => globalThis.document.removeEventListener("mousedown", onDown, true);
        // closePalette is recreated each render but only reads stable refs/props.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [palette]);

    if (!pos) {
        return null;
    }

    const strip = expanded ? (
        <div
            ref={stripRef}
            data-rt-toolbar
            role="toolbar"
            aria-label={t("story.richText.tools")}
            className="flex items-center gap-0.5 rounded-md border border-edge bg-surface-raised px-1 py-0.5 shadow-lg"
            onMouseDown={keepFocus}
            onKeyDown={onStripKeyDown}
        >
            <button type="button" className={BTN} onClick={collapse} title={t("story.richText.collapse")}>
                <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <div className="mx-0.5 h-4 w-px bg-fill" />
            <button type="button" className={active.bold ? BTN_ACTIVE : BTN} aria-pressed={active.bold} onClick={() => keepKeyboard(() => props.editor.current?.toggleMark("bold"))} title={t("story.richText.bold")}>
                <Bold className="h-3.5 w-3.5" />
            </button>
            <button type="button" className={active.italic ? BTN_ACTIVE : BTN} aria-pressed={active.italic} onClick={() => keepKeyboard(() => props.editor.current?.toggleMark("italic"))} title={t("story.richText.italic")}>
                <Italic className="h-3.5 w-3.5" />
            </button>
            {/*
              * NOT wrapped in `keepKeyboard`: like the expression button this one hands the author to a
              * popover, and that popover's field wants the focus. Dragging it back to the strip a frame
              * later would put the caret somewhere other than the reading being typed.
              */}
            <button
                ref={rubyBtnRef}
                type="button"
                className={!active.canRuby ? BTN_INERT : active.ruby || ruby ? BTN_ACTIVE : BTN}
                aria-disabled={!active.canRuby}
                aria-pressed={Boolean(active.ruby)}
                aria-expanded={Boolean(ruby)}
                onClick={() => {
                    if (!active.canRuby) {
                        return;
                    }
                    if (ruby) {
                        closeRuby();
                        return;
                    }
                    openRuby();
                }}
                title={active.canRuby ? t("story.richText.ruby") : t("story.richText.rubyHint")}
            >
                <Superscript className="h-3.5 w-3.5" />
            </button>
            <div className="mx-0.5 h-4 w-px bg-fill" />
            {swatches.map(color => {
                const isActive = activeKey !== null && colorKey(color) === activeKey;
                return (
                    <button
                        key={color}
                        type="button"
                        // The active swatch already wears a ring, so the focus indicator has to be
                        // told apart from it rather than layered on top: an accent-coloured OUTLINE,
                        // against the active one's foreground-coloured box-shadow ring.
                        className={`h-4 w-4 rounded-full border transition-transform hover:scale-110 ${FOCUS_RING} ${
                            isActive ? "scale-110 border-fg ring-2 ring-fg/80 ring-offset-1 ring-offset-surface-raised" : "border-edge-strong"
                        }`}
                        style={{ backgroundColor: color }}
                        aria-pressed={isActive}
                        onClick={() => keepKeyboard(() => applyColor(color))}
                        title={t("story.richText.textColor", { color })}
                    />
                );
            })}
            <button
                ref={paletteBtnRef}
                type="button"
                className={`${BTN} relative ${palette ? "bg-fill text-fg" : ""}`}
                aria-expanded={Boolean(palette)}
                onClick={() => (palette
                    // Closing it from the keyboard leaves the author on this button — they are still
                    // in the strip. Closing it with the pointer hands the line back, as before.
                    ? closePalette(stripRef.current?.contains(globalThis.document.activeElement) ? "trigger" : "editor")
                    : openPalette())}
                title={t("story.richText.moreColors")}
            >
                <Palette className="h-3.5 w-3.5" />
                {active.color ? (
                    <span
                        className="pointer-events-none absolute bottom-0 right-0 h-1.5 w-1.5 rounded-full border border-black/50"
                        style={{ backgroundColor: active.color }}
                    />
                ) : null}
            </button>
            <div className="mx-0.5 h-4 w-px bg-fill" />
            <button type="button" className={BTN} onClick={() => keepKeyboard(() => props.editor.current?.insertPause(true))} title={t("story.richText.insertPause")}>
                <PauseIcon className="h-3.5 w-3.5" />
            </button>
            <button
                type="button"
                className={BTN}
                onClick={() => keepKeyboard(() => props.editor.current?.insertInterpolation(defaultInterpolationForKind(getLastInterpolationKind())))}
                title={props.hasVariables ? t("story.richText.insertValue") : t("story.richText.insertValueHint")}
            >
                <Braces className="h-3.5 w-3.5" />
            </button>
            {props.canInsertEvent ? (
                // NOT wrapped in `keepKeyboard`: this one opens the expression popover on the chip it
                // just inserted, and that popover wants the focus. Dragging it back to the strip a
                // frame later would take the author out of the editor they were just handed.
                <button type="button" className={BTN} onClick={() => props.onInsertEvent?.()} title={t("story.richText.insertExpression")}>
                    <Smile className="h-3.5 w-3.5" />
                </button>
            ) : null}
        </div>
    ) : (
        <button
            type="button"
            data-rt-toolbar
            className="inline-flex h-6 items-center gap-1 rounded-md border border-edge bg-surface-raised px-1.5 text-2xs text-fg-muted shadow transition-colors hover:text-fg"
            onMouseDown={keepFocus}
            onClick={() => setExpanded(true)}
            title={t("story.richText.tools")}
        >
            <Type className="h-3 w-3" />
            <ChevronRight className="h-3 w-3" />
        </button>
    );

    return createPortal(
        <>
            <div className="fixed z-[55]" style={{ top: pos.top, left: pos.left }}>
                {strip}
            </div>
            {palette ? (
                <div
                    ref={palettePanelRef}
                    className="fixed z-[70] w-52 rounded-lg border border-edge bg-surface-raised p-2 shadow-2xl"
                    style={{ top: palette.top, left: palette.left }}
                    onMouseDown={event => event.stopPropagation()}
                >
                    <ProjectPalette
                        value={active.color}
                        onPick={(color, commit) => {
                            props.editor.current?.setColor(color);
                            if (commit) {
                                addRecentColor(color);
                                closePalette();
                            }
                        }}
                    />
                </div>
            ) : null}
            {ruby ? (
                <RubyPopover
                    anchor={ruby}
                    value={ruby.value}
                    onCommit={value => props.editor.current?.setRuby(value)}
                    onRemove={() => {
                        props.editor.current?.setRuby(null);
                        closeRuby();
                    }}
                    onClose={() => closeRuby()}
                />
            ) : null}
        </>,
        document.body,
    );
});
