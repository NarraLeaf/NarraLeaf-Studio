import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, LayoutTemplate, RefreshCw } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import { Button, EmptyState, Modal, SearchInput, TabStrip } from "@/lib/components/elements";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIRuntimeBridgeService } from "@/lib/workspace/services/ui-editor/UIRuntimeBridgeService";
import type { UIStageSlotId, UISurface, UISurfaceKind } from "@shared/types/ui-editor/document";
import type { UITemplateRegistryEntry } from "@shared/types/uiTemplateRegistry";
import { applyUITemplate } from "./applyUITemplate";
import { UITemplateCard, UITemplateCardSkeleton, type UITemplatePreviewState } from "./UITemplateCard";

type UITemplateStoreModalProps = {
    isOpen: boolean;
    onClose: () => void;
    documentService: UIDocumentService | null;
    runtimeBridge: UIRuntimeBridgeService | null;
    /** Which store to open on — the kind the surfaces panel is currently showing. */
    initialKind: UISurfaceKind;
    /** Stage slots this project has already filled, so their cards can say so. */
    occupiedStageSlotIds: ReadonlySet<UIStageSlotId>;
    /** Open a freshly imported surface in an editor tab. */
    onApplied: (surface: UISurface) => void;
    /** Surface a transient message (skipped slots, unimported resources). */
    onNotify: (message: string, level: "info" | "success" | "warning") => void;
};

/**
 * The UI template store.
 *
 * **Two stores, not one list with a filter.** A Page and a Game UI are different
 * things bought for different reasons: a Page is a whole screen the author adds
 * to their game, a Game UI takes over one of five fixed stage slots and there can
 * only ever be one per slot. Mixing them meant every author read past most of the
 * shelf, and it meant a card could not say the one thing that decides a Game UI —
 * whether its slot is still free. So the strip picks the store, and it opens on
 * whichever one the panel behind it was already showing.
 *
 * **The cards are the templates.** Each preview is the fetched `UIDocument`
 * rendered through the same runtime bridge the editor uses, not a screenshot
 * committed beside it — so a card cannot go stale against the template it sells,
 * and a template author never has to remember to re-export a picture.
 */
