import { useEffect, useRef } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import { useTextEditorViewOptions } from "../../assets/editors/text/useTextEditorViewOptions";
// Type-only, and it has to stay that way: the module it names loads Monaco, whose own body reads
// `window` while it runs. A value import here fails every node-environment suite that can reach the
// story editor at collection time, and would put Monaco's module init in front of opening a scene.
import type * as NarralangMonaco from "./narralangMonaco";
import type { NarralangIssueRow } from "./narralangIo";

/**
 * Breathing room above the first line and below the last.
 *
 * Monaco's own option rather than CSS padding on the host, for the reason `TextEditor` records: the
 * host element is what Monaco measures to lay out lines, the gutter and the scrollbar, so padding it
 * leaves every one of those measurements a few pixels wrong.
 */
const EDITOR_PADDING = { top: 12, bottom: 12 } as const;

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
 * The open scene as a NarraLang script: the same rows, read as a page rather than as a list.
 *
 * **Read-only, in every case.** Editing the script is a later milestone; what this round settles is
 * that the projection is on screen and stays in step with the document. A scene that has rows with no
 * script form gets the extra sentence above the editor, because that scene will not become editable
 * when the rest does - see the design doc's "the gate" - and the author is better told now than after
 * they have written a chapter expecting to.
 *
 * The Monaco configuration is `studioMonaco`'s, not a second one. That module's no-worker bargain is
 * the load-bearing part: this window is a `file://` page whose scripts are served over `app://`, so a
 * Monaco web worker is a cross-origin request Chromium refuses.
 */
export function NarralangScriptView(props: {
    text: string;
    rows: readonly NarralangIssueRow[];
    /** False until the first print lands, which is the only time this view has nothing to show. */
    ready: boolean;
}) {
    const { t, tn } = useTranslation();
    const hostRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<NarralangMonaco.monaco.editor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<typeof NarralangMonaco | null>(null);

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
    const readOnlyMessage = t("story.narralang.view.readOnly");
    const readOnlyMessageRef = useRef(readOnlyMessage);
    readOnlyMessageRef.current = readOnlyMessage;

    useEffect(() => {
        const host = hostRef.current;
        if (!host) {
            return;
        }
        let cancelled = false;
        let dispose: (() => void) | null = null;

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
                // A projection, not a buffer. The message is what an author sees when they try to
                // type, which is cheaper than a permanent banner saying the same thing.
                readOnly: true,
                readOnlyMessage: { value: readOnlyMessageRef.current },
            });
            // One shared, refcounted subscription across every Monaco surface in the window: a theme
            // is global, so a per-view watcher would repaint the same thing N times.
            const unwatchTheme = studio.watchStudioMonacoTheme();

            monacoRef.current = studio;
            editorRef.current = editor;

            dispose = () => {
                unwatchTheme();
                editor.getModel()?.dispose();
                editor.dispose();
                editorRef.current = null;
                monacoRef.current = null;
            };
        });

        return () => {
            cancelled = true;
            dispose?.();
        };
    }, []);

    // A fresh print replaces the text in place rather than swapping the model: the author is reading,
    // and the scroll position is the thing they would lose. Guarded on equality because a document
    // change elsewhere in the story re-runs the print with the same result for this scene.
    useEffect(() => {
        const editor = editorRef.current;
        const model = editor?.getModel();
        if (!editor || !model || model.getValue() === props.text) {
            return;
        }
        const state = editor.saveViewState();
        model.setValue(props.text);
        if (state) {
            editor.restoreViewState(state);
        }
    }, [props.text, props.ready]);

    useEffect(() => {
        editorRef.current?.updateOptions({
            lineNumbers: viewOptions.lineNumbers ? "on" : "off",
            wordWrap: viewOptions.softWrap ? "on" : "off",
            readOnlyMessage: { value: readOnlyMessage },
        });
    }, [readOnlyMessage, viewOptions]);

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
        </div>
    );
}
