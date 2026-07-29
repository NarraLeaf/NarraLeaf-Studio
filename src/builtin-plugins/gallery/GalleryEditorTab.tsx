/**
 * The Gallery editor tab: the authoring surface for the whole catalog.
 *
 * Laid out as groups / grid / inspector because a gallery is browsed visually -
 * the old side-panel list showed 40px thumbnails of artwork whose entire point
 * is how it looks. The grid is the primary object here; everything else is
 * chrome around it.
 *
 * ## Elastic complexity
 *
 * The same catalog serves a flat single-CG gallery and a multi-differential one,
 * and the UI is what makes both feel native:
 *
 * - "Import CGs" turns N picked images into N one-image artworks. That is the
 *   whole authoring flow for a simple gallery, and the word "variant" never
 *   appears.
 * - A card only shows its variant count once it has more than one, so the second
 *   level of the model stays invisible until the author asks for it.
 * - "Add differentials" on a selected artwork promotes it in place. No
 *   conversion step, no migration - a single-CG artwork already *is* a
 *   one-variant artwork.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
    ChevronRight,
    Eye,
    EyeOff,
    FolderPlus,
    ImagePlus,
    Images,
    Layers,
    Plus,
    Star,
    Trash2,
    X,
} from "lucide-react";
import {
    AssetType,
    ui,
    type Asset,
    type PluginApp,
} from "narraleaf-studio/plugin";
import {
    DEFAULT_LOCKED_NAME_MASK,
    resolveCoverVariant,
    type GalleryArtwork,
    type GalleryVariant,
} from "./catalog";
import { GalleryThumb, InlineNameInput } from "./components";
import type { GalleryStore } from "./store";

/** Sentinel group filters that are not real group ids. */
const GROUP_ALL = "__all";
const GROUP_UNGROUPED = "__none";

const DRAG_ARTWORK_MIME = "application/x-narraleaf-gallery-artwork";

type PickerTarget =
    | { kind: "import" }
    | { kind: "variants"; artworkId: string }
    | { kind: "variantImage"; artworkId: string; variantId: string }
    | { kind: "lockedImage"; artworkId: string }
    | { kind: "defaultLockedImage" };

