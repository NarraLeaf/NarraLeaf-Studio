import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { Bold, Braces, ChevronDown, ChevronRight, Italic, Palette, Pause as PauseIcon, Type } from "lucide-react";
import { ProjectPalette } from "@/apps/workspace/modules/properties/framework/fields/ProjectPalette";
import { addRecentColor, useRecentColors } from "@/apps/workspace/modules/properties/framework/fields/recentColors";
import { parseColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { useRichToolbarExpanded } from "./storyEditorSessionStore";
import type { ActiveMarks, RichTextInputHandle } from "./RichTextInput";

/** Fallback quick colors shown until the author has built up a recent-colors history. */
const DEFAULT_SWATCHES = ["#ffffff", "#f87171", "#fb923c", "#facc15", "#4ade80", "#38bdf8", "#a78bfa"];
const SWATCH_COUNT = 7;
const BTN = "grid h-6 w-6 place-items-center rounded text-slate-300 hover:bg-white/10 hover:text-white";
const BTN_ACTIVE = "grid h-6 w-6 place-items-center rounded bg-primary/25 text-primary";

/** Case-insensitive normalized hex key so colors from mixed sources compare reliably. */
function colorKey(color: string): string {
    return parseColorValue(color, { hex: color, alpha: 1 }).hex.toLowerCase();
}

/** Keep the contentEditable selection alive when a toolbar control is pressed. */
function keepFocus(event: { preventDefault: () => void }) {
    event.preventDefault();
}

/**
 * Floating rich-text control strip shown above the row being edited. Rendered in a portal with a
 * high z-index (positioned from the edit box) so it always reliably receives clicks regardless of
 * row stacking. Collapsed to a small chip by default; its expanded state is shared across the whole
 * Studio session (see {@link useRichToolbarExpanded}).
 */
export function RichTextToolbar(props: {
    editor: RefObject<RichTextInputHandle | null>;
    anchorRef: RefObject<HTMLElement | null>;
    commitGuard?: RefObject<boolean>;
    active?: ActiveMarks;
    /** Whether any story variable is declared; the interpolation button hints when none exist. */
    hasVariables?: boolean;
}) {
    const [expanded, setExpanded] = useRichToolbarExpanded();
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
    const [palette, setPalette] = useState<{ top: number; left: number } | null>(null);
    const paletteBtnRef = useRef<HTMLButtonElement | null>(null);
    const palettePanelRef = useRef<HTMLDivElement | null>(null);
    const active = props.active ?? { bold: false, italic: false };
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
            setPos({ top: Math.max(4, rect.top - (expanded ? 34 : 28)), left: rect.left });
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
    const closePalette = () => {
        if (props.commitGuard) {
            props.commitGuard.current = false;
        }
        setPalette(null);
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
            data-rt-toolbar
            className="flex items-center gap-0.5 rounded-md border border-white/10 bg-[#16191e] px-1 py-0.5 shadow-lg"
            onMouseDown={keepFocus}
        >
            <button type="button" className={BTN} onClick={() => setExpanded(false)} title="Collapse rich text tools">
                <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <div className="mx-0.5 h-4 w-px bg-white/10" />
            <button type="button" className={active.bold ? BTN_ACTIVE : BTN} onClick={() => props.editor.current?.toggleMark("bold")} title="Bold">
                <Bold className="h-3.5 w-3.5" />
            </button>
            <button type="button" className={active.italic ? BTN_ACTIVE : BTN} onClick={() => props.editor.current?.toggleMark("italic")} title="Italic">
                <Italic className="h-3.5 w-3.5" />
            </button>
            <div className="mx-0.5 h-4 w-px bg-white/10" />
            {swatches.map(color => {
                const isActive = activeKey !== null && colorKey(color) === activeKey;
                return (
                    <button
                        key={color}
                        type="button"
                        className={`h-4 w-4 rounded-full border transition-transform hover:scale-110 ${
                            isActive ? "scale-110 border-white ring-2 ring-white/80 ring-offset-1 ring-offset-[#16191e]" : "border-white/25"
                        }`}
                        style={{ backgroundColor: color }}
                        onClick={() => applyColor(color)}
                        title={`Text color ${color}`}
                    />
                );
            })}
            <button ref={paletteBtnRef} type="button" className={`${BTN} relative ${palette ? "bg-white/10 text-white" : ""}`} onClick={() => (palette ? closePalette() : openPalette())} title="More colors — project palette">
                <Palette className="h-3.5 w-3.5" />
                {active.color ? (
                    <span
                        className="pointer-events-none absolute bottom-0 right-0 h-1.5 w-1.5 rounded-full border border-black/50"
                        style={{ backgroundColor: active.color }}
                    />
                ) : null}
            </button>
            <div className="mx-0.5 h-4 w-px bg-white/10" />
            <button type="button" className={BTN} onClick={() => props.editor.current?.insertPause(true)} title="Insert pause (waits for a click)">
                <PauseIcon className="h-3.5 w-3.5" />
            </button>
            <button
                type="button"
                className={BTN}
                onClick={() => props.editor.current?.insertInterpolation({ kind: "variable", target: { scope: "scene", variableId: "" } })}
                title={props.hasVariables ? "Insert variable value" : "Insert variable value (declare a variable first)"}
            >
                <Braces className="h-3.5 w-3.5" />
            </button>
        </div>
    ) : (
        <button
            type="button"
            data-rt-toolbar
            className="inline-flex h-6 items-center gap-1 rounded-md border border-white/10 bg-[#16191e] px-1.5 text-[11px] text-slate-400 shadow transition-colors hover:text-slate-200"
            onMouseDown={keepFocus}
            onClick={() => setExpanded(true)}
            title="Rich text tools"
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
                    className="fixed z-[70] w-52 rounded-lg border border-white/15 bg-[#16191e] p-2 shadow-2xl"
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
        </>,
        document.body,
    );
}
