import type { RefObject } from "react";
import { Bold, ChevronDown, ChevronRight, Italic, Pause as PauseIcon, Type } from "lucide-react";
import { useRichToolbarExpanded } from "./storyEditorSessionStore";
import type { RichTextInputHandle } from "./RichTextInput";

const SWATCHES = ["#ffffff", "#f87171", "#fb923c", "#facc15", "#4ade80", "#38bdf8", "#a78bfa", "#f472b6"];
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
    );
}
