import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ImagePlus, Images, Plus, Star, Trash2, X } from "lucide-react";
import {
    AssetType,
    PanelPosition,
    definePlugin,
    ui,
    type Asset,
    type BlueprintInspectorParamSelectOption,
    type PluginApp,
} from "narraleaf-studio/plugin";
import {
    GALLERY_STORE_NAMESPACE,
    GALLERY_STORE_VERSION,
    createArtworkId,
    createVariantId,
    normalizeGalleryCatalog,
    resolveCoverVariant,
    type GalleryArtwork,
    type GalleryStoreData,
    type GalleryVariant,
} from "./catalog";
import {
    DYNAMIC_OPTIONS_SOURCE,
    PLUGIN_ID,
    VARIANT_OPTIONS_SOURCE,
    createGalleryBlueprintNodes,
} from "./nodes";

const PANEL_ID = `${PLUGIN_ID}.panel`;

type GalleryStore = ReturnType<typeof createGalleryStore>;

function createGalleryStore(app: PluginApp) {
    let items: GalleryArtwork[] = [];
    const listeners = new Set<() => void>();

    const notify = () => {
        for (const listener of listeners) {
            listener();
        }
        app.services.blueprintNodes.notifyDynamicSelectOptionsChanged();
    };

    const commit = async (nextItems: GalleryArtwork[]) => {
        items = normalizeGalleryCatalog(nextItems);
        notify();
        await app.services.storage.writeJson<GalleryStoreData>(GALLERY_STORE_NAMESPACE, {
            version: GALLERY_STORE_VERSION,
            items,
        });
    };

    const patchArtwork = (
        artworkId: string,
        patch: (artwork: GalleryArtwork) => GalleryArtwork,
    ) => commit(items.map(artwork => (
        artwork.id === artworkId
            ? { ...patch(artwork), updatedAt: Date.now() }
            : artwork
    )));

    return {
        async load() {
            const stored = await app.services.storage.readJson<GalleryStoreData>(GALLERY_STORE_NAMESPACE);
            items = normalizeGalleryCatalog(stored);
            notify();
        },
        getItems: () => items,
        /** Artwork options for the node inspector's Artwork picker. */
        getArtworkOptions: (): BlueprintInspectorParamSelectOption[] =>
            items.map(artwork => ({
                value: artwork.id,
                label: artwork.name || artwork.id,
            })),
        /**
         * Variant options for every artwork at once. The inspector narrows them
         * to the selected artwork through dynamicOptionsFilter on this meta.
         */
        getVariantOptions: (): BlueprintInspectorParamSelectOption[] =>
            items.flatMap(artwork => artwork.variants.map(variant => ({
                value: variant.id,
                label: variant.name || variant.id,
                meta: { artworkId: artwork.id },
            }))),
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        async addArtwork() {
            const now = Date.now();
            await commit([
                ...items,
                {
                    id: createArtworkId(),
                    name: `Artwork ${items.length + 1}`,
                    variants: [],
                    coverVariantId: null,
                    createdAt: now,
                    updatedAt: now,
                },
            ]);
        },
        async renameArtwork(artworkId: string, name: string) {
            await patchArtwork(artworkId, artwork => ({ ...artwork, name }));
        },
        async removeArtwork(artworkId: string) {
            await commit(items.filter(artwork => artwork.id !== artworkId));
        },
        /** One variant per picked asset, so a whole differential set lands in one go. */
        async addVariants(artworkId: string, assets: Asset[]) {
            await patchArtwork(artworkId, artwork => ({
                ...artwork,
                variants: [
                    ...artwork.variants,
                    ...assets.map((asset, index) => ({
                        id: createVariantId(artwork.id),
                        name: asset.name || `Variant ${artwork.variants.length + index + 1}`,
                        imageAssetId: asset.id,
                        imageAssetName: asset.name,
                    })),
                ],
            }));
        },
        async patchVariant(artworkId: string, variantId: string, patch: Partial<GalleryVariant>) {
            await patchArtwork(artworkId, artwork => ({
                ...artwork,
                variants: artwork.variants.map(variant => (
                    variant.id === variantId ? { ...variant, ...patch } : variant
                )),
            }));
        },
        async removeVariant(artworkId: string, variantId: string) {
            await patchArtwork(artworkId, artwork => ({
                ...artwork,
                variants: artwork.variants.filter(variant => variant.id !== variantId),
                coverVariantId: artwork.coverVariantId === variantId ? null : artwork.coverVariantId,
            }));
        },
        async setCoverVariant(artworkId: string, variantId: string) {
            await patchArtwork(artworkId, artwork => ({
                ...artwork,
                // Clicking the current cover clears it, falling back to the first variant.
                coverVariantId: artwork.coverVariantId === variantId ? null : variantId,
            }));
        },
    };
}

