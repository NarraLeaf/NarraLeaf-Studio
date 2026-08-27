/**
 * Row renderers for the translation table editor.
 * - TranslateRow: clean two-column reading view; status is a quiet 2px bar.
 *   Named-key rows additionally allow inline source editing and removal.
 * - ReviewRow: line-by-line review with prominent approve/return actions.
 * - AddKeyRow: ghost row at the end of the named-keys group to add a key.
 * Kept separate from the tab shell so each mode stays easy to reason about.
 * Comments in English per project convention.
 */

import { useLayoutEffect, useRef, useState } from "react";
import type { StoryRichRun } from "@shared/types/story";
import { InlineRuns, InlineTargetEditor } from "./TranslationInline";
import { Check, Plus, Trash2, TriangleAlert, Undo2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { LocalizationUnitState } from "@/lib/workspace/services/localization/localizationModel";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import {
    localizationKeysFreezeScope,
    TranslationClaimMark,
    translationDocumentFreezeScope,
    useLocalizationKeyClaim,
    useTranslationClaim,
} from "./localizationLiveSession";

/** Minimal row shape both modes render; the tab supplies story/UI/key rows alike. */
export type TranslationTableRow = {
    unitId: string;
    sourceText: string;
    /**
     * The source with its run tags, when the line has any. Shown in place of `sourceText` so the
     * translator can see - and copy - the styling, the pauses and the reveal-time events they are
     * being asked to place.
     */
    sourceMarkup?: string;
    /**
     * The line's own runs, when it has tags. Their presence is what puts this row on the inline
     * path: the source is drawn rather than spelled, and the translation is written in a field that
     * draws it too.
     */
    sourceRuns?: StoryRichRun[];
    interpolationCount: number;
    /** Named-key rows: the source text is editable in place (translate mode). */
    editableSource?: boolean;
    /** Named-key rows: the key's registry name (drives edit/remove callbacks). */
    keyName?: string;
};

/** Muted status tint for the row indicator bar — never a loud chip. */
const STATE_INDICATOR_CLASS: Record<LocalizationUnitState, string> = {
    untranslated: "bg-edge",
    machine: "bg-primary/40",
    translated: "bg-primary/40",
    reviewed: "bg-success/60",
    stale: "bg-warning/70",
};

export function stateLabelKey(state: LocalizationUnitState): `workspace.localization.table.${"statusUntranslated" | "statusMachine" | "statusTranslated" | "statusReviewed" | "statusStale"}` {
    switch (state) {
        case "machine":
            return "workspace.localization.table.statusMachine";
        case "translated":
            return "workspace.localization.table.statusTranslated";
        case "reviewed":
            return "workspace.localization.table.statusReviewed";
        case "stale":
            return "workspace.localization.table.statusStale";
        default:
            return "workspace.localization.table.statusUntranslated";
    }
}

/** 2px status bar on the row's left edge; the tooltip carries the details. */
function StateIndicator({ state }: { state: LocalizationUnitState }) {
    const { t } = useTranslation();
    const label = t(stateLabelKey(state));
    const title = state === "stale"
        ? `${label}: ${t("workspace.localization.table.staleHint")}`
        : label;
    return (
        <span className="absolute inset-y-0 left-0 flex w-2 justify-center py-3" data-tip={title}>
            <span aria-hidden className={`w-0.5 rounded-full ${STATE_INDICATOR_CLASS[state]}`} />
        </span>
    );
}

/**
 * Content-driven textarea shared by the target editor and the inline
 * named-key source editor: it grows to fit the full text (no inner
 * scrolling, no max height), so long lines are always readable.
 */
function AutosizeTextarea(props: {
    value: string;
    placeholder?: string;
    ariaLabel?: string;
    /**
     * The document this box writes, as the project-relative path the freeze policy takes.
     *
     * ⚠ **The two boxes this renders write different documents**, which stopped being a distinction
     * without a difference the day a live session carried one of them: a translation goes into
     * `editor/localization/<locale>.json`, which a session leaves writable, and a named key's source
     * text goes into the key registry, which it does not. A guard with no scope is frozen by any
     * freeze at all - the correct default everywhere that cannot name its document, and the wrong
     * answer for the box a translator is meant to be typing into.
     */
    freezeScope?: string;
    /** Who else is inside this line, or null. Read-only for as long as somebody is. */
    heldBy?: string | null;
    /**
     * What to say about the holder, when it is not a translation being held.
     *
     * The source column of a named-key row draws this same box over a different document, so the
     * sentence has to be that document's - "translating this line" is wrong over a source text.
     */
    heldTip?: string;
    onChange: (value: string) => void;
    onFocus?: () => void;
    onBlur?: () => void;
}) {
    const { t } = useTranslation();
    // `readOnly` rather than `disabled`, the same bargain the story-variable rows make: the text is
    // exactly what a reader of a past version came to see, and a disabled textarea is dimmed past
    // reading. Unguarded, a frozen project took the edit, showed it in the row, and threw it away on
    // thaw.
    const freeze = useFreezeGuard(props.freezeScope);
    const held = props.heldBy ?? null;
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    // Auto-size on mount and whenever the value changes (filter/mode switches
    // remount rows, so freshly visible rows measure themselves immediately).
    useLayoutEffect(() => {
        const el = textareaRef.current;
        if (!el) {
            return;
        }
        el.style.height = "auto";
        const contentHeight = el.scrollHeight;
        if (contentHeight > 0) {
            // scrollHeight excludes borders; add them so border-box height fits.
            el.style.height = `${contentHeight + el.offsetHeight - el.clientHeight}px`;
        }
    }, [props.value]);

    return (
        <textarea
            ref={textareaRef}
            value={props.value}
            placeholder={props.placeholder}
            aria-label={props.ariaLabel}
            onChange={event => props.onChange(event.target.value)}
            onFocus={props.onFocus}
            onBlur={props.onBlur}
            readOnly={freeze.frozen || held !== null}
            data-tip={freeze.frozen
                ? freeze.reason
                : held === null
                    ? undefined
                    : props.heldTip ?? t("workspace.localization.live.entryClaimed", { name: held })}
            className="min-h-[3.25rem] w-full resize-none overflow-hidden rounded-md border border-edge-subtle bg-transparent px-2 py-1.5 text-sm leading-relaxed text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-primary/50 focus:bg-surface-raised"
        />
    );
}

/**
 * Which row currently owns the inline field, and how a row asks for it.
 *
 * Held by the tab rather than by the row: one field at a time is what a windowed table of a few
 * hundred rows can afford, and it is the same arrangement the story editor's rows have.
 */
export type InlineEditing = {
    unitId: string | null;
    /** Where the pointer landed when the field was opened. `null` lands the caret at the end. */
    caret: number | null;
    onEdit: (unitId: string, caret: number | null) => void;
    onStopEdit: () => void;
    /**
     * A plain box - a line with no tags - taking or releasing the caret.
     *
     * Only a live session reads it, to hold the line while somebody is inside it. Optional because
     * the rows render outside one too, and a table that had to be told about sessions to draw a
     * translation would be the coupling this seam exists to avoid.
     */
    onFocusUnit?: (unitId: string | null) => void;
};

/**
 * Target-text editor shared by both modes.
 *
 * Two shapes, and which one a row gets is decided by the line, not by a setting. A line that carries
 * tags gets the inline field, where the styling is drawn and placed from a palette. Everything else -
 * a character name, a menu label, a line with nothing but words - keeps the plain box it always had,
 * because there is nothing for the other one to draw and a contentEditable is a worse text box.
 *
 * The placeholder hint only appears while the box has focus, keeping rows quiet otherwise.
 */
function TargetEditor(props: {
    row: TranslationTableRow;
    /** The language this table is for. What the freeze scope and the claim are addressed by. */
    locale: string;
    target: string;
    editing?: InlineEditing;
    /** Who else is translating this line, or null. */
    heldBy: string | null;
    onTargetChange: (row: TranslationTableRow, target: string) => void;
}) {
    const { t } = useTranslation();
    const [focused, setFocused] = useState(false);
    const scope = translationDocumentFreezeScope(props.locale);

    /**
     * Tell the tab which line has the field open, so the session can hold it.
     *
     * The inline field reports through `editing`, which the tab already reads; the plain box has
     * only its own focus, and this is what lifts it. Both matter: a claim asserted for one shape of
     * row and not the other is a line somebody can be written over while they are inside it.
     */
    const holdFor = (open: boolean) => {
        setFocused(open);
        props.editing?.onFocusUnit?.(open ? props.row.unitId : null);
    };

    if (props.row.sourceRuns && props.editing) {
        const editing = props.editing;
        return (
            <InlineTargetEditor
                unitId={props.row.unitId}
                sourceRuns={props.row.sourceRuns}
                target={props.target}
                editing={editing.unitId === props.row.unitId}
                caret={editing.caret}
                placeholder={t("workspace.localization.table.targetPlaceholder")}
                ariaLabel={t("workspace.localization.table.targetColumn")}
                freezeScope={scope}
                heldBy={props.heldBy}
                onEdit={caret => editing.onEdit(props.row.unitId, caret)}
                onStopEdit={editing.onStopEdit}
                onTargetChange={target => props.onTargetChange(props.row, target)}
            />
        );
    }

    return (
        <div className="flex min-w-0 flex-col gap-1">
            <AutosizeTextarea
                value={props.target}
                placeholder={t("workspace.localization.table.targetPlaceholder")}
                ariaLabel={t("workspace.localization.table.targetColumn")}
                freezeScope={scope}
                heldBy={props.heldBy}
                onChange={value => props.onTargetChange(props.row, value)}
                onFocus={() => holdFor(true)}
                onBlur={() => holdFor(false)}
            />
            {focused && props.row.interpolationCount > 0 ? (
                <div className="px-2 text-2xs leading-relaxed text-fg-subtle">
                    {`{0}…{${props.row.interpolationCount - 1}} · `}
                    {t("workspace.localization.table.placeholderHint")}
                </div>
            ) : null}
        </div>
    );
}

/**
 * The source line as the translator reads it.
 *
 * A line with tags is drawn: the emphasis is dotted, the pause is a chip, the value is a chip. That
 * is the whole of what Studio has over the `.po` file the same line would arrive in - there, run 1
 * can only ever be the characters `‹1›`.
 */
function SourceText({ row }: { row: TranslationTableRow }) {
    if (!row.sourceRuns) {
        return <>{row.sourceText}</>;
    }
    return <InlineRuns runs={row.sourceRuns} className="whitespace-pre-wrap" />;
}

/**
 * Translate mode: a distraction-free bilingual reading row. The text itself
 * is the focal point; state lives in the quiet left indicator bar only.
 * Source text and speaker are selectable so translators can copy them.
 * Named-key rows edit their source text in place and reveal a remove
 * button on hover.
 */
export function TranslateRow(props: {
    row: TranslationTableRow;
    /** The language this table is for. */
    locale: string;
    speaker: string;
    state: LocalizationUnitState;
    target: string;
    /** Present in translate mode; a row whose line carries tags edits inline through it. */
    editing?: InlineEditing;
    onTargetChange: (row: TranslationTableRow, target: string) => void;
    onSourceChange?: (row: TranslationTableRow, sourceText: string) => void;
    onRemove?: (row: TranslationTableRow) => void;
    /**
     * The source box of a named key taking or releasing focus, so a session can hold the string.
     *
     * Optional because the rows render outside a session too, and a table that had to be told about
     * one to draw a source text would be the coupling this seam exists to avoid.
     */
    onFocusKey?: (name: string | null) => void;
}) {
    const { t } = useTranslation();
    // Removing a key, and editing a key's source text, write the KEY REGISTRY rather than this
    // language's translations - a document a live session does not carry - so they are scoped to it
    // and stay off while the translations beside them stay live. The row itself and its translation
    // stay readable either way: browsing a past version is the point.
    const freeze = useFreezeGuard(localizationKeysFreezeScope());
    const heldBy = useTranslationClaim(props.row.unitId);
    // Who else has this string's SOURCE text open, which is a different document and therefore a
    // different claim from the translation beside it. Both can be held at once, by two people.
    const keyHeldBy = useLocalizationKeyClaim(props.row.keyName);
    const keyHeldTip = keyHeldBy === null
        ? undefined
        : t("workspace.localization.live.keyClaimed", { name: keyHeldBy });
    const sourceEditable = props.row.editableSource === true && !!props.onSourceChange;
    const removable = props.row.editableSource === true && !!props.onRemove;

    return (
        <div className="group relative grid grid-cols-2 gap-x-6 gap-y-0.5 border-b border-edge-subtle px-4 py-3 hover:bg-fill-subtle">
            <StateIndicator state={props.state} />
            <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-1.5 truncate px-2 text-2xs text-fg-subtle">
                <span className="select-text truncate">{props.speaker}</span>
                {/* Two marks, because the row draws two documents: the source text of a named string
                    and its translation. Two people can hold one row, one column each. */}
                {keyHeldBy ? <TranslationClaimMark account={keyHeldBy} tip={keyHeldTip} /> : null}
                {heldBy ? <TranslationClaimMark account={heldBy} /> : null}
            </div>
            {sourceEditable ? (
                <div className="col-start-1 row-start-2 min-w-0">
                    <AutosizeTextarea
                        value={props.row.sourceText}
                        placeholder={t("workspace.localization.table.keySourcePlaceholder")}
                        ariaLabel={t("workspace.localization.table.sourceColumn")}
                        freezeScope={localizationKeysFreezeScope()}
                        heldBy={keyHeldBy}
                        heldTip={keyHeldTip}
                        onFocus={() => props.onFocusKey?.(props.row.keyName ?? null)}
                        onBlur={() => props.onFocusKey?.(null)}
                        onChange={value => props.onSourceChange?.(props.row, value)}
                    />
                </div>
            ) : (
                <div className="col-start-1 row-start-2 min-w-0 cursor-text select-text whitespace-pre-wrap rounded-md border border-transparent px-2 py-1.5 text-sm leading-relaxed text-fg">
                    <SourceText row={props.row} />
                </div>
            )}
            <div className="col-start-2 row-start-2 min-w-0">
                <TargetEditor
                    row={props.row}
                    locale={props.locale}
                    target={props.target}
                    editing={props.editing}
                    heldBy={heldBy}
                    onTargetChange={props.onTargetChange}
                />
            </div>
            {removable ? (
                <button
                    type="button"
                    className="absolute right-3 top-2 flex h-6 w-6 items-center justify-center rounded-md text-fg-subtle opacity-0 transition-opacity hover:bg-fill hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={() => props.onRemove?.(props.row)}
                    {...freeze.writes(
                        // Refused for a string somebody else is inside, exactly as typing into it
                        // is: removing the row takes the sentence they were writing about it.
                        keyHeldBy !== null,
                        keyHeldTip ?? t("workspace.localization.table.removeKey"),
                    )}
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </button>
            ) : null}
        </div>
    );
}

/**
 * Review mode: same bilingual layout, plus an explicit stale notice and
 * prominent approve/return actions. The translation stays editable so
 * reviewers can fix small things in place.
 */
export function ReviewRow(props: {
    row: TranslationTableRow;
    /** The language this table is for. */
    locale: string;
    speaker: string;
    state: LocalizationUnitState;
    target: string;
    editing?: InlineEditing;
    onTargetChange: (row: TranslationTableRow, target: string) => void;
    onApprove: (row: TranslationTableRow) => void;
    onReturn: (row: TranslationTableRow) => void;
}) {
    const { t } = useTranslation();
    // Approving and returning both restate the unit in THIS language's translations, so both are
    // scoped to it: a live session leaves that document writable, and a guard with no scope would
    // grey out a reviewer's two buttons inside a session that was carrying their edits perfectly
    // well. Each keeps its own reason when the row's state is already why it is disabled.
    const freeze = useFreezeGuard(translationDocumentFreezeScope(props.locale));
    const heldBy = useTranslationClaim(props.row.unitId);
    // ⚠ Approving and returning restate the entry, so they are refused for a line somebody else is
    // inside exactly as typing into it is. Greyed with the holder's name rather than left live and
    // refused: an action taken and then thrown away is the failure the freeze guard exists to remove,
    // and a claim is the same shape of "no".
    const held = heldBy === null ? null : t("workspace.localization.live.entryClaimed", { name: heldBy });
    const { row, speaker, state, target } = props;
    const canApprove = state !== "reviewed" && state !== "untranslated";
    const canReturn = state === "reviewed" || state === "stale" || state === "machine";

    return (
        <div className="relative grid grid-cols-2 gap-x-6 gap-y-0.5 border-b border-edge-subtle px-4 py-3 hover:bg-fill-subtle">
            <StateIndicator state={state} />
            <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2 px-2">
                <span className="select-text truncate text-2xs text-fg-subtle">{speaker}</span>
                <span aria-hidden className="text-2xs text-fg-subtle">·</span>
                <span className="shrink-0 text-2xs text-fg-muted">{t(stateLabelKey(state))}</span>
                {heldBy ? <TranslationClaimMark account={heldBy} /> : null}
            </div>
            <div className="col-start-1 row-start-2 min-w-0 cursor-text select-text whitespace-pre-wrap rounded-md border border-transparent px-2 py-1.5 text-sm leading-relaxed text-fg">
                {row.sourceText}
            </div>
            <div className="col-start-2 row-start-2 flex min-w-0 flex-col gap-1.5">
                {state === "stale" ? (
                    <div className="flex items-start gap-1.5 rounded-md bg-warning/10 px-2 py-1 text-2xs leading-relaxed text-warning">
                        <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                        {t("workspace.localization.table.staleHint")}
                    </div>
                ) : null}
                <TargetEditor
                    row={row}
                    locale={props.locale}
                    target={target}
                    editing={props.editing}
                    heldBy={heldBy}
                    onTargetChange={props.onTargetChange}
                />
                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        onClick={() => props.onApprove(row)}
                        className="inline-flex h-6 items-center gap-1.5 rounded-md bg-success/15 px-2.5 text-xs font-medium text-success transition-colors hover:bg-success/25 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-success/15"
                        {...freeze.writes(!canApprove || held !== null, held ?? t("workspace.localization.table.markReviewed"))}
                    >
                        <Check className="h-3.5 w-3.5" />
                        {t("workspace.localization.table.reviewApprove")}
                    </button>
                    <button
                        type="button"
                        onClick={() => props.onReturn(row)}
                        className="inline-flex h-6 items-center gap-1.5 rounded-md bg-fill px-2.5 text-xs font-medium text-fg-muted transition-colors hover:bg-fill-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-fill disabled:hover:text-fg-muted"
                        {...freeze.writes(!canReturn || held !== null, held ?? t("workspace.localization.table.unmarkReviewed"))}
                    >
                        <Undo2 className="h-3.5 w-3.5" />
                        {t("workspace.localization.table.reviewReturn")}
                    </button>
                </div>
            </div>
        </div>
    );
}

const ADD_KEY_INPUT_CLASS =
    "h-7 min-w-0 rounded-md border border-edge bg-surface-raised px-2 text-xs text-fg outline-none placeholder:text-fg-subtle focus:border-primary/50";

/**
 * Ghost row at the end of the named-keys group (translate mode only).
 * Collapsed by default; expands into key-name + source inputs. Enter
 * submits, Escape or clicking away cancels. `onSubmit` validates and
 * returns whether the key was created (so failed submits keep the form).
 */
export function AddKeyRow(props: { onSubmit: (name: string, sourceText: string) => boolean }) {
    const { t } = useTranslation();
    // Declaring a UI key writes the localization document. Guarded at the collapsed "+" so the draft
    // row never opens - a form that accepts a name and then throws it away is the measured failure this
    // milestone exists to remove - and again at the submit, because the opener only decides whether the
    // form appears. A row already expanded when the freeze arrives keeps both its Enter keys and its
    // tick, and neither of them consults the button that is no longer on screen.
    // Scoped to the key registry, which a live session does NOT carry: declaring a UI string has no
    // verb, so it stays off for the length of a session while the translations beside it stay live.
    const freeze = useFreezeGuard(localizationKeysFreezeScope());
    const [expanded, setExpanded] = useState(false);
    const [nameDraft, setNameDraft] = useState("");
    const [sourceDraft, setSourceDraft] = useState("");

    const cancel = () => {
        setExpanded(false);
        setNameDraft("");
        setSourceDraft("");
    };

    const submit = () => {
        if (freeze.frozen) {
            return;
        }
        if (props.onSubmit(nameDraft, sourceDraft)) {
            cancel();
        }
    };

    if (!expanded) {
        return (
            <div className="px-4 py-2">
                <button
                    type="button"
                    className="flex h-7 w-full items-center justify-center gap-1 rounded-md border border-dashed border-edge text-2xs text-fg-subtle transition-colors hover:border-edge-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => setExpanded(true)}
                    {...freeze.writes()}
                >
                    <Plus className="h-3 w-3" /> {t("workspace.localization.table.addKey")}
                </button>
            </div>
        );
    }

    return (
        <div
            className="flex items-center gap-1.5 px-4 py-2"
            onKeyDown={event => {
                if (event.key === "Escape") {
                    cancel();
                } else if (event.key === "Enter") {
                    event.preventDefault();
                    submit();
                }
            }}
            onBlur={event => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    cancel();
                }
            }}
        >
            <input
                autoFocus
                className={`${ADD_KEY_INPUT_CLASS} w-48 flex-none`}
                value={nameDraft}
                placeholder={t("workspace.localization.table.keyNamePlaceholder")}
                onChange={event => setNameDraft(event.target.value)}
                aria-label={t("workspace.localization.table.keyNamePlaceholder")}
            />
            <input
                className={`${ADD_KEY_INPUT_CLASS} flex-1`}
                value={sourceDraft}
                placeholder={t("workspace.localization.table.keySourcePlaceholder")}
                onChange={event => setSourceDraft(event.target.value)}
                aria-label={t("workspace.localization.table.keySourcePlaceholder")}
            />
            <button
                type="button"
                className="flex h-7 w-7 flex-none items-center justify-center rounded-md border border-edge text-fg-muted hover:border-primary/50 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                onClick={submit}
                aria-label={t("workspace.localization.table.addKey")}
                {...freeze.writes(false, t("workspace.localization.table.addKey"))}
            >
                <Check className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}