export function GalleryEditorTab({ app, store }: { app: PluginApp; store: GalleryStore }) {
    const [data, setData] = useState(() => store.getData());
    const [query, setQuery] = useState("");
    const [groupFilter, setGroupFilter] = useState<string>(GROUP_ALL);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [picker, setPicker] = useState<PickerTarget | null>(null);
    const [showSettings, setShowSettings] = useState(false);
    const anchorRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => store.subscribe(() => setData({ ...store.getData() })), [store]);

    const run = async (action: () => Promise<unknown>) => {
        setBusy(true);
        try {
            await action();
        } catch (error) {
            app.services.ui.notifications.error(error instanceof Error ? error.message : String(error));
        } finally {
            setBusy(false);
        }
    };

    const visibleArtworks = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return data.items.filter(artwork => {
            if (groupFilter === GROUP_UNGROUPED && artwork.groupId) {
                return false;
            }
            if (groupFilter !== GROUP_ALL && groupFilter !== GROUP_UNGROUPED && artwork.groupId !== groupFilter) {
                return false;
            }
            if (!needle) {
                return true;
            }
            return artwork.name.toLowerCase().includes(needle)
                || artwork.description.toLowerCase().includes(needle)
                || artwork.variants.some(variant =>
                    variant.name.toLowerCase().includes(needle)
                    || variant.imageAssetName?.toLowerCase().includes(needle));
        });
    }, [data.items, groupFilter, query]);

    // Selection is kept honest against deletes and filter changes, so bulk
    // actions can never act on an artwork the author can no longer see.
    const selection = useMemo(() => {
        const visible = new Set(visibleArtworks.map(artwork => artwork.id));
        return selectedIds.filter(id => visible.has(id));
    }, [selectedIds, visibleArtworks]);

    const selectedArtwork = selection.length === 1
        ? data.items.find(artwork => artwork.id === selection[0]) ?? null
        : null;

    const imageCount = data.items.reduce((total, artwork) => total + artwork.variants.length, 0);

    const groupTargetForNew = groupFilter === GROUP_ALL || groupFilter === GROUP_UNGROUPED ? null : groupFilter;

    const toggleSelection = (artworkId: string, additive: boolean) => {
        setSelectedIds(previous => {
            if (!additive) {
                return [artworkId];
            }
            return previous.includes(artworkId)
                ? previous.filter(id => id !== artworkId)
                : [...previous, artworkId];
        });
    };

    const onPickerConfirm = (assets: Asset[]) => {
        const target = picker;
        setPicker(null);
        if (!target || assets.length === 0) {
            return;
        }
        const first = assets[0]!;
        switch (target.kind) {
            case "import":
                void run(async () => {
                    const created = await store.importArtworks(assets, groupTargetForNew);
                    setSelectedIds(created.slice(-1));
                });
                return;
            case "variants":
                void run(() => store.addVariants(target.artworkId, assets));
                return;
            case "variantImage":
                void run(() => store.patchVariant(target.artworkId, target.variantId, {
                    imageAssetId: first.id,
                    imageAssetName: first.name,
                }));
                return;
            case "lockedImage":
                void run(() => store.patchArtworkFields(target.artworkId, {
                    lockedImageAssetId: first.id,
                    lockedImageAssetName: first.name,
                }));
                return;
            case "defaultLockedImage":
                void run(() => store.patchSettings({
                    lockedImageAssetId: first.id,
                    lockedImageAssetName: first.name,
                }));
        }
    };

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface text-fg">
            <header className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
                <Images size={15} className="text-fg-muted" />
                <span className="text-sm">Gallery</span>
                <span className="text-2xs text-fg-subtle">
                    {data.items.length} artwork{data.items.length === 1 ? "" : "s"} · {imageCount} image{imageCount === 1 ? "" : "s"}
                </span>
                <div className="ml-auto flex items-center gap-2">
                    <ui.SearchInput
                        size="sm"
                        placeholder="Search"
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                    />
                    <ui.Button size="sm" variant="secondary" disabled={busy} onClick={() => setPicker({ kind: "import" })}>
                        <ImagePlus size={13} />
                        Import CGs
                    </ui.Button>
                    <ui.Button
                        size="sm"
                        variant="primary"
                        disabled={busy}
                        onClick={() => void run(async () => {
                            setSelectedIds([await store.addArtwork(groupTargetForNew)]);
                        })}
                    >
                        <Plus size={13} />
                        Artwork
                    </ui.Button>
                </div>
            </header>

            <div className="flex min-h-0 flex-1">
                <GroupSidebar
                    store={store}
                    groups={data.groups}
                    items={data.items}
                    active={groupFilter}
                    busy={busy}
                    onSelect={setGroupFilter}
                    onRun={run}
                    settingsOpen={showSettings}
                    onToggleSettings={() => setShowSettings(open => !open)}
                />

                <main className="min-w-0 flex-1 overflow-y-auto p-3">
                    {showSettings ? (
                        <GallerySettingsForm
                            app={app}
                            store={store}
                            busy={busy}
                            onPickPlaceholder={() => setPicker({ kind: "defaultLockedImage" })}
                            onRun={run}
                        />
                    ) : visibleArtworks.length === 0 ? (
                        <EmptyGrid
                            hasCatalog={data.items.length > 0}
                            onImport={() => setPicker({ kind: "import" })}
                        />
                    ) : (
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
                            {visibleArtworks.map(artwork => (
                                <ArtworkCard
                                    key={artwork.id}
                                    app={app}
                                    artwork={artwork}
                                    selected={selection.includes(artwork.id)}
                                    onSelect={additive => toggleSelection(artwork.id, additive)}
                                    onDropBefore={draggedId => void run(() => store.moveArtwork(draggedId, artwork.id))}
                                />
                            ))}
                        </div>
                    )}
                </main>

                {!showSettings && selection.length > 0 && (
                    <aside className="w-72 shrink-0 overflow-y-auto border-l border-edge">
                        {selectedArtwork ? (
                            <ArtworkInspector
                                app={app}
                                store={store}
                                artwork={selectedArtwork}
                                groups={data.groups}
                                busy={busy}
                                onRun={run}
                                onClose={() => setSelectedIds([])}
                                onAddVariants={() => setPicker({ kind: "variants", artworkId: selectedArtwork.id })}
                                onPickVariantImage={variantId => setPicker({
                                    kind: "variantImage",
                                    artworkId: selectedArtwork.id,
                                    variantId,
                                })}
                                onPickLockedImage={() => setPicker({ kind: "lockedImage", artworkId: selectedArtwork.id })}
                            />
                        ) : (
                            <BulkInspector
                                store={store}
                                selection={selection}
                                groups={data.groups}
                                busy={busy}
                                onRun={run}
                                onClear={() => setSelectedIds([])}
                            />
                        )}
                    </aside>
                )}
            </div>

            <div ref={anchorRef} className="h-0 w-full" />
            <ui.AssetSelector
                visible={Boolean(picker)}
                assetType={AssetType.Image}
                multiple={picker?.kind === "import" || picker?.kind === "variants"}
                anchorRef={anchorRef}
                title={pickerTitle(picker)}
                onClose={() => setPicker(null)}
                onConfirm={assets => onPickerConfirm(assets as Asset[])}
            />
        </div>
    );
}

