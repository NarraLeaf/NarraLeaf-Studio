import { useCallback, useEffect, useMemo, useState } from "react";
import { Checkbox } from "@/lib/components/elements/Checkbox";
import { Select } from "@/lib/components/elements/Select";
import { Modal, dialogFooterButtonClass } from "@/lib/components/elements/Modal";
import { SectionTitle } from "@/lib/components/elements/SectionTitle";
import { useTranslation } from "@/lib/i18n";
import type { PluralKey, TranslationKey } from "@shared/i18n";
import type { UISurface } from "@shared/types/ui-editor/document";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { useFreezeGuard } from "../../../../components/ui/freezeGuard";
import { interfaceDocumentFreezeScope } from "../../uiFreezeScope";
import type { DesignFrameTarget } from "@/lib/ui-editor/figma-import/convertFigmaFrames";
import type { GameUiSlot } from "@/lib/ui-editor/figma-import/gameUiRoles";
import { applyDesignImport, occupiedGameUi, type ApplyDesignImportResult } from "./applyDesignImport";
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

/** The default for a row: Game UI when its layers are named for a slot. */
const defaultTargets = (source: DesignSource | null): Record<string, DesignFrameTarget> =>
    Object.fromEntries((source?.items ?? []).map(item => [item.id, item.gameUi.length > 0 ? "gameUi" : "page"]));

/**
 * Pick what to import from a design - a Figma export's frames, a PSD, a set of images - then read
 * what the import simplified.
 *
 * A row whose layers are named for Game UI slots (a design of the running game) offers to come in as
 * that Game UI instead of a page, and the dialog says which of the project's Game UI it will take the
 * place of before the author presses Import.
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
    const [targets, setTargets] = useState<Record<string, DesignFrameTarget>>({});

    useEffect(() => {
        setSelected(new Set(source?.items.map(item => item.id) ?? []));
        setTargets(defaultTargets(source));
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
            const frameTargets = Object.fromEntries(loaded.frameIds.map(id => [id, targets[id] ?? "page"]));
            const imported = await applyDesignImport(loaded.file, loaded.frameIds, documentService, frameTargets);
            setResult(imported);
            const first = imported.pages[0] ?? imported.surfaces[0];
            if (first) {
                onApplied(first);
            }
        } catch (thrown) {
            console.warn("[design import] import failed", thrown);
            setError(thrown instanceof DesignSourceError ? thrown.message : t("uiEditor.designImport.error.apply"));
        } finally {
            setBusy(false);
        }
    }, [documentService, onApplied, selected, source, t, targets]);

    const chosen = source?.items.filter(item => selected.has(item.id)) ?? [];
    const pages = source ? source.pagesFor(chosen.filter(item => targets[item.id] !== "gameUi").length) : 0;
    const slots = useMemo(() => {
        const out: GameUiSlot[] = [];
        for (const item of source?.items ?? []) {
            if (!selected.has(item.id) || targets[item.id] !== "gameUi") continue;
            for (const slot of item.gameUi) if (!out.includes(slot)) out.push(slot);
        }
        return out;
    }, [selected, source, targets]);
    const replacing = useMemo(
        () => (documentService && slots.length > 0 ? occupiedGameUi(documentService, slots).map(surface => surface.name) : []),
        [documentService, slots],
    );
    const willAdd = [
        ...(pages > 0 ? [tn("uiEditor.designImport.willAdd", pages, { count: pages })] : []),
        ...(slots.length > 0 ? [tn("uiEditor.designImport.willAddGameUi", slots.length, { count: slots.length })] : []),
    ];
    const slotLabel = (slot: GameUiSlot) => t(`uiEditor.stageSlot.${slot}` as TranslationKey);
    const footer = result ? (
        <div className="flex w-full items-center justify-end gap-2">
            <button type="button" className={dialogFooterButtonClass({ variant: "primary" })} onClick={onClose}>
                {t("common.done")}
            </button>
        </div>
    ) : (
        <div className="flex w-full items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-fg-subtle">
                {willAdd.join(" · ")}
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
                                <div key={item.id} className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-fill">
                                    <Checkbox
                                        checked={selected.has(item.id)}
                                        onCheckedChange={checked => toggle(item.id, checked)}
                                        disabled={busy}
                                        className="flex min-w-0 flex-1 items-center gap-2 text-sm"
                                    >
                                        <span className="flex min-w-0 flex-col">
                                            <span className="truncate text-fg">{item.name}</span>
                                            {targets[item.id] === "gameUi" && (
                                                <span className="truncate text-xs text-fg-subtle" data-design-import-slots="">
                                                    {formatList(item.gameUi.map(slotLabel))}
                                                </span>
                                            )}
                                        </span>
                                    </Checkbox>
                                    {item.gameUi.length > 0 && (
                                        <div className="w-28 shrink-0">
                                        <Select
                                            size="sm"
                                            fullWidth
                                            portalMenu
                                            ariaLabel={t("uiEditor.designImport.target.label")}
                                            value={targets[item.id] ?? "gameUi"}
                                            disabled={busy}
                                            options={[
                                                { value: "gameUi", label: t("uiEditor.designImport.target.gameUi") },
                                                { value: "page", label: t("uiEditor.designImport.target.page") },
                                            ]}
                                            onChange={value => setTargets(previous => ({ ...previous, [item.id]: value as DesignFrameTarget }))}
                                            menuDataAttributes={{ "data-design-import-target": item.id }}
                                        />
                                        </div>
                                    )}
                                    <span className="shrink-0 text-xs tabular-nums text-fg-subtle">
                                        {t("uiEditor.designImport.size", {
                                            width: Math.round(item.width),
                                            height: Math.round(item.height),
                                        })}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                    {replacing.length > 0 && (
                        <p className="text-xs text-warning" data-design-import-replacing="">
                            {t("uiEditor.designImport.willReplace", { names: formatList(replacing) })}
                        </p>
                    )}
                    {error && <p className="text-xs text-danger">{error}</p>}
                </div>
            )}
            {result && (
                <div className="space-y-3">
                    {(result.pages.length > 0 || result.gameUi.length === 0) && (
                        <div className="text-sm text-fg">
                            {tn("uiEditor.designImport.added", result.pages.length, { count: result.pages.length })}
                        </div>
                    )}
                    {result.gameUi.map(entry => (
                        <div key={entry.slot} className="text-sm text-fg" data-design-import-game-ui={entry.slot}>
                            {entry.replaced
                                ? tn("uiEditor.designImport.gameUiReplaced", entry.wired, {
                                    slot: slotLabel(entry.slot),
                                    name: entry.replaced,
                                    count: entry.wired,
                                })
                                : tn("uiEditor.designImport.gameUiAdded", entry.wired, { slot: slotLabel(entry.slot), count: entry.wired })}
                        </div>
                    ))}
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
