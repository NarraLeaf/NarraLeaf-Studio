import { useCallback, useEffect, useState } from "react";
import { Checkbox } from "@/lib/components/elements/Checkbox";
import { Modal, dialogFooterButtonClass } from "@/lib/components/elements/Modal";
import { SectionTitle } from "@/lib/components/elements/SectionTitle";
import { useTranslation } from "@/lib/i18n";
import type { PluralKey, TranslationKey } from "@shared/i18n";
import type { UISurface } from "@shared/types/ui-editor/document";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { useFreezeGuard } from "../../../../components/ui/freezeGuard";
import { interfaceDocumentFreezeScope } from "../../uiFreezeScope";
import { applyDesignImport, type ApplyDesignImportResult } from "./applyDesignImport";
import { DesignSourceError, type DesignSource, type DesignSourceKind } from "./designSources";

type DesignImportModalProps = {
    /** The design being imported; the dialog is shown while one is set. */
    source: DesignSource | null;
    onClose: () => void;
    documentService: UIDocumentService | null;
    /** The first page the import added, opened as a pasted interface is. */
    onApplied: (surface: UISurface) => void;
};

const TITLE_KEY: Record<DesignSourceKind, TranslationKey> = {
    figma: "uiEditor.designImport.title",
    psd: "uiEditor.designImport.titlePsd",
    images: "uiEditor.designImport.titleImages",
};

const LIST_KEY: Record<DesignSourceKind, TranslationKey> = {
    figma: "uiEditor.designImport.frames",
    psd: "uiEditor.designImport.documents",
    images: "uiEditor.designImport.images",
};

/**
 * Pick what to import from a design - a Figma export's frames, a PSD, a set of images - then read
 * what the import simplified.
 *
 * Two states in one dialog: the rows with a box each, and after Import, the report. The report is
 * shown here rather than as a notification because it is a list the author works through - which
 * layers became pictures, which fonts to add - and a toast is gone before the second line is read.
 */
export function DesignImportModal({ source, onClose, documentService, onApplied }: DesignImportModalProps) {
    const { t, tn, formatList } = useTranslation();
    const freeze = useFreezeGuard(interfaceDocumentFreezeScope());
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<ApplyDesignImportResult | null>(null);

    useEffect(() => {
        setSelected(new Set(source?.items.map(item => item.id) ?? []));
        setBusy(false);
        setError(null);
        setResult(null);
    }, [source]);

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
        if (!source || !documentService || selected.size === 0) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const ids = source.items.filter(item => selected.has(item.id)).map(item => item.id);
            const loaded = await source.load(ids);
            const imported = await applyDesignImport(loaded.file, loaded.frameIds, documentService);
            setResult(imported);
            if (imported.surfaces[0]) {
                onApplied(imported.surfaces[0]);
            }
        } catch (thrown) {
            console.warn("[design import] import failed", thrown);
            setError(thrown instanceof DesignSourceError ? thrown.message : t("uiEditor.designImport.error.apply"));
        } finally {
            setBusy(false);
        }
    }, [documentService, onApplied, selected, source, t]);

    const pages = source ? source.pagesFor(selected.size) : 0;
    const footer = result ? (
        <div className="flex w-full items-center justify-end gap-2">
            <button type="button" className={dialogFooterButtonClass({ variant: "primary" })} onClick={onClose}>
                {t("common.done")}
            </button>
        </div>
    ) : (
        <div className="flex w-full items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-fg-subtle">
                {pages > 0 ? tn("uiEditor.designImport.willAdd", pages, { count: pages }) : ""}
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
                aria-label={t("uiEditor.designImport.import")}
                className={dialogFooterButtonClass({
                    variant: "primary",
                    disabled: busy || selected.size === 0 || !documentService || freeze.frozen,
                })}
                onClick={() => void runImport()}
                {...freeze.writes(busy || selected.size === 0 || !documentService)}
            >
                {busy ? t("uiEditor.designImport.importing") : t("uiEditor.designImport.import")}
            </button>
        </div>
    );

    return (
        <Modal
            isOpen={source !== null}
            onClose={close}
            title={t(TITLE_KEY[source?.kind ?? "figma"])}
            helpTopic="designImport"
            size="md"
            closeOnOverlayClick={!busy}
            footer={footer}
        >
            {source && !result && (
                <div className="space-y-3">
                    <div className="min-w-0">
                        <div className="truncate text-sm text-fg">{source.label}</div>
                        {source.detail && <div className="truncate text-xs text-fg-subtle">{source.detail}</div>}
                    </div>
                    <div>
                        <SectionTitle density="page">{t(LIST_KEY[source.kind])}</SectionTitle>
                        <div className="mt-2 max-h-72 overflow-y-auto overscroll-contain rounded-md border border-edge py-1">
                            {source.items.map(item => (
                                <Checkbox
                                    key={item.id}
                                    checked={selected.has(item.id)}
                                    onCheckedChange={checked => toggle(item.id, checked)}
                                    disabled={busy}
                                    className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-fill"
                                >
                                    <span className="min-w-0 flex-1 truncate text-fg">{item.name}</span>
                                    <span className="shrink-0 text-xs tabular-nums text-fg-subtle">
                                        {t("uiEditor.designImport.size", {
                                            width: Math.round(item.width),
                                            height: Math.round(item.height),
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
                        {tn("uiEditor.designImport.added", result.surfaces.length, { count: result.surfaces.length })}
                    </div>
                    {result.buttons > 0 && (
                        <div className="text-sm text-fg" data-design-import-buttons="">
                            {tn("uiEditor.designImport.buttons", result.buttons, { count: result.buttons })}
                        </div>
                    )}
                    {result.imagesSkipped > 0 && (
                        <div className="text-sm text-warning">
                            {tn("uiEditor.designImport.imagesSkipped", result.imagesSkipped, { count: result.imagesSkipped })}
                        </div>
                    )}
                    <div>
                        <SectionTitle density="page">{t("uiEditor.designImport.reportTitle")}</SectionTitle>
                        {result.notes.length === 0 ? (
                            <p className="mt-2 text-xs text-fg-subtle">{t("uiEditor.designImport.noNotes")}</p>
                        ) : (
                            <ul className="mt-2 space-y-2" data-design-import-report="">
                                {result.notes.map(note => (
                                    <li key={note.code} className="min-w-0">
                                        <div className="text-sm text-fg">
                                            {tn(`uiEditor.designImport.note.${note.code}` as PluralKey, note.count, { count: note.count })}
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
