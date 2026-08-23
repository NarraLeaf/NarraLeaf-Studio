/**
 * Dictionary panel (right dock). The project's own vocabulary, and the two checks it drives.
 *
 * The list is a project document (`editor/dictionary.json`), so the panel is present whether or not
 * a story is open - the terms belong to the project, not to the row that happened to add one. What
 * reads it is the story editor: the spellchecker accepts every spelling here, a variant is marked
 * where it appears, and a term with a reading offers that reading wherever it is written without
 * one.
 *
 * Every field is a draft committed on blur rather than a controlled write per keystroke. The term is
 * the entry's identity, so writing per keystroke would rename it once per character; and each write
 * re-reads every open row against the dictionary, which is work for a term that is still being
 * typed.
 *
 * Comments in English per convention.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookMarked, ListChecks, Plus, Trash2 } from "lucide-react";
import {
    Button,
    CONTROL_SIZE_CLASS,
    CONTROL_SQUARE_CLASS,
    EmptyState,
    FieldLabel,
    SearchInput,
    Switch,
} from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { useWorkspace } from "@/apps/workspace/context";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { Services } from "@/lib/workspace/services/services";
import type { DictionaryService } from "@/lib/workspace/services/dictionary/DictionaryService";
import {
    DEFAULT_DICTIONARY_OPTIONS,
    type ProjectDictionaryEntry,
    type ProjectDictionaryOptions,
} from "@shared/types/dictionary";
import { useRegistry } from "@/apps/workspace/registry";
import {
    findingsByTerm,
    scanProjectForVariants,
    variantNeedles,
    type DictionaryFinding,
} from "@/lib/workspace/services/dictionary/dictionaryScan";
import { jumpToSearchTarget } from "../search/searchJump";
import type { PanelComponentProps } from "../types";
import type { DictionaryPanelPayload } from "./openDictionaryPanel";
import { isImeKeyEvent } from "@/lib/utils/imeComposition";

const FIELD_CLASS = cn(
    CONTROL_SIZE_CLASS.sm,
    "min-w-0 w-full rounded-md border border-edge bg-surface-raised px-2 text-fg outline-none focus:border-primary",
);

/** One variant per line, which is the only separator no language writes inside a word. */
function variantsToText(variants: string[] | undefined): string {
    return (variants ?? []).join("\n");
}

function textToVariants(text: string): string[] {
    return text.split("\n").map(line => line.trim()).filter(Boolean);
}

