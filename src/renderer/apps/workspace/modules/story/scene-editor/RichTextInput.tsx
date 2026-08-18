import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ClipboardEvent, CSSProperties, KeyboardEvent } from "react";
import type { StoryInlineEvent, StoryInterpolationRef, StoryRichRun } from "@shared/types/story";
import type { StoryCaretTarget } from "./storySceneEditorTypes";
import { parseColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { useTranslation } from "@/lib/i18n";
import {
  applyMarkToRange,
  createUnitRange,
  domToRuns,
  getSelectionUnitRange,
  marksAtUnit,
  markSelectedChips,
  normalizeRuns,
  rangeHasMark,
  rangeMarkColor,
  rangeMarkRuby,
  renderRunsToElement,
  richRunsToPlain,
  rubyRunAt,
  setSelectionUnitRange,
  spliceRuns,
  totalUnits,
  unitOffsetFromPoint,
  unitOffsetOfElement,
  type ResolveAppearanceLabel,
  type ResolveInterpolationLabel,
  type RichRenderOptions
} from "./richText";
import { editKindForInputType, RichTextHistory, type RichTextSnapshot } from "./richTextHistory";
import { getInterface } from "@/lib/app/bridge";
import {
  markAtUnit,
  SpellcheckRunner,
  underlineBoxes,
  UNDERLINE_HEIGHT_PX,
  type SpellMark,
  type UnderlineBox
} from "./storySpellcheck";
import type { StorySpellcheckBinding } from "./useStorySpellcheck";

export type ActiveMarks = {
  bold: boolean;
  italic: boolean;
  color?: string;
  /**
   * The reading the ruby control would edit, and whether there is anything for it to act on.
   *
   * `ruby` is the reading shared by the selection, or — with a collapsed caret — the reading of
   * the annotated run the caret sits in. `canRuby` is separate because those are two different
   * questions: a selection can be annotated even when it carries no reading yet, and a caret
   * outside any annotated run can do nothing at all, which is what leaves the control inert.
   */
  ruby?: string;
  canRuby: boolean;
};

/**
 * The unit range the ruby control addresses, and the reading already on it.
 *
 * Resolved once, when the popover opens, and handed back at commit time - see `getRubyTarget`.
 */
export type RubyTarget = { start: number; end: number; ruby?: string };

export type PauseClickInfo = {
  unit: number;
  value: number | true;
  anchor: { top: number; left: number; bottom: number };
};

export type InterpolationClickInfo = {
  unit: number;
  value: StoryInterpolationRef;
  anchor: { top: number; left: number; bottom: number };
};

export type EventClickInfo = {
  unit: number;
  value: StoryInlineEvent;
  anchor: { top: number; left: number; bottom: number };
};

/** A right click that landed on a marked misspelling: which units it covers, and where it is drawn. */
export type SpellingClickInfo = {
  unitStart: number;
  unitEnd: number;
  word: string;
  anchor: { top: number; left: number; bottom: number };
};

export type RichTextInputHandle = {
  focus: () => void;
  toggleMark: (mark: "bold" | "italic") => void;
  setColor: (color: string) => void;
  /**
   * The range the ruby control would act on, read at the moment the popover opens. `null` when
   * there is nothing to annotate — see `canRuby`.
   */
  getRubyTarget: () => RubyTarget | null;
  /**
   * Set or clear the reading. Pass `null` to remove it.
   *
   * `target` is the range `getRubyTarget` gave the caller when the popover opened, and passing it
   * is how a commit stays pinned to the words it was typed for. Omitting it resolves the range
   * afresh, which is only right when nothing can have moved the caret in between.
   */
  setRuby: (ruby: string | null, target?: { start: number; end: number }) => void;
  insertPause: (pause: number | true) => void;
  updatePauseAt: (unit: number, pause: number | true) => void;
  removePauseAt: (unit: number) => void;
  insertInterpolation: (interp: StoryInterpolationRef) => void;
  updateInterpolationAt: (unit: number, interp: StoryInterpolationRef) => void;
  removeInterpolationAt: (unit: number) => void;
  /** Insert an event chip; returns the click-info to open its editor right away, or null if it did not land. */
  insertEvent: (event: StoryInlineEvent) => EventClickInfo | null;
  updateEventAt: (unit: number, event: StoryInlineEvent) => void;
  removeEventAt: (unit: number) => void;
  /**
   * Write `replacement` over units `[start, end)` — an accepted spelling suggestion.
   *
   * Goes through the same splice every other structural edit uses, so the correction is one entry
   * on the row's own undo stack: `Mod+Z` once puts the author's spelling back, which is the point.
   * Focus and the caret come back to the field afterwards, because accepting a suggestion is the
   * end of the detour and the author is mid-sentence.
   */
  replaceSpelling: (start: number, end: number, replacement: string) => void;
  /**
   * Current rich runs read straight from the live editor DOM (bypasses any not-yet-flushed draft).
   * Returns `null` when the editor is not mounted so callers fall back to their own state instead of
   * committing an empty edit.
   */
  getRuns: () => StoryRichRun[] | null;
};

export const RichTextInput = forwardRef<
  RichTextInputHandle,
  {
    initialRuns: StoryRichRun[];
    className?: string;
    style?: CSSProperties;
    placeholder?: string;
    /** Where the caret lands when the editor mounts. Defaults to the end (natural for entering a line). */
    initialCaret?: StoryCaretTarget;
    /** Shift+Enter — commit and open a fresh blank insert slot below (bypasses continuation). */
    onShiftEnter: () => void;
    onChange: (value: string, runs: StoryRichRun[]) => void;
    /** Enter — commit and continue with a row of the same kind (carrying the speaker). */
    onEnter: () => void;
    /** Escape — commit and leave edit mode. Exiting never discards; undo is Mod+Z's job. */
    onExit: () => void;
    onBlur: () => void;
    /**
     * `Mod+Z` with the row's own history exhausted — the author is asking to undo past the start of
     * this edit, so story history takes over. The row handles `Mod+Z` itself because
     * `KeybindingService` suppresses it inside editable fields (story undo works in whole blocks and
     * would discard the paragraph being typed).
     */
    onUndoBeyondRow?: () => void;
    /** `Mod+Shift+Z` with the row's redo stack empty. See {@link onUndoBeyondRow}. */
    onRedoBeyondRow?: () => void;
    /**
     * The caret sat at a visual boundary and the author pressed an arrow that would leave the line:
     * ArrowUp on the first visual line, ArrowDown on the last, ArrowLeft at the very start, ArrowRight
     * at the very end. The parent moves focus to the adjacent story row.
     *
     * `caretX` is the caret's viewport x as it left, which the parent keeps as the goal column and
     * hands to the row being entered.
     */
    onArrowOut?: (direction: "up" | "down" | "left" | "right", caretX: number | null) => void;
    /**
     * `Tab` / `Shift+Tab` with the caret in the field — the parent moves focus to the style toolbar
     * ("Tab advances within a row"). `backwards` is Shift+Tab, which enters the strip from its far
     * end, the way stepping backwards into any composite control does.
     *
     * Returns whether the key was taken. It has to be answerable at press time rather than assumed:
     * a row whose toolbar has scrolled out of its pane renders no strip at all, and swallowing Tab
     * there would leave the key doing nothing with no way to tell why.
     */
    onTab?: (backwards: boolean) => boolean;
    /** Backspace pressed with a collapsed caret at the start of an empty line (row demote / delete). */
    onBackspaceAtEmptyStart?: () => void;
    /**
     * The author moved the caret by something other than a vertical arrow — a horizontal arrow, a
     * click, a keystroke — so they have stated a new column and the parent's goal column is spent.
     * Fires for moves *within* the row too, which never reach {@link onArrowOut}.
     */
    onGoalColumnInvalidated?: () => void;
    /**
     * A paste carrying more than one line arrived while this row was open for editing.
     *
     * The split is here rather than at the handler because it is a fact about the field, not about the
     * story: **a row is one line.** A single-line paste is left entirely to the browser — the caret,
     * the marks the text lands in, and this row's own undo stack are all things Chromium gets right
     * and a re-implementation would only get differently. More than one line is text this field cannot
     * hold, so it goes to whoever can make rows out of it.
     *
     * Returns whether the caller took it; only then is the browser's own paste cancelled, so a handler
     * that declines still leaves the author with a working paste.
     */
    onMultiLinePaste?: (event: ClipboardEvent<HTMLDivElement>) => boolean;
    onPauseClick?: (info: PauseClickInfo) => void;
    onInterpolationClick?: (info: InterpolationClickInfo) => void;
    onEventClick?: (info: EventClickInfo) => void;
    /**
     * Spellchecking for this field. Omitted (or carrying no language), nothing is checked and the
     * overlay draws nothing.
     */
    spellcheck?: StorySpellcheckBinding;
    /** A right click landed on a marked word; the parent opens the suggestion popover over it. */
    onSpellingClick?: (info: SpellingClickInfo) => void;
    resolveInterpolationLabel?: ResolveInterpolationLabel;
    /**
     * Names the look an inline expression chip switches to. Omitted, the chip is icon-only — never an
     * id, which is the one thing a row must not show.
     */
    resolveAppearanceLabel?: ResolveAppearanceLabel;
    onActiveMarksChange?: (marks: ActiveMarks) => void;
    /**
     * Render the runs without making the element editable.
     *
     * The only property that actually stops typing: gating the commit path is not enough, because a
     * `contentEditable` element lets the browser place the caret and apply keystrokes without asking
     * Studio anything. Measured on a frozen workspace before this existed - a row took a whole typed
     * sentence, showed it, and threw it away on thaw. Chips, marks and colours still render; the
     * imperative `focus()` and the mount-time caret placement become no-ops.
     */
    readOnly?: boolean;
  }
>(function RichTextInput(props, ref) {
  const { t } = useTranslation();
  const readOnly = props.readOnly === true;
  const editorRef = useRef<HTMLDivElement | null>(null);
  const savedRange = useRef<{ start: number; end: number } | null>(null);
  const historyRef = useRef<RichTextHistory>(new RichTextHistory());
  // Set while we mutate the DOM ourselves. execCommand fires `beforeinput` too, and without this the
  // row would record the same edit twice — once here, once from the listener.
  const programmaticRef = useRef(false);
  // Caret color mirrors the color mark at the caret so authors preview the color they'll type in.
  const [caretColor, setCaretColor] = useState<string | null>(null);
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;
  const onActiveRef = useRef(props.onActiveMarksChange);
  onActiveRef.current = props.onActiveMarksChange;
  // Kept in a ref so the DOM-render callbacks stay stable while labels refresh on rename.
  const renderOptions: RichRenderOptions = {
    resolveLabel: props.resolveInterpolationLabel,
    resolveAppearance: props.resolveAppearanceLabel,
    // Editor chips open the pause / value popovers, so they read as clickable.
    interactive: true,
    titles: {
      pauseClick: t("story.richText.pauseClick"),
      pauseSeconds: (seconds) => t("story.richText.pauseSeconds", { seconds }),
      insertedValue: (name) => t("story.richText.insertedValue", { name }),
      valueFallback: t("story.richText.valueFallback"),
      expressionEvent: t("story.richText.expressionEvent"),
      soundEvent: t("story.richText.soundEvent")
    }
  };
  const renderOptionsRef = useRef(renderOptions);
  renderOptionsRef.current = renderOptions;

  useEffect(() => {
    const el = editorRef.current;
    if (!el) {
      return;
    }
    const runs = normalizeRuns(props.initialRuns);
    renderRunsToElement(el, runs, renderOptionsRef.current);
    if (readOnly) {
      // No focus and no caret: the point is that the author cannot start typing into it.
      return;
    }
    el.focus();
    // An explicit range means the author already selected this text in the read-only row and we
    // are carrying their selection across the swap into the editor; a goal column means they
    // arrowed in vertically and the caret keeps its x. Only the plain landings collapse to an edge.
    const target = props.initialCaret;
    const range = resolveInitialCaret(el, runs, target);
    setSelectionUnitRange(el, range.start, range.end);
    savedRange.current = range;
    // Render initial content once; edits are model/DOM driven from here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The spellchecker's reaction to an edit, held in a ref so `emitChange` can stay dependency-free.
   *
   * It is called from `emitChange` rather than from the `input` handler because the runs are
   * already in hand there. `domToRuns` walks and normalizes the whole row, it is the most
   * expensive thing on the typing path, and asking for it twice per keystroke to answer two
   * questions about the same text would double that for nothing.
   */
  const onSpellRunsRef = useRef<((runs: StoryRichRun[]) => void) | null>(null);

  const emitChange = useCallback(() => {
    const el = editorRef.current;
    if (!el) {
      return;
    }
    const runs = domToRuns(el);
    onChangeRef.current(richRunsToPlain(runs), runs);
    onSpellRunsRef.current?.(runs);
  }, []);

  // ---------------------------------------------------------------------------
  // Spellcheck: the marks, when they are asked for, and where they are drawn.
  // ---------------------------------------------------------------------------

  const spellLanguage = readOnly ? null : (props.spellcheck?.language ?? null);
  const spellRevision = props.spellcheck?.revision ?? 0;
  /** Answering the runner's questions without pinning it to one render's closure. */
  const spellcheckRef = useRef(props.spellcheck);
  spellcheckRef.current = props.spellcheck;
  /** The misspellings currently believed true, in unit offsets. */
  const spellMarksRef = useRef<readonly SpellMark[]>([]);
  /** Where they are drawn. The only part of this field React renders. */
  const [spellBoxes, setSpellBoxes] = useState<UnderlineBox[]>([]);
  /** What the sync effect below last handed the runner. Reset whenever a new runner is built. */
  const spellSyncRef = useRef<{ language: string | null; revision: number } | null>(null);

  /**
   * Put the current marks back under their words.
   *
   * Absolute coordinates resolve against the padding box of the nearest positioned ancestor, which
   * is exactly what `offsetParent` names — so the overlay layer and this measurement agree by
   * construction rather than by assumption, whatever the row is nested in. Expressing the boxes in
   * that space is also why scrolling costs nothing: the underlines sit inside the same scrolled
   * content as the words, and move with them without a listener.
   */
  const measureSpellMarks = useCallback(() => {
    const el = editorRef.current;
    const marks = spellMarksRef.current;
    if (!el || marks.length === 0) {
      setSpellBoxes((current) => (current.length === 0 ? current : []));
      return;
    }
    const parent = el.offsetParent as HTMLElement | null;
    const parentRect = parent?.getBoundingClientRect();
    const origin =
      parent && parentRect
        ? { left: parentRect.left + parent.clientLeft, top: parentRect.top + parent.clientTop }
        : { left: 0, top: 0 };
    const scroll = parent
      ? { left: parent.scrollLeft, top: parent.scrollTop }
      : { left: globalThis.window.scrollX, top: globalThis.window.scrollY };
    const boxes: UnderlineBox[] = [];
    for (const mark of marks) {
      const rects = createUnitRange(el, mark.unitStart, mark.unitEnd).getClientRects();
      boxes.push(...underlineBoxes(Array.from(rects), origin, scroll));
    }
    setSpellBoxes((current) => (sameBoxes(current, boxes) ? current : boxes));
  }, []);

  /**
   * The checking loop. It owns the timing and the two staleness guards; see {@link SpellcheckRunner}.
   *
   * Built in an effect and torn down with it, one runner per mount. It used to be built once into
   * the ref and disposed by an unmount cleanup, which is broken in exactly the environment the app
   * runs in: `React.StrictMode` is on whenever Studio is not packaged, so every field mounts,
   * unmounts and mounts again - and React keeps the ref across that. The throwaway unmount latched
   * `disposed` on the instance the second mount then reused, so every answer was discarded and no
   * underline was ever drawn in development. Measured in the running app, not deduced.
   *
   * Everything that varies is read through refs at the moment it is needed, so the runner never
   * closes over one render.
   */
  const spellRunnerRef = useRef<SpellcheckRunner | null>(null);
  useEffect(() => {
    const runner = new SpellcheckRunner({
      check: async (text, language) => {
        const result = await getInterface()
          .app.spellcheck.check(text, language)
          .catch(() => null);
        return result?.success ? result.data.ranges : null;
      },
      readRuns: () => (editorRef.current ? domToRuns(editorRef.current) : null),
      // Filtered here as well as in the checker, so a word the author has just taught the
      // project stops being marked on the next check rather than on whichever round trip
      // happens to carry the new list.
      isKnownWord: (word) => spellcheckRef.current?.isKnownWord(word) ?? false,
      onMarks: (marks) => {
        spellMarksRef.current = marks;
        measureSpellMarks();
      }
    });
    spellRunnerRef.current = runner;
    // Forget what the effect below last synced. This runner has never been told a language, and
    // on a remount the props have not changed - so without this it would be told nothing.
    spellSyncRef.current = null;
    return () => {
      runner.dispose();
      if (spellRunnerRef.current === runner) {
        spellRunnerRef.current = null;
      }
      spellMarksRef.current = [];
    };
  }, [measureSpellMarks]);

  const onSpellRuns = useCallback((runs: StoryRichRun[]) => {
    spellRunnerRef.current?.edited(runs);
  }, []);
  onSpellRunsRef.current = onSpellRuns;

  /**
   * The language, and every reason to ask again that the field does not cause itself: the author
   * changed the setting in another window, or taught the project a word from another row.
   *
   * One effect for both, comparing against what it last saw, because the two arrive together far
   * more often than not - the service publishes a language and bumps its revision in the same
   * breath - and two effects would put two checks in flight for one event.
   */
  useEffect(() => {
    const runner = spellRunnerRef.current;
    if (!runner) {
      return;
    }
    const previous = spellSyncRef.current;
    spellSyncRef.current = { language: spellLanguage, revision: spellRevision };
    if (!previous || previous.language !== spellLanguage) {
      runner.setLanguage(spellLanguage);
      return;
    }
    if (previous.revision !== spellRevision && spellLanguage) {
      runner.refresh();
    }
  }, [spellLanguage, spellRevision]);

  // Re-layout the field does not announce: the pane was resized, the window was, the row rewrapped
  // because something beside it grew. Scrolling is deliberately absent — see `measureSpellMarks`.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) {
      return;
    }
    const remeasure = () => measureSpellMarks();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(remeasure) : null;
    observer?.observe(el);
    globalThis.window.addEventListener("resize", remeasure);
    return () => {
      observer?.disconnect();
      globalThis.window.removeEventListener("resize", remeasure);
    };
  }, [measureSpellMarks]);

  /**
   * The marks last published to the toolbar. `onActiveMarksChange` is a `setState` on the row's edit
   * box, so calling it with a fresh object that says the same thing re-renders the box and the strip
   * for nothing — and it was being called at least twice per keystroke.
   */
  const lastMarksRef = useRef<ActiveMarks | null>(null);
  /**
   * The DOM selection the marks below were last read for.
   *
   * The same caret position gets reported twice for one keystroke — `selectionchange` on the document
   * and the field's own `keyup` — and at typing speed those land in different frames, so batching
   * alone does not merge them. The second read cannot produce a different answer: the selection has
   * not moved and the text has not changed. Skipping it halves the `queryCommand*` calls, which are
   * the most expensive thing on this path because each one makes Chromium flush style.
   *
   * Any path that *changes* something passes `force`, because a mark can change under a caret that
   * never moved: `Bold` on a collapsed caret sets the style the next characters inherit, and reading
   * "the selection is where it was" would leave the strip showing the old state.
   */
  const lastReportedSelectionRef = useRef<{
    anchorNode: Node | null;
    anchorOffset: number;
    focusNode: Node | null;
    focusOffset: number;
  } | null>(null);

  const reportActive = useCallback((force = false) => {
    try {
      const el = editorRef.current;
      const selection = globalThis.window.getSelection();
      const reported = lastReportedSelectionRef.current;
      if (
        !force &&
        selection &&
        reported &&
        reported.anchorNode === selection.anchorNode &&
        reported.anchorOffset === selection.anchorOffset &&
        reported.focusNode === selection.focusNode &&
        reported.focusOffset === selection.focusOffset
      ) {
        return;
      }
      lastReportedSelectionRef.current = selection
        ? {
            anchorNode: selection.anchorNode,
            anchorOffset: selection.anchorOffset,
            focusNode: selection.focusNode,
            focusOffset: selection.focusOffset
          }
        : null;
      const range = el ? getSelectionUnitRange(el) : null;
      if (el) {
        markSelectedChips(el, range);
      }
      let color: string | undefined;
      try {
        const raw = globalThis.document.queryCommandValue("foreColor");
        const parsed = raw ? parseColorValue(String(raw), { hex: "", alpha: 1 }) : null;
        color = parsed && parsed.hex ? parsed.hex : undefined;
      } catch {
        // queryCommandValue is best-effort in Chromium; ignore failures.
      }
      let bold = globalThis.document.queryCommandState("bold");
      let italic = globalThis.document.queryCommandState("italic");
      // Ruby has no execCommand of its own, so both answers come off the unit model. A selection
      // is always annotatable; a collapsed caret only when it is standing in a reading already.
      let ruby: string | undefined;
      let canRuby = false;
      if (el && range && range.start !== range.end) {
        // A selection can include inline value chips (contentEditable=false), which execCommand's
        // query state ignores — derive the active marks from the unit model instead.
        const runs = domToRuns(el);
        bold = rangeHasMark(runs, range.start, range.end, "bold");
        italic = rangeHasMark(runs, range.start, range.end, "italic");
        color = rangeMarkColor(runs, range.start, range.end);
        ruby = rangeMarkRuby(runs, range.start, range.end);
        canRuby = true;
      } else if (el && selection) {
        // Read off the DOM, not the unit model. This branch runs on every caret move, and
        // `domToRuns` walks and normalizes the whole row to answer a question the span the
        // caret is standing in already carries.
        const node = selection.focusNode;
        const from =
          node?.nodeType === Node.ELEMENT_NODE
            ? (node as HTMLElement)
            : (node?.parentElement ?? null);
        const host = from && el.contains(from) ? from.closest<HTMLElement>("[data-ruby]") : null;
        ruby = host && el.contains(host) ? host.dataset.ruby || undefined : undefined;
        canRuby = ruby !== undefined;
      }
      const previousMarks = lastMarksRef.current;
      if (
        !previousMarks ||
        previousMarks.bold !== bold ||
        previousMarks.italic !== italic ||
        previousMarks.color !== color ||
        previousMarks.ruby !== ruby ||
        previousMarks.canRuby !== canRuby
      ) {
        lastMarksRef.current = { bold, italic, color, ruby, canRuby };
        onActiveRef.current?.({ bold, italic, color, ruby, canRuby });
      }
      setCaretColor(color ?? null);
    } catch {
      // queryCommandState can throw when there is no selection; ignore.
    }
  }, []);

  /**
   * Ask for the toolbar's state to be brought up to date, at most once per frame.
   *
   * Every caret move fires this from two directions at once — `selectionchange` on the document and
   * the field's own `keyup`/`mouseup` — so a single keystroke ran the whole read twice. The read is
   * not free: `queryCommandState`/`queryCommandValue` each force Chromium to flush style, and they
   * were the most expensive DOM calls on the typing path (measured at 0.69ms per character between
   * them).
   *
   * A frame of latency is the right trade. Nothing about the caret's own behaviour goes through
   * here — this only decides whether the B in the style strip looks pressed.
   */
  const reportActiveFrameRef = useRef<number | null>(null);
  const reportActiveForceRef = useRef(false);
  const scheduleReportActive = useCallback(
    (force = false) => {
      reportActiveForceRef.current = reportActiveForceRef.current || force;
      if (reportActiveFrameRef.current !== null) {
        return;
      }
      reportActiveFrameRef.current = globalThis.requestAnimationFrame(() => {
        reportActiveFrameRef.current = null;
        const forced = reportActiveForceRef.current;
        reportActiveForceRef.current = false;
        reportActive(forced);
      });
    },
    [reportActive]
  );
  useEffect(
    () => () => {
      if (reportActiveFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(reportActiveFrameRef.current);
      }
    },
    []
  );

  const snapshot = useCallback((): RichTextSnapshot | null => {
    const el = editorRef.current;
    return el ? { runs: domToRuns(el), range: getSelectionUnitRange(el) } : null;
  }, []);

  /** Record the pre-edit state of a mutation we perform ourselves (a chip, a mark, an inserted value). */
  const recordStructural = useCallback(() => {
    historyRef.current.record(snapshot, { kind: "structural", now: performance.now() });
  }, [snapshot]);

  // Typing goes through `beforeinput` because it is the only point where the pre-edit state still
  // exists — `input` fires once Chromium has already changed the DOM.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) {
      return;
    }
    const onBeforeInput = (event: Event) => {
      if (programmaticRef.current) {
        return;
      }
      const input = event as InputEvent;
      // `snapshot` itself, not its result: it walks the whole field out of the DOM and measures
      // the selection, and a burst of typing coalesces into ONE undo entry — so on all but the
      // first keystroke of a burst the history would have thrown the answer away. See `record`.
      historyRef.current.record(snapshot, {
        kind: editKindForInputType(input.inputType),
        boundary: input.data === " ",
        now: performance.now()
      });
    };
    el.addEventListener("beforeinput", onBeforeInput);
    return () => el.removeEventListener("beforeinput", onBeforeInput);
  }, [snapshot]);

  const applySnapshot = useCallback(
    (state: RichTextSnapshot) => {
      const el = editorRef.current;
      if (!el) {
        return;
      }
      renderRunsToElement(el, state.runs, renderOptionsRef.current);
      if (state.range) {
        setSelectionUnitRange(el, state.range.start, state.range.end);
        savedRange.current = state.range;
      }
      emitChange();
      // Forced: undo/redo re-renders the runs, so the marks under the restored caret can differ
      // from the ones under the caret it replaced even when the two sit at the same offset.
      scheduleReportActive(true);
    },
    [emitChange, scheduleReportActive]
  );

  /** Returns false when this row has nothing left to undo, so the caller can hand off to story history. */
  const undo = useCallback((): boolean => {
    const current = snapshot();
    if (!current) {
      return false;
    }
    const previous = historyRef.current.undo(current);
    if (!previous) {
      return false;
    }
    applySnapshot(previous);
    return true;
  }, [applySnapshot, snapshot]);

  const redo = useCallback((): boolean => {
    const current = snapshot();
    if (!current) {
      return false;
    }
    const next = historyRef.current.redo(current);
    if (!next) {
      return false;
    }
    applySnapshot(next);
    return true;
  }, [applySnapshot, snapshot]);

  const saveSelection = useCallback(() => {
    const el = editorRef.current;
    if (!el) {
      return;
    }
    // The range itself is saved synchronously and always has been: `onTab` hands the caret to the
    // style strip on this very keystroke, and the strip has nothing else to read it from.
    const range = getSelectionUnitRange(el);
    if (range) {
      savedRange.current = range;
    }
    scheduleReportActive();
  }, [scheduleReportActive]);

  /**
   * Where the collapsed caret currently sits, relative to the line's edges. `atFirstLine`/`atLastLine`
   * are geometric (so wrapped or Shift+Enter multi-line text only leaves the field from the true top /
   * bottom visual line), while `atStart`/`atEnd` are exact unit offsets. Returns null when there is no
   * caret inside the editor.
   */
  const getCaretEdges = useCallback(() => {
    const el = editorRef.current;
    if (!el) {
      return null;
    }
    const selection = globalThis.window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }
    const range = selection.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) {
      return null;
    }
    const collapsed = range.collapsed;
    const unit = getSelectionUnitRange(el);
    const total = totalUnits(domToRuns(el));
    const empty = total === 0;
    const atStart = !!unit && unit.start === 0;
    const atEnd = !!unit && unit.end >= total;
    let atFirstLine = atStart;
    let atLastLine = atEnd;
    let caretX: number | null = null;
    if (empty) {
      atFirstLine = true;
      atLastLine = true;
    } else {
      const caretRect = caretClientRect(range);
      if (caretRect) {
        const elRect = el.getBoundingClientRect();
        const cs = globalThis.window.getComputedStyle(el);
        const padTop = parseFloat(cs.paddingTop) || 0;
        const padBottom = parseFloat(cs.paddingBottom) || 0;
        const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4 || 18;
        atFirstLine = caretRect.top - (elRect.top + padTop) <= lineHeight * 0.6;
        atLastLine = elRect.bottom - padBottom - caretRect.bottom <= lineHeight * 0.6;
        caretX = caretRect.left;
      }
    }
    return { collapsed, atStart, atEnd, atFirstLine, atLastLine, empty, caretX };
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      // Only a vertical arrow continues a vertical run; every other key that reaches the field is
      // the author saying where the caret goes now. Pressing a modifier on its own says nothing.
      const modifierOnly =
        event.key === "Shift" ||
        event.key === "Control" ||
        event.key === "Alt" ||
        event.key === "Meta";
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown" && !modifierOnly) {
        props.onGoalColumnInvalidated?.();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        // Always take the key: Chromium's native stack is destroyed by every rich-text re-render, so
        // letting it through would undo into a state the row no longer agrees with.
        event.preventDefault();
        if (event.shiftKey ? redo() : undo()) {
          return;
        }
        (event.shiftKey ? props.onRedoBeyondRow : props.onUndoBeyondRow)?.();
        return;
      }
      if (event.key === "Tab" && props.onTab) {
        // Hand the caret over BEFORE focus leaves. The toolbar gives the line back on Escape and
        // every one of its commands applies to a selection, but a contentEditable that has lost
        // focus has no selection left to read — `savedRange` is the only copy, and `onBlur` saves
        // it too late for a handler that runs on this keystroke.
        saveSelection();
        if (props.onTab(event.shiftKey)) {
          event.preventDefault();
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        props.onExit();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        // Enter continues the same kind of row, Shift+Enter opens a blank one. Neither inserts a
        // line break: a row is one line, and a soft break inside it had no way in from the insert
        // slot anyway, so the two halves of writing a line disagreed on what the key meant.
        event.shiftKey ? props.onShiftEnter() : props.onEnter();
        return;
      }
      if (event.key === "Backspace" && props.onBackspaceAtEmptyStart) {
        const edges = getCaretEdges();
        if (edges && edges.collapsed && edges.empty) {
          event.preventDefault();
          props.onBackspaceAtEmptyStart();
          return;
        }
      }
      if (!props.onArrowOut) {
        return;
      }
      const isArrow =
        event.key === "ArrowUp" ||
        event.key === "ArrowDown" ||
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight";
      if (!isArrow || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
        return;
      }
      const edges = getCaretEdges();
      if (!edges || !edges.collapsed) {
        return;
      }
      const leaves =
        (event.key === "ArrowUp" && edges.atFirstLine) ||
        (event.key === "ArrowDown" && edges.atLastLine) ||
        (event.key === "ArrowLeft" && edges.atStart) ||
        (event.key === "ArrowRight" && edges.atEnd);
      if (!leaves) {
        return;
      }
      event.preventDefault();
      props.onArrowOut(
        event.key === "ArrowUp"
          ? "up"
          : event.key === "ArrowDown"
            ? "down"
            : event.key === "ArrowLeft"
              ? "left"
              : "right",
        edges.caretX
      );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [
      getCaretEdges,
      saveSelection,
      props.onArrowOut,
      props.onBackspaceAtEmptyStart,
      props.onExit,
      props.onEnter,
      props.onShiftEnter,
      props.onTab,
      props.onUndoBeyondRow,
      props.onRedoBeyondRow,
      undo,
      redo
    ]
  );

  // Keep the toolbar's active state in sync as the caret / selection moves.
  useEffect(() => {
    const onSelectionChange = () => {
      const el = editorRef.current;
      const selection = globalThis.window.getSelection();
      if (
        el &&
        selection &&
        selection.rangeCount > 0 &&
        el.contains(selection.getRangeAt(0).commonAncestorContainer)
      ) {
        scheduleReportActive();
      }
    };
    globalThis.document.addEventListener("selectionchange", onSelectionChange);
    return () => globalThis.document.removeEventListener("selectionchange", onSelectionChange);
  }, [scheduleReportActive]);

  /**
   * Apply a bold/italic/color mark. For a real selection we go through the unit model so inline value
   * chips get styled too (execCommand can't touch contentEditable=false chips); a collapsed caret keeps
   * execCommand's "typing state" so the next typed characters inherit the style.
   */
  const applyMark = useCallback(
    (mark: "bold" | "italic" | "color", color?: string) => {
      const el = editorRef.current;
      if (!el) {
        return;
      }
      el.focus();
      let range = getSelectionUnitRange(el);
      if (!range && savedRange.current) {
        // Focus was on a portal popover (color palette); restore the last real selection.
        setSelectionUnitRange(el, savedRange.current.start, savedRange.current.end);
        range = savedRange.current;
      }
      if (!range) {
        return;
      }
      if (range.start === range.end) {
        // Nothing to record: a collapsed caret only sets the style the *next* characters inherit, and
        // that typing records itself. The guard is for execCommand's own `beforeinput`.
        programmaticRef.current = true;
        try {
          globalThis.document.execCommand("styleWithCSS", false, "true");
          globalThis.document.execCommand(
            mark === "color" ? "foreColor" : mark,
            false,
            mark === "color" ? color : undefined
          );
        } catch {
          // execCommand is best-effort in Chromium; ignore failures.
        } finally {
          programmaticRef.current = false;
        }
        saveSelection();
        // The caret has not moved — only the style the next characters will inherit has changed —
        // so the "same selection, same answer" shortcut has to be told this one is different.
        scheduleReportActive(true);
        emitChange();
        return;
      }
      recordStructural();
      const runs = domToRuns(el);
      let next: StoryRichRun[];
      if (mark === "color") {
        const value = color || undefined;
        next = applyMarkToRange(runs, range.start, range.end, (marks) => ({
          ...marks,
          color: value
        }));
      } else {
        const active = rangeHasMark(runs, range.start, range.end, mark);
        next = applyMarkToRange(runs, range.start, range.end, (marks) => ({
          ...marks,
          [mark]: active ? undefined : true
        }));
      }
      renderRunsToElement(el, next, renderOptionsRef.current);
      setSelectionUnitRange(el, range.start, range.end);
      saveSelection();
      scheduleReportActive(true);
      emitChange();
    },
    [emitChange, recordStructural, saveSelection, scheduleReportActive]
  );

  /**
   * The words the ruby control is addressing: the selection, or — with a collapsed caret — the
   * whole annotated run the caret is standing in. `null` when there is nothing to annotate.
   *
   * The popover reads this once, on the way in, and hands it back on the way out. Deriving it
   * again at commit time would read the selection as it stands *then*, and the ordinary exit is a
   * click back into the sentence: the caret has moved by the time the draft lands, so the reading
   * would be written over whatever was clicked, or — a caret outside any annotated run — dropped
   * without a word, which is the one outcome a draft popover exists to prevent.
   */
  const resolveRubyTarget = useCallback((): RubyTarget | null => {
    const el = editorRef.current;
    if (!el) {
      return null;
    }
    const selection = getSelectionUnitRange(el) ?? savedRange.current;
    if (!selection) {
      return null;
    }
    const runs = domToRuns(el);
    if (selection.start !== selection.end) {
      return { ...selection, ruby: rangeMarkRuby(runs, selection.start, selection.end) };
    }
    return rubyRunAt(runs, selection.start);
  }, []);

  /**
   * Set or clear the reading over `target`, or over whatever {@link resolveRubyTarget} finds when
   * the caller has none. `null` removes it.
   *
   * Unlike {@link applyMark} this must never focus the editor: the reading is typed in a popover,
   * and dragging focus back here would end the author's typing at the first character. The caret
   * is only restored when the editor still holds focus.
   *
   * `textOnly` because a reading belongs to characters the author wrote. See
   * {@link applyMarkToRange}.
   */
  const setRuby = useCallback(
    (ruby: string | null, target?: { start: number; end: number }) => {
      const el = editorRef.current;
      if (!el) {
        return;
      }
      const range = target ?? resolveRubyTarget();
      if (!range) {
        return;
      }
      const runs = domToRuns(el);
      const value = ruby?.trim() || undefined;
      if (value === rangeMarkRuby(runs, range.start, range.end)) {
        // Closing the popover having changed nothing is the common exit. Rendering anyway would
        // cost an undo entry for an edit that never happened.
        return;
      }
      recordStructural();
      const next = applyMarkToRange(
        runs,
        range.start,
        range.end,
        (marks) => ({ ...marks, ruby: value }),
        { textOnly: true }
      );
      renderRunsToElement(el, next, renderOptionsRef.current);
      if (globalThis.document.activeElement === el) {
        setSelectionUnitRange(el, range.start, range.end);
        saveSelection();
      } else {
        savedRange.current = { start: range.start, end: range.end };
      }
      scheduleReportActive(true);
      emitChange();
    },
    [emitChange, recordStructural, resolveRubyTarget, saveSelection, scheduleReportActive]
  );

  // Splice by explicit unit range without focusing the editor (so a pause popover's input keeps
  // focus). Caret is only restored when the editor already holds focus.
  const spliceUnits = useCallback(
    (start: number, deleteCount: number, insert: StoryRichRun[], caretAfter: boolean) => {
      const el = editorRef.current;
      if (!el) {
        return;
      }
      recordStructural();
      const runs = spliceRuns(domToRuns(el), start, start + deleteCount, insert);
      renderRunsToElement(el, runs, renderOptionsRef.current);
      if (globalThis.document.activeElement === el) {
        const pos = caretAfter ? start + insert.length : start;
        setSelectionUnitRange(el, pos, pos);
      }
      emitChange();
    },
    [emitChange, recordStructural]
  );

  const insertRun = useCallback(
    (run: StoryRichRun): number | null => {
      const el = editorRef.current;
      if (!el) {
        return null;
      }
      el.focus();
      const range = getSelectionUnitRange(el) ?? savedRange.current;
      if (!range) {
        return null;
      }
      recordStructural();
      const runs = spliceRuns(domToRuns(el), range.start, range.end, [run]);
      renderRunsToElement(el, runs, renderOptionsRef.current);
      setSelectionUnitRange(el, range.start + 1, range.start + 1);
      savedRange.current = { start: range.start + 1, end: range.start + 1 };
      emitChange();
      // The unit the run was spliced in at - callers auto-opening its editor need it.
      return range.start;
    },
    [emitChange, recordStructural]
  );

  const insertPause = useCallback(
    (pause: number | true) => {
      insertRun({ pause });
    },
    [insertRun]
  );
  const insertInterpolation = useCallback(
    (interp: StoryInterpolationRef) => {
      insertRun({ interpolation: interp });
    },
    [insertRun]
  );
  /**
   * Insert an event chip and return the info needed to open its editor immediately (unit + the fresh
   * chip's screen anchor), so the toolbar's insert-then-edit flow is one motion. Returns null when
   * the insert did not land (no editor / no caret) or the rendered chip cannot be located.
   */
  const insertEvent = useCallback(
    (event: StoryInlineEvent): EventClickInfo | null => {
      const unit = insertRun({ event });
      const el = editorRef.current;
      if (unit === null || !el) {
        return null;
      }
      // The just-rendered chip is the [data-event] at this unit offset; measure it for the anchor
      // the popover positions against, mirroring the click path.
      const chip = Array.from(el.querySelectorAll<HTMLElement>("[data-event]")).find(
        (candidate) => unitOffsetOfElement(el, candidate) === unit
      );
      if (!chip) {
        return null;
      }
      const rect = chip.getBoundingClientRect();
      return {
        unit,
        value: event,
        anchor: { top: rect.top, left: rect.left, bottom: rect.bottom }
      };
    },
    [insertRun]
  );

  /**
   * Write an accepted suggestion over the word it corrects.
   *
   * The replacement inherits the marks of the run it replaces: a misspelled word can be bold,
   * coloured or annotated like any other, and a bare splice would leave the one word the author
   * fixed as a hole in the styling of the sentence.
   *
   * Unlike the ruby and pause popovers, this one takes focus back. Accepting a suggestion ends the
   * detour — there is nothing else to say about the word — so the caret returns to just after the
   * correction, where the author would have put it themselves.
   */
  const replaceSpelling = useCallback(
    (start: number, end: number, replacement: string) => {
      const el = editorRef.current;
      if (!el || readOnly || end <= start || !replacement) {
        return;
      }
      recordStructural();
      const runs = domToRuns(el);
      const marks = marksAtUnit(runs, start);
      const next = spliceRuns(runs, start, end, [
        marks ? { text: replacement, marks } : { text: replacement }
      ]);
      renderRunsToElement(el, next, renderOptionsRef.current);
      const caret = start + replacement.length;
      savedRange.current = { start: caret, end: caret };
      el.focus();
      setSelectionUnitRange(el, caret, caret);
      scheduleReportActive(true);
      emitChange();
    },
    [emitChange, readOnly, recordStructural, scheduleReportActive]
  );

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        const el = editorRef.current;
        // Read-only: refuse focus outright. The parent still calls this from the toolbar and popover
        // paths, and focusing a non-editable div would put a visible focus ring on something that
        // takes no input.
        if (!el || readOnly) {
          return;
        }
        el.focus();
        // Restore the caret whatever stole focus interrupted (a pause / value popover, a toolbar
        // press). Plain `focus()` on a contentEditable drops the caret at the start, silently
        // moving the author's insertion point to somewhere they never put it.
        const saved = savedRange.current;
        if (saved) {
          setSelectionUnitRange(el, saved.start, saved.end);
        }
      },
      toggleMark: (mark) => applyMark(mark),
      setColor: (color) => applyMark("color", color),
      getRubyTarget: resolveRubyTarget,
      setRuby,
      insertPause,
      updatePauseAt: (unit, pause) => spliceUnits(unit, 1, [{ pause }], true),
      removePauseAt: (unit) => spliceUnits(unit, 1, [], false),
      insertInterpolation,
      updateInterpolationAt: (unit, interp) =>
        spliceUnits(unit, 1, [{ interpolation: interp }], true),
      removeInterpolationAt: (unit) => spliceUnits(unit, 1, [], false),
      insertEvent,
      updateEventAt: (unit, event) => spliceUnits(unit, 1, [{ event }], true),
      removeEventAt: (unit) => spliceUnits(unit, 1, [], false),
      replaceSpelling,
      getRuns: () => (editorRef.current ? domToRuns(editorRef.current) : null)
    }),
    [
      applyMark,
      insertPause,
      insertInterpolation,
      insertEvent,
      readOnly,
      replaceSpelling,
      resolveRubyTarget,
      setRuby,
      spliceUnits
    ]
  );

  return (
    <>
      <div
        ref={editorRef}
        className={props.className}
        style={{ ...props.style, caretColor: caretColor ?? undefined }}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        // No `spellCheck` attribute, deliberately. Chromium's own checker is switched off across
        // the app (`@shared/types/spellcheck`), so asking it to check would draw nothing; the
        // squiggles below are Studio's, over text Studio checked.
        onContextMenu={(event) => {
          if (readOnly) {
            return;
          }
          // A right click on a marked word asks about that word, and that is the only claim
          // this field makes on the gesture. Everything else is left to bubble: the row skips
          // a right click that landed inside the open field (see `StoryBlockRow`), so what
          // reaches the workspace is the editable-text menu — cut, copy, paste — as before.
          //
          // Blink's own menu request no longer matters either way. It used to be the one
          // channel carrying the spellchecker's verdict, which is why this handler was once
          // careful never to prevent the default; there is now no checker under the page to
          // have a verdict, and the suggestions come from the main process on request.
          const el = editorRef.current;
          if (!el || !props.onSpellingClick || spellMarksRef.current.length === 0) {
            return;
          }
          const unit = unitOffsetFromPoint(el, event.clientX, event.clientY);
          const mark = unit === null ? null : markAtUnit(spellMarksRef.current, unit);
          if (!mark) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          const rect = createUnitRange(el, mark.unitStart, mark.unitEnd).getBoundingClientRect();
          props.onSpellingClick({
            unitStart: mark.unitStart,
            unitEnd: mark.unitEnd,
            word: mark.word,
            anchor: { top: rect.top, left: rect.left, bottom: rect.bottom }
          });
        }}
        role="textbox"
        aria-multiline="false"
        aria-readonly={readOnly || undefined}
        data-placeholder={props.placeholder ?? ""}
        onClick={(event) => {
          event.stopPropagation();
          const el = editorRef.current;
          const chip = (event.target as HTMLElement).closest?.(
            "[data-pause]"
          ) as HTMLElement | null;
          if (el && chip && el.contains(chip) && props.onPauseClick) {
            const rect = chip.getBoundingClientRect();
            props.onPauseClick({
              unit: unitOffsetOfElement(el, chip),
              value: chip.dataset.pause === "click" ? true : Number(chip.dataset.pause) || true,
              anchor: { top: rect.top, left: rect.left, bottom: rect.bottom }
            });
          }
          const interpChip = (event.target as HTMLElement).closest?.(
            "[data-interp]"
          ) as HTMLElement | null;
          if (el && interpChip && el.contains(interpChip) && props.onInterpolationClick) {
            let value: StoryInterpolationRef | null = null;
            try {
              value = JSON.parse(interpChip.dataset.interp ?? "") as StoryInterpolationRef;
            } catch {
              value = null;
            }
            if (value) {
              const rect = interpChip.getBoundingClientRect();
              props.onInterpolationClick({
                unit: unitOffsetOfElement(el, interpChip),
                value,
                anchor: { top: rect.top, left: rect.left, bottom: rect.bottom }
              });
            }
          }
          const eventChip = (event.target as HTMLElement).closest?.(
            "[data-event]"
          ) as HTMLElement | null;
          if (el && eventChip && el.contains(eventChip) && props.onEventClick) {
            let value: StoryInlineEvent | null = null;
            try {
              value = JSON.parse(eventChip.dataset.event ?? "") as StoryInlineEvent;
            } catch {
              value = null;
            }
            if (value) {
              const rect = eventChip.getBoundingClientRect();
              props.onEventClick({
                unit: unitOffsetOfElement(el, eventChip),
                value,
                anchor: { top: rect.top, left: rect.left, bottom: rect.bottom }
              });
            }
          }
        }}
        onInput={() => {
          emitChange();
          // Forced, because an edit can change the marks under a caret that never moved — and
          // the caret's own NODE can survive it. Chromium's native Ctrl+B wraps the existing
          // text node in a <b> rather than replacing it, so anchorNode/anchorOffset come back
          // identical and the "same selection, same answer" shortcut in `reportActive` would
          // skip the one read that mattered: the strip stayed unpressed on the keystroke that
          // pressed it, then caught up on the next caret move. Every browser-driven edit
          // (native formatting, paste, drop, IME) arrives here and nowhere else.
          scheduleReportActive(true);
        }}
        onPaste={(event) => {
          if (readOnly || !props.onMultiLinePaste) {
            return;
          }
          if (!/\r?\n/.test(event.clipboardData.getData("text/plain").trim())) {
            return;
          }
          if (props.onMultiLinePaste(event)) {
            event.preventDefault();
          }
        }}
        onKeyUp={saveSelection}
        // Clicking into the text states a column as plainly as an arrow does. The row's own
        // mousedown never sees this: a contentEditable counts as an interactive target.
        onMouseUp={() => {
          saveSelection();
          props.onGoalColumnInvalidated?.();
        }}
        onBlur={() => {
          saveSelection();
          props.onBlur();
        }}
        onKeyDown={handleKeyDown}
      />
      {spellBoxes.length > 0 ? (
        /*
         * The underlines, as a sibling of the field rather than as spans inside it.
         *
         * Inside is not an option: the document is runs and marks, so a span added to carry a
         * decoration would round-trip to disk, split runs the author never split, and stand in
         * the caret's way. A sibling shares the field's containing block, which is what lets the
         * boxes be laid out in the same coordinate space the words are.
         *
         * Inert, and aria-hidden. The squiggle is three pixels tall and sits exactly where a
         * click lands when the author aims at the bottom of a line; a strip that took the
         * pointer would refuse the caret to the one word they most want to edit. The suggestions
         * are reached by right-clicking the word, which hit-tests the text underneath.
         */
        <div className="story-rt-spell-layer" aria-hidden="true">
          {spellBoxes.map((box, index) => (
            <span
              key={`${box.top}:${box.left}:${index}`}
              className="story-rt-spell"
              style={{
                left: box.left,
                top: box.top,
                width: box.width,
                height: UNDERLINE_HEIGHT_PX
              }}
            />
          ))}
        </div>
      ) : null}
    </>
  );
});

