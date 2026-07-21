import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Images, Plus, Trash2, X } from "lucide-react";
import {
    AssetType,
    PanelPosition,
    definePlugin,
    ui,
    type Asset,
    type BlueprintInspectorParamSelectOption,
    type PluginApp,
} from "narraleaf-studio/plugin";
import { DYNAMIC_OPTIONS_SOURCE, PLUGIN_ID, createGalleryBlueprintNodes } from "./nodes";

const PANEL_ID = `${PLUGIN_ID}.panel`;
const STORE_NAMESPACE = `${PLUGIN_ID}.items`;

type GalleryItem = {
    id: string;
    name: string;
    imageAssetId: string | null;
    imageAssetName?: string | null;
    createdAt: number;
    updatedAt: number;
};

type GalleryStoreData = {
    version: 1;
    items: GalleryItem[];
};

type GalleryStore = ReturnType<typeof createGalleryStore>;

function createGalleryStore(app: PluginApp) {
    let items: GalleryItem[] = [];
    const listeners = new Set<() => void>();

    const notify = () => {
        for (const listener of listeners) {
            listener();
        }
        app.services.blueprintNodes.notifyDynamicSelectOptionsChanged();
    };

    const commit = async (nextItems: GalleryItem[]) => {
        items = normalizeItems(nextItems);
        notify();
        await app.services.storage.writeJson<GalleryStoreData>(STORE_NAMESPACE, {
            version: 1,
            items,
        });
    };

    return {
        async load() {
            const stored = await app.services.storage.readJson<GalleryStoreData>(STORE_NAMESPACE);
            items = normalizeItems(stored?.items ?? []);
            notify();
        },
        getItems: () => items,
        getOptions: (): BlueprintInspectorParamSelectOption[] =>
            items.map(item => ({
                value: item.id,
                label: item.name || item.id,
                meta: item.imageAssetId ? { imageAssetId: item.imageAssetId } : undefined,
            })),
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        async add() {
            const now = Date.now();
            await commit([
                ...items,
                {
                    id: createGalleryItemId(),
                    name: `Gallery ${items.length + 1}`,
                    imageAssetId: null,
                    imageAssetName: null,
                    createdAt: now,
                    updatedAt: now,
                },
            ]);
        },
        async patch(itemId: string, patch: Partial<Pick<GalleryItem, "name" | "imageAssetId" | "imageAssetName">>) {
            const now = Date.now();
            await commit(items.map(item => (
                item.id === itemId
                    ? { ...item, ...patch, updatedAt: now }
                    : item
            )));
        },
        async remove(itemId: string) {
            await commit(items.filter(item => item.id !== itemId));
        },
    };
}

function normalizeItems(value: unknown): GalleryItem[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((raw): GalleryItem[] => {
        if (!raw || typeof raw !== "object") {
            return [];
        }
        const record = raw as Partial<GalleryItem>;
        const id = typeof record.id === "string" ? record.id.trim() : "";
        if (!id) {
            return [];
        }
        const now = Date.now();
        return [{
            id,
            name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : id,
            imageAssetId: typeof record.imageAssetId === "string" && record.imageAssetId.trim()
                ? record.imageAssetId.trim()
                : null,
            imageAssetName: typeof record.imageAssetName === "string" && record.imageAssetName.trim()
                ? record.imageAssetName.trim()
                : null,
            createdAt: typeof record.createdAt === "number" ? record.createdAt : now,
            updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : now,
        }];
    });
}

function createGalleryItemId(): string {
    const random = typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `${PLUGIN_ID}.${random}`;
}

function GalleryPanel({ app, store }: { app: PluginApp; store: GalleryStore }) {
    const [items, setItems] = useState<GalleryItem[]>(() => store.getItems());
    const [query, setQuery] = useState("");
    const [busy, setBusy] = useState(false);
    const [selectingItemId, setSelectingItemId] = useState<string | null>(null);
    const selectorAnchorRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => store.subscribe(() => setItems([...store.getItems()])), [store]);

    const filteredItems = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) {
            return items;
        }
        return items.filter(item =>
            item.name.toLowerCase().includes(q) ||
            item.id.toLowerCase().includes(q) ||
            item.imageAssetName?.toLowerCase().includes(q)
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

    const selectingItem = selectingItemId ? items.find(item => item.id === selectingItemId) ?? null : null;

    return (
        <ui.Panel.Root>
            <ui.Panel.Header
                title="Gallery"
                description={`${items.length} item${items.length === 1 ? "" : "s"}`}
                actions={(
                    <ui.Button size="sm" variant="primary" disabled={busy} onClick={() => void run(() => store.add())}>
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
                        title={items.length === 0 ? "No gallery items" : "No matches"}
                        description={items.length === 0 ? "Create an item and assign an image asset." : "Try another search."}
                    />
                ) : (
                    <div className="space-y-2">
                        {filteredItems.map(item => (
                            <GalleryItemRow
                                key={item.id}
                                app={app}
                                item={item}
                                busy={busy}
                                onNameChange={name => void run(() => store.patch(item.id, { name }))}
                                onSelectImage={() => setSelectingItemId(item.id)}
                                onClearImage={() => void run(() => store.patch(item.id, {
                                    imageAssetId: null,
                                    imageAssetName: null,
                                }))}
                                onRemove={() => void run(() => store.remove(item.id))}
                            />
                        ))}
                    </div>
                )}
            </ui.Panel.Section>
            <div ref={selectorAnchorRef} className="h-0 w-full" />
            <ui.AssetSelector
                visible={Boolean(selectingItem)}
                assetType={AssetType.Image}
                selectedIds={selectingItem?.imageAssetId ? [selectingItem.imageAssetId] : []}
                anchorRef={selectorAnchorRef}
                title="Select gallery image"
                onClose={() => setSelectingItemId(null)}
                onConfirm={assets => {
                    const image = assets[0] as Asset | undefined;
                    if (!selectingItem || !image) {
                        return;
                    }
                    void run(() => store.patch(selectingItem.id, {
                        imageAssetId: image.id,
                        imageAssetName: image.name,
                    }));
                }}
            />
        </ui.Panel.Root>
    );
}

