import { useRef, useState } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { Bold, ChevronDown, ChevronRight, Italic, Palette, Pause as PauseIcon, Type } from "lucide-react";
import { ProjectPalette } from "@/apps/workspace/modules/properties/framework/fields/ProjectPalette";
import { useRichToolbarExpanded } from "./storyEditorSessionStore";
import type { RichTextInputHandle } from "./RichTextInput";

const SWATCHES = ["#ffffff", "#f87171", "#fb923c", "#facc15", "#4ade80", "#38bdf8", "#a78bfa"];
const BTN = "grid h-6 w-6 place-items-center rounded text-slate-300 hover:bg-white/10 hover:text-white";

/** Keep the contentEditable selection alive when a toolbar control is pressed. */
function keepFocus(event: { preventDefault: () => void }) {
    event.preventDefault();
}

/**
 * Floating rich-text control strip rendered above the row being edited. Collapsed to a small chip
 * by default; its expanded state is shared across the whole Studio session
 * (see {@link useRichToolbarExpanded}).
 */
export function RichTextToolbar(props: { editor: RefObject<RichTextInputHandle | null>; commitGuard?: RefObject<boolean> }) {
    const [expanded, setExpanded] = useRichToolbarExpanded();
    const [palette, setPalette] = useState<{ top: number; left: number } | null>(null);
    const paletteBtnRef = useRef<HTMLButtonElement | null>(null);

    const openPalette = () => {
        const rect = paletteBtnRef.current?.getBoundingClientRect();
        if (props.commitGuard) {
            props.commitGuard.current = true;
        }
        setPalette(rect
            ? { top: Math.min(rect.bottom + 6, window.innerHeight - 220), left: Math.max(8, Math.min(rect.left, window.innerWidth - 224)) }
            : { top: 120, left: 120 });
    };
    const closePalette = () => {
        if (props.commitGuard) {
            props.commitGuard.current = false;
        }
        setPalette(null);
        props.editor.current?.focus();
    };

    if (!expanded) {
        return (
            <button
                type="button"
                className="absolute -top-7 left-0 z-10 inline-flex h-6 items-center gap-1 rounded-md border border-white/10 bg-[#16191e] px-1.5 text-[11px] text-slate-400 shadow transition-colors hover:text-slate-200"
                onMouseDown={keepFocus}
                onClick={() => setExpanded(true)}
                title="Rich text tools"
            >
                <Type className="h-3 w-3" />
                <ChevronRight className="h-3 w-3" />
            </button>
        );
    }

    return (
        <>
            <div
                className="absolute -top-8 left-0 z-10 flex items-center gap-0.5 rounded-md border border-white/10 bg-[#16191e] px-1 py-0.5 shadow-lg"
                onMouseDown={keepFocus}
            >
                <button type="button" className={BTN} onClick={() => setExpanded(false)} title="Collapse rich text tools">
                    <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <div className="mx-0.5 h-4 w-px bg-white/10" />
                <button type="button" className={BTN} onClick={() => props.editor.current?.toggleMark("bold")} title="Bold">
                    <Bold className="h-3.5 w-3.5" />
                </button>
                <button type="button" className={BTN} onClick={() => props.editor.current?.toggleMark("italic")} title="Italic">
                    <Italic className="h-3.5 w-3.5" />
                </button>
                <div className="mx-0.5 h-4 w-px bg-white/10" />
                {SWATCHES.map(color => (
                    <button
                        key={color}
                        type="button"
                        className="h-4 w-4 rounded-full border border-white/25 transition-transform hover:scale-110"
                        style={{ backgroundColor: color }}
                        onClick={() => props.editor.current?.setColor(color)}
                        title={`Text color ${color}`}
                    />
                ))}
                <button
                    ref={paletteBtnRef}
                    type="button"
                    className={BTN}
                    onClick={openPalette}
                    title="More colors — project palette"
                >
                    <Palette className="h-3.5 w-3.5" />
                </button>
                <div className="mx-0.5 h-4 w-px bg-white/10" />
                <button
                    type="button"
                    className={BTN}
                    onClick={() => props.editor.current?.insertPause(true)}
                    title="Insert pause (waits for a click)"
                >
                    <PauseIcon className="h-3.5 w-3.5" />
                </button>
            </div>
            {palette ? createPortal(
                <>
                    <div className="fixed inset-0 z-[60]" onMouseDown={closePalette} />
                    <div
                        className="fixed z-[70] w-52 rounded-lg border border-white/15 bg-[#16191e] p-2 shadow-2xl"
                        style={{ top: palette.top, left: palette.left }}
                        onMouseDown={event => event.stopPropagation()}
                    >
                        <ProjectPalette
                            onPick={(color, commit) => {
                                props.editor.current?.setColor(color);
                                if (commit) {
                                    closePalette();
                                }
                            }}
                        />
                    </div>
                </>,
                document.body,
            ) : null}
        </>
    );
}
