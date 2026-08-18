import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { EditorComponentProps } from "../../../types";
import { useWorkspace } from "../../../../context";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { FileSystemService } from "@/lib/workspace/services/core/FileSystem";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import {
  useTextEditorActions,
  useTextEditorLanguages,
  useTextEditorPreviews
} from "@/apps/workspace/hooks/useUIService";
import {
  textEditorContributionMatches,
  type PluginTextEditorActionDef,
  type PluginTextEditorPreviewDef
} from "@/lib/workspace/services/ui/textEditorContributions";
import { detectTextEncodingFromBom, type TextEncodingId } from "@shared/types/textEncoding";
import type {
  TextDocumentCommands,
  TextDocumentSelection
} from "@/lib/workspace/services/ui/textDocumentStatus";
// Type-only, and it has to stay that way. `./studioMonaco` reads `window` while its module body
// runs (monaco's own `base/browser/window.js` does), and this component is reachable from
// `workspaceEditorSession`, which several node-environment unit tests import - a value import here
// fails them at collection with `window is not defined`. It would also make every workspace pay
// Monaco module init at startup whether or not a text file is ever opened.
import type * as StudioMonaco from "./studioMonaco";
import { monacoLanguageForFileName, textFileExtension, type LineEnding } from "./textEditableFiles";
import { useTextEditorViewOptions } from "./useTextEditorViewOptions";
import {
  readTextDocumentPreferences,
  resolveLineEnding,
  resolveOpenEncoding,
  textPreferencePatch,
  type TextPreferenceIntent
} from "./textDocumentPreferences";
import type { TextEditorTabPayload } from "./textEditorTabId";

/** The caret, before the first read lands and after a reopen swaps the model. */
const NO_SELECTION: TextDocumentSelection = { line: 1, column: 1, characters: 0, ranges: 0 };

/**
 * Breathing room above the first line and below the last.
 *
 * Monaco's own option rather than CSS padding on the host: the host element is what monaco measures
 * to lay out lines, the gutter and the scrollbar, so padding it would leave every one of those
 * measurements a few pixels wrong - the scrollbar would end short and the last line would sit under
 * the edge. `padding` is inside monaco's own coordinate system and is the only place the space can
 * come from.
 */
const EDITOR_PADDING = { top: 12, bottom: 12 } as const;

/** House style: commit on a timer, never on the keystroke. Matches `TypeScriptBlueprintEditorPane`. */
const AUTOSAVE_DEBOUNCE_MS = 400;

/**
 * Monaco, loaded on the first text tab and shared by every one after it.
 *
 * Memoised on the promise rather than the module so two tabs opening in the same frame share one
 * load. `edcore.main`'s side effects - every editor contribution - are per module instance, which
 * is what makes sharing correct rather than merely cheap.
 */
let studioMonacoPromise: Promise<typeof StudioMonaco> | null = null;
function loadStudioMonaco(): Promise<typeof StudioMonaco> {
  studioMonacoPromise ??= import("./studioMonaco");
  return studioMonacoPromise;
}

/**
 * The built-in text editor: a Monaco instance over one `AssetType.Other` asset whose extension
 * Studio recognises as plain text (see `textEditableFiles`).
 *
 * Three decisions worth knowing before editing this file:
 *
 *  - **No worker, by construction.** This window's document is a `file://` page whose scripts are
 *    served over `app://`, so a Monaco web worker is a cross-origin request Chromium refuses. Every
 *    feature that would ask for one is off; see `WORKER_FREE_EDITOR_OPTIONS`, which is where the
 *    reasoning lives.
 *  - **Debounced autosave, no close confirmation.** Studio has no per-tab "save your changes?"
 *    anywhere, so a dirty buffer that only exists in memory is a buffer the author will lose. The
 *    tab flushes on deactivation and on unmount as well as on the timer.
 *  - **The tab has no status bar of its own.** File name, encoding, line ending and selection are
 *    cells in the *workspace* status bar; this component publishes them through
 *    `UIService.textDocumentStatus` and implements the commands they invoke. What is left here is a
 *    strip that exists only for plugin contributions, and it does not render at all when there are
 *    none - which, with no plugin installed, is always. A tab that drew its own copy of the same
 *    four values under a bar that already has room for them was the thing this replaced.
 */
