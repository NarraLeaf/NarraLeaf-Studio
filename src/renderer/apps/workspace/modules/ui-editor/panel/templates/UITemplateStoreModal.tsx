import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
    AlertTriangle,
    Bell,
    CheckCircle2,
    LayoutTemplate,
    Layers,
    ListChecks,
    MessageSquare,
    PanelsTopLeft,
    RefreshCw,
    Search,
} from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import { Button, EmptyState, Input } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UISurface } from "@shared/types/ui-editor/document";
import type { UITemplateRegistryEntry } from "@shared/types/uiTemplateRegistry";
import { applyUITemplate } from "./applyUITemplate";

type ApplyState =
    | { status: "idle" }
    | { status: "working" }
    | { status: "success"; message: string }
    | { status: "error"; message: string };

type UITemplateStoreModalProps = {
    isOpen: boolean;
    onClose: () => void;
    documentService: UIDocumentService | null;
    /** Open a freshly imported surface in an editor tab. */
    onApplied: (surface: UISurface) => void;
    /** Surface a transient message (skipped slots, unimported resources). */
    onNotify: (message: string, level: "info" | "success" | "warning") => void;
};

function categoryIcon(categories: string[]): ReactNode {
    const primary = categories[0];
    const className = "h-4 w-4 text-fg-muted";
    switch (primary) {
        case "dialog":
            return <MessageSquare className={className} />;
        case "notification":
            return <Bell className={className} />;
        case "choice":
            return <ListChecks className={className} />;
        case "overlay":
            return <Layers className={className} />;
        case "menu":
            return <PanelsTopLeft className={className} />;
        default:
            return <LayoutTemplate className={className} />;
    }
}

