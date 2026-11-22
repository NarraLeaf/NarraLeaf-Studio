import { useCallback, useEffect, useState } from "react";
import { Checkbox } from "@/lib/components/elements/Checkbox";
import { Modal, dialogFooterButtonClass } from "@/lib/components/elements/Modal";
import { SectionTitle } from "@/lib/components/elements/SectionTitle";
import { useTranslation } from "@/lib/i18n";
import type { PluralKey } from "@shared/i18n";
import type { FigmaExportFile } from "@/lib/ui-editor/figma-import/figmaExportFormat";
import type { UISurface } from "@shared/types/ui-editor/document";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { useFreezeGuard } from "../../../../components/ui/freezeGuard";
import { interfaceDocumentFreezeScope } from "../../uiFreezeScope";
import { applyFigmaImport, type ApplyFigmaImportResult } from "./applyFigmaImport";

type FigmaImportModalProps = {
    /** The export being imported; the dialog is shown while one is set. */
    file: FigmaExportFile | null;
    fileName: string;
    onClose: () => void;
    documentService: UIDocumentService | null;
    /** The first page the import added, opened as a pasted interface is. */
    onApplied: (surface: UISurface) => void;
};

/**
 * Pick the frames of a Figma export to import, then read what the import simplified.
 *
 * Two states in one dialog: the frames with a box each, and after Import, the report. The report is
 * shown here rather than as a notification because it is a list the author works through - which
 * layers became pictures, which fonts to add - and a toast is gone before the second line is read.
 */
export function FigmaImportModal({ file, fileName, onClose, documentService, onApplied }: FigmaImportModalProps) {
    const { t, tn, formatList } = useTranslation();
    const freeze = useFreezeGuard(interfaceDocumentFreezeScope());
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<ApplyFigmaImportResult | null>(null);

    useEffect(() => {
        setSelected(new Set(file?.frames.map(frame => frame.id) ?? []));
        setBusy(false);
        setError(null);
        setResult(null);
    }, [file]);

    const close = useCallback(() => {
        if (!busy) {
            onClose();
        }
    }, [busy, onClose]);

    const toggle = useCallback((id: string, checked: boolean) => {
        setSelected(previous => {
            const next = new Set(previous);
            if (checked) next.add(id);
            else next.delete(id);
            return next;
        });
    }, []);

    const runImport = useCallback(async () => {
        if (!file || !documentService || selected.size === 0) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const ids = file.frames.filter(frame => selected.has(frame.id)).map(frame => frame.id);
            const imported = await applyFigmaImport(file, ids, documentService);
            setResult(imported);
            if (imported.surfaces[0]) {
                onApplied(imported.surfaces[0]);
            }
        } catch (thrown) {
            console.warn("[figma import] import failed", thrown);
            setError(t("uiEditor.figmaImport.error.apply"));
        } finally {
            setBusy(false);
        }
    }, [documentService, file, onApplied, selected, t]);

    const footer = result ? (
        <div className="flex w-full items-center justify-end gap-2">
            <button type="button" className={dialogFooterButtonClass({ variant: "primary" })} onClick={onClose}>
                {t("common.done")}
            </button>
        </div>
    ) : (
        <div className="flex w-full items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-fg-subtle">
                {selected.size > 0 ? tn("uiEditor.figmaImport.willAdd", selected.size, { count: selected.size }) : ""}
            </span>
            <button
                type="button"
                className={dialogFooterButtonClass({ variant: "secondary", disabled: busy })}
                onClick={close}
                disabled={busy}
            >
                {t("common.cancel")}
            </button>
            <button
                type="button"
                aria-label={t("uiEditor.figmaImport.import")}
                className={dialogFooterButtonClass({
                    variant: "primary",
                    disabled: busy || selected.size === 0 || !documentService || freeze.frozen,
                })}
                onClick={() => void runImport()}
                {...freeze.writes(busy || selected.size === 0 || !documentService)}
            >
                {busy ? t("uiEditor.figmaImport.importing") : t("uiEditor.figmaImport.import")}
            </button>
        </div>
    );

    return (
        <Modal
            isOpen={file !== null}
            onClose={close}
            title={t("uiEditor.figmaImport.title")}
            helpTopic="figmaImport"
            size="md"
            closeOnOverlayClick={!busy}
            footer={footer}
        >
            {file && !result && (
                <div className="space-y-3">
                    <div className="min-w-0">
                        <div className="truncate text-sm text-fg">{fileName}</div>
                        {file.source.pageName && <div className="truncate text-xs text-fg-subtle">{file.source.pageName}</div>}
                    </div>
                    <div>
                        <SectionTitle density="page">{t("uiEditor.figmaImport.frames")}</SectionTitle>
                        <div className="mt-2 max-h-72 overflow-y-auto overscroll-contain rounded-md border border-edge py-1">
                            {file.frames.map(frame => (
                                <Checkbox
                                    key={frame.id}
                                    checked={selected.has(frame.id)}
                                    onCheckedChange={checked => toggle(frame.id, checked)}
                                    disabled={busy}
                                    className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-fill"
                                >
                                    <span className="min-w-0 flex-1 truncate text-fg">{frame.name}</span>
                                    <span className="shrink-0 text-xs tabular-nums text-fg-subtle">
                                        {t("uiEditor.figmaImport.size", {
                                            width: Math.round(frame.width),
                                            height: Math.round(frame.height),
                                        })}
                                    </span>
                                </Checkbox>
                            ))}
                        </div>
                    </div>
                    {error && <p className="text-xs text-danger">{error}</p>}
                </div>
            )}
            {result && (
                <div className="space-y-3">
                    <div className="text-sm text-fg">
                        {tn("uiEditor.figmaImport.added", result.surfaces.length, { count: result.surfaces.length })}
                    </div>
                    {result.imagesSkipped > 0 && (
                        <div className="text-sm text-warning">
                            {tn("uiEditor.figmaImport.imagesSkipped", result.imagesSkipped, { count: result.imagesSkipped })}
                        </div>
                    )}
                    <div>
                        <SectionTitle density="page">{t("uiEditor.figmaImport.reportTitle")}</SectionTitle>
                        {result.notes.length === 0 ? (
                            <p className="mt-2 text-xs text-fg-subtle">{t("uiEditor.figmaImport.noNotes")}</p>
                        ) : (
                            <ul className="mt-2 space-y-2" data-figma-import-report="">
                                {result.notes.map(note => (
                                    <li key={note.code} className="min-w-0">
                                        <div className="text-sm text-fg">
                                            {tn(`uiEditor.figmaImport.note.${note.code}` as PluralKey, note.count, { count: note.count })}
                                        </div>
                                        {note.examples.length > 0 && (
                                            <div className="truncate text-xs text-fg-subtle">{formatList(note.examples)}</div>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            )}
        </Modal>
    );
}