export function TextEditor({ tabId, payload, active }: EditorComponentProps<TextEditorTabPayload>) {
  const { t } = useTranslation();
  const { context } = useWorkspace();
  const freeze = useFreezeGuard();
  const asset = payload?.asset;

  // Seeded from the record rather than from the defaults, so the very first frame of a GBK file's
  // status cells says GBK instead of flashing UTF-8 while the read is out.
  const recorded = useMemo(() => readTextDocumentPreferences(asset?.extras), [asset?.extras]);
  const [encoding, setEncoding] = useState<TextEncodingId>(() =>
    resolveOpenEncoding(recorded.encoding, null)
  );
  const [lineEnding, setLineEnding] = useState<LineEnding>(() =>
    resolveLineEnding("", recorded.lineEnding)
  );
  const [selection, setSelection] = useState<TextDocumentSelection>(NO_SELECTION);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * Bumped by "reopen with encoding". The load effect keys on this rather than on `asset.hash`,
   * because saving mutates the record's hash in place - keying on it would make every save
   * schedule a reload that could land on top of the next keystroke.
   */
  const [reload, setReload] = useState<{ token: number; encoding: TextEncodingId | null }>({
    token: 0,
    encoding: null
  });

  /** Set once Monaco has loaded and the editor exists; the load effect waits on it. */
  const [editorReady, setEditorReady] = useState(false);
  /**
   * Whether the bytes on disk did not survive the decode - the document contains replacement
   * characters that no round-trip can turn back into the original bytes.
   *
   * This is the *autosave interlock*, and it is the one piece of behaviour here that nothing
   * asked for up front. Opening a GBK file with no byte-order mark shows replacement characters, by
   * design (§3.3: no guessing). Combined with a 400ms autosave, one keystroke would then write
   * that lossy text back over a colleague's file and destroy it silently - which is exactly what
   * happened once during verification. So: while the decode was lossy, nothing is written
   * automatically. "Save with Encoding" still writes, because that is an author saying "yes, this
   * text, in this encoding" - and reopening under the right encoding clears the state entirely.
   */
  const [lossyDecode, setLossyDecode] = useState(false);

  // ---- plugin contributions ------------------------------------------------
  //
  // Studio registers nothing here: the Markdown grammar, the preview and any document command
  // are plugin work (`app.services.textEditor`). Everything below is therefore normally empty,
  // and the render contract is that an empty registry draws NOTHING - no greyed toggle, no
  // placeholder. A control the author cannot use is worse than an absent one.

  const extension = useMemo(() => textFileExtension(asset?.name ?? ""), [asset?.name]);
  const allLanguages = useTextEditorLanguages();
  const allPreviews = useTextEditorPreviews();
  const allActions = useTextEditorActions();

  const previews = useMemo(
    () => allPreviews.filter((def) => textEditorContributionMatches(def.extensions, extension)),
    [allPreviews, extension]
  );
  /** An action without `extensions` applies to every text document. */
  const actions = useMemo(
    () => allActions.filter((def) => textEditorContributionMatches(def.extensions, extension)),
    [allActions, extension]
  );

  /** Which preview pane is open, by id. Null - the normal state - is "editor only". */
  const [previewId, setPreviewId] = useState<string | null>(null);
  const activePreview = previews.find((def) => def.id === previewId) ?? null;
  /**
   * The buffer as the open preview sees it.
   *
   * Kept out of the editor's own change path unless a preview is actually open: mirroring every
   * keystroke into React state would re-render the tab on each character for the overwhelmingly
   * common case where nobody is looking at it.
   */
  const [previewText, setPreviewText] = useState("");
  const previewOpenRef = useRef(false);
  previewOpenRef.current = Boolean(activePreview);

  const hostRef = useRef<HTMLDivElement>(null);
  const monacoRef = useRef<typeof StudioMonaco | null>(null);
  const editorRef = useRef<StudioMonaco.monaco.editor.IStandaloneCodeEditor | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  /**
   * Gutter and wrapping, from settings. Mirrored into a ref for the same reason `encoding` is:
   * the create effect must not list them, or changing a checkbox in the Settings window would
   * dispose the editor and take the author's undo history with it.
   */
  const viewOptions = useTextEditorViewOptions();
  const viewOptionsRef = useRef(viewOptions);
  viewOptionsRef.current = viewOptions;
  /** The encoding a save should use, readable from callbacks that must not re-subscribe. */
  const encodingRef = useRef<TextEncodingId>(encoding);
  encodingRef.current = encoding;
  const lossyRef = useRef(lossyDecode);
  lossyRef.current = lossyDecode;
  /**
   * The translator, out of the load effect's dependency list.
   *
   * `t` is only there for a failure message, and it is stable today - but the load effect
   * *replaces the document from disk*, so anything in its deps is one identity change away from
   * throwing out the author's last 400ms of typing. Nothing that is not a genuine reload reason
   * belongs in that array.
   */
  const tRef = useRef(t);
  tRef.current = t;
  /**
   * The registered plugin languages, kept out of the load effect's deps for the same reason `t`
   * is: a plugin registering a grammar must never replace the document from disk under the
   * author's caret. Read at load time instead - plugins register during workspace startup, long
   * before any text tab exists, so the ref is already correct when it is consulted.
   */
  const languagesRef = useRef(allLanguages);
  languagesRef.current = allLanguages;
  /**
   * What the asset record says, out of the load effect's deps for the same reason.
   *
   * It has to be a ref specifically because saving *changes the record*: `patchAssetExtras` marks
   * the assets metadata dirty and broadcasts `updated`, so a record in the dependency array would
   * make choosing an encoding re-read the file from disk a second time, on top of the reload the
   * choice already scheduled.
   */
  const recordedRef = useRef(recorded);
  recordedRef.current = recorded;

  const assetPath = useMemo(
    () =>
      context && asset
        ? context.project.resolve(ProjectNameConvention.AssetsDataShard(asset.id))
        : null,
    [context, asset?.id]
  );

  // ---- save ---------------------------------------------------------------

  const setModified = useCallback(
    (modified: boolean) => {
      context?.services.get<UIService>(Services.UI).editor.setModified(tabId, modified);
    },
    [context, tabId]
  );

  /**
   * Write the buffer to the asset. Goes through `AssetsService.writeAssetTextContent`, never
   * straight to the file system: the record's `hash` has to move with the bytes, or every reader
   * that caches on it keeps serving the previous save.
   */
  const save = useCallback(async () => {
    const model = editorRef.current?.getModel();
    if (!context || !asset || !model) {
      return;
    }
    // A frozen workspace refuses writes by answering them as a no-op success, so a save that
    // went through would clear the dirty flag over bytes that never left memory - and this path
    // is reachable while frozen: a timer armed a moment before the freeze still flushes on
    // deactivation. The buffer stays dirty and stays on screen instead.
    if (freeze.frozen) {
      return;
    }
    const result = await context.services
      .get<AssetsService>(Services.Assets)
      .writeAssetTextContent(asset, model.getValue(), encodingRef.current);
    if (result.success) {
      setModified(false);
    } else {
      setError(result.error ?? t("assets.textEditor.saveFailed"));
    }
  }, [context, asset, setModified, t, freeze.frozen]);

  const saveRef = useRef(save);
  saveRef.current = save;

  const cancelPendingSave = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  /** Write now if a debounced save is outstanding - the deactivate and unmount path. */
  const flush = useCallback(async () => {
    if (saveTimerRef.current === null) {
      return;
    }
    cancelPendingSave();
    await saveRef.current();
  }, [cancelPendingSave]);

  const scheduleSave = useCallback(() => {
    cancelPendingSave();
    // Marked before the interlock is consulted, not after: refusing to write is not the same as
    // there being nothing to write, and a buffer that will never autosave is the one the author
    // most needs the tab to admit is unsaved. The visible signal is the encoding token, already
    // tinted `danger` by the lossy decode; the fix is one click inside it.
    setModified(true);
    if (lossyRef.current) {
      // See `lossyDecode`. An automatic write must never overwrite bytes it could not read.
      return;
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void saveRef.current();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [cancelPendingSave, setModified]);

  /**
   * The one handler on Monaco's content change: schedule the write, and - only while a preview
   * pane is open - push the buffer into React so that pane re-renders. Stable, because the
   * editor is created once for the life of the tab and this is in its dependency list.
   */
  const handleContentChanged = useCallback(() => {
    scheduleSave();
    if (previewOpenRef.current) {
      setPreviewText(editorRef.current?.getModel()?.getValue() ?? "");
    }
  }, [scheduleSave]);

  /**
   * Read the caret and the selection off the editor.
   *
   * Computed from the editor rather than from the event, so the same function answers a cursor
   * move, a drag, a multi-cursor Alt-click and a model swap identically - and so it can be called
   * directly after a reopen, where there is no event at all.
   *
   * The character count is `getValueLengthInRange`, not "end column minus start column": a
   * selection that spans lines, and one over a CJK document where a character is three bytes on
   * disk, both have to come out as the number of characters the author can see they picked.
   */
  const syncSelection = useCallback(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) {
      return;
    }
    const position = editor.getPosition();
    let characters = 0;
    let ranges = 0;
    for (const range of editor.getSelections() ?? []) {
      if (range.isEmpty()) {
        continue;
      }
      characters += model.getValueLengthInRange(range);
      ranges += 1;
    }
    setSelection({
      line: position?.lineNumber ?? 1,
      column: position?.column ?? 1,
      characters,
      ranges
    });
  }, []);

  // ---- the editor instance ------------------------------------------------

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    let cancelled = false;
    let dispose: (() => void) | null = null;

    void loadStudioMonaco().then((studio) => {
      if (cancelled) {
        return;
      }
      studio.defineStudioMonacoTheme();
      const editor = studio.monaco.editor.create(host, {
        ...studio.WORKER_FREE_EDITOR_OPTIONS,
        value: "",
        language: "plaintext",
        theme: studio.STUDIO_MONACO_THEME,
        automaticLayout: true,
        scrollBeyondLastLine: false,
        fontSize: 12,
        lineHeight: 18,
        tabSize: 4,
        // Read once here for the initial instance; the effect below keeps them current
        // without recreating the editor, which would throw away undo history.
        lineNumbers: viewOptionsRef.current.lineNumbers ? "on" : "off",
        wordWrap: viewOptionsRef.current.softWrap ? "on" : "off",
        renderWhitespace: "selection",
        renderLineHighlight: "line",
        padding: EDITOR_PADDING,
        smoothScrolling: true,
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        // Studio's own read-only affordance for a frozen workspace: the text stays
        // selectable and scrollable, which is the entire reason to open a shared plan on a
        // frozen project. Also the state until the first read lands.
        readOnly: true
      });
      // One shared, refcounted subscription across every open text tab: a Monaco theme is
      // global, so a per-tab watcher would repaint the same thing N times and add N listeners
      // to an emitter that starts warning at ten. See `watchStudioMonacoTheme`.
      const unwatchTheme = studio.watchStudioMonacoTheme();

      const changed = editor.onDidChangeModelContent(() => handleContentChanged());
      // Both, and both routed to the same reader. Monaco raises a selection change for a plain
      // caret move as well, so one of them would do for the caret - but only the selection
      // event fires when a drag *shrinks* to nothing on the same line, and only the position
      // event is guaranteed after a programmatic `setPosition`. Reading the editor rather than
      // the event makes the pair idempotent, so subscribing to both costs nothing.
      const moved = editor.onDidChangeCursorPosition(() => syncSelection());
      const selected = editor.onDidChangeCursorSelection(() => syncSelection());

      monacoRef.current = studio;
      editorRef.current = editor;
      setEditorReady(true);

      dispose = () => {
        changed.dispose();
        moved.dispose();
        selected.dispose();
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
    // Created once for the life of the tab: a re-create would drop the undo stack and the
    // caret. `handleContentChanged` is stable for the same reason.
  }, [handleContentChanged]);

  // Settings changes reach a live editor through updateOptions, never through a re-create.
  useEffect(() => {
    editorRef.current?.updateOptions({
      lineNumbers: viewOptions.lineNumbers ? "on" : "off",
      wordWrap: viewOptions.softWrap ? "on" : "off"
    });
  }, [viewOptions, editorReady]);

  // ---- loading ------------------------------------------------------------

  useEffect(() => {
    if (!context || !asset || !assetPath || !editorReady) {
      return;
    }
    let mounted = true;
    setLoading(true);
    setError(null);

    const fs = context.services.get<FileSystemService>(Services.FileSystem);
    void (async () => {
      // What the author said, then the byte-order mark, then UTF-8 - `resolveOpenEncoding`
      // owns that order and the argument for it. Nothing is guessed from the byte histogram;
      // see `detectTextEncodingFromBom`. The first read is for those three bytes, the second
      // asks the main process to decode under the answer.
      let chosen = reload.encoding;
      if (!chosen) {
        const raw = await fs.readRaw(assetPath);
        if (!mounted) {
          return;
        }
        chosen = resolveOpenEncoding(
          recordedRef.current.encoding,
          raw.ok ? detectTextEncodingFromBom(raw.data) : null
        );
      }

      const text = await fs.read(assetPath, chosen);
      if (!mounted) {
        return;
      }
      if (!text.ok) {
        setError(text.error?.message ?? tRef.current("assets.textEditor.loadFailed"));
        setLoading(false);
        return;
      }

      const editor = editorRef.current;
      const studio = monacoRef.current;
      if (!editor || !studio) {
        return;
      }
      // Content first, then the record, then the platform: a file with lines in it has already
      // answered, and only an empty one has to fall back. See `resolveLineEnding`.
      const ending = resolveLineEnding(text.data, recordedRef.current.lineEnding);
      // A plugin grammar for this extension wins over Studio's built-in mapping, and is
      // handed to Monaco here rather than when the plugin registered it: `studioMonaco` IS
      // Monaco, and installing at registration time would drag the whole editor into
      // workspace startup for every project. Falls back to the built-in mapping when the
      // grammar is malformed - a broken plugin must not stop a file opening.
      const contributed = languagesRef.current.find((def) =>
        textEditorContributionMatches(def.extensions, textFileExtension(asset.name))
      );
      const language =
        (contributed ? studio.installPluginTextEditorLanguage(contributed) : null) ??
        monacoLanguageForFileName(asset.name);
      // A fresh model rather than `setValue`: swapping the model resets the undo stack, which
      // is what a reopen means, and it does not fire `onDidChangeModelContent` - so loading a
      // document never schedules a save of what was just read.
      const next = studio.monaco.editor.createModel(text.data, language);
      next.setEOL(
        ending === "CRLF"
          ? studio.monaco.editor.EndOfLineSequence.CRLF
          : studio.monaco.editor.EndOfLineSequence.LF
      );
      const previous = editor.getModel();
      editor.setModel(next);
      previous?.dispose();

      setEncoding(chosen);
      // U+FFFD in the decoded text means the file is not in this encoding. Nothing here
      // guesses which one it is; it only refuses to write over it.
      setLossyDecode(text.data.includes("\uFFFD"));
      setLineEnding(ending);
      setSelection(NO_SELECTION);
      // Loading swaps the model without firing a content change, so an open preview would
      // otherwise keep rendering the previous document.
      setPreviewText(text.data);
      setModified(false);
      setLoading(false);
    })();

    return () => {
      mounted = false;
    };
  }, [context, asset?.id, assetPath, reload, editorReady, setModified]);

  // ---- freeze -------------------------------------------------------------

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: freeze.frozen || loading });
  }, [freeze.frozen, loading]);

  // ---- flush points -------------------------------------------------------

  useEffect(() => {
    if (active) {
      editorRef.current?.layout();
      return;
    }
    void flush();
  }, [active, flush]);

  useEffect(
    () => () => {
      // Unmount: the timer dies with the component, so the write has to be started here. It
      // is deliberately not awaited - there is nothing left to report to.
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        void saveRef.current();
      }
    },
    []
  );

  // ---- the commands the status bar invokes ---------------------------------

  /**
   * Record an author's encoding or line-ending decision on the asset, so the next person to open
   * the file - on this machine or on a colleague's - gets it without having to know.
   *
   * Three properties this has to keep, all of them easy to lose:
   *
   *  - **Opening writes nothing.** `textPreferencePatch` refuses the `"open"` intent outright, so
   *    browsing a project cannot produce a diff.
   *  - **Nothing is written that is already there.** The same function returns null for a no-op,
   *    because the assets metadata is a project file and a redundant write is a line in someone's
   *    commit.
   *  - **The record is read live, not off the payload.** `patchAssetExtras` mutates the record the
   *    metadata manager holds; the tab's payload was captured when the tab opened and can be a
   *    different object, which would make every patch compare against stale extras and rewrite
   *    what is already on disk.
   */
  const persistPreference = useCallback(
    (
      intent: TextPreferenceIntent,
      next: { encoding?: TextEncodingId; lineEnding?: LineEnding }
    ) => {
      // Frozen refuses writes at the boundary anyway; not asking keeps the freeze from
      // reporting a failed save about bookkeeping the author never asked for.
      if (!context || !asset || freeze.frozen) {
        return;
      }
      const assets = context.services.get<AssetsService>(Services.Assets);
      const live = assets.getAssets()[asset.type]?.[asset.id] ?? asset;
      const patch = textPreferencePatch(intent, live.extras, next);
      if (!patch) {
        return;
      }
      void assets.patchAssetExtras(live, patch);
    },
    [context, asset, freeze.frozen]
  );

  const reopenWith = useCallback(
    (next: TextEncodingId) => {
      void (async () => {
        // Flush first: the buffer is still in the *old* encoding, and re-reading before
        // writing would throw away whatever the last 400ms typed.
        await flush();
        persistPreference("reopen-with", { encoding: next });
        setReload((current) => ({ token: current.token + 1, encoding: next }));
      })();
    },
    [flush, persistPreference]
  );

  const saveWith = useCallback(
    (next: TextEncodingId) => {
      cancelPendingSave();
      setEncoding(next);
      encodingRef.current = next;
      // An explicit save is an author decision, so it lifts the interlock as well as writing.
      setLossyDecode(false);
      lossyRef.current = false;
      persistPreference("save-with", { encoding: next });
      void saveRef.current();
    },
    [cancelPendingSave, persistPreference]
  );

  /**
   * Convert the document's line endings and write it back.
   *
   * Through the model rather than by rewriting the text: `setEOL` is a single undoable edit that
   * leaves the caret and the selection where they were, and `getValue()` then hands the save the
   * converted string with no second pass over it. Saving immediately rather than on the debounce
   * is deliberate - this is a menu choice, not typing, and the author should be able to close the
   * tab straight after making it.
   */
  const setDocumentLineEnding = useCallback(
    (next: LineEnding) => {
      const studio = monacoRef.current;
      const model = editorRef.current?.getModel();
      if (!studio || !model || next === lineEnding) {
        return;
      }
      // The menu row is already greyed out on a frozen workspace, so this is unreachable from
      // the UI - and it is here anyway, because converting the buffer while the save is
      // refused would leave the status bar saying LF over a file that is still CRLF on disk.
      if (freeze.frozen) {
        return;
      }
      model.setEOL(
        next === "CRLF"
          ? studio.monaco.editor.EndOfLineSequence.CRLF
          : studio.monaco.editor.EndOfLineSequence.LF
      );
      setLineEnding(next);
      cancelPendingSave();
      persistPreference("set-eol", { lineEnding: next });
      void saveRef.current();
    },
    [cancelPendingSave, freeze.frozen, lineEnding, persistPreference]
  );

  /**
   * The command trio the status bar holds, stable for the life of the tab.
   *
   * Trampolines through refs rather than the callbacks themselves: the record is registered once,
   * and re-registering it every time `save` closes over a new buffer would churn the status cells
   * on every keystroke.
   */
  const commandsRef = useRef({ reopenWith, saveWith, setDocumentLineEnding });
  commandsRef.current = { reopenWith, saveWith, setDocumentLineEnding };
  const commands = useMemo<TextDocumentCommands>(
    () => ({
      reopenWith: (id) => commandsRef.current.reopenWith(id),
      saveWith: (id) => commandsRef.current.saveWith(id),
      setLineEnding: (ending) => commandsRef.current.setDocumentLineEnding(ending)
    }),
    []
  );

  // ---- publishing to the workspace status bar ------------------------------

  const statusService = useMemo(
    () => (context ? context.services.get<UIService>(Services.UI).textDocumentStatus : null),
    [context]
  );

  // Registered once per tab, with whatever the values are at mount; the effect below pushes the
  // real ones in the same commit, so there is no frame where the bar reports a default.
  const initialStatusRef = useRef({ encoding, lineEnding, fileName: asset?.name ?? "" });
  useEffect(() => {
    if (!statusService) {
      return;
    }
    return statusService.register(
      {
        tabId,
        fileName: initialStatusRef.current.fileName,
        encoding: initialStatusRef.current.encoding,
        lineEnding: initialStatusRef.current.lineEnding,
        lossy: false,
        selection: NO_SELECTION
      },
      commands
    );
  }, [statusService, tabId, commands]);

  useEffect(() => {
    statusService?.update(tabId, {
      fileName: asset?.name ?? "",
      encoding,
      lineEnding,
      lossy: lossyDecode,
      selection
    });
  }, [statusService, tabId, asset?.name, encoding, lineEnding, lossyDecode, selection]);

  // ---- plugin previews and actions ----------------------------------------

  const contributionTitle = useCallback(
    (def: PluginTextEditorPreviewDef | PluginTextEditorActionDef) =>
      def.titleKey ? t(def.titleKey) : def.title,
    [t]
  );

  const togglePreview = useCallback(
    (id: string) => {
      const opening = previewId !== id;
      setPreviewId(opening ? id : null);
      if (opening) {
        // Seed from the live buffer: the pane was not open, so no content event has been
        // filling it in and there is nothing else coming to.
        setPreviewText(editorRef.current?.getModel()?.getValue() ?? "");
      }
    },
    [previewId]
  );

  /**
   * Run a plugin's command over the open document.
   *
   * `getText`/`setText` resolve the model on each call rather than closing over it: reopening
   * with another encoding installs a *new* model, and a captured one would leave the action
   * editing a document the tab no longer shows. Writing through `setValue` goes down the normal
   * content-change path, so the edit is undoable and rides the same debounced autosave a
   * keystroke does.
   */
  const runAction = useCallback(
    (action: PluginTextEditorActionDef) => {
      if (!asset) {
        return;
      }
      void (async () => {
        try {
          await action.run({
            assetId: asset.id,
            fileName: asset.name,
            encoding: encodingRef.current,
            getText: () => editorRef.current?.getModel()?.getValue() ?? "",
            setText: (text) => editorRef.current?.getModel()?.setValue(text)
          });
        } catch (failure) {
          const message = failure instanceof Error ? failure.message : String(failure);
          setError(message || tRef.current("assets.textEditor.actionFailed"));
        }
      })();
    },
    [asset]
  );

  // ---- render -------------------------------------------------------------

  const PreviewComponent = activePreview?.component ?? null;
  /** Whether the tab's own strip has anything to be. See the render note below. */
  const strip = previews.length > 0 || actions.length > 0 || Boolean(error);

  return (
    // `.nl-editor-surface`, not `bg-surface-sunken`: this is a reading surface like the story
    // editor's prose column and the inspector, and it resolves its alpha from the same
    // `editor.surfaceOpacity` setting they do. Pinned to the opaque token, the text editor was
    // the one editor in Studio that stayed a solid black rectangle under a workspace wallpaper.
    // Monaco itself paints nothing - see `transparent` in `studioMonaco` for why the alpha
    // cannot live in `editor.background`.
    <div className="nl-editor-surface flex h-full min-h-0 flex-col" data-text-editor-tab-id={tabId}>
      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1">
          <div ref={hostRef} className="absolute inset-0" />
          {loading && (
            <div className="nl-editor-surface absolute inset-0 flex items-center justify-center text-fg-subtle">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
        </div>
        {/* A plugin's preview, beside the editor rather than instead of it: the pane is for
                    reading the result while still typing the source. Monaco's `automaticLayout`
                    reflows into the remaining half on its own. */}
        {PreviewComponent && (
          <div className="min-h-0 min-w-0 flex-1 overflow-auto border-l border-edge">
            <PreviewComponent
              text={previewText}
              encoding={encoding}
              fileName={asset?.name ?? ""}
              assetId={asset?.id ?? ""}
              active={Boolean(active)}
            />
          </div>
        )}
      </div>

      {/* The tab's own strip, which exists ONLY for plugin contributions and for a failure the
                author has to see. File name, encoding, line ending and selection are cells in the
                workspace status bar now - drawing a second copy of them here under a bar that
                already shows them is the duplication this replaced.

                With no plugin registered for this extension and nothing broken, `strip` is false and
                nothing renders at all: no border, no height, no empty row. That is the shape the
                design calls for - a tab with no bottom bar. */}
      {strip && (
        <div className="flex shrink-0 items-center gap-1.5 border-t border-edge px-3 py-1 text-2xs tabular-nums text-fg-subtle">
          {/* Toggling a preview is inspection, so it stays live on a frozen workspace; an
                        action can rewrite the document, so it does not. */}
          {previews.map((preview) => (
            <button
              key={preview.id}
              type="button"
              onClick={() => togglePreview(preview.id)}
              aria-pressed={previewId === preview.id}
              data-tip={contributionTitle(preview)}
              aria-label={contributionTitle(preview)}
              data-text-editor-preview-id={preview.id}
              className={`flex items-center gap-1 rounded-md px-1 -mx-1 transition-colors hover:bg-fill hover:text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50${
                previewId === preview.id ? " bg-fill text-fg" : ""
              }`}
            >
              {preview.icon ?? contributionTitle(preview)}
            </button>
          ))}
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => runAction(action)}
              {...freeze.writes(false, contributionTitle(action))}
              data-text-editor-action-id={action.id}
              className="flex items-center gap-1 rounded-md px-1 -mx-1 transition-colors hover:bg-fill hover:text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-subtle"
            >
              {action.icon ?? contributionTitle(action)}
            </button>
          ))}
          {error && (
            <>
              <span className="flex-1" />
              {/* A read or write that failed belongs next to the document it failed
                                on, not in a global cell that would still be reporting it after the
                                author switched tabs. It is also why the strip has this second
                                reason to exist. */}
              <span className="max-w-[24rem] truncate text-danger">{error}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
