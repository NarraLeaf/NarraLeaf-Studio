import { useEffect, useRef, useState } from "react";
import type { StoryDocument, StoryScene } from "@shared/types/story";
import { printNarralangScene } from "@/lib/story/narralang/narralangPrinter";
import { useWorkspace } from "../../../context";
import { narralangIssueRows, type NarralangIssueRow } from "./narralangIo";
import { narralangLookups } from "./narralangLookups";

/**
 * How long the script waits after a document change before it is printed again.
 *
 * Printing a scene walks every block through the extractor and the renderer, and rebuilds the whole
 * lookup table in front of it - cheap for one scene, and not cheap enough to sit on the edit path of
 * a long one. The document is republished per mutation, and a burst of them (a paste, a replace-all,
 * holding a key on a numeric field) would otherwise be one full print each.
 *
 * The first print after the view opens is NOT delayed - see the effect below. An author who has just
 * asked to read the script should not watch a blank editor for a third of a second.
 */
const REPRINT_DEBOUNCE_MS = 300;

export type NarralangScript = {
    /** The scene as a script. Empty until the first print lands. */
    text: string;
    /**
     * The rows with no script form, as sentences.
     *
     * Non-empty means this scene will never be editable through this view (see the design doc's "the
     * gate"), so it is the view's own reason to say so rather than only a report after an export.
     */
    rows: readonly NarralangIssueRow[];
    /** False until the first print of this scene has landed. */
    ready: boolean;
    /**
     * Whether the script may be written back - the design doc's gate, in one field.
     *
     * A scene with a row that has no script form is read-only for good, and it is read-only as a
     * whole: partial editability was rejected, because a locked region inside a live buffer is a way
     * to lose work and makes the file's editability change under the author as Studio versions move.
     */
    editable: boolean;
};

const EMPTY: NarralangScript = { text: "", rows: [], ready: false, editable: false };

/**
 * The open scene, printed as NarraLang, kept in step with the document.
 *
 * Only while `enabled`. The row editor is the surface an author spends the day in, and a projection
 * of the whole scene computed behind it - on every mutation, for a tab nobody is looking at - is a
 * cost the row editor did not have before this view existed.
 */
export function useNarralangScript(
    scene: StoryScene | null,
    document: StoryDocument | null,
    enabled: boolean,
): NarralangScript {
    const { context } = useWorkspace();
    const [script, setScript] = useState<NarralangScript>(EMPTY);

    /**
     * The print itself, out of the effect's dependency list.
     *
     * Everything it closes over is already in that list; keeping the function out of it means a
     * re-created callback cannot be mistaken for a document change and schedule a print of text that
     * has not moved.
     */
    const printRef = useRef<() => void>(() => undefined);
    printRef.current = () => {
        if (!context || !scene || !document) {
            return;
        }
        const lookups = narralangLookups(context.services, document);
        const result = printNarralangScene(scene, lookups);
        setScript({
            text: result.text,
            // One scene, so the rows carry no scene name - `narralangIssueRows` drops it for a single
            // scene, which is what keeps the list from repeating the name of the tab it is in.
            rows: narralangIssueRows(result.issues, [scene], lookups),
            ready: true,
            editable: result.issues.length === 0,
        });
    };

    /** Whether this run of the view has printed once. Reset when it closes, not when it re-renders. */
    const primed = useRef(false);
    useEffect(() => {
        if (!enabled) {
            primed.current = false;
            setScript(EMPTY);
        }
    }, [enabled]);

    useEffect(() => {
        if (!enabled || !context || !scene || !document) {
            return;
        }
        if (!primed.current) {
            primed.current = true;
            printRef.current();
            return;
        }
        // `document` is republished per mutation (the editor's own subscription re-wraps it), so this
        // effect is the change signal and the timer is the only thing between an edit and a print.
        const timer = window.setTimeout(() => printRef.current(), REPRINT_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [context, document, enabled, scene]);

    return script;
}