function GalleryPanel({ app, store }: { app: PluginApp; store: GalleryStore }) {
    const [items, setItems] = useState<GalleryArtwork[]>(() => store.getItems());
    const [query, setQuery] = useState("");
    const [busy, setBusy] = useState(false);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
    const [pickerTarget, setPickerTarget] = useState<
        { kind: "add"; artworkId: string } | { kind: "replace"; artworkId: string; variantId: string } | null
    >(null);
    const selectorAnchorRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => store.subscribe(() => setItems([...store.getItems()])), [store]);

    const filteredItems = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) {
            return items;
        }
        return items.filter(artwork =>
            artwork.name.toLowerCase().includes(q) ||
            artwork.variants.some(variant =>
                variant.name.toLowerCase().includes(q) ||
                variant.imageAssetName?.toLowerCase().includes(q)
            )
        );
    }, [items, query]);

    const run = async (action: () => Promise<void>) => {
        setBusy(true);
        try {
            await action();
        } catch (error) {
            app.services.ui.notifications.error(error instanceof Error ? error.message : String(error));
        } finally {
            setBusy(false);
        }
    };

    const toggleExpanded = (artworkId: string) => {
        setExpandedIds(previous => {
            const next = new Set(previous);
            if (next.has(artworkId)) {
                next.delete(artworkId);
            } else {
                next.add(artworkId);
            }
            return next;
        });
    };

    const replacingVariant = pickerTarget?.kind === "replace"
        ? items
            .find(artwork => artwork.id === pickerTarget.artworkId)
            ?.variants.find(variant => variant.id === pickerTarget.variantId)
        : undefined;

    const variantCountLabel = (artwork: GalleryArtwork) =>
        `${artwork.variants.length} variant${artwork.variants.length === 1 ? "" : "s"}`;

    return (
        <ui.Panel.Root>
            <ui.Panel.Header
                title="Gallery"
                description={`${items.length} artwork${items.length === 1 ? "" : "s"}`}
                actions={(
                    <ui.Button size="sm" variant="primary" disabled={busy} onClick={() => void run(() => store.addArtwork())}>
                        <Plus size={14} />
                        Add
                    </ui.Button>
                )}
            />
            <ui.Panel.Toolbar>
                <ui.SearchInput
                    size="sm"
                    fullWidth
                    placeholder="Search gallery..."
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                />
            </ui.Panel.Toolbar>
            <ui.Panel.Section className="min-h-0 flex-1 overflow-y-auto">
                {filteredItems.length === 0 ? (
                    <ui.Panel.EmptyState
                        icon={<Images size={22} />}
                        title={items.length === 0 ? "No artworks" : "No matches"}
                        description={items.length === 0
                            ? "Create an artwork and add its variants."
                            : "Try another search."}
                    />
                ) : (
                    <div className="space-y-2">
                        {filteredItems.map(artwork => (
                            <ArtworkRow
                                key={artwork.id}
                                app={app}
                                artwork={artwork}
                                busy={busy}
                                expanded={expandedIds.has(artwork.id)}
                                countLabel={variantCountLabel(artwork)}
                                onToggle={() => toggleExpanded(artwork.id)}
                                onRename={name => void run(() => store.renameArtwork(artwork.id, name))}
                                onRemove={() => void run(() => store.removeArtwork(artwork.id))}
                                onAddVariants={() => setPickerTarget({ kind: "add", artworkId: artwork.id })}
                                onReplaceVariantImage={variantId => setPickerTarget({
                                    kind: "replace",
                                    artworkId: artwork.id,
                                    variantId,
                                })}
                                onRenameVariant={(variantId, name) => void run(() =>
                                    store.patchVariant(artwork.id, variantId, { name })
                                )}
                                onClearVariantImage={variantId => void run(() =>
                                    store.patchVariant(artwork.id, variantId, {
                                        imageAssetId: null,
                                        imageAssetName: null,
                                    })
                                )}
                                onRemoveVariant={variantId => void run(() => store.removeVariant(artwork.id, variantId))}
                                onSetCover={variantId => void run(() => store.setCoverVariant(artwork.id, variantId))}
                            />
                        ))}
                    </div>
                )}
            </ui.Panel.Section>
            <div ref={selectorAnchorRef} className="h-0 w-full" />
            <ui.AssetSelector
                visible={Boolean(pickerTarget)}
                assetType={AssetType.Image}
                multiple={pickerTarget?.kind === "add"}
                selectedIds={replacingVariant?.imageAssetId ? [replacingVariant.imageAssetId] : []}
                anchorRef={selectorAnchorRef}
                title={pickerTarget?.kind === "replace" ? "Select variant image" : "Add variants"}
                onClose={() => setPickerTarget(null)}
                onConfirm={assets => {
                    const target = pickerTarget;
                    if (!target || assets.length === 0) {
                        return;
                    }
                    setPickerTarget(null);
                    if (target.kind === "add") {
                        void run(() => store.addVariants(target.artworkId, assets as Asset[]));
                        setExpandedIds(previous => new Set(previous).add(target.artworkId));
                        return;
                    }
                    const image = assets[0] as Asset;
                    void run(() => store.patchVariant(target.artworkId, target.variantId, {
                        imageAssetId: image.id,
                        imageAssetName: image.name,
                    }));
                }}
            />
        </ui.Panel.Root>
    );
}

