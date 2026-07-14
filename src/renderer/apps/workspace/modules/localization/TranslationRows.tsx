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
import { Check, Plus, Trash2, TriangleAlert, Undo2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { LocalizationUnitState } from "@/lib/workspace/services/localization/localizationModel";

/** Minimal row shape both modes render; the tab supplies story/UI/key rows alike. */
export type TranslationTableRow = {
    unitId: string;
    sourceText: string;
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
        ? `${label} — ${t("workspace.localization.table.staleHint")}`
        : label;
    return (
        <span className="absolute inset-y-0 left-0 flex w-2 justify-center py-3" title={title}>
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
    onChange: (value: string) => void;
    onFocus?: () => void;
    onBlur?: () => void;
}) {
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
            className="min-h-[3.25rem] w-full resize-none overflow-hidden rounded-md border border-edge-subtle bg-transparent px-2 py-1.5 text-sm leading-relaxed text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-primary/50 focus:bg-surface-raised"
        />
    );
}

/**
 * Target-text editor shared by both modes. The `{0}…{n}` placeholder hint
 * only appears while the textarea is focused, keeping rows quiet otherwise.
 */
function TargetEditor(props: {
    row: TranslationTableRow;
    target: string;
    onTargetChange: (row: TranslationTableRow, target: string) => void;
}) {
    const { t } = useTranslation();
    const [focused, setFocused] = useState(false);

    return (
        <div className="flex min-w-0 flex-col gap-1">
            <AutosizeTextarea
                value={props.target}
                placeholder={t("workspace.localization.table.targetPlaceholder")}
                ariaLabel={t("workspace.localization.table.targetColumn")}
                onChange={value => props.onTargetChange(props.row, value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
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
 * Translate mode: a distraction-free bilingual reading row. The text itself
 * is the focal point; state lives in the quiet left indicator bar only.
 * Source text and speaker are selectable so translators can copy them.
 * Named-key rows edit their source text in place and reveal a remove
 * button on hover.
 */
export function TranslateRow(props: {
    row: TranslationTableRow;
    speaker: string;
    state: LocalizationUnitState;
    target: string;
    onTargetChange: (row: TranslationTableRow, target: string) => void;
    onSourceChange?: (row: TranslationTableRow, sourceText: string) => void;
    onRemove?: (row: TranslationTableRow) => void;
}) {
    const { t } = useTranslation();
    const sourceEditable = props.row.editableSource === true && !!props.onSourceChange;
    const removable = props.row.editableSource === true && !!props.onRemove;

    return (
        <div className="group relative grid grid-cols-2 gap-x-6 gap-y-0.5 border-b border-edge-subtle px-4 py-3 hover:bg-fill-subtle">
            <StateIndicator state={props.state} />
            <div className="col-start-1 row-start-1 truncate px-2 text-2xs text-fg-subtle">
                <span className="select-text">{props.speaker}</span>
            </div>
            {sourceEditable ? (
                <div className="col-start-1 row-start-2 min-w-0">
                    <AutosizeTextarea
                        value={props.row.sourceText}
                        placeholder={t("workspace.localization.table.keySourcePlaceholder")}
                        ariaLabel={t("workspace.localization.table.sourceColumn")}
                        onChange={value => props.onSourceChange?.(props.row, value)}
                    />
                </div>
            ) : (
                <div className="col-start-1 row-start-2 min-w-0 cursor-text select-text whitespace-pre-wrap rounded-md border border-transparent px-2 py-1.5 text-sm leading-relaxed text-fg">
                    {props.row.sourceText}
                </div>
            )}
            <div className="col-start-2 row-start-2 min-w-0">
                <TargetEditor row={props.row} target={props.target} onTargetChange={props.onTargetChange} />
            </div>
            {removable ? (
                <button
                    type="button"
                    title={t("workspace.localization.table.removeKey")}
                    className="absolute right-3 top-2 flex h-6 w-6 items-center justify-center rounded text-fg-subtle opacity-0 transition-opacity hover:bg-fill hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={() => props.onRemove?.(props.row)}
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
    speaker: string;
    state: LocalizationUnitState;
    target: string;
    onTargetChange: (row: TranslationTableRow, target: string) => void;
    onApprove: (row: TranslationTableRow) => void;
    onReturn: (row: TranslationTableRow) => void;
}) {
    const { t } = useTranslation();
    const { row, speaker, state, target } = props;
    const canApprove = state !== "reviewed" && state !== "untranslated";
    const canReturn = state === "reviewed" || state === "stale" || state === "machine";

    return (
        <div className="relative grid grid-cols-2 gap-x-6 gap-y-0.5 border-b border-edge-subtle px-4 py-3 hover:bg-fill-subtle">
            <StateIndicator state={state} />
            <div className="col-start-1 row-start-1 flex min-w-0 items-baseline gap-2 px-2">
                <span className="select-text truncate text-2xs text-fg-subtle">{speaker}</span>
                <span aria-hidden className="text-2xs text-fg-subtle">·</span>
                <span className="shrink-0 text-2xs text-fg-muted">{t(stateLabelKey(state))}</span>
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
                <TargetEditor row={row} target={target} onTargetChange={props.onTargetChange} />
                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        disabled={!canApprove}
                        onClick={() => props.onApprove(row)}
                        title={t("workspace.localization.table.markReviewed")}
                        className="inline-flex h-6 items-center gap-1.5 rounded-md bg-success/15 px-2.5 text-xs font-medium text-success transition-colors hover:bg-success/25 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-success/15"
                    >
                        <Check className="h-3.5 w-3.5" />
                        {t("workspace.localization.table.reviewApprove")}
                    </button>
                    <button
                        type="button"
                        disabled={!canReturn}
                        onClick={() => props.onReturn(row)}
                        title={t("workspace.localization.table.unmarkReviewed")}
                        className="inline-flex h-6 items-center gap-1.5 rounded-md bg-fill px-2.5 text-xs font-medium text-fg-muted transition-colors hover:bg-fill-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-fill disabled:hover:text-fg-muted"
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
    "h-7 min-w-0 rounded border border-edge bg-surface-raised px-2 text-xs text-fg outline-none placeholder:text-fg-subtle focus:border-primary/50";

/**
 * Ghost row at the end of the named-keys group (translate mode only).
 * Collapsed by default; expands into key-name + source inputs. Enter
 * submits, Escape or clicking away cancels. `onSubmit` validates and
 * returns whether the key was created (so failed submits keep the form).
 */
export function AddKeyRow(props: { onSubmit: (name: string, sourceText: string) => boolean }) {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);
    const [nameDraft, setNameDraft] = useState("");
    const [sourceDraft, setSourceDraft] = useState("");

    const cancel = () => {
        setExpanded(false);
        setNameDraft("");
        setSourceDraft("");
    };

    const submit = () => {
        if (props.onSubmit(nameDraft, sourceDraft)) {
            cancel();
        }
    };

    if (!expanded) {
        return (
            <div className="px-4 py-2">
                <button
                    type="button"
                    className="flex h-7 w-full items-center justify-center gap-1 rounded border border-dashed border-edge text-2xs text-fg-subtle transition-colors hover:border-edge-strong hover:text-fg"
                    onClick={() => setExpanded(true)}
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
                className="flex h-7 w-7 flex-none items-center justify-center rounded border border-edge text-fg-muted hover:border-primary/50 hover:text-fg"
                onClick={submit}
                title={t("workspace.localization.table.addKey")}
            >
                <Check className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}