export function UITemplateStoreModal({
    isOpen,
    onClose,
    documentService,
    runtimeBridge,
    initialKind,
    occupiedStageSlotIds,
    onApplied,
    onNotify,
}: UITemplateStoreModalProps) {
    const { t, tn } = useTranslation();
    const [entries, setEntries] = useState<UITemplateRegistryEntry[] | null>(null);
    const [previews, setPreviews] = useState<Record<string, UITemplatePreviewState>>({});
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [query, setQuery] = useState("");
    const [kind, setKind] = useState<UISurfaceKind>(initialKind);
    const [applyingId, setApplyingId] = useState<string | null>(null);

    const loadPreviews = useCallback(async (loaded: UITemplateRegistryEntry[]) => {
        if (loaded.length === 0) {
            return;
        }
        setPreviews(Object.fromEntries(loaded.map(entry => [entry.id, { status: "loading" } as const])));
        const result = await getInterface().uiTemplates.fetchPreviews(loaded.map(entry => entry.id));
        setPreviews(() => {
            // Start from "unavailable" for everything and fill in what came back:
            // the handler drops a template whose document would not fetch, and that
            // absence is exactly the card that should show as unavailable.
            const next: Record<string, UITemplatePreviewState> = Object.fromEntries(
                loaded.map(entry => [entry.id, { status: "unavailable" } as const]),
            );
            if (!result.success) {
                return next;
            }
            for (const preview of result.data) {
                const document = documentService?.prepareTemplateDocumentForPreview(preview.document);
                if (document) {
                    next[preview.id] = { status: "ready", document };
                }
            }
            return next;
        });
    }, [documentService]);

    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await getInterface().uiTemplates.registryFetch();
            if (!result.success) {
                setEntries(null);
                setPreviews({});
                setError(result.error ?? t("uiEditor.templateStore.error.load"));
                return;
            }
            setEntries(result.data.index.templates);
            await loadPreviews(result.data.index.templates);
        } finally {
            setLoading(false);
        }
    }, [loadPreviews, t]);

    // Fetch the index the first time the store opens; a manual retry re-fetches.
    useEffect(() => {
        if (!isOpen || entries !== null || loading || error !== null) {
            return;
        }
        void refresh();
    }, [entries, error, isOpen, loading, refresh]);

    // Follow the panel's own filter, so opening the store from the Game UI list
    // lands on the Game UI shelf rather than making the author switch twice.
    useEffect(() => {
        if (isOpen) {
            setKind(initialKind);
        }
    }, [initialKind, isOpen]);

    const inKind = useMemo(
        () => (entries ?? []).filter(entry => entry.surface.kind === kind),
        [entries, kind],
    );

    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) {
            return inKind;
        }
        return inKind.filter(entry =>
            [entry.name, entry.description, entry.publisher, ...entry.categories]
                .join(" ")
                .toLowerCase()
                .includes(needle),
        );
    }, [inKind, query]);

    const placementLabel = useCallback((entry: UITemplateRegistryEntry): string => {
        if (entry.surface.kind === "stageSurface") {
            return t(`uiEditor.templateStore.slot.${entry.surface.slotId ?? "onStage"}`);
        }
        return t("uiEditor.templateStore.placement.page");
    }, [t]);

    /** Why this card cannot be added, or nothing when it can. */
    const blockedReason = useCallback((entry: UITemplateRegistryEntry): string | undefined => {
        if (entry.surface.kind !== "stageSurface") {
            return undefined;
        }
        const slotId = entry.surface.slotId ?? "onStage";
        if (!occupiedStageSlotIds.has(slotId)) {
            return undefined;
        }
        return t("uiEditor.templateStore.slotTaken", { slot: t(`uiEditor.templateStore.slot.${slotId}`) });
    }, [occupiedStageSlotIds, t]);

    const handleApply = async (entry: UITemplateRegistryEntry) => {
        if (!documentService || applyingId) {
            return;
        }
        setApplyingId(entry.id);
        try {
            const result = await applyUITemplate(entry.id, documentService);
            if (!result.ok) {
                onNotify(result.error, "warning");
                return;
            }
            if (result.surfaces.length === 0) {
                const slot = result.skippedSlots[0];
                onNotify(
                    slot
                        ? t("uiEditor.templateStore.slotTaken", { slot: t(`uiEditor.templateStore.slot.${slot}`) })
                        : t("uiEditor.templateStore.error.apply"),
                    "warning",
                );
                return;
            }
            onNotify(t("uiEditor.templateStore.applied", { name: entry.name }), "success");
            if (result.assetsSkipped > 0) {
                onNotify(tn("uiEditor.templateStore.assetsSkipped", result.assetsSkipped), "warning");
            }
            if (result.components.length > 0) {
                onNotify(tn("uiEditor.templateStore.componentsAdded", result.components.length), "info");
            }
            onApplied(result.surfaces[0]);
            // The author asked for this template and got it; leaving the store open
            // over the surface they just added hides the thing they came here to make.
            onClose();
        } finally {
            setApplyingId(null);
        }
    };

    const tabs = useMemo(() => {
        const count = (target: UISurfaceKind) =>
            (entries ?? []).filter(entry => entry.surface.kind === target).length;
        // An element, not a bare string: TabStrip lays its children out with `gap`,
        // and two adjacent strings collapse into one anonymous flex item — which is
        // how the count came to be printed hard against the label ("Page3").
        const shelfCount = (target: UISurfaceKind) => entries
            ? <span className="text-fg-subtle tabular-nums">{count(target)}</span>
            : undefined;
        return [
            { id: "appSurface", label: t("uiEditor.surfaceKind.page"), badge: shelfCount("appSurface") },
            { id: "stageSurface", label: t("uiEditor.surfaceKind.gameUi"), badge: shelfCount("stageSurface") },
        ];
    }, [entries, t]);

    const body = () => {
        if (error) {
            return (
                <EmptyState
                    icon={<AlertTriangle className="h-6 w-6" />}
                    title={t("uiEditor.templateStore.error.offline")}
                    description={error}
                    action={
                        <Button size="sm" variant="secondary" onClick={() => void refresh()}>
                            {t("uiEditor.templateStore.retry")}
                        </Button>
                    }
                />
            );
        }
        if (entries === null) {
            return (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
                    {[0, 1, 2, 3].map(index => <UITemplateCardSkeleton key={index} />)}
                </div>
            );
        }
        if (filtered.length === 0) {
            return (
                <EmptyState
                    icon={<LayoutTemplate className="h-6 w-6" />}
                    title={
                        query.trim()
                            ? t("uiEditor.templateStore.emptyFiltered")
                            : t("uiEditor.templateStore.empty")
                    }
                />
            );
        }
        return (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
                {filtered.map(entry => (
                    <UITemplateCard
                        key={entry.id}
                        entry={entry}
                        preview={previews[entry.id] ?? { status: "loading" }}
                        runtimeBridge={runtimeBridge}
                        placementLabel={placementLabel(entry)}
                        blockedReason={blockedReason(entry)}
                        busy={applyingId === entry.id}
                        onAdd={() => void handleApply(entry)}
                    />
                ))}
            </div>
        );
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={t("uiEditor.templateStore.title")}
            size="xl"
        >
            <div className="flex h-[30rem] flex-col">
                <div className="flex items-center gap-2">
                    <TabStrip
                        tabs={tabs}
                        activeId={kind}
                        onChange={(id: string) => setKind(id as UISurfaceKind)}
                        size="sm"
                        className="min-w-0 flex-1"
                    />
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void refresh()}
                        disabled={loading}
                        title={t("uiEditor.templateStore.retry")}
                        aria-label={t("uiEditor.templateStore.retry")}
                    >
                        <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                    </Button>
                </div>

                <div className="pt-3">
                    <SearchInput
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        placeholder={t("uiEditor.templateStore.search")}
                        size="sm"
                        fullWidth
                    />
                </div>

                <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
                    {body()}
                </div>
            </div>
        </Modal>
    );
}