function EntryEditor(props: {
    entry: ProjectDictionaryEntry;
    onCommit: (patch: { term?: string; reading?: string | null; variants?: string[]; note?: string | null }) => void;
    onRemove: () => void;
}) {
    const { t } = useTranslation();
    const freeze = useFreezeGuard();
    const { entry } = props;
    const [term, setTerm] = useState(entry.term);
    const [reading, setReading] = useState(entry.reading ?? "");
    const [variants, setVariants] = useState(variantsToText(entry.variants));
    const [note, setNote] = useState(entry.note ?? "");

    // The entry can move under an open editor - undo, a version restored, a teammate's merge landing
    // on reload - and a draft that ignored that would write the old values back on the next blur.
    useEffect(() => {
        setTerm(entry.term);
        setReading(entry.reading ?? "");
        setVariants(variantsToText(entry.variants));
        setNote(entry.note ?? "");
    }, [entry.term, entry.reading, entry.variants, entry.note]);

    const commitTerm = () => {
        const next = term.trim();
        if (!next || next === entry.term) {
            setTerm(entry.term);
            return;
        }
        props.onCommit({ term: next });
    };

    return (
        // Labelled rather than placeheld: a placeholder is gone the moment the field has a value, and
        // four filled boxes in a narrow panel do not say which of them is the reading.
        <div className="flex flex-col border-t border-edge-subtle px-2 py-2">
            <FieldLabel>{t("dictionary.field.term")}</FieldLabel>
            <input
                className={FIELD_CLASS}
                value={term}
                readOnly={freeze.frozen}
                data-tip={freeze.frozen ? freeze.reason : undefined}
                aria-label={t("dictionary.field.term")}
                onChange={event => setTerm(event.target.value)}
                onBlur={commitTerm}
                onKeyDown={event => {
                    event.stopPropagation();
                    if (isImeKeyEvent(event)) {
                        return;
                    }
                    if (event.key === "Enter") {
                        event.currentTarget.blur();
                    }
                }}
            />
            <FieldLabel className="mt-2">{t("dictionary.field.reading")}</FieldLabel>
            <input
                className={FIELD_CLASS}
                value={reading}
                readOnly={freeze.frozen}
                data-tip={freeze.frozen ? freeze.reason : undefined}
                aria-label={t("dictionary.field.reading")}
                onChange={event => setReading(event.target.value)}
                onBlur={() => props.onCommit({ reading: reading.trim() || null })}
                onKeyDown={event => {
                    event.stopPropagation();
                    if (isImeKeyEvent(event)) {
                        return;
                    }
                    if (event.key === "Enter") {
                        event.currentTarget.blur();
                    }
                }}
            />
            <FieldLabel className="mt-2">{t("dictionary.field.variants")}</FieldLabel>
            <textarea
                rows={2}
                className={cn(
                    "min-h-0 w-full resize-y rounded-md border border-edge bg-surface-raised px-2 py-1 text-xs text-fg outline-none focus:border-primary",
                )}
                value={variants}
                readOnly={freeze.frozen}
                data-tip={freeze.frozen ? freeze.reason : undefined}
                aria-label={t("dictionary.field.variants")}
                onChange={event => setVariants(event.target.value)}
                onBlur={() => props.onCommit({ variants: textToVariants(variants) })}
                onKeyDown={event => event.stopPropagation()}
            />
            <FieldLabel className="mt-2">{t("dictionary.field.note")}</FieldLabel>
            <input
                className={FIELD_CLASS}
                value={note}
                readOnly={freeze.frozen}
                data-tip={freeze.frozen ? freeze.reason : undefined}
                aria-label={t("dictionary.field.note")}
                onChange={event => setNote(event.target.value)}
                onBlur={() => props.onCommit({ note: note.trim() || null })}
                onKeyDown={event => {
                    event.stopPropagation();
                    if (isImeKeyEvent(event)) {
                        return;
                    }
                    if (event.key === "Enter") {
                        event.currentTarget.blur();
                    }
                }}
            />
            {/* On its own line, and at the end: beside a field it reads as removing that field. */}
            <div className="mt-2 flex justify-end">
                <button
                    type="button"
                    className={cn(
                        CONTROL_SQUARE_CLASS.sm,
                        "flex shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-fill hover:text-danger disabled:cursor-not-allowed disabled:opacity-40",
                    )}
                    onClick={props.onRemove}
                    {...freeze.writes(false, t("dictionary.remove"))}
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </button>
            </div>
        </div>
    );
}

/**
 * Where one term is written the way this project does not, and a way to get there.
 *
 * Rows rather than a count, because the answer to "this term is inconsistent" is always "where" -
 * and the row it is in is the only place it can be fixed, since a replacement made from here would
 * be a project-wide edit nobody watched.
 */
function EntryFindings(props: { findings: DictionaryFinding[]; onJump: (finding: DictionaryFinding) => void }) {
    return (
        <div className="flex flex-col gap-0.5 pb-1">
            {props.findings.map((finding, index) => (
                <button
                    key={`${finding.target.blockId}:${index}`}
                    type="button"
                    onClick={() => props.onJump(finding)}
                    className={cn(
                        "flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-md border border-edge-subtle px-2 py-1",
                        "text-left text-fg-muted transition-colors duration-150",
                        "hover:border-edge hover:bg-fill hover:text-fg focus:border-primary",
                    )}
                >
                    <span className="w-full truncate text-2xs text-fg-subtle">
                        {finding.target.sceneName || finding.target.storyName}
                    </span>
                    <span className="w-full truncate text-xs">{finding.preview}</span>
                </button>
            ))}
        </div>
    );
}