function ArtworkRow({
    app,
    artwork,
    busy,
    expanded,
    countLabel,
    onToggle,
    onRename,
    onRemove,
    onAddVariants,
    onReplaceVariantImage,
    onRenameVariant,
    onClearVariantImage,
    onRemoveVariant,
    onSetCover,
}: {
    app: PluginApp;
    artwork: GalleryArtwork;
    busy: boolean;
    expanded: boolean;
    countLabel: string;
    onToggle: () => void;
    onRename: (name: string) => void;
    onRemove: () => void;
    onAddVariants: () => void;
    onReplaceVariantImage: (variantId: string) => void;
    onRenameVariant: (variantId: string, name: string) => void;
    onClearVariantImage: (variantId: string) => void;
    onRemoveVariant: (variantId: string) => void;
    onSetCover: (variantId: string) => void;
}) {
    const cover = resolveCoverVariant(artwork);
    const effectiveCoverId = cover?.id ?? null;

    return (
        <div className="rounded-md border border-white/10 bg-white/[0.03]">
            <div className="flex min-w-0 gap-2 p-2">
                <button
                    type="button"
                    aria-label={expanded ? "Collapse artwork" : "Expand artwork"}
                    className="mt-1 h-4 w-4 shrink-0 text-gray-500 hover:text-gray-300"
                    onClick={onToggle}
                >
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                <GalleryImagePreview app={app} assetId={cover?.imageAssetId ?? null} />
                <div className="min-w-0 flex-1 space-y-2">
                    <InlineNameInput value={artwork.name} onCommit={onRename} />
                    <div className="flex min-w-0 items-center gap-1.5">
                        <ui.Button size="sm" variant="secondary" disabled={busy} onClick={onAddVariants}>
                            <ImagePlus size={13} />
                            Variants
                        </ui.Button>
                        <ui.IconButton
                            size="sm"
                            variant="danger"
                            aria-label="Delete artwork"
                            title="Delete artwork"
                            disabled={busy}
                            onClick={onRemove}
                        >
                            <Trash2 size={13} />
                        </ui.IconButton>
                        <span className="truncate text-[11px] text-gray-500">{countLabel}</span>
                    </div>
                </div>
            </div>
            {expanded && (
                <div className="space-y-1.5 border-t border-white/10 p-2 pl-6">
                    {artwork.variants.length === 0 ? (
                        <div className="text-[11px] text-gray-500">No variants yet.</div>
                    ) : (
                        artwork.variants.map(variant => (
                            <VariantRow
                                key={variant.id}
                                app={app}
                                variant={variant}
                                busy={busy}
                                isCover={variant.id === effectiveCoverId}
                                isExplicitCover={variant.id === artwork.coverVariantId}
                                onSelectImage={() => onReplaceVariantImage(variant.id)}
                                onRename={name => onRenameVariant(variant.id, name)}
                                onClearImage={() => onClearVariantImage(variant.id)}
                                onRemove={() => onRemoveVariant(variant.id)}
                                onSetCover={() => onSetCover(variant.id)}
                            />
                        ))
                    )}
                </div>
            )}
        </div>
    );
}

