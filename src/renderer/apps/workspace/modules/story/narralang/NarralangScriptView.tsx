import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import { useTextEditorViewOptions } from "../../assets/editors/text/useTextEditorViewOptions";
// Type-only, and it has to stay that way: the module it names loads Monaco, whose own body reads
// `window` while it runs. A value import here fails every node-environment suite that can reach the
// story editor at collection time, and would put Monaco's module init in front of opening a scene.
import type * as NarralangMonaco from "./narralangMonaco";
import type { NarralangParseDiagnostic } from "@/lib/story/narralang/narralangReconcile";
import {
    NARRALANG_COMMIT_DEBOUNCE_MS,
    narralangDiagnosticMarks,
    shouldAdoptNarralangPrint,
} from "./narralangEdit";
import type { NarralangIssueRow } from "./narralangIo";
import type { NarralangCommitOutcome } from "./useNarralangCommit";

/**
 * Breathing room above the first line and below the last.
 *
 * Monaco's own option rather than CSS padding on the host, for the reason `TextEditor` records: the
 * host element is what Monaco measures to lay out lines, the gutter and the scrollbar, so padding it
 * leaves every one of those measurements a few pixels wrong.
 */
const EDITOR_PADDING = { top: 12, bottom: 12 } as const;

/** Who owns the squiggles on this model, so setting ours never clears anyone else's. */
const MARKER_OWNER = "narralang";

/**
 * Monaco plus the NarraLang language, loaded on the first script view and shared by every one after.
 *
 * Memoised on the promise rather than the module so two tabs opening in the same frame share one
 * load, which is what `TextEditor` does with the same module underneath.
 */
let narralangMonacoPromise: Promise<typeof NarralangMonaco> | null = null;
function loadNarralangMonaco(): Promise<typeof NarralangMonaco> {
    narralangMonacoPromise ??= import("./narralangMonaco");
    return narralangMonacoPromise;
}

/**
 * The open scene as a NarraLang script: the same rows, read and written as a page rather than as a
 * list.
 *
 * Writable exactly when {@link NarralangScriptViewProps.editable} says so, which is a scene whose
 * every row has a script form, in a workspace that is not frozen. A scene that fails the gate gets
 * the sentence above the editor and stays read-only for good - see the design doc's "the gate" - and
 * the author is better told now than after they have written a chapter expecting otherwise.
 *
 * ## What this component is responsible for
 *
 * Three things, all of them ways to lose typing, and all three decided in `narralangEdit` so they can
 * be read without a Monaco:
 *
 *  - **When the buffer is written.** On idle, on leaving the editor, and on closing the view. Never
 *    per keystroke: a commit re-parses the scene and republishes the document to every panel.
 *  - **What a buffer that does not parse does.** Nothing. It marks its lines and leaves the document
 *    exactly as it was. Half-written text is the normal state of something being typed into, so a
 *    refusal is not an error and gets no dialog, no toast and no sound.
 *  - **What happens when the document moves underneath.** A print never replaces text the author has
 *    typed and not yet committed, and never replaces anything at all while they are in the editor -
 *    a caret that jumps mid-sentence is indistinguishable from a bug. The print is held and applied
 *    when they leave.
 *
 * The Monaco configuration is `studioMonaco`'s, not a second one. That module's no-worker bargain is
 * the load-bearing part: this window is a `file://` page whose scripts are served over `app://`, so a
 * Monaco web worker is a cross-origin request Chromium refuses.
 */
export type NarralangScriptViewProps = {
    text: string;
    rows: readonly NarralangIssueRow[];
    /** False until the first print lands, which is the only time this view has nothing to show. */
    ready: boolean;
    /** Whether the buffer may be typed into at all. */
    editable: boolean;
    /** What Monaco says when it refuses a keystroke. The gate's reason, or the freeze's. */
    readOnlyReason: string;
    commit: (text: string) => NarralangCommitOutcome;
    breakMerge: () => void;
};