function pickerTitle(target: PickerTarget | null): string {
    switch (target?.kind) {
        case "import":
            return "Import CGs";
        case "variants":
            return "Add differentials";
        case "variantImage":
            return "Select image";
        case "lockedImage":
            return "Select locked placeholder";
        case "defaultLockedImage":
            return "Select default placeholder";
        default:
            return "Select image";
    }
}

function EmptyGrid({ hasCatalog, onImport }: { hasCatalog: boolean; onImport: () => void }) {
    return (
        <div className="grid h-full place-items-center">
            <div className="flex flex-col items-center gap-3 text-center">
                <Images size={26} className="text-fg-subtle" />
                <div className="text-sm text-fg-muted">
                    {hasCatalog ? "Nothing here" : "No artworks yet"}
                </div>
                {!hasCatalog && (
                    <ui.Button size="sm" variant="secondary" onClick={onImport}>
                        <ImagePlus size={13} />
                        Import CGs
                    </ui.Button>
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

function GroupSidebar({
    store,
    groups,
    items,
    active,
    busy,
    onSelect,
    onRun,
    settingsOpen,
    onToggleSettings,
}: {
    store: GalleryStore;
    groups: { id: string; name: string }[];
    items: GalleryArtwork[];
    active: string;
    busy: boolean;
    onSelect: (groupId: string) => void;
    onRun: (action: () => Promise<unknown>) => Promise<void>;
    settingsOpen: boolean;
    onToggleSettings: () => void;
}) {
    const [renamingId, setRenamingId] = useState<string | null>(null);

    const countFor = (groupId: string) => {
        if (groupId === GROUP_ALL) {
            return items.length;
        }
        if (groupId === GROUP_UNGROUPED) {
            return items.filter(artwork => !artwork.groupId).length;
        }
        return items.filter(artwork => artwork.groupId === groupId).length;
    };

    const ungroupedCount = countFor(GROUP_UNGROUPED);

    /** Dropping a card on a group row files it there - the direct gesture. */
    const dropArtwork = (groupId: string | null) => (event: React.DragEvent) => {
        const artworkId = event.dataTransfer.getData(DRAG_ARTWORK_MIME);
        if (!artworkId) {
            return;
        }
        event.preventDefault();
        void onRun(() => store.patchArtworkFields(artworkId, { groupId }));
    };

    const allowArtworkDrop = (event: React.DragEvent) => {
        if (event.dataTransfer.types.includes(DRAG_ARTWORK_MIME)) {
            event.preventDefault();
        }
    };

    return (
        <nav className="flex w-44 shrink-0 flex-col border-r border-edge">
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                <GroupRow
                    label="All"
                    count={countFor(GROUP_ALL)}
                    active={active === GROUP_ALL && !settingsOpen}
                    onClick={() => onSelect(GROUP_ALL)}
                />
                {groups.map(group => (
                    <div
                        key={group.id}
                        onDragOver={allowArtworkDrop}
                        onDrop={dropArtwork(group.id)}
                    >
                        {renamingId === group.id ? (
                            <div className="px-1 py-0.5">
                                <InlineNameInput
                                    value={group.name}
                                    onCommit={name => {
                                        setRenamingId(null);
                                        void onRun(() => store.renameGroup(group.id, name));
                                    }}
                                />
                            </div>
                        ) : (
                            <GroupRow
                                label={group.name}
                                count={countFor(group.id)}
                                active={active === group.id && !settingsOpen}
                                onClick={() => onSelect(group.id)}
                                onDoubleClick={() => setRenamingId(group.id)}
                                onRemove={() => void onRun(async () => {
                                    await store.removeGroup(group.id);
                                    if (active === group.id) {
                                        onSelect(GROUP_ALL);
                                    }
                                })}
                            />
                        )}
                    </div>
                ))}
                {/* Only worth a row once grouping is actually in use. */}
                {groups.length > 0 && ungroupedCount > 0 && (
                    <div onDragOver={allowArtworkDrop} onDrop={dropArtwork(null)}>
                        <GroupRow
                            label="Ungrouped"
                            count={ungroupedCount}
                            active={active === GROUP_UNGROUPED && !settingsOpen}
                            onClick={() => onSelect(GROUP_UNGROUPED)}
                        />
                    </div>
                )}
            </div>
            <div className="shrink-0 border-t border-edge p-1.5">
                <button
                    type="button"
                    disabled={busy}
                    className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-2xs text-fg-muted hover:bg-fill-subtle hover:text-fg"
                    onClick={() => void onRun(() => store.addGroup())}
                >
                    <FolderPlus size={12} />
                    New group
                </button>
                <button
                    type="button"
                    className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-2xs hover:bg-fill-subtle hover:text-fg ${settingsOpen ? "bg-fill-subtle text-fg" : "text-fg-muted"}`}
                    onClick={onToggleSettings}
                >
                    <Layers size={12} />
                    Locked look
                </button>
            </div>
        </nav>
    );
}

function GroupRow({
    label,
    count,
    active,
    onClick,
    onDoubleClick,
    onRemove,
}: {
    label: string;
    count: number;
    active: boolean;
    onClick: () => void;
    onDoubleClick?: () => void;
    onRemove?: () => void;
}) {
    return (
        <div
            className={`group flex cursor-default items-center gap-1 rounded px-2 py-1 text-2xs ${active ? "bg-fill text-fg" : "text-fg-muted hover:bg-fill-subtle"}`}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
        >
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <span className="shrink-0 tabular-nums text-fg-subtle">{count}</span>
            {onRemove && (
                <button
                    type="button"
                    aria-label={`Delete group ${label}`}
                    className="hidden shrink-0 text-fg-subtle hover:text-danger group-hover:block"
                    onClick={event => {
                        event.stopPropagation();
                        onRemove();
                    }}
                >
                    <X size={11} />
                </button>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

function ArtworkCard({
    app,
    artwork,
    selected,
    onSelect,
    onDropBefore,
}: {
    app: PluginApp;
    artwork: GalleryArtwork;
    selected: boolean;
    onSelect: (additive: boolean) => void;
    onDropBefore: (draggedArtworkId: string) => void;
}) {
    const [dropTarget, setDropTarget] = useState(false);
    const cover = resolveCoverVariant(artwork);
    const hasDifferentials = artwork.variants.length > 1;

    return (
        <div
            // `nl-drag-source` is required in this repo: bare `draggable` is inert.
            className={`nl-drag-source group relative flex cursor-default flex-col overflow-hidden rounded-md border transition-colors ${
                selected ? "border-primary ring-1 ring-primary" : "border-edge hover:border-edge-strong"
            } ${dropTarget ? "border-l-2 border-l-primary" : ""}`}
            draggable
            onDragStart={event => {
                event.dataTransfer.setData(DRAG_ARTWORK_MIME, artwork.id);
                event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={event => {
                if (event.dataTransfer.types.includes(DRAG_ARTWORK_MIME)) {
                    event.preventDefault();
                    setDropTarget(true);
                }
            }}
            onDragLeave={() => setDropTarget(false)}
            onDrop={event => {
                setDropTarget(false);
                const draggedId = event.dataTransfer.getData(DRAG_ARTWORK_MIME);
                if (draggedId && draggedId !== artwork.id) {
                    event.preventDefault();
                    onDropBefore(draggedId);
                }
            }}
            onClick={event => onSelect(event.ctrlKey || event.metaKey || event.shiftKey)}
        >
            <GalleryThumb app={app} assetId={cover?.imageAssetId} className="aspect-video w-full" />
            <div className="flex items-center gap-1 px-1.5 py-1">
                <span className="min-w-0 flex-1 truncate text-2xs" title={artwork.name}>{artwork.name}</span>
                {/* The second level of the model stays hidden until it exists. */}
                {hasDifferentials && (
                    <span className="flex shrink-0 items-center gap-0.5 text-2xs text-fg-subtle" title={`${artwork.variants.length} differentials`}>
                        <Layers size={10} />
                        {artwork.variants.length}
                    </span>
                )}
                {artwork.hidden && (
                    <span className="shrink-0 text-fg-subtle" title="Hidden until unlocked">
                        <EyeOff size={11} />
                    </span>
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block space-y-1">
            <span className="text-2xs text-fg-subtle">{label}</span>
            {children}
        </label>
    );
}

function ArtworkInspector({
    app,
    store,
    artwork,
    groups,
    busy,
    onRun,
    onClose,
    onAddVariants,
    onPickVariantImage,
    onPickLockedImage,
}: {
    app: PluginApp;
    store: GalleryStore;
    artwork: GalleryArtwork;
    groups: { id: string; name: string }[];
    busy: boolean;
    onRun: (action: () => Promise<unknown>) => Promise<void>;
    onClose: () => void;
    onAddVariants: () => void;
    onPickVariantImage: (variantId: string) => void;
    onPickLockedImage: () => void;
}) {
    const cover = resolveCoverVariant(artwork);

    return (
        <div className="flex flex-col gap-3 p-3">
            <div className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-2xs text-fg-subtle">Artwork</span>
                <ui.IconButton size="sm" variant="ghost" aria-label="Close inspector" onClick={onClose}>
                    <X size={12} />
                </ui.IconButton>
            </div>

            <GalleryThumb
                app={app}
                assetId={cover?.imageAssetId}
                fit="contain"
                className="aspect-video w-full rounded border border-edge"
            />

            <Field label="Name">
                <InlineNameInput
                    value={artwork.name}
                    onCommit={name => void onRun(() => store.patchArtworkFields(artwork.id, { name }))}
                />
            </Field>

            <Field label="Description">
                <ui.TextArea
                    size="sm"
                    fullWidth
                    rows={2}
                    placeholder="Shown in the viewer once unlocked"
                    defaultValue={artwork.description}
                    key={`${artwork.id}:description`}
                    onBlur={event => {
                        const next = event.target.value;
                        if (next !== artwork.description) {
                            void onRun(() => store.patchArtworkFields(artwork.id, { description: next }));
                        }
                    }}
                />
            </Field>

            <Field label="Group">
                <ui.Select
                    size="sm"
                    fullWidth
                    value={artwork.groupId ?? ""}
                    options={[
                        { value: "", label: "Ungrouped" },
                        ...groups.map(group => ({ value: group.id, label: group.name })),
                    ]}
                    onChange={value => void onRun(() => store.patchArtworkFields(artwork.id, {
                        groupId: String(value) || null,
                    }))}
                />
            </Field>

            <button
                type="button"
                disabled={busy}
                className="flex items-center gap-2 rounded px-1 py-1 text-2xs text-fg-muted hover:bg-fill-subtle hover:text-fg"
                onClick={() => void onRun(() => store.patchArtworkFields(artwork.id, { hidden: !artwork.hidden }))}
            >
                {artwork.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                {artwork.hidden ? "Hidden until unlocked" : "Shown as a locked slot"}
            </button>

            <div className="space-y-1">
                <div className="flex items-center gap-1">
                    <span className="flex-1 text-2xs text-fg-subtle">
                        {artwork.variants.length > 1 ? `Differentials (${artwork.variants.length})` : "Image"}
                    </span>
                    <ui.Button size="sm" variant="secondary" disabled={busy} onClick={onAddVariants}>
                        <Plus size={11} />
                        Add
                    </ui.Button>
                </div>
                {artwork.variants.length === 0 ? (
                    <p className="px-1 text-2xs text-fg-subtle">No image yet.</p>
                ) : (
                    <div className="space-y-1">
                        {artwork.variants.map(variant => (
                            <VariantRow
                                key={variant.id}
                                app={app}
                                variant={variant}
                                busy={busy}
                                // Only meaningful once there is a choice to make.
                                showCoverControl={artwork.variants.length > 1}
                                isCover={variant.id === cover?.id}
                                isExplicitCover={variant.id === artwork.coverVariantId}
                                onRename={name => void onRun(() => store.patchVariant(artwork.id, variant.id, { name }))}
                                onPickImage={() => onPickVariantImage(variant.id)}
                                onSetCover={() => void onRun(() => store.setCoverVariant(artwork.id, variant.id))}
                                onRemove={() => void onRun(() => store.removeVariant(artwork.id, variant.id))}
                            />
                        ))}
                    </div>
                )}
            </div>

            <Field label="Locked placeholder">
                <div className="flex items-center gap-2">
                    <GalleryThumb
                        app={app}
                        assetId={artwork.lockedImageAssetId}
                        className="h-9 w-14 shrink-0 rounded border border-edge"
                    />
                    <ui.Button size="sm" variant="secondary" disabled={busy} onClick={onPickLockedImage}>
                        Pick
                    </ui.Button>
                    {artwork.lockedImageAssetId && (
                        <ui.IconButton
                            size="sm"
                            variant="ghost"
                            aria-label="Use the catalog default"
                            title="Use the catalog default"
                            disabled={busy}
                            onClick={() => void onRun(() => store.patchArtworkFields(artwork.id, {
                                lockedImageAssetId: null,
                                lockedImageAssetName: null,
                            }))}
                        >
                            <X size={12} />
                        </ui.IconButton>
                    )}
                </div>
            </Field>

            <ui.Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() => void onRun(async () => {
                    await store.removeArtworks([artwork.id]);
                    onClose();
                })}
            >
                <Trash2 size={12} />
                Delete artwork
            </ui.Button>
        </div>
    );
}

function VariantRow({
    app,
    variant,
    busy,
    showCoverControl,
    isCover,
    isExplicitCover,
    onRename,
    onPickImage,
    onSetCover,
    onRemove,
}: {
    app: PluginApp;
    variant: GalleryVariant;
    busy: boolean;
    showCoverControl: boolean;
    isCover: boolean;
    isExplicitCover: boolean;
    onRename: (name: string) => void;
    onPickImage: () => void;
    onSetCover: () => void;
    onRemove: () => void;
}) {
    return (
        <div className="group flex items-center gap-1.5 rounded border border-edge bg-fill-subtle p-1">
            <button
                type="button"
                aria-label="Change image"
                title={variant.imageAssetName ?? "Pick an image"}
                className="shrink-0"
                disabled={busy}
                onClick={onPickImage}
            >
                <GalleryThumb app={app} assetId={variant.imageAssetId} className="h-8 w-12 rounded" />
            </button>
            <div className="min-w-0 flex-1">
                <InlineNameInput value={variant.name} onCommit={onRename} />
            </div>
            {showCoverControl && (
                <ui.IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={isExplicitCover ? "Clear cover" : "Use as cover"}
                    title={isExplicitCover ? "Clear cover" : isCover ? "Default cover (first)" : "Use as cover"}
                    disabled={busy}
                    className={isCover ? "text-primary" : ""}
                    onClick={onSetCover}
                >
                    <Star size={12} fill={isExplicitCover ? "currentColor" : "none"} />
                </ui.IconButton>
            )}
            <ui.IconButton
                size="sm"
                variant="ghost"
                aria-label="Delete"
                title="Delete"
                disabled={busy}
                className="text-fg-subtle hover:text-danger"
                onClick={onRemove}
            >
                <Trash2 size={12} />
            </ui.IconButton>
        </div>
    );
}

function BulkInspector({
    store,
    selection,
    groups,
    busy,
    onRun,
    onClear,
}: {
    store: GalleryStore;
    selection: string[];
    groups: { id: string; name: string }[];
    busy: boolean;
    onRun: (action: () => Promise<unknown>) => Promise<void>;
    onClear: () => void;
}) {
    return (
        <div className="flex flex-col gap-3 p-3">
            <div className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-2xs text-fg-subtle">
                    {selection.length} selected
                </span>
                <ui.IconButton size="sm" variant="ghost" aria-label="Clear selection" onClick={onClear}>
                    <X size={12} />
                </ui.IconButton>
            </div>

            <Field label="Move to group">
                <ui.Select
                    size="sm"
                    fullWidth
                    value=""
                    options={[
                        { value: "", label: "Pick a group" },
                        { value: GROUP_UNGROUPED, label: "Ungrouped" },
                        ...groups.map(group => ({ value: group.id, label: group.name })),
                    ]}
                    onChange={async raw => {
                        const value = String(raw);
                        if (!value) {
                            return;
                        }
                        const groupId = value === GROUP_UNGROUPED ? null : value;
                        await onRun(async () => {
                            for (const artworkId of selection) {
                                await store.patchArtworkFields(artworkId, { groupId });
                            }
                        });
                    }}
                />
            </Field>

            <ui.Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() => void onRun(async () => {
                    await store.removeArtworks(selection);
                    onClear();
                })}
            >
                <Trash2 size={12} />
                Delete {selection.length}
            </ui.Button>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Catalog-wide settings
// ---------------------------------------------------------------------------

function GallerySettingsForm({
    app,
    store,
    busy,
    onPickPlaceholder,
    onRun,
}: {
    app: PluginApp;
    store: GalleryStore;
    busy: boolean;
    onPickPlaceholder: () => void;
    onRun: (action: () => Promise<unknown>) => Promise<void>;
}) {
    const settings = store.getSettings();

    return (
        <div className="max-w-md space-y-4">
            <div className="flex items-center gap-1.5 text-2xs text-fg-subtle">
                <ChevronRight size={11} />
                How locked artworks look in game
            </div>

            <Field label="Default placeholder">
                <div className="flex items-center gap-2">
                    <GalleryThumb
                        app={app}
                        assetId={settings.lockedImageAssetId}
                        className="h-16 w-24 shrink-0 rounded border border-edge"
                    />
                    <ui.Button size="sm" variant="secondary" disabled={busy} onClick={onPickPlaceholder}>
                        Pick
                    </ui.Button>
                    {settings.lockedImageAssetId && (
                        <ui.IconButton
                            size="sm"
                            variant="ghost"
                            aria-label="Clear placeholder"
                            title="Clear placeholder"
                            disabled={busy}
                            onClick={() => void onRun(() => store.patchSettings({
                                lockedImageAssetId: null,
                                lockedImageAssetName: null,
                            }))}
                        >
                            <X size={12} />
                        </ui.IconButton>
                    )}
                </div>
            </Field>

            <Field label="Locked title">
                <InlineNameInput
                    value={settings.lockedNameMask}
                    allowEmpty
                    placeholder={DEFAULT_LOCKED_NAME_MASK}
                    onCommit={lockedNameMask => void onRun(() => store.patchSettings({ lockedNameMask }))}
                />
            </Field>
            <p className="text-2xs text-fg-subtle">
                Empty shows the real title while locked.
            </p>
        </div>
    );
}
