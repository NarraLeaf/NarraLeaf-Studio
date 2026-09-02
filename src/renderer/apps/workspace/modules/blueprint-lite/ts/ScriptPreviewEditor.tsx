import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { EditorComponentProps } from "../../types";
import { useWorkspace } from "../../../context";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import type { FileSystemService } from "@/lib/workspace/services/core/FileSystem";
import { scriptLanguageOf } from "@shared/project/scriptsDirectory";
import { ScriptOpenMenu } from "./ScriptOpenMenu";
// Type-only, and it has to stay that way: `studioMonaco` reads `window` while its module body runs,
// and this file is reachable from the session serializer, which node-environment unit tests import.
// A value import would also make every workspace pay Monaco's module init whether or not a script is
// ever previewed. See the same note in `TextEditor.tsx`.
import type * as StudioMonaco from "@/apps/workspace/modules/assets/editors/text/studioMonaco";
import type { ScriptPreviewTabPayload } from "./scriptPreviewTabId";

/** Matches the text editor, so two reading surfaces in one window are not laid out differently. */
const EDITOR_PADDING = { top: 12, bottom: 12 } as const;

let studioMonacoPromise: Promise<typeof StudioMonaco> | null = null;
function loadStudioMonaco(): Promise<typeof StudioMonaco> {
    studioMonacoPromise ??= import("@/apps/workspace/modules/assets/editors/text/studioMonaco");
    return studioMonacoPromise;
}

/**
 * A script blueprint's source, read-only.
 *
 * **A reader, never a writer**, and that is the whole design rather than an unfinished half.
 * `<project>/scripts/` is the one directory whose bytes the disk owns (see
 * `@shared/project/scriptsDirectory`): Studio holds its documents as an in-memory copy and writes
 * the whole copy back when it saves, so an editable buffer over a script would write that copy back
 * over an edit made in another tool the next time anything saved. What this tab is for is looking -
 * seeing which file a blueprint runs and what is in it without leaving the workspace - and the
 * button beside it hands the folder to the editor the author actually writes in.
 *
 * Highlighting only, no type check. The grammar is Monaco's basic TypeScript contribution, which
 * tokenizes on the main thread; the language *service* runs in a web worker this window cannot
 * spawn, and it would be the wrong answer anyway - the author's own editor type-checks against
 * their `node_modules`, and this one cannot see them.
 *
 * The disk can change under this tab, so there is a refresh, and the tab re-reads whenever it
 * becomes visible again.
 */
export function ScriptPreviewEditor({ payload }: EditorComponentProps<ScriptPreviewTabPayload>) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    // A tab restored from a session that no longer carries a payload has nothing to show; the empty
    // ref reads as a missing file, which is what it is.
    const scriptRef = payload?.scriptRef ?? "";
    const hostRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<StudioMonaco.monaco.editor.IStandaloneCodeEditor | null>(null);
    const [source, setSource] = useState<string | null>(null);
    const [missing, setMissing] = useState(false);
    const [loading, setLoading] = useState(true);

    const projectPath = isInitialized && context ? context.project.getConfig().projectPath : null;
    const language = useMemo(() => (scriptLanguageOf(scriptRef) === "javascript" ? "javascript" : "typescript"), [scriptRef]);

    const read = useCallback(async () => {
        if (!isInitialized || !context) {
            return;
        }
        setLoading(true);
        const fs = context.services.get<FileSystemService>(Services.FileSystem);
        const result = await fs.read(context.project.resolve(scriptRef.split("/")), "utf-8");
        setLoading(false);
        if (result.ok) {
            setMissing(false);
            setSource(result.data);
            return;
        }
        // A file that is not there and a file that could not be read are one message here: both
        // mean "there is nothing to show", and the row in the blueprints list is where the
        // difference is already drawn.
        setMissing(true);
        setSource("");
    }, [context, isInitialized, scriptRef]);

    useEffect(() => {
        void read();
    }, [read]);

    // The disk owns this file, so what is on screen goes stale whenever the author saves in their
    // own editor. Re-read when the tab comes back into view rather than watching, which would mean
    // a second watcher over a directory Dev Mode already watches.
    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState === "visible") {
                void read();
            }
        };
        window.addEventListener("focus", onVisible);
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            window.removeEventListener("focus", onVisible);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [read]);

    useEffect(() => {
        const host = hostRef.current;
        if (!host || source === null) {
            return;
        }
        let cancelled = false;
        let dispose: (() => void) | null = null;
        void loadStudioMonaco().then(studio => {
            if (cancelled || !hostRef.current) {
                return;
            }
            studio.defineStudioMonacoTheme();
            const editor = studio.monaco.editor.create(host, {
                ...studio.WORKER_FREE_EDITOR_OPTIONS,
                value: source,
                language,
                theme: studio.STUDIO_MONACO_THEME,
                automaticLayout: true,
                scrollBeyondLastLine: false,
                fontSize: 12,
                lineHeight: 18,
                tabSize: 4,
                readOnly: true,
                // Monaco's default for a read-only editor is a tooltip saying the editor is read
                // only, which is true and useless. This says where writing happens instead.
                readOnlyMessage: { value: t("blueprint.script.readOnly") },
                domReadOnly: true,
                renderLineHighlight: "none",
                padding: EDITOR_PADDING,
                smoothScrolling: true,
                scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
            });
            editorRef.current = editor;
            const unwatchTheme = studio.watchStudioMonacoTheme();
            dispose = () => {
                unwatchTheme();
                editor.getModel()?.dispose();
                editor.dispose();
                editorRef.current = null;
            };
        });
        return () => {
            cancelled = true;
            dispose?.();
        };
        // `source` is deliberately absent: re-creating the editor on every read would lose the
        // author's scroll position. The effect below writes new text into the model instead.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [language, t, source === null]);

    useEffect(() => {
        const editor = editorRef.current;
        const model = editor?.getModel();
        if (!model || source === null || model.getValue() === source) {
            return;
        }
        // The view state is saved and restored around the write so a refresh keeps the reader where
        // they were, which is the whole reason this is not a fresh editor.
        const state = editor?.saveViewState() ?? null;
        model.setValue(source);
        if (state) {
            editor?.restoreViewState(state);
        }
    }, [source]);

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface">
            <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-1.5">
                <span className="truncate font-mono text-2xs text-fg-muted">{scriptRef}</span>
                {missing ? <span className="text-2xs text-danger">{t("blueprint.script.missing")}</span> : null}
                <div className="ml-auto flex items-center gap-1.5">
                    <button
                        type="button"
                        onClick={() => void read()}
                        className="flex h-6 w-6 items-center justify-center rounded-sm text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                        data-tip={t("common.refresh")}
                        aria-label={t("common.refresh")}
                    >
                        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    </button>
                    {projectPath ? <ScriptOpenMenu projectPath={projectPath} scriptRef={scriptRef} /> : null}
                </div>
            </div>
            <div className="min-h-0 flex-1 nl-editor-surface">
                <div ref={hostRef} className="h-full w-full" />
            </div>
        </div>
    );
}