export function NarralangScriptView(props: NarralangScriptViewProps) {
    const { t, tn } = useTranslation();
    const hostRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<NarralangMonaco.monaco.editor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<typeof NarralangMonaco | null>(null);
    const [mounted, setMounted] = useState(false);
    const [diagnostics, setDiagnostics] = useState<readonly NarralangParseDiagnostic[]>([]);
    /** The header names another scene. Held until the header agrees again, or the buffer is replaced. */
    const [renameIgnored, setRenameIgnored] = useState(false);

    /**
     * The script, the gutter preference and the read-only sentence, mirrored out of the create
     * effect's dependency list. The editor is created once for the life of the view; listing any of
     * them would dispose and rebuild it on the next print, which is every few seconds while writing.
     */
    const textRef = useRef(props.text);
    textRef.current = props.text;
    const viewOptions = useTextEditorViewOptions();
    const viewOptionsRef = useRef(viewOptions);
    viewOptionsRef.current = viewOptions;
    const editableRef = useRef(props.editable);
    editableRef.current = props.editable;
    const readOnlyReasonRef = useRef(props.readOnlyReason);
    readOnlyReasonRef.current = props.readOnlyReason;
    const commitRef = useRef(props.commit);
    commitRef.current = props.commit;
    const breakMergeRef = useRef(props.breakMerge);
    breakMergeRef.current = props.breakMerge;

    /** The last text this view is answerable for: a print it adopted, or a buffer it committed. */
    const settledRef = useRef(props.text);
    /** A print that arrived while the author was in the editor, waiting for them to leave. */
    const pendingPrintRef = useRef<string | null>(null);
    const focusedRef = useRef(false);
    /** True while this component is the one writing the model, so its own write is not an edit. */
    const applyingRef = useRef(false);
    const commitTimerRef = useRef<number | null>(null);
    /** Set once Monaco is up; the print effect below is the only other caller. */
    const adoptRef = useRef<((text: string) => void) | null>(null);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) {
            return;
        }
        let cancelled = false;
        let dispose: (() => void) | null = null;

        const clearTimer = (): void => {
            if (commitTimerRef.current !== null) {
                window.clearTimeout(commitTimerRef.current);
                commitTimerRef.current = null;
            }
        };

        // The last commit runs from the teardown, by which time this component is on its way out and
        // has nowhere to put a diagnostic.
        const report = (next: readonly NarralangParseDiagnostic[], renamed = false): void => {
            if (!cancelled) {
                setDiagnostics(next);
                setRenameIgnored(renamed);
            }
        };

        /**
         * Offer the buffer to the document.
         *
         * Settling only on an answer that means "the document now says this" is the whole safety
         * property: a refused buffer stays dirty, so no print can replace it and the next idle tries
         * again with whatever the author has since fixed.
         */
        const runCommit = (): NarralangCommitOutcome => {
            clearTimer();
            const model = editorRef.current?.getModel();
            if (!model || !editableRef.current) {
                return { kind: "unavailable", diagnostics: [], renameIgnored: false };
            }
            const text = model.getValue();
            if (text === settledRef.current) {
                return { kind: "unchanged", diagnostics: [], renameIgnored: false };
            }
            const outcome = commitRef.current(text);
            if (outcome.kind === "refused") {
                report(outcome.diagnostics, outcome.renameIgnored);
                return outcome;
            }
            report([], outcome.renameIgnored);
            if (outcome.kind !== "unavailable") {
                settledRef.current = text;
                // Whatever print was waiting describes the document before this write, so applying it
                // on blur would put the author's own paragraph back the way it was.
                pendingPrintRef.current = null;
            }
            return outcome;
        };

        void loadNarralangMonaco().then(studio => {
            if (cancelled) {
                return;
            }
            studio.defineStudioMonacoTheme();
            const editor = studio.monaco.editor.create(host, {
                ...studio.WORKER_FREE_EDITOR_OPTIONS,
                value: textRef.current,
                language: studio.installNarralangLanguage(),
                theme: studio.STUDIO_MONACO_THEME,
                automaticLayout: true,
                scrollBeyondLastLine: false,
                fontSize: 12,
                lineHeight: 18,
                tabSize: 2,
                lineNumbers: viewOptionsRef.current.lineNumbers ? "on" : "off",
                wordWrap: viewOptionsRef.current.softWrap ? "on" : "off",
                renderWhitespace: "none",
                renderLineHighlight: "line",
                padding: EDITOR_PADDING,
                smoothScrolling: true,
                scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
                // The message is what an author sees when they try to type into a scene the script
                // cannot write, which is cheaper than a permanent banner saying the same thing.
                readOnly: !editableRef.current,
                readOnlyMessage: { value: readOnlyReasonRef.current },
            });
            // One shared, refcounted subscription across every Monaco surface in the window: a theme
            // is global, so a per-view watcher would repaint the same thing N times.
            const unwatchTheme = studio.watchStudioMonacoTheme();
            // The model was seeded with whatever the latest print was at this moment, which is not
            // necessarily the one the first render saw. Without this the buffer would look dirty
            // before a key had been pressed, and no print would ever be allowed to replace it.
            settledRef.current = textRef.current;

            const adopt = (text: string): void => {
                const model = editor.getModel();
                if (!model || model.getValue() === text) {
                    pendingPrintRef.current = null;
                    settledRef.current = text;
                    return;
                }
                const state = editor.saveViewState();
                applyingRef.current = true;
                try {
                    model.setValue(text);
                } finally {
                    applyingRef.current = false;
                }
                if (state) {
                    editor.restoreViewState(state);
                }
                settledRef.current = text;
                pendingPrintRef.current = null;
                report([]);
                // The document moved without this buffer, so the next thing typed is a separate step.
                breakMergeRef.current();
            };

            const onChange = editor.onDidChangeModelContent(() => {
                if (applyingRef.current || !editableRef.current) {
                    return;
                }
                clearTimer();
                commitTimerRef.current = window.setTimeout(runCommit, NARRALANG_COMMIT_DEBOUNCE_MS);
            });
            const onFocus = editor.onDidFocusEditorText(() => {
                focusedRef.current = true;
            });
            // Leaving is the one moment an author unambiguously means "that is the line" - so the
            // buffer lands, the undo group ends, and anything the document did meanwhile is applied.
            const onBlur = editor.onDidBlurEditorText(() => {
                focusedRef.current = false;
                const outcome = runCommit();
                breakMergeRef.current();
                const pending = pendingPrintRef.current;
                const model = editor.getModel();
                // `committed`: a print of this scene is already on its way and the one being held
                // describes the document before the write, so applying it would put the author's own
                // paragraph back the way it was for as long as it takes the next print to land.
                if (outcome.kind === "committed" || pending === null || !model) {
                    return;
                }
                // The same predicate as on arrival, and it is load-bearing here: a commit that was
                // REFUSED leaves the buffer dirty, and adopting over it would throw away the text the
                // author has to come back and fix.
                if (shouldAdoptNarralangPrint(
                    { settled: settledRef.current, buffer: model.getValue(), focused: false },
                    pending,
                )) {
                    adopt(pending);
                }
            });

            monacoRef.current = studio;
            editorRef.current = editor;
            adoptRef.current = adopt;
            setMounted(true);

            dispose = () => {
                // The last thing the author typed, on the way out. `runCommit` is a no-op when the
                // buffer already matches the document, so closing a view nobody edited writes nothing.
                runCommit();
                breakMergeRef.current();
                clearTimer();
                onChange.dispose();
                onFocus.dispose();
                onBlur.dispose();
                unwatchTheme();
                editor.getModel()?.dispose();
                editor.dispose();
                editorRef.current = null;
                monacoRef.current = null;
                adoptRef.current = null;
            };
        });

        return () => {
            cancelled = true;
            clearTimer();
            dispose?.();
        };
    }, []);

    // A fresh print replaces the text in place rather than swapping the model: the author is reading,
    // and the scroll position is the thing they would lose. Whether it may replace anything at all is
    // `shouldAdoptNarralangPrint`'s decision; a print it refuses is held for the next blur.
    useEffect(() => {
        const editor = editorRef.current;
        const model = editor?.getModel();
        if (!editor || !model) {
            return;
        }
        const adopt = adoptRef.current;
        if (!adopt) {
            return;
        }
        const allowed = shouldAdoptNarralangPrint(
            { settled: settledRef.current, buffer: model.getValue(), focused: focusedRef.current },
            props.text,
        );
        if (allowed) {
            adopt(props.text);
            return;
        }
        if (props.text !== model.getValue()) {
            pendingPrintRef.current = props.text;
        }
    }, [mounted, props.ready, props.text]);

    useEffect(() => {
        editorRef.current?.updateOptions({
            lineNumbers: viewOptions.lineNumbers ? "on" : "off",
            wordWrap: viewOptions.softWrap ? "on" : "off",
            readOnly: !props.editable,
            readOnlyMessage: { value: props.readOnlyReason },
        });
    }, [props.editable, props.readOnlyReason, viewOptions]);

    // Diagnostics as squiggles on the lines they belong to, which is the whole of how a refused
    // buffer reports itself: no dialog, no toast, and the document untouched behind them.
    useEffect(() => {
        const studio = monacoRef.current;
        const model = editorRef.current?.getModel();
        if (!studio || !model) {
            return;
        }
        studio.monaco.editor.setModelMarkers(
            model,
            MARKER_OWNER,
            narralangDiagnosticMarks(
                // A buffer that has stopped being writable - frozen, or a scene that just gained a
                // row with no script form - has nothing to report: it is no longer being offered to
                // the document, so a squiggle would be a complaint about a write nobody is making.
                props.editable ? diagnostics : [],
                // Clamped: a diagnostic outside the model can only mean the buffer moved on since it
                // was raised, and Monaco throws rather than clamping for itself.
                line => model.getLineMaxColumn(Math.min(Math.max(1, line), model.getLineCount())) - 1,
                t,
            ).map(mark => ({
                severity: studio.monaco.MarkerSeverity.Error,
                message: mark.message,
                startLineNumber: mark.line,
                startColumn: mark.startColumn,
                endLineNumber: mark.line,
                endColumn: mark.endColumn,
            })),
        );
    }, [diagnostics, mounted, props.editable, t]);

    return (
        // `.nl-editor-surface`, like the row list beside it and the built-in text editor: this is a
        // reading surface and resolves its alpha from the same `editor.surfaceOpacity` setting.
        // Monaco itself paints nothing; see `transparent` in `studioMonaco` for why.
        <div className="nl-editor-surface flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {props.rows.length > 0 ? (
                <div className="flex max-h-32 shrink-0 flex-col gap-1 overflow-auto border-b border-edge bg-warning/10 px-3 py-1.5">
                    <div className="flex items-start gap-1.5 text-2xs text-warning">
                        <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                        <span>{tn("story.narralang.view.gate", props.rows.length)}</span>
                    </div>
                    {/* Named by the sentence the row list shows them with, never by an identifier: the
                        author finds the row by reading down the scene. The reasons ride the tooltip
                        rather than a second line each - the list has to stay findable at a glance. */}
                    <ul className="flex flex-col gap-0.5 pl-5">
                        {props.rows.map(row => (
                            <li
                                key={row.blockId}
                                className="truncate text-2xs text-fg-muted"
                                data-tip={row.reasons
                                    .map(reason => t(`story.narralang.reason.${reason}` as TranslationKey))
                                    .join("\n")}
                            >
                                {row.description}
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
            <div className="relative min-h-0 min-w-0 flex-1">
                <div ref={hostRef} className="absolute inset-0" />
                {!props.ready && (
                    <div className="nl-editor-surface absolute inset-0 flex items-center justify-center text-fg-subtle">
                        <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                )}
            </div>
            {/* The two things the marked lines cannot say for themselves: that nothing was written,
                and that one edit was read and not obeyed. Present only while each is true, and
                statements rather than instructions — the marks already say which lines and why. */}
            {props.editable && (diagnostics.length > 0 || renameIgnored) ? (
                <div className="flex shrink-0 flex-col gap-0.5 border-t border-edge bg-warning/10 px-3 py-1 text-2xs text-warning">
                    {diagnostics.length > 0 ? (
                        <div className="flex items-center gap-1.5">
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            <span>{tn("story.narralang.view.unread", diagnostics.length)}</span>
                        </div>
                    ) : null}
                    {renameIgnored ? (
                        <div className="flex items-center gap-1.5">
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            <span>{t("story.narralang.view.renameElsewhere")}</span>
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