export function UITemplateStoreModal({
    isOpen,
    onClose,
    documentService,
    onApplied,
    onNotify,
}: UITemplateStoreModalProps) {
    const { t } = useTranslation();
    const [entries, setEntries] = useState<UITemplateRegistryEntry[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [query, setQuery] = useState("");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [apply, setApply] = useState<ApplyState>({ status: "idle" });

    const refresh = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await getInterface().uiTemplates.registryFetch();
            if (!result.success) {
                setEntries(null);
                setError(result.error ?? t("uiEditor.templateStore.error.load"));
                return;
            }
            setEntries(result.data.index.templates);
        } finally {
            setLoading(false);
        }
    };

    // Fetch the index the first time the store opens; a manual retry re-fetches.
    useEffect(() => {
        if (!isOpen) {
            return;
        }
        let active = true;
        if (entries === null && !loading && error === null) {
            void (async () => {
                await refresh();
                if (!active) {
                    return;
                }
            })();
        }
        return () => {
            active = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const filtered = useMemo(() => {
        if (!entries) {
            return [];
        }
        const needle = query.trim().toLowerCase();
        if (!needle) {
            return entries;
        }
        return entries.filter(entry =>
            [entry.name, entry.description, entry.publisher, ...entry.categories]
                .join(" ")
                .toLowerCase()
                .includes(needle),
        );
    }, [entries, query]);

    const selected = useMemo(
        () => filtered.find(entry => entry.id === selectedId) ?? null,
        [filtered, selectedId],
    );

    const placementLabel = (entry: UITemplateRegistryEntry): string => {
        if (entry.surface.kind === "stageSurface") {
            return t("uiEditor.templateStore.placement.gameUi", {
                slot: t(`uiEditor.templateStore.slot.${entry.surface.slotId ?? "onStage"}`),
            });
        }
        return t("uiEditor.templateStore.placement.page");
    };

    const handleApply = async (entry: UITemplateRegistryEntry) => {
        if (!documentService || apply.status === "working") {
            return;
        }
        setApply({ status: "working" });
        const result = await applyUITemplate(entry.id, documentService);
        if (!result.ok) {
            setApply({ status: "error", message: result.error });
            return;
        }
        if (result.surfaces.length === 0) {
            // Every surface was skipped (e.g. its stage slot is already taken).
            const slot = result.skippedSlots[0];
            setApply({
                status: "error",
                message: slot
                    ? t("uiEditor.templateStore.slotTaken", { slot: t(`uiEditor.templateStore.slot.${slot}`) })
                    : t("uiEditor.templateStore.error.apply"),
            });
            return;
        }
        setApply({ status: "success", message: t("uiEditor.templateStore.applied", { name: entry.name }) });
        if (result.skippedSlots.length > 0) {
            const slot = result.skippedSlots[0];
            onNotify(t("uiEditor.templateStore.slotTaken", { slot: t(`uiEditor.templateStore.slot.${slot}`) }), "warning");
        }
        if (result.assetsSkipped > 0) {
            onNotify(t("uiEditor.templateStore.assetsSkipped", { count: result.assetsSkipped }), "warning");
        }
        onApplied(result.surfaces[0]);
    };

    if (!isOpen) {
        return null;
    }

    return (
        // A workspace-owned overlay (the UI panel has no modal service of its own):
        // a dimmed backdrop plus a centered raised panel, matching the shared Modal.
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
            onClick={onClose}
        >
            <div
                className="flex h-[32rem] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-edge bg-surface shadow-xl"
                onClick={event => event.stopPropagation()}
            >
                <div className="flex items-center gap-2 border-b border-edge px-3 py-2.5">
                    <LayoutTemplate className="h-4 w-4 text-fg-muted" />
                    <span className="text-sm font-medium text-fg">{t("uiEditor.templateStore.title")}</span>
                    <div className="ml-auto flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void refresh()}
                            disabled={loading}
                        >
                            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={onClose}>
                            {t("common.close")}
                        </Button>
                    </div>
                </div>

                <div className="flex min-h-0 flex-1">
                    {/* Left: searchable template list */}
                    <div className="flex w-1/2 min-w-0 flex-col border-r border-edge">
                        <div className="p-2">
                            <Input
                                value={query}
                                onChange={event => setQuery(event.target.value)}
                                placeholder={t("uiEditor.templateStore.search")}
                                leftIcon={<Search className="h-4 w-4" />}
                                fullWidth
                                size="sm"
                            />
                        </div>
                        <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
                            {loading && entries === null ? (
                                <EmptyState icon={<RefreshCw className="h-6 w-6 animate-spin" />} />
                            ) : error ? (
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
                            ) : filtered.length === 0 ? (
                                <EmptyState
                                    icon={<LayoutTemplate className="h-6 w-6" />}
                                    title={
                                        query.trim()
                                            ? t("uiEditor.templateStore.emptyFiltered")
                                            : t("uiEditor.templateStore.empty")
                                    }
                                />
                            ) : (
                                <div className="flex flex-col gap-0.5">
                                    {filtered.map(entry => (
                                        <button
                                            key={entry.id}
                                            type="button"
                                            onClick={() => setSelectedId(entry.id)}
                                            className={cn(
                                                "flex items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors",
                                                entry.id === selectedId ? "bg-primary/15" : "hover:bg-fill",
                                            )}
                                        >
                                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-fill">
                                                {categoryIcon(entry.categories)}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-sm text-fg">{entry.name}</span>
                                                <span className="block truncate text-2xs text-fg-subtle">
                                                    {entry.description}
                                                </span>
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right: selected template detail + apply */}
                    <div className="flex w-1/2 min-w-0 flex-col">
                        {selected ? (
                            <div className="flex min-h-0 flex-1 flex-col">
                                <div className="min-h-0 flex-1 overflow-auto p-4">
                                    <div className="text-sm font-medium text-fg">{selected.name}</div>
                                    {selected.publisher ? (
                                        <div className="mt-0.5 text-2xs text-fg-subtle">{selected.publisher}</div>
                                    ) : null}
                                    <p className="mt-3 text-xs leading-relaxed text-fg-muted">
                                        {selected.description || t("uiEditor.templateStore.noDescription")}
                                    </p>
                                    <dl className="mt-4 space-y-1.5 text-xs">
                                        <div className="flex gap-2">
                                            <dt className="w-20 shrink-0 text-fg-subtle">
                                                {t("uiEditor.templateStore.target")}
                                            </dt>
                                            <dd className="text-fg-muted">{placementLabel(selected)}</dd>
                                        </div>
                                    </dl>
                                </div>
                                <div className="border-t border-edge p-3">
                                    {apply.status === "success" ? (
                                        <div className="mb-2 flex items-center gap-1.5 text-2xs text-success">
                                            <CheckCircle2 className="h-3.5 w-3.5" />
                                            <span>{apply.message}</span>
                                        </div>
                                    ) : apply.status === "error" ? (
                                        <div className="mb-2 flex items-center gap-1.5 text-2xs text-danger">
                                            <AlertTriangle className="h-3.5 w-3.5" />
                                            <span>{apply.message}</span>
                                        </div>
                                    ) : null}
                                    <Button
                                        variant="primary"
                                        size="sm"
                                        fullWidth
                                        disabled={!documentService || apply.status === "working"}
                                        onClick={() => void handleApply(selected)}
                                    >
                                        {apply.status === "working" ? (
                                            <RefreshCw className="h-4 w-4 animate-spin" />
                                        ) : null}
                                        {t("uiEditor.templateStore.add")}
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-1 items-center justify-center p-4">
                                <EmptyState
                                    size="sm"
                                    icon={<LayoutTemplate className="h-6 w-6" />}
                                    title={t("uiEditor.templateStore.selectPrompt")}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
