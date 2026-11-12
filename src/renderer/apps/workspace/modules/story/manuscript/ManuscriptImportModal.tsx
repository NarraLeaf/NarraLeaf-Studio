import { useMemo, useState } from "react";
import { Select, type SelectOption } from "@/lib/components/elements/Select";
import { Checkbox } from "@/lib/components/elements/Checkbox";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import type { XlsxSheet } from "@shared/manuscript/officeRead";
import type { Character } from "@/lib/workspace/services/character/Character";
import type { PastePlan, SpeakerMappingTarget, StoryPasteMemory } from "@/lib/story/paste/storyPasteTypes";
import { inferPasteSeparator } from "@/lib/story/paste/storyPasteModel";
import {
    guessTableMapping,
    proseSourceText,
    structuredSourceSplit,
    tableColumnCount,
    tableToSource,
    type ManuscriptImportSource,
    type TableColumnRole,
    type TableMapping,
} from "@/lib/story/manuscript/manuscriptImport";
import { StoryPasteWizardModal } from "../scene-editor/StoryPasteWizardModal";

/**
 * What a picked file was read as. A table keeps its raw rows, because which column is which is a
 * question the author answers in the dialog; the other two are already a source.
 */
export type ManuscriptImportFile =
    | { kind: "source"; source: ManuscriptImportSource }
    | { kind: "table"; sheets: XlsxSheet[] };

export type ManuscriptImportRequest = {
    fileName: string;
    file: ManuscriptImportFile;
};

const ROLES: readonly TableColumnRole[] = ["speaker", "text", "note", "scene"];

/**
 * A script file through the paste wizard.
 *
 * The wizard is the same dialog a paste opens: the speaker table, the memory, the preview. A file
 * with its own speakers (Fountain cues, a speaker column) hands it a ready split and the separator
 * controls go away; a Word manuscript is prose and keeps them. A spreadsheet adds its column picker
 * above the speaker table, since which column is the speaker is the one thing the file cannot say.
 */
export function ManuscriptImportModal(props: {
    request: ManuscriptImportRequest;
    characters: Character[];
    memory: StoryPasteMemory;
    busy: boolean;
    onSaveSeparator: Parameters<typeof StoryPasteWizardModal>[0]["onSaveSeparator"];
    onForgetSeparator: Parameters<typeof StoryPasteWizardModal>[0]["onForgetSeparator"];
    onCancel: () => void;
    onConfirm: (source: ManuscriptImportSource, plan: PastePlan, authoredMappings: Record<string, SpeakerMappingTarget>) => void;
}) {
    const { t, tn } = useTranslation();
    const { file } = props.request;
    const sheets = file.kind === "table" ? file.sheets : [];
    const [sheetIndex, setSheetIndex] = useState(() => Math.max(0, sheets.findIndex(sheet => sheet.rows.length > 0)));
    const rows = sheets[sheetIndex]?.rows ?? [];
    const [mapping, setMapping] = useState<TableMapping>(() => guessTableMapping(rows));

    const source = useMemo<ManuscriptImportSource>(
        () => (file.kind === "source" ? file.source : tableToSource(rows, mapping)),
        [file, rows, mapping],
    );
    const presplit = useMemo(() => (source.kind === "structured" ? structuredSourceSplit(source) : undefined), [source]);
    const proseText = source.kind === "prose" ? proseSourceText(source) : "";
    const inferred = useMemo(() => inferPasteSeparator(proseText), [proseText]);

    const columnOptions = useMemo<SelectOption[]>(() => {
        const header = mapping.headerRow ? rows[0] ?? [] : [];
        const options: SelectOption[] = [{ value: "none", label: t("manuscript.table.none") }];
        for (let column = 0; column < tableColumnCount(rows); column += 1) {
            const name = header[column]?.trim();
            options.push({
                value: String(column),
                label: name
                    ? t("manuscript.table.columnNamed", { n: column + 1, name })
                    : t("manuscript.table.column", { n: column + 1 }),
            });
        }
        return options;
    }, [mapping.headerRow, rows, t]);

    const header = (
        <div className="flex flex-col gap-2">
            <span className="text-2xs text-fg-subtle" data-manuscript-scene-count>
                {tn("manuscript.sceneCount", source.scenes.length)}
            </span>
            {file.kind === "table" ? (
                <div className="flex flex-col gap-2 rounded-md border border-edge bg-fill-subtle px-2 py-2" data-manuscript-table-mapping>
                    <div className="flex flex-wrap items-end gap-2">
                        {sheets.length > 1 ? (
                            <div className="flex w-[160px] flex-col">
                                <FieldLabel as="span">{t("manuscript.table.sheet")}</FieldLabel>
                                <Select
                                    size="sm"
                                    fullWidth
                                    portalMenu
                                    ariaLabel={t("manuscript.table.sheet")}
                                    options={sheets.map((sheet, index) => ({ value: String(index), label: sheet.name }))}
                                    value={String(sheetIndex)}
                                    onChange={value => {
                                        const next = Number(value);
                                        setSheetIndex(next);
                                        setMapping(guessTableMapping(sheets[next]?.rows ?? []));
                                    }}
                                />
                            </div>
                        ) : null}
                        {ROLES.map(role => (
                            <div key={role} className="flex min-w-[120px] flex-1 flex-col">
                                <FieldLabel as="span">{t(`manuscript.table.role.${role}` as TranslationKey)}</FieldLabel>
                                <Select
                                    size="sm"
                                    fullWidth
                                    portalMenu
                                    ariaLabel={t(`manuscript.table.role.${role}` as TranslationKey)}
                                    options={columnOptions}
                                    value={mapping[role] === null ? "none" : String(mapping[role])}
                                    onChange={value => setMapping(current => ({
                                        ...current,
                                        [role]: value === "none" ? null : Number(value),
                                    }))}
                                />
                            </div>
                        ))}
                    </div>
                    <Checkbox
                        checked={mapping.headerRow}
                        onCheckedChange={checked => setMapping(current => ({ ...current, headerRow: checked }))}
                    >
                        {t("manuscript.table.headerRow")}
                    </Checkbox>
                </div>
            ) : null}
        </div>
    );

    return (
        <StoryPasteWizardModal
            open
            // The seed key: a different file re-seeds the wizard's own state.
            text={presplit ? `\u0000${props.request.fileName}` : proseText}
            inferred={inferred}
            presplit={presplit}
            header={header}
            title={t("manuscript.wizardTitle", { file: props.request.fileName })}
            actionLabel={t("manuscript.importAction")}
            helpTopic="storyManuscript"
            busy={props.busy}
            characters={props.characters}
            memory={props.memory}
            onSaveSeparator={props.onSaveSeparator}
            onForgetSeparator={props.onForgetSeparator}
            onCancel={props.onCancel}
            onConfirm={(plan, authored) => props.onConfirm(source, plan, authored)}
        />
    );
}