/** Whether two measured sets of underlines are the same, so an unchanged layout costs no render. */
function sameBoxes(a: readonly UnderlineBox[], b: readonly UnderlineBox[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (box, index) =>
        box.left === b[index].left && box.top === b[index].top && box.width === b[index].width
    )
  );
}

/**
 * The unit range the caret opens at.
 *
 * A goal column arrives as a viewport x plus the visual line to land on, and is resolved against
 * this row's own text: aim at the middle of that line, clamped inside the field so an x from a
 * longer row (or a row starting further left — a dialogue's text is indented past its nametag)
 * still lands on the nearest character rather than missing the box entirely. Anything unresolvable
 * degrades to the line's own edge, which is the pre-goal-column behaviour.
 */
function resolveInitialCaret(
  el: HTMLElement,
  runs: StoryRichRun[],
  target: StoryCaretTarget | undefined
): { start: number; end: number } {
  const edge = (position: number) => ({ start: position, end: position });
  if (target && typeof target === "object" && "goalX" in target) {
    const total = totalUnits(runs);
    if (total === 0) {
      return edge(0);
    }
    const rect = el.getBoundingClientRect();
    const cs = globalThis.window.getComputedStyle(el);
    const padTop = parseFloat(cs.paddingTop) || 0;
    const padBottom = parseFloat(cs.paddingBottom) || 0;
    const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4 || 18;
    const y =
      target.line === "first"
        ? rect.top + padTop + lineHeight / 2
        : rect.bottom - padBottom - lineHeight / 2;
    const x = Math.min(Math.max(target.goalX, rect.left + 1), rect.right - 1);
    const offset = unitOffsetFromPoint(el, x, y);
    return offset === null
      ? edge(target.line === "first" ? 0 : total)
      : edge(Math.min(offset, total));
  }
  if (typeof target === "object") {
    return target;
  }
  return edge(target === "start" ? 0 : totalUnits(runs));
}

/** Bounding rect of a (usually collapsed) caret range, tolerant of Chromium's empty-rect edge cases. */
function caretClientRect(range: Range): DOMRect | null {
  const rect = range.getBoundingClientRect();
  if (rect && (rect.height > 0 || rect.width > 0 || rect.top !== 0 || rect.bottom !== 0)) {
    return rect;
  }
  const rects = range.getClientRects();
  return rects.length > 0 ? rects[0] : null;
}