function VariantRow({
    app,
    variant,
    busy,
    isCover,
    isExplicitCover,
    onSelectImage,
    onRename,
    onClearImage,
    onRemove,
    onSetCover,
}: {
    app: PluginApp;
    variant: GalleryVariant;
    busy: boolean;
    isCover: boolean;
    isExplicitCover: boolean;
    onSelectImage: () => void;
    onRename: (name: string) => void;
    onClearImage: () => void;
    onRemove: () => void;
    onSetCover: () => void;
}) {
    return (
        <div className="flex min-w-0 items-start gap-2 rounded border border-white/10 bg-black/20 p-1.5">
            <GalleryImagePreview app={app} assetId={variant.imageAssetId} size="sm" />
            <div className="min-w-0 flex-1 space-y-1.5">
                <InlineNameInput value={variant.name} onCommit={onRename} />
                <div className="flex min-w-0 items-center gap-1">
                    <ui.IconButton
                        size="sm"
                        variant="ghost"
                        aria-label={isExplicitCover ? "Clear cover" : "Use as cover"}
                        title={isExplicitCover
                            ? "Clear cover"
                            : isCover
                                ? "Default cover (first variant)"
                                : "Use as cover"}
                        disabled={busy}
                        onClick={onSetCover}
                        className={isCover ? "text-primary" : ""}
                    >
                        <Star size={13} fill={isExplicitCover ? "currentColor" : "none"} />
                    </ui.IconButton>
                    <ui.IconButton
                        size="sm"
                        variant="ghost"
                        aria-label="Change image"
                        title="Change image"
                        disabled={busy}
                        onClick={onSelectImage}
                    >
                        <ImagePlus size={13} />
                    </ui.IconButton>
                    <ui.IconButton
                        size="sm"
                        variant="ghost"
                        aria-label="Remove image"
                        title="Remove image"
                        disabled={busy || !variant.imageAssetId}
                        onClick={onClearImage}
                        className={!variant.imageAssetId ? "hidden" : ""}
                    >
                        <X size={13} />
                    </ui.IconButton>
                    <ui.IconButton
                        size="sm"
                        variant="danger"
                        aria-label="Delete variant"
                        title="Delete variant"
                        disabled={busy}
                        onClick={onRemove}
                    >
                        <Trash2 size={13} />
                    </ui.IconButton>
                    <span className="truncate text-[11px] text-gray-500">
                        {variant.imageAssetName || "No image"}
                    </span>
                </div>
            </div>
        </div>
    );
}

/** Local draft so typing does not commit (and re-persist) on every keystroke. */
function InlineNameInput({ value, onCommit }: { value: string; onCommit: (name: string) => void }) {
    const [draft, setDraft] = useState(value);

    useEffect(() => {
        setDraft(value);
    }, [value]);

    return (
        <ui.Input
            size="sm"
            fullWidth
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onBlur={() => {
                const next = draft.trim();
                if (next && next !== value) {
                    onCommit(next);
                } else {
                    setDraft(value);
                }
            }}
        />
    );
}

function GalleryImagePreview({
    app,
    assetId,
    size = "md",
}: {
    app: PluginApp;
    assetId: string | null;
    size?: "sm" | "md";
}) {
    const [url, setUrl] = useState<string | null>(null);

    useEffect(() => {
        let disposed = false;
        let localUrl: string | null = null;
        const asset = assetId ? app.services.assets.get(AssetType.Image, assetId) : undefined;
        if (!asset) {
            setUrl(null);
            return;
        }
        app.services.assets.createObjectUrl(asset)
            .then(nextUrl => {
                if (disposed) {
                    app.services.assets.revokeObjectUrl(nextUrl);
                    return;
                }
                localUrl = nextUrl;
                setUrl(nextUrl);
            })
            .catch(() => {
                if (!disposed) {
                    setUrl(null);
                }
            });
        return () => {
            disposed = true;
            if (localUrl) {
                app.services.assets.revokeObjectUrl(localUrl);
            }
        };
    }, [app, assetId]);

    const box = size === "sm" ? "h-10 w-10" : "h-16 w-16";

    return (
        <div className={`grid ${box} shrink-0 place-items-center overflow-hidden rounded border border-white/10 bg-black/20`}>
            {url ? (
                <img src={url} alt="" className="h-full w-full object-cover" />
            ) : (
                <Images size={size === "sm" ? 14 : 18} className="text-gray-500" />
            )}
        </div>
    );
}

export default definePlugin({
    async setup(app) {
        const store = createGalleryStore(app);
        await store.load();

        const unregisterArtworkOptions = app.services.blueprintNodes.registerDynamicSelectOptionsSource(
            DYNAMIC_OPTIONS_SOURCE,
            () => store.getArtworkOptions(),
        );
        const unregisterVariantOptions = app.services.blueprintNodes.registerDynamicSelectOptionsSource(
            VARIANT_OPTIONS_SOURCE,
            () => store.getVariantOptions(),
        );
        // In the editor the catalog is the live panel store; the runtime entry
        // reads the copy published with the game instead.
        app.services.blueprintNodes.registerMany(createGalleryBlueprintNodes(() => store.getItems()));
        app.services.ui.panels.register({
            id: PANEL_ID,
            title: "Gallery",
            icon: <Images size={16} />,
            position: PanelPosition.Left,
            component: () => <GalleryPanel app={app} store={store} />,
            defaultVisible: false,
            order: 640,
        });

        return () => {
            app.services.ui.panels.unregister(PANEL_ID);
            unregisterArtworkOptions();
            unregisterVariantOptions();
        };
    },
});