function GalleryItemRow({
    app,
    item,
    busy,
    onNameChange,
    onSelectImage,
    onClearImage,
    onRemove,
}: {
    app: PluginApp;
    item: GalleryItem;
    busy: boolean;
    onNameChange: (name: string) => void;
    onSelectImage: () => void;
    onClearImage: () => void;
    onRemove: () => void;
}) {
    const [draftName, setDraftName] = useState(item.name);

    useEffect(() => {
        setDraftName(item.name);
    }, [item.name]);

    return (
        <div className="rounded-md border border-white/10 bg-white/[0.03] p-2">
            <div className="flex min-w-0 gap-2">
                <GalleryImagePreview app={app} item={item} />
                <div className="min-w-0 flex-1 space-y-2">
                    <ui.Input
                        size="sm"
                        fullWidth
                        value={draftName}
                        onChange={event => setDraftName(event.target.value)}
                        onBlur={() => {
                            const next = draftName.trim();
                            if (next && next !== item.name) {
                                onNameChange(next);
                            } else {
                                setDraftName(item.name);
                            }
                        }}
                    />
                    <div className="flex min-w-0 items-center gap-1.5">
                        <ui.Button size="sm" variant="secondary" disabled={busy} onClick={onSelectImage}>
                            <ImagePlus size={13} />
                            Image
                        </ui.Button>
                        <ui.IconButton
                            size="sm"
                            variant="ghost"
                            aria-label="Remove image"
                            title="Remove image"
                            disabled={busy || !item.imageAssetId}
                            onClick={onClearImage}
                            className={!item.imageAssetId ? "hidden" : ""}
                        >
                            <X size={13} />
                        </ui.IconButton>
                        <ui.IconButton
                            size="sm"
                            variant="danger"
                            aria-label="Delete gallery item"
                            title="Delete gallery item"
                            disabled={busy}
                            onClick={onRemove}
                        >
                            <Trash2 size={13} />
                        </ui.IconButton>
                    </div>
                    <div className="truncate text-[11px] text-gray-500">
                        {item.imageAssetName || item.imageAssetId || "No image selected"}
                    </div>
                </div>
            </div>
        </div>
    );
}

function GalleryImagePreview({ app, item }: { app: PluginApp; item: GalleryItem }) {
    const [url, setUrl] = useState<string | null>(null);

    useEffect(() => {
        let disposed = false;
        let localUrl: string | null = null;
        const asset = item.imageAssetId
            ? app.services.assets.get(AssetType.Image, item.imageAssetId)
            : undefined;
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
    }, [app, item.imageAssetId]);

    return (
        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded border border-white/10 bg-black/20">
            {url ? (
                <img src={url} alt="" className="h-full w-full object-cover" />
            ) : (
                <Images size={18} className="text-gray-500" />
            )}
        </div>
    );
}

export default definePlugin({
    async setup(app) {
        const store = createGalleryStore(app);
        await store.load();

        const unregisterOptions = app.services.blueprintNodes.registerDynamicSelectOptionsSource(
            DYNAMIC_OPTIONS_SOURCE,
            () => store.getOptions(),
        );
        app.services.blueprintNodes.registerMany(createGalleryBlueprintNodes());
        const unregisterPanel = app.services.ui.panels.register({
            id: PANEL_ID,
            title: "Gallery",
            icon: <Images size={16} />,
            position: PanelPosition.Left,
            component: () => <GalleryPanel app={app} store={store} />,
            defaultVisible: false,
            order: 640,
        });

        return () => {
            unregisterPanel();
            unregisterOptions();
        };
    },
});