export function DictionaryPanel({ payload }: PanelComponentProps<DictionaryPanelPayload>) {
    const { t, tn } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const freeze = useFreezeGuard();

    const service = useMemo<DictionaryService | null>(
        () => (context && isInitialized ? context.services.get<DictionaryService>(Services.Dictionary) : null),
        [context, isInitialized],
    );

    const [entries, setEntries] = useState<ProjectDictionaryEntry[]>([]);
    const [options, setOptions] = useState<ProjectDictionaryOptions>(DEFAULT_DICTIONARY_OPTIONS);
    const [query, setQuery] = useState("");
    const [openTerm, setOpenTerm] = useState<string | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);
    const { openEditorTab, setPanelVisibility } = useRegistry();
    /** The last check's answer, or `null` before one has been run. */
    const [findings, setFindings] = useState<DictionaryFinding[] | null>(null);
    const [scanning, setScanning] = useState<{ done: number; total: number } | null>(null);
    /**
     * Bumped to abandon a check in flight.
     *
     * A scan reads every story in the project, so it outlives the panel that started it: closing the
     * panel, switching project, or pressing the button again must not leave a second pass writing its
     * answer over the first.
     */
    const scanRef = useRef(0);

    useEffect(() => {
        if (!service) {
            setEntries([]);
            return;
        }
        const read = () => {
            try {
                setEntries(service.listEntries());
                setOptions(service.getOptions());
            } catch {
                // A recovery-mode workspace never loaded the document. An empty list is what it has.
                setEntries([]);
                setOptions(DEFAULT_DICTIONARY_OPTIONS);
            }
        };
        read();
        return service.onEntriesChanged(read);
    }, [service]);

    // A right click on a mark in a story row hands the term over. The token is what makes asking
    // twice about the same term reach here the second time.
    useEffect(() => {
        if (!payload?.term) {
            return;
        }
        setOpenTerm(payload.term);
        setQuery("");
    }, [payload?.term, payload?.revealToken]);

    useEffect(() => {
        if (!openTerm) {
            return;
        }
        // Found by reading the attribute rather than by selector: a term is arbitrary text, and a
        // quote or a bracket in one would turn a selector into a syntax error.
        const rows = listRef.current?.querySelectorAll<HTMLElement>("[data-dictionary-term]") ?? [];
        for (const row of rows) {
            if (row.dataset.dictionaryTerm === openTerm) {
                row.scrollIntoView({ block: "nearest" });
                return;
            }
        }
    }, [openTerm, entries]);

    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) {
            return entries;
        }
        return entries.filter(entry =>
            entry.term.toLowerCase().includes(needle)
            || entry.reading?.toLowerCase().includes(needle)
            || (entry.variants ?? []).some(variant => variant.toLowerCase().includes(needle)));
    }, [entries, query]);

    const addTerm = useCallback(() => {
        if (!service) {
            return;
        }
        const typed = query.trim();
        if (typed) {
            // Adding what is in the search box is the gesture that follows searching for a term and
            // finding it absent. A term that is already there is revealed instead of refused.
            service.addTerm(typed);
            setQuery("");
            setOpenTerm(typed);
            return;
        }
        // Nothing typed: a blank entry to fill in, named so it sorts to a place the author can see.
        const base = t("dictionary.newTerm");
        let candidate = base;
        let index = 2;
        while (service.hasTerm(candidate)) {
            candidate = `${base} ${index}`;
            index += 1;
        }
        service.addTerm(candidate);
        setOpenTerm(candidate);
    }, [query, service, t]);

    /** Abandon whatever is in flight when the panel goes away. */
    useEffect(() => () => {
        scanRef.current += 1;
    }, []);

    // A check answers for the dictionary it was run against. Editing one term does not tell us
    // anything about another's occurrences, but it does mean the list on screen is about a
    // dictionary that no longer exists - so it is dropped rather than left to be read as current.
    useEffect(() => {
        scanRef.current += 1;
        setScanning(null);
        setFindings(null);
    }, [service]);

    const check = useCallback(() => {
        if (!context || !service) {
            return;
        }
        const generation = scanRef.current + 1;
        scanRef.current = generation;
        let needles;
        try {
            needles = variantNeedles(service.listEntries());
        } catch {
            return;
        }
        setFindings(null);
        setScanning({ done: 0, total: 0 });
        void scanProjectForVariants(context, needles, {
            shouldContinue: () => scanRef.current === generation,
            onProgress: progress => {
                if (scanRef.current === generation) {
                    setScanning(progress);
                }
            },
        }).then(result => {
            if (scanRef.current !== generation) {
                return;
            }
            setScanning(null);
            // A partial answer is thrown away rather than shown: "nothing found" and "nothing found
            // in the half I read" are the same sentence on screen and not the same fact.
            setFindings(result.complete ? result.findings : null);
        });
    }, [context, service]);

    const byTerm = useMemo(() => findingsByTerm(findings ?? []), [findings]);

    const jump = useCallback((finding: DictionaryFinding) => {
        jumpToSearchTarget(finding.target, { openEditorTab, setPanelVisibility, context });
    }, [context, openEditorTab, setPanelVisibility]);

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-1.5 px-2 py-2">
                <SearchInput
                    size="sm"
                    fullWidth
                    value={query}
                    placeholder={t("dictionary.search")}
                    onChange={event => setQuery(event.target.value)}
                    onKeyDown={event => {
                        event.stopPropagation();
                        if (event.key === "Enter") {
                            addTerm();
                        }
                    }}
                />
                <button
                    type="button"
                    className={cn(
                        CONTROL_SQUARE_CLASS.sm,
                        "flex shrink-0 items-center justify-center rounded-md border border-edge text-fg-muted hover:border-primary/50 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40",
                    )}
                    onClick={addTerm}
                    {...freeze.writes(!service, t("dictionary.add"))}
                >
                    <Plus className="h-3.5 w-3.5" />
                </button>
            </div>

            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
                {visible.length === 0 ? (
                    <EmptyState
                        size="sm"
                        icon={<BookMarked className="h-5 w-5" />}
                        title={entries.length === 0 ? t("dictionary.empty") : t("dictionary.noMatches")}
                    />
                ) : (
                    visible.map(entry => (
                        <div key={entry.term} data-dictionary-term={entry.term}>
                            <button
                                type="button"
                                className={cn(
                                    CONTROL_SIZE_CLASS.sm,
                                    "flex w-full cursor-default items-center justify-between gap-2 px-2 text-left transition-colors",
                                    openTerm === entry.term ? "bg-fill text-fg" : "text-fg-muted hover:bg-fill hover:text-fg",
                                )}
                                aria-expanded={openTerm === entry.term}
                                onClick={() => setOpenTerm(current => (current === entry.term ? null : entry.term))}
                            >
                                <span className="truncate">{entry.term}</span>
                                {entry.reading ? (
                                    <span className="shrink-0 text-2xs text-fg-subtle">{entry.reading}</span>
                                ) : null}
                                {byTerm.has(entry.term) ? (
                                    <span className="shrink-0 text-2xs text-warning">
                                        {tn("dictionary.found", byTerm.get(entry.term)!.length, {
                                            count: byTerm.get(entry.term)!.length,
                                        })}
                                    </span>
                                ) : null}
                            </button>
                            {openTerm === entry.term && byTerm.has(entry.term) ? (
                                <EntryFindings findings={byTerm.get(entry.term)!} onJump={jump} />
                            ) : null}
                            {openTerm === entry.term ? (
                                <EntryEditor
                                    entry={entry}
                                    onCommit={patch => {
                                        if (!service?.updateEntry(entry.term, patch)) {
                                            return;
                                        }
                                        // A rename moves the entry's identity, and the row is keyed
                                        // by it - without this the editor folds shut on the
                                        // keystroke that renamed the term.
                                        if (patch.term) {
                                            setOpenTerm(patch.term);
                                        }
                                    }}
                                    onRemove={() => {
                                        service?.removeTerm(entry.term);
                                        setOpenTerm(null);
                                    }}
                                />
                            ) : null}
                        </div>
                    ))
                )}
            </div>

            <div className="border-t border-edge-subtle px-2 py-2">
                <div className="mb-1 flex items-center gap-2">
                    <Button
                        size="sm"
                        variant="secondary"
                        disabled={scanning !== null || !service}
                        onClick={check}
                    >
                        <ListChecks className="mr-1 h-3.5 w-3.5" />
                        {t("dictionary.check")}
                    </Button>
                    <span className="min-w-0 flex-1 truncate text-2xs text-fg-subtle">
                        {scanning
                            ? t("dictionary.checking", { done: String(scanning.done), total: String(scanning.total) })
                            : findings === null
                                ? ""
                                : findings.length === 0
                                    ? t("dictionary.checkClean")
                                    : tn("dictionary.found", findings.length, { count: findings.length })}
                    </span>
                </div>
                {/* A div rather than a label: the control is a button, so a label around it would
                    look clickable and do nothing. The name is on the switch itself instead. */}
                <div className="flex items-center justify-between gap-2 py-1 text-xs text-fg-muted">
                    <span className="truncate">{t("dictionary.options.suggestReadings")}</span>
                    <Switch
                        size="sm"
                        checked={options.suggestReadings}
                        disabled={freeze.frozen || !service}
                        aria-label={t("dictionary.options.suggestReadings")}
                        onCheckedChange={value => service?.setOptions({ suggestReadings: value })}
                    />
                </div>
                <div className="flex items-center justify-between gap-2 py-1 text-xs text-fg-muted">
                    <span className="truncate">{t("dictionary.options.checkVariants")}</span>
                    <Switch
                        size="sm"
                        checked={options.checkVariants}
                        disabled={freeze.frozen || !service}
                        aria-label={t("dictionary.options.checkVariants")}
                        onCheckedChange={value => service?.setOptions({ checkVariants: value })}
                    />
                </div>
            </div>
        </div>
    );
}
