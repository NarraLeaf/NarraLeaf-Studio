/**
 * The Gallery editor tab: the authoring surface for all four EXTRA columns.
 *
 * The layout decisions here are argued in ./design.md - read that before moving
 * anything. In short: kind is the primary axis (segments), group is secondary
 * (chips), image-identified kinds get a grid and audio-identified kinds get a
 * list, the inspector column is always mounted so the content never reflows, and
 * its idle state is where the blueprint contract is taught.
 *
 * Every component that writes calls `ui.useFreezeGuard()` rather than taking the
 * guard as a prop: it is what Studio's own panels do, and threading one more
 * argument through eight components is how a control gets missed. What the guard
 * must NOT touch is as load-bearing as what it does - switching columns,
 * filtering by group, selecting an entry, auditioning a clip and reading the
 * inspector all stay live, because a frozen project is one the author opened to
 * look at.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
    Clapperboard,
    Eye,
    EyeOff,
    Images,
    Layers,
    MessageSquareQuote,
    Music,
    Pause,
    Play,
    Plus,
    Search,
    SlidersHorizontal,
    Star,
    Trash2,
    X,
} from "lucide-react";
import {
    AssetType,
    ui,
    type Asset,
    type PluginApp,
    type PluginSceneEntry,
    type PluginStoryEntry,
    type PluginVoiceUnitEntry,
} from "narraleaf-studio/plugin";
import {
    DEFAULT_LOCKED_NAME_MASK,
    GALLERY_ENTRY_KINDS,
    isAudioGalleryKind,
    resolveCoverVariant,
    type GalleryArtwork,
    type GalleryEntryKind,
    type GalleryGroup,
    type GalleryVariant,
} from "./catalog";
import { GalleryThumb, InlineNameInput, formatDuration, useAudioAudition } from "./components";
import type { GalleryStore } from "./store";

/** Sentinel group filters that are not real group ids. */
const GROUP_ALL = "__all";
const GROUP_UNGROUPED = "__none";

const DRAG_ENTRY_MIME = "application/x-narraleaf-gallery-entry";

type KindMeta = {
    label: string;
    /**
     * How the kind reads mid-sentence. Not derivable from `label`: lowercasing
     * it turns the CG acronym into "cg".
     */
    noun: string;
    /** The primary action's verb for this column. */
    createLabel: string;
    icon: typeof Images;
    /** Grid for kinds identified by a picture, list for kinds identified by sound or text. */
    layout: "grid" | "list";
    /** What the idle inspector says a row of this kind carries. */
    rowFields: string;
};

const KIND_META: Record<GalleryEntryKind, KindMeta> = {
    cg: {
        label: "CG",
        noun: "CG",
        createLabel: "Import CGs",
        icon: Images,
        layout: "grid",
        rowFields: "name, image, unlocked, variantCount",
    },
    scene: {
        label: "Recollection",
        noun: "recollection",
        createLabel: "Add Recollection",
        icon: Clapperboard,
        layout: "grid",
        rowFields: "name, image, unlocked, storyId, sceneId",
    },
    music: {
        label: "Music",
        noun: "track or album",
        createLabel: "Import Tracks",
        icon: Music,
        layout: "list",
        rowFields: "name, audioAssetId, durationSec, unlocked",
    },
    voice: {
        label: "Voice",
        noun: "voice set",
        createLabel: "Add Voice Lines",
        icon: MessageSquareQuote,
        layout: "list",
        rowFields: "name, voiceUnitId, lineText, unlocked",
    },
};

type PickerTarget =
    | { kind: "importCgs" }
    | { kind: "importTracks" }
    | { kind: "coverImage"; artworkId: string }
    | { kind: "addImages"; artworkId: string }
    | { kind: "addTracks"; artworkId: string }
    | { kind: "variantImage"; artworkId: string; variantId: string }
    | { kind: "lockedImage"; artworkId: string }
    | { kind: "defaultLockedImage" };

type Audition = ReturnType<typeof useAudioAudition>;

export function GalleryEditorTab({ app, store }: { app: PluginApp; store: GalleryStore }) {
    const [data, setData] = useState(() => store.getData());
    const [activeKind, setActiveKind] = useState<GalleryEntryKind>("cg");
    const [query, setQuery] = useState("");
    const [groupFilter, setGroupFilter] = useState<string>(GROUP_ALL);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [picker, setPicker] = useState<PickerTarget | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [voicePickerFor, setVoicePickerFor] = useState<string | null>(null);
    const anchorRef = useRef<HTMLDivElement | null>(null);
    const audition = useAudioAudition(app);
    const freeze = ui.useFreezeGuard();

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

    const countsByKind = useMemo(() => {
        const counts: Record<GalleryEntryKind, number> = { cg: 0, scene: 0, music: 0, voice: 0 };
        for (const item of data.items) {
            counts[item.kind] += 1;
        }
        return counts;
    }, [data.items]);

    const meta = KIND_META[activeKind];

    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return data.items.filter(item => {
            if (item.kind !== activeKind) {
                return false;
            }
            if (groupFilter === GROUP_UNGROUPED && item.groupId) {
                return false;
            }
            if (groupFilter !== GROUP_ALL && groupFilter !== GROUP_UNGROUPED && item.groupId !== groupFilter) {
                return false;
            }
            if (!needle) {
                return true;
            }
            return item.name.toLowerCase().includes(needle)
                || item.description.toLowerCase().includes(needle)
                || item.variants.some(variant =>
                    variant.name.toLowerCase().includes(needle)
                    || variant.lineText?.toLowerCase().includes(needle)
                    || variant.imageAssetName?.toLowerCase().includes(needle)
                    || variant.audioAssetName?.toLowerCase().includes(needle));
        });
    }, [activeKind, data.items, groupFilter, query]);

    // Selection is kept honest against deletes, kind switches and filters, so a
    // bulk action can never touch an entry the author cannot see.
    const selection = useMemo(() => {
        const ids = new Set(visible.map(item => item.id));
        return selectedIds.filter(id => ids.has(id));
    }, [selectedIds, visible]);

    const selected = selection.length === 1
        ? data.items.find(item => item.id === selection[0]) ?? null
        : null;

    const itemCount = data.items.reduce((total, item) => total + item.variants.length, 0);
    const groupForNew = groupFilter === GROUP_ALL || groupFilter === GROUP_UNGROUPED ? null : groupFilter;

    const primaryAction = () => {
        switch (activeKind) {
            case "cg":
                setPicker({ kind: "importCgs" });
                return;
            case "music":
                setPicker({ kind: "importTracks" });
                return;
            default:
                // Recollections and voice sets have nothing to import: the next
                // step is picking a scene or lines, in the inspector.
                void run(async () => setSelectedIds([await store.addArtwork(activeKind, groupForNew)]));
        }
    };

    const onPickerConfirm = (assets: Asset[]) => {
        const target = picker;
        setPicker(null);
        if (!target || assets.length === 0) {
            return;
        }
        const first = assets[0]!;
        switch (target.kind) {
            case "importCgs":
                void run(async () => setSelectedIds((await store.importArtworks(assets, groupForNew)).slice(-1)));
                return;
            case "importTracks":
                void run(async () => setSelectedIds([await store.importTracks(assets, groupForNew)]));
                return;
            case "addImages":
                void run(() => store.addVariants(target.artworkId, assets));
                return;
            case "addTracks":
                void run(() => store.addAudioVariants(target.artworkId, assets));
                return;
            case "coverImage":
                void run(() => store.addVariants(target.artworkId, [first]));
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

    const pickerWantsAudio = picker?.kind === "importTracks" || picker?.kind === "addTracks";
    const pickerWantsMany = picker?.kind === "importCgs"
        || picker?.kind === "importTracks"
        || picker?.kind === "addImages"
        || picker?.kind === "addTracks";

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface text-fg">
            <header className="shrink-0 border-b border-edge">
                <div className="flex items-center gap-2 px-3 pt-2">
                    <Images size={15} className="text-fg-muted" />
                    <span className="text-sm">Gallery</span>
                    <span className="text-2xs text-fg-subtle">
                        {data.items.length} {data.items.length === 1 ? "entry" : "entries"}
                        {" · "}
                        {itemCount} {itemCount === 1 ? "item" : "items"}
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                        <ui.SearchInput
                            size="sm"
                            placeholder="Search"
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                        />
                        <ui.Button
                            size="sm"
                            variant="primary"
                            onClick={primaryAction}
                            {...freeze.writes(busy)}
                        >
                            <Plus size={13} />
                            {meta.createLabel}
                        </ui.Button>
                        {/* A modal, not a navigation row: it changes settings, not what this pane shows. */}
                        <ui.IconButton
                            size="sm"
                            variant="ghost"
                            aria-label="Locked look"
                            title="How locked entries look in game"
                            onClick={() => setSettingsOpen(true)}
                        >
                            <SlidersHorizontal size={13} />
                        </ui.IconButton>
                    </div>
                </div>

                <div className="flex items-center gap-0.5 px-3 pt-1.5">
                    {GALLERY_ENTRY_KINDS.map(kind => {
                        const kindMeta = KIND_META[kind];
                        const Icon = kindMeta.icon;
                        const active = kind === activeKind;
                        return (
                            <button
                                key={kind}
                                type="button"
                                className={`flex items-center gap-1.5 rounded-t border-b-2 px-2.5 py-1.5 text-2xs transition-colors ${
                                    active
                                        ? "border-primary text-fg"
                                        : "border-transparent text-fg-muted hover:bg-fill-subtle hover:text-fg"
                                }`}
                                onClick={() => {
                                    setActiveKind(kind);
                                    audition.stop();
                                }}
                            >
                                <Icon size={12} />
                                {kindMeta.label}
                                <span className="tabular-nums text-fg-subtle">{countsByKind[kind]}</span>
                            </button>
                        );
                    })}
                </div>
            </header>

            <GroupChips
                groups={data.groups}
                items={data.items.filter(item => item.kind === activeKind)}
                active={groupFilter}
                busy={busy}
                onSelect={setGroupFilter}
                onCreate={() => void run(() => store.addGroup())}
                onRename={(groupId, name) => void run(() => store.renameGroup(groupId, name))}
                onRemove={groupId => void run(async () => {
                    await store.removeGroup(groupId);
                    if (groupFilter === groupId) {
                        setGroupFilter(GROUP_ALL);
                    }
                })}
                onDropEntry={(entryId, groupId) => void run(() => store.patchArtworkFields(entryId, { groupId }))}
            />

            <div className="flex min-h-0 flex-1">
                <main className="min-w-0 flex-1 overflow-y-auto p-3">
                    {visible.length === 0 ? (
                        <EmptyPane
                            meta={meta}
                            filtered={countsByKind[activeKind] > 0}
                            onCreate={primaryAction}
                        />
                    ) : meta.layout === "grid" ? (
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
                            {visible.map(item => (
                                <EntryCard
                                    key={item.id}
                                    app={app}
                                    entry={item}
                                    selected={selection.includes(item.id)}
                                    onSelect={additive => toggleSelection(setSelectedIds, item.id, additive)}
                                    onDropBefore={draggedId => void run(() => store.moveArtwork(draggedId, item.id))}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {visible.map(item => (
                                <EntryRow
                                    key={item.id}
                                    app={app}
                                    entry={item}
                                    selected={selection.includes(item.id)}
                                    audition={audition}
                                    onSelect={additive => toggleSelection(setSelectedIds, item.id, additive)}
                                    onDropBefore={draggedId => void run(() => store.moveArtwork(draggedId, item.id))}
                                />
                            ))}
                        </div>
                    )}
                </main>

                {/* Always mounted: an inspector that appears on selection reflows
                    the content under the cursor. The idle state earns the space. */}
                <aside className="w-72 shrink-0 overflow-y-auto border-l border-edge">
                    {selected ? (
                        <EntryInspector
                            app={app}
                            store={store}
                            entry={selected}
                            groups={data.groups}
                            busy={busy}
                            audition={audition}
                            onRun={run}
                            onClose={() => setSelectedIds([])}
                            onPick={setPicker}
                            onPickVoiceLines={() => setVoicePickerFor(selected.id)}
                        />
                    ) : selection.length > 1 ? (
                        <BulkInspector
                            store={store}
                            selection={selection}
                            groups={data.groups}
                            busy={busy}
                            onRun={run}
                            onClear={() => setSelectedIds([])}
                        />
                    ) : (
                        <IdleInspector meta={meta} />
                    )}
                </aside>
            </div>

            <div ref={anchorRef} className="h-0 w-full" />
            <ui.AssetSelector
                visible={Boolean(picker)}
                assetType={pickerWantsAudio ? AssetType.Audio : AssetType.Image}
                multiple={pickerWantsMany}
                anchorRef={anchorRef}
                title={pickerTitle(picker)}
                onClose={() => setPicker(null)}
                onConfirm={assets => onPickerConfirm(assets as Asset[])}
            />
            {voicePickerFor && (
                <VoiceUnitPicker
                    app={app}
                    existing={data.items.find(item => item.id === voicePickerFor)?.variants ?? []}
                    onClose={() => setVoicePickerFor(null)}
                    onConfirm={units => {
                        const artworkId = voicePickerFor;
                        setVoicePickerFor(null);
                        void run(() => store.addVoiceVariants(artworkId, units));
                    }}
                />
            )}
            {settingsOpen && (
                <LockedLookModal
                    app={app}
                    store={store}
                    busy={busy}
                    onClose={() => setSettingsOpen(false)}
                    onPickPlaceholder={() => setPicker({ kind: "defaultLockedImage" })}
                    onRun={run}
                />
            )}
        </div>
    );
}

function toggleSelection(
    setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>,
    id: string,
    additive: boolean,
): void {
    setSelectedIds(previous => {
        if (!additive) {
            return [id];
        }
        return previous.includes(id) ? previous.filter(other => other !== id) : [...previous, id];
    });
}

function pickerTitle(target: PickerTarget | null): string {
    switch (target?.kind) {
        case "importCgs":
            return "Import CGs";
        case "importTracks":
            return "Import tracks";
        case "addImages":
            return "Add differentials";
        case "addTracks":
            return "Add tracks";
        case "coverImage":
            return "Select cover";
        case "variantImage":
            return "Select image";
        case "lockedImage":
            return "Select locked placeholder";
        case "defaultLockedImage":
            return "Select default placeholder";
        default:
            return "Select asset";
    }
}

/**
 * An empty column teaches what it is for rather than dead-ending, so an author
 * who has only ever used the CG tab discovers the other three.
 */
function EmptyPane({ meta, filtered, onCreate }: { meta: KindMeta; filtered: boolean; onCreate: () => void }) {
    const Icon = filtered ? Search : meta.icon;
    const freeze = ui.useFreezeGuard();
    return (
        <div className="grid h-full place-items-center">
            <div className="flex flex-col items-center gap-3 text-center">
                <Icon size={26} className="text-fg-subtle" />
                <div className="text-sm text-fg-muted">
                    {filtered ? "Nothing matches" : `No ${meta.noun} entries yet`}
                </div>
                {/* Still rendered while frozen, greyed: the empty column's whole
                    job is to say what this column is for, and a missing button
                    reads as a broken editor rather than as a frozen project. */}
                {!filtered && (
                    <ui.Button size="sm" variant="secondary" onClick={onCreate} {...freeze.writes()}>
                        <Plus size={13} />
                        {meta.createLabel}
                    </ui.Button>
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

function GroupChips({
    groups,
    items,
    active,
    busy,
    onSelect,
    onCreate,
    onRename,
    onRemove,
    onDropEntry,
}: {
    groups: GalleryGroup[];
    items: GalleryArtwork[];
    active: string;
    busy: boolean;
    onSelect: (groupId: string) => void;
    onCreate: () => void;
    onRename: (groupId: string, name: string) => void;
    onRemove: (groupId: string) => void;
    onDropEntry: (entryId: string, groupId: string | null) => void;
}) {
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const freeze = ui.useFreezeGuard();

    const countFor = (groupId: string): number => {
        if (groupId === GROUP_ALL) {
            return items.length;
        }
        if (groupId === GROUP_UNGROUPED) {
            return items.filter(item => !item.groupId).length;
        }
        return items.filter(item => item.groupId === groupId).length;
    };

    const allowDrop = (event: React.DragEvent) => {
        if (event.dataTransfer.types.includes(DRAG_ENTRY_MIME)) {
            event.preventDefault();
        }
    };
    const dropTo = (groupId: string | null) => (event: React.DragEvent) => {
        const entryId = event.dataTransfer.getData(DRAG_ENTRY_MIME);
        if (entryId) {
            event.preventDefault();
            onDropEntry(entryId, groupId);
        }
    };

    const chip = (
        key: string,
        label: string,
        count: number,
        options: { groupId?: string; droppable?: boolean } = {},
    ) => (
        <div
            key={key}
            className="group/chip flex items-center"
            // Drop targets go through `gesture`, so a frozen project never starts a
            // drag it would refuse to finish.
            onDragOver={options.droppable ? freeze.gesture(allowDrop) : undefined}
            onDrop={options.droppable ? freeze.gesture(dropTo(options.groupId ?? null)) : undefined}
        >
            <button
                type="button"
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs transition-colors ${
                    active === key
                        ? "border-primary/60 bg-primary/15 text-fg"
                        : "border-edge text-fg-muted hover:border-edge-strong hover:text-fg"
                }`}
                // Filtering by group is navigation - the freeze never touches it.
                onClick={() => onSelect(key)}
                onDoubleClick={options.groupId ? freeze.gesture(() => setRenamingId(options.groupId!)) : undefined}
            >
                {label}
                <span className="tabular-nums text-fg-subtle">{count}</span>
                {/* Greyed rather than dropped, like every other write here: it is
                    already a hover-reveal, and removing it on hover would leave the
                    author hunting for a control that is simply switched off. */}
                {options.groupId && (
                    <span
                        role="button"
                        tabIndex={-1}
                        aria-label={`Delete group ${label}`}
                        aria-disabled={freeze.frozen || undefined}
                        title={freeze.frozen ? freeze.reason : undefined}
                        className={`hidden text-fg-subtle group-hover/chip:inline ${
                            freeze.frozen ? "opacity-40" : "hover:text-danger"
                        }`}
                        onClick={event => {
                            event.stopPropagation();
                            if (freeze.frozen) {
                                return;
                            }
                            onRemove(options.groupId!);
                        }}
                    >
                        <X size={9} />
                    </span>
                )}
            </button>
        </div>
    );

    const ungrouped = countFor(GROUP_UNGROUPED);

    return (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-edge px-3 py-1.5">
            {chip(GROUP_ALL, "All", countFor(GROUP_ALL))}
            {groups.map(group => (
                renamingId === group.id ? (
                    <div key={group.id} className="w-32">
                        <InlineNameInput
                            value={group.name}
                            onCommit={name => {
                                setRenamingId(null);
                                onRename(group.id, name);
                            }}
                        />
                    </div>
                ) : chip(group.id, group.name, countFor(group.id), { groupId: group.id, droppable: true })
            ))}
            {groups.length > 0 && ungrouped > 0
                && chip(GROUP_UNGROUPED, "Ungrouped", ungrouped, { droppable: true })}
            <button
                type="button"
                aria-label="New group"
                className="rounded-full border border-dashed border-edge px-1.5 py-0.5 text-fg-subtle hover:border-edge-strong hover:text-fg disabled:opacity-40"
                onClick={onCreate}
                {...freeze.writes(busy, "New group")}
            >
                <Plus size={10} />
            </button>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Grid + list presenters
// ---------------------------------------------------------------------------

/**
 * Shared drag wiring: reorder within the pane, or drop onto a group chip.
 *
 * Reordering and regrouping both write, so a frozen project gets the whole set
 * unattached - `draggable` included. Half of it would be worse than none: a card
 * that lifts and then refuses to land reads as a broken editor.
 */
function useEntryDrag(entryId: string, onDropBefore: (draggedId: string) => void) {
    const [over, setOver] = useState(false);
    const freeze = ui.useFreezeGuard();
    return {
        over,
        props: {
            draggable: !freeze.frozen,
            onDragStart: freeze.gesture((event: React.DragEvent) => {
                event.dataTransfer.setData(DRAG_ENTRY_MIME, entryId);
                event.dataTransfer.effectAllowed = "move";
            }),
            onDragOver: freeze.gesture((event: React.DragEvent) => {
                if (event.dataTransfer.types.includes(DRAG_ENTRY_MIME)) {
                    event.preventDefault();
                    setOver(true);
                }
            }),
            onDragLeave: freeze.gesture(() => setOver(false)),
            onDrop: freeze.gesture((event: React.DragEvent) => {
                setOver(false);
                const draggedId = event.dataTransfer.getData(DRAG_ENTRY_MIME);
                if (draggedId && draggedId !== entryId) {
                    event.preventDefault();
                    onDropBefore(draggedId);
                }
            }),
        },
    };
}

function EntryCard({
    app,
    entry,
    selected,
    onSelect,
    onDropBefore,
}: {
    app: PluginApp;
    entry: GalleryArtwork;
    selected: boolean;
    onSelect: (additive: boolean) => void;
    onDropBefore: (draggedId: string) => void;
}) {
    const drag = useEntryDrag(entry.id, onDropBefore);
    const cover = resolveCoverVariant(entry);

    return (
        <div
            // `nl-drag-source` is required in this repo: bare `draggable` is inert.
            className={`nl-drag-source group relative flex cursor-default flex-col overflow-hidden rounded-md border transition-colors ${
                selected ? "border-primary ring-1 ring-primary" : "border-edge hover:border-edge-strong"
            } ${drag.over ? "border-l-2 border-l-primary" : ""}`}
            {...drag.props}
            onClick={event => onSelect(event.ctrlKey || event.metaKey || event.shiftKey)}
        >
            <GalleryThumb app={app} assetId={cover?.imageAssetId} className="aspect-video w-full" />
            <div className="flex items-center gap-1 px-1.5 py-1">
                <span className="min-w-0 flex-1 truncate text-2xs" title={entry.name}>{entry.name}</span>
                {/* The second level of the model stays hidden until it exists. */}
                {entry.variants.length > 1 && (
                    <span
                        className="flex shrink-0 items-center gap-0.5 text-2xs text-fg-subtle"
                        title={`${entry.variants.length} items`}
                    >
                        <Layers size={10} />
                        {entry.variants.length}
                    </span>
                )}
                {entry.hidden && (
                    <span className="shrink-0 text-fg-subtle" title="Hidden until unlocked">
                        <EyeOff size={11} />
                    </span>
                )}
            </div>
            {/* A recollection is only meaningful once it points somewhere; say so
                on the card rather than making the author open the inspector. */}
            {entry.kind === "scene" && (
                <div className={`truncate border-t border-edge px-1.5 py-0.5 text-2xs ${
                    entry.scene?.sceneId ? "text-fg-subtle" : "text-warning"
                }`}>
                    {entry.scene?.sceneId ? "Scene set" : "No scene picked"}
                </div>
            )}
        </div>
    );
}

/**
 * A row, for the kinds a tile would waste: a track is a title, a length and a
 * play button; a voice line is text that needs room to read.
 */
function EntryRow({
    app,
    entry,
    selected,
    audition,
    onSelect,
    onDropBefore,
}: {
    app: PluginApp;
    entry: GalleryArtwork;
    selected: boolean;
    audition: Audition;
    onSelect: (additive: boolean) => void;
    onDropBefore: (draggedId: string) => void;
}) {
    const drag = useEntryDrag(entry.id, onDropBefore);
    const cover = resolveCoverVariant(entry);
    const single = entry.variants.length === 1 ? entry.variants[0]! : null;
    const auditionKey = single ? `${entry.id}:${single.id}` : null;
    const playing = auditionKey !== null && audition.playingKey === auditionKey;
    const totalSeconds = entry.variants.reduce((total, variant) => total + (variant.durationSec ?? 0), 0);

    return (
        <div
            className={`nl-drag-source flex cursor-default items-center gap-2 rounded border px-2 py-1.5 transition-colors ${
                selected ? "border-primary bg-primary/10" : "border-edge hover:border-edge-strong hover:bg-fill-subtle"
            } ${drag.over ? "border-t-2 border-t-primary" : ""}`}
            {...drag.props}
            onClick={event => onSelect(event.ctrlKey || event.metaKey || event.shiftKey)}
        >
            {/* Only a single-item entry plays from here; an album plays per track
                in the inspector, where the track list lives. */}
            {single ? (
                <button
                    type="button"
                    aria-label={playing ? "Stop" : "Play"}
                    title={playing ? "Stop" : "Play"}
                    disabled={!single.audioAssetId}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-edge text-fg-muted hover:border-primary hover:text-fg disabled:opacity-40"
                    onClick={event => {
                        event.stopPropagation();
                        void audition.toggle(auditionKey!, single.audioAssetId);
                    }}
                >
                    {playing ? <Pause size={11} /> : <Play size={11} />}
                </button>
            ) : (
                <span
                    className="grid h-6 w-6 shrink-0 place-items-center text-fg-subtle"
                    title={`${entry.variants.length} items`}
                >
                    <Layers size={12} />
                </span>
            )}

            {cover?.imageAssetId && (
                <GalleryThumb app={app} assetId={cover.imageAssetId} className="h-6 w-9 shrink-0 rounded" />
            )}

            <div className="min-w-0 flex-1">
                <div className="truncate text-2xs" title={entry.name}>{entry.name}</div>
                {entry.kind === "voice" && single?.lineText && (
                    <div className="truncate text-2xs text-fg-subtle" title={single.lineText}>
                        {single.lineText}
                    </div>
                )}
                {entry.variants.length > 1 && (
                    <div className="text-2xs text-fg-subtle">{entry.variants.length} items</div>
                )}
            </div>

            {entry.hidden && (
                <span className="shrink-0 text-fg-subtle" title="Hidden until unlocked">
                    <EyeOff size={11} />
                </span>
            )}
            <span className="shrink-0 tabular-nums text-2xs text-fg-subtle">
                {formatDuration(single?.durationSec ?? (totalSeconds || null))}
            </span>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

/**
 * A labelled inspector row.
 *
 * The label is a **sibling** of the control, not a `<label>` wrapped around it,
 * which is how every other inspector in Studio spells this. Wrapping was the
 * cause of a real defect: `<label>` forwards a stray click to its labeled
 * control, and a `Select` inside one re-opened its menu the instant you picked
 * something - the pick closed the menu, the label then forwarded the same click
 * to the trigger, and the trigger toggled it back open. `Select` is hardened
 * against that ancestor now, but the wrapping bought nothing to begin with:
 * these controls are not form controls, so there is no focus to forward.
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="block space-y-1">
            <span className="block text-2xs text-fg-subtle">{label}</span>
            {children}
        </div>
    );
}

/**
 * What the inspector shows with nothing selected: the blueprint contract.
 *
 * The editor used to never mention that these entries exist to be read by
 * `Get Gallery`, which left the author with authored data and no idea how to put
 * it on screen. This is the one place that hint belongs - it fills space that
 * would otherwise be blank, and it is gone the moment anything is selected, so
 * it never becomes chrome over the content.
 */
function IdleInspector({ meta }: { meta: KindMeta }) {
    return (
        <div className="flex flex-col gap-3 p-3">
            <span className="text-2xs text-fg-subtle">Nothing selected</span>
            <div className="space-y-2 rounded border border-edge bg-fill-subtle p-2">
                <div className="text-2xs text-fg-muted">To put this on a Page</div>
                <ol className="space-y-1 text-2xs text-fg-subtle">
                    <li>
                        1. <span className="text-fg-muted">Get Gallery</span>, Kind =
                        {" "}
                        <span className="text-fg-muted">{meta.label}</span>
                    </li>
                    <li>
                        2. Entries → <span className="text-fg-muted">Set List Content</span>
                    </li>
                    <li>
                        3. In the item template, <span className="text-fg-muted">Get List Item Props</span>
                        {" → "}
                        <span className="text-fg-muted">Get JSON Field</span>
                    </li>
                </ol>
                <div className="text-2xs text-fg-subtle">
                    Row fields: <span className="text-fg-muted">{meta.rowFields}</span>
                </div>
            </div>
        </div>
    );
}

function EntryInspector({
    app,
    store,
    entry,
    groups,
    busy,
    audition,
    onRun,
    onClose,
    onPick,
    onPickVoiceLines,
}: {
    app: PluginApp;
    store: GalleryStore;
    entry: GalleryArtwork;
    groups: GalleryGroup[];
    busy: boolean;
    audition: Audition;
    onRun: (action: () => Promise<unknown>) => Promise<void>;
    onClose: () => void;
    onPick: (target: PickerTarget) => void;
    onPickVoiceLines: () => void;
}) {
    const meta = KIND_META[entry.kind];
    const MetaIcon = meta.icon;
    const cover = resolveCoverVariant(entry);
    const audio = isAudioGalleryKind(entry.kind);
    const freeze = ui.useFreezeGuard();

    return (
        <div className="flex flex-col gap-3 p-3">
            <div className="flex items-center gap-1.5">
                <MetaIcon size={12} className="shrink-0 text-fg-subtle" />
                <span className="min-w-0 flex-1 truncate text-2xs text-fg-subtle">{meta.label}</span>
                <ui.IconButton size="sm" variant="ghost" aria-label="Close inspector" onClick={onClose}>
                    <X size={12} />
                </ui.IconButton>
            </div>

            {/* Every kind can carry a picture, but only image kinds lead with one. */}
            {(!audio || cover?.imageAssetId) && (
                <button
                    type="button"
                    className="block w-full"
                    onClick={() => {
                        if (entry.variants.length === 0) {
                            onPick({ kind: "coverImage", artworkId: entry.id });
                        }
                    }}
                    {...freeze.writes(busy, entry.variants.length === 0 ? "Pick an image" : undefined)}
                >
                    <GalleryThumb
                        app={app}
                        assetId={cover?.imageAssetId}
                        fit="contain"
                        className="aspect-video w-full rounded border border-edge"
                    />
                </button>
            )}

            <Field label="Name">
                <InlineNameInput
                    value={entry.name}
                    readOnly={freeze.frozen}
                    onCommit={name => void onRun(() => store.patchArtworkFields(entry.id, { name }))}
                />
            </Field>

            <Field label="Description">
                {/* `readOnly`, never `disabled`: the description is prose the author
                    came to read, and a disabled textarea dims it and refuses to be
                    selected or copied. */}
                <ui.TextArea
                    size="sm"
                    fullWidth
                    rows={2}
                    readOnly={freeze.frozen}
                    placeholder="Shown in the viewer once unlocked"
                    key={`${entry.id}:description`}
                    defaultValue={entry.description}
                    onBlur={event => {
                        if (!freeze.frozen && event.target.value !== entry.description) {
                            void onRun(() => store.patchArtworkFields(entry.id, {
                                description: event.target.value,
                            }));
                        }
                    }}
                />
            </Field>

            {entry.kind === "scene" && (
                <ScenePickerFields app={app} store={store} entry={entry} onRun={onRun} />
            )}

            <Field label="Group">
                {/* `readOnly` rather than `disabled`, which is `Select`'s own
                    frozen mode: the list of groups is project data the author came
                    to look at, and a dropdown that will not open hides it. */}
                <ui.Select
                    size="sm"
                    fullWidth
                    readOnly={freeze.frozen}
                    value={entry.groupId ?? ""}
                    options={[
                        { value: "", label: "Ungrouped" },
                        ...groups.map(group => ({ value: group.id, label: group.name })),
                    ]}
                    onChange={value => void onRun(() => store.patchArtworkFields(entry.id, {
                        groupId: String(value) || null,
                    }))}
                />
            </Field>

            <button
                type="button"
                className="flex items-center gap-2 rounded px-1 py-1 text-2xs text-fg-muted hover:bg-fill-subtle hover:text-fg disabled:opacity-50 disabled:hover:bg-transparent"
                onClick={() => void onRun(() => store.patchArtworkFields(entry.id, { hidden: !entry.hidden }))}
                {...freeze.writes(busy)}
            >
                {entry.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                {entry.hidden ? "Hidden until unlocked" : "Shown as a locked slot"}
            </button>

            <MemberList
                app={app}
                store={store}
                entry={entry}
                busy={busy}
                audition={audition}
                onRun={onRun}
                onPick={onPick}
                onPickVoiceLines={onPickVoiceLines}
            />

            <Field label="Locked placeholder">
                <div className="flex items-center gap-2">
                    <GalleryThumb
                        app={app}
                        assetId={entry.lockedImageAssetId}
                        className="h-9 w-14 shrink-0 rounded border border-edge"
                    />
                    <ui.Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onPick({ kind: "lockedImage", artworkId: entry.id })}
                        {...freeze.writes(busy)}
                    >
                        Pick
                    </ui.Button>
                    {entry.lockedImageAssetId && (
                        <ui.IconButton
                            size="sm"
                            variant="ghost"
                            aria-label="Use the catalog default"
                            onClick={() => void onRun(() => store.patchArtworkFields(entry.id, {
                                lockedImageAssetId: null,
                                lockedImageAssetName: null,
                            }))}
                            {...freeze.writes(busy, "Use the catalog default")}
                        >
                            <X size={12} />
                        </ui.IconButton>
                    )}
                </div>
            </Field>

            <ui.Button
                size="sm"
                variant="danger"
                onClick={() => void onRun(async () => {
                    await store.removeArtworks([entry.id]);
                    onClose();
                })}
                {...freeze.writes(busy)}
            >
                <Trash2 size={12} />
                Delete entry
            </ui.Button>
        </div>
    );
}

/** Where a recollection replays from. */
function ScenePickerFields({
    app,
    store,
    entry,
    onRun,
}: {
    app: PluginApp;
    store: GalleryStore;
    entry: GalleryArtwork;
    onRun: (action: () => Promise<unknown>) => Promise<void>;
}) {
    const [stories, setStories] = useState<PluginStoryEntry[]>([]);
    const [scenes, setScenes] = useState<PluginSceneEntry[]>([]);
    const freeze = ui.useFreezeGuard();
    const storyId = entry.scene?.storyId ?? "";
    const sceneId = entry.scene?.sceneId ?? "";

    useEffect(() => {
        setStories(app.services.story.listStories());
    }, [app]);

    useEffect(() => {
        if (!storyId) {
            setScenes([]);
            return;
        }
        let disposed = false;
        app.services.story.listScenes(storyId)
            .then(next => {
                if (!disposed) {
                    setScenes(next);
                }
            })
            .catch((error: unknown) => {
                if (disposed) {
                    return;
                }
                setScenes([]);
                // An empty dropdown with no reason is the worst outcome here -
                // the author cannot tell "this story has no scenes" from "the
                // lookup broke".
                app.services.ui.notifications.error(
                    `Could not list scenes: ${error instanceof Error ? error.message : String(error)}`,
                );
            });
        return () => {
            disposed = true;
        };
    }, [app, storyId]);

    return (
        <>
            <Field label="Story">
                <ui.Select
                    size="sm"
                    fullWidth
                    readOnly={freeze.frozen}
                    value={storyId}
                    options={[
                        { value: "", label: "Pick a story" },
                        ...stories.map(story => ({ value: story.id, label: story.name })),
                    ]}
                    // Changing the story invalidates the scene, so it is cleared
                    // rather than left pointing into a different story.
                    onChange={value => void onRun(() => store.setScene(entry.id, {
                        storyId: String(value) || null,
                        sceneId: null,
                    }))}
                />
            </Field>
            <Field label="Scene">
                <ui.Select
                    size="sm"
                    fullWidth
                    disabled={!storyId}
                    readOnly={freeze.frozen}
                    value={sceneId}
                    options={[
                        { value: "", label: storyId ? "Pick a scene" : "Pick a story first" },
                        ...scenes.map(scene => ({ value: scene.id, label: scene.name })),
                    ]}
                    onChange={value => void onRun(() => store.setScene(entry.id, {
                        storyId: storyId || null,
                        sceneId: String(value) || null,
                    }))}
                />
            </Field>
        </>
    );
}

/**
 * The entry's members. Named per kind, and only labelled as a set once there is
 * more than one - a single-CG artwork never has to learn the word "differential".
 */
function MemberList({
    app,
    store,
    entry,
    busy,
    audition,
    onRun,
    onPick,
    onPickVoiceLines,
}: {
    app: PluginApp;
    store: GalleryStore;
    entry: GalleryArtwork;
    busy: boolean;
    audition: Audition;
    onRun: (action: () => Promise<unknown>) => Promise<void>;
    onPick: (target: PickerTarget) => void;
    onPickVoiceLines: () => void;
}) {
    const cover = resolveCoverVariant(entry);
    const freeze = ui.useFreezeGuard();
    const many = entry.variants.length > 1;
    const label = entry.kind === "music"
        ? many ? `Tracks (${entry.variants.length})` : "Track"
        : entry.kind === "voice"
            ? many ? `Lines (${entry.variants.length})` : "Line"
            : many ? `Differentials (${entry.variants.length})` : "Image";

    const add = () => {
        switch (entry.kind) {
            case "music":
                onPick({ kind: "addTracks", artworkId: entry.id });
                return;
            case "voice":
                onPickVoiceLines();
                return;
            default:
                onPick({ kind: "addImages", artworkId: entry.id });
        }
    };

    return (
        <div className="space-y-1">
            <div className="flex items-center gap-1">
                <span className="flex-1 text-2xs text-fg-subtle">{label}</span>
                <ui.Button size="sm" variant="secondary" onClick={add} {...freeze.writes(busy)}>
                    <Plus size={11} />
                    Add
                </ui.Button>
            </div>
            {entry.variants.length === 0 ? (
                <p className="px-1 text-2xs text-fg-subtle">
                    {entry.kind === "voice"
                        ? "No lines picked yet."
                        : entry.kind === "music"
                            ? "No tracks yet."
                            : "No image yet."}
                </p>
            ) : (
                <div className="space-y-1">
                    {entry.variants.map(variant => (
                        <MemberRow
                            key={variant.id}
                            app={app}
                            entry={entry}
                            variant={variant}
                            busy={busy}
                            audition={audition}
                            showCover={many}
                            isCover={variant.id === cover?.id}
                            isExplicitCover={variant.id === entry.coverVariantId}
                            onRename={name => void onRun(() => store.patchVariant(entry.id, variant.id, { name }))}
                            onPickImage={() => onPick({
                                kind: "variantImage",
                                artworkId: entry.id,
                                variantId: variant.id,
                            })}
                            onSetCover={() => void onRun(() => store.setCoverVariant(entry.id, variant.id))}
                            onRemove={() => void onRun(() => store.removeVariant(entry.id, variant.id))}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function MemberRow({
    app,
    entry,
    variant,
    busy,
    audition,
    showCover,
    isCover,
    isExplicitCover,
    onRename,
    onPickImage,
    onSetCover,
    onRemove,
}: {
    app: PluginApp;
    entry: GalleryArtwork;
    variant: GalleryVariant;
    busy: boolean;
    audition: Audition;
    showCover: boolean;
    isCover: boolean;
    isExplicitCover: boolean;
    onRename: (name: string) => void;
    onPickImage: () => void;
    onSetCover: () => void;
    onRemove: () => void;
}) {
    const audio = isAudioGalleryKind(entry.kind);
    const key = `${entry.id}:${variant.id}`;
    const playing = audition.playingKey === key;
    const freeze = ui.useFreezeGuard();

    return (
        <div className="flex items-start gap-1.5 rounded border border-edge bg-fill-subtle p-1">
            {/* Auditioning is reading, so the play button is untouched by a freeze. */}
            {audio ? (
                <button
                    type="button"
                    aria-label={playing ? "Stop" : "Play"}
                    title={variant.audioAssetName ?? (playing ? "Stop" : "Play")}
                    disabled={!variant.audioAssetId}
                    className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-edge text-fg-muted hover:border-primary hover:text-fg disabled:opacity-40"
                    onClick={() => void audition.toggle(key, variant.audioAssetId)}
                >
                    {playing ? <Pause size={11} /> : <Play size={11} />}
                </button>
            ) : (
                <button
                    type="button"
                    aria-label="Change image"
                    className="shrink-0"
                    onClick={onPickImage}
                    {...freeze.writes(busy, variant.imageAssetName ?? "Pick an image")}
                >
                    <GalleryThumb app={app} assetId={variant.imageAssetId} className="h-8 w-12 rounded" />
                </button>
            )}
            <div className="min-w-0 flex-1 space-y-0.5">
                <InlineNameInput value={variant.name} readOnly={freeze.frozen} onCommit={onRename} />
                {/* The label starts out as the line text, so echoing it below
                    would just print it twice; show it only once the author has
                    renamed the row to something else. */}
                {entry.kind === "voice" && variant.lineText && variant.lineText !== variant.name && (
                    <div className="px-1 text-2xs text-fg-subtle" title={variant.lineText}>
                        {variant.lineText}
                    </div>
                )}
                {audio && variant.durationSec ? (
                    <div className="px-1 text-2xs tabular-nums text-fg-subtle">
                        {formatDuration(variant.durationSec)}
                    </div>
                ) : null}
            </div>
            {showCover && !audio && (
                <ui.IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={isExplicitCover ? "Clear cover" : "Use as cover"}
                    className={isCover ? "text-primary" : ""}
                    onClick={onSetCover}
                    {...freeze.writes(
                        busy,
                        isExplicitCover ? "Clear cover" : isCover ? "Default cover (first)" : "Use as cover",
                    )}
                >
                    <Star size={12} fill={isExplicitCover ? "currentColor" : "none"} />
                </ui.IconButton>
            )}
            <ui.IconButton
                size="sm"
                variant="ghost"
                aria-label="Delete"
                className="text-fg-subtle hover:text-danger"
                onClick={onRemove}
                {...freeze.writes(busy, "Delete")}
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
    groups: GalleryGroup[];
    busy: boolean;
    onRun: (action: () => Promise<unknown>) => Promise<void>;
    onClear: () => void;
}) {
    const freeze = ui.useFreezeGuard();

    return (
        <div className="flex flex-col gap-3 p-3">
            <div className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-2xs text-fg-subtle">{selection.length} selected</span>
                <ui.IconButton size="sm" variant="ghost" aria-label="Clear selection" onClick={onClear}>
                    <X size={12} />
                </ui.IconButton>
            </div>

            <Field label="Move to group">
                <ui.Select
                    size="sm"
                    fullWidth
                    readOnly={freeze.frozen}
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
                            for (const id of selection) {
                                await store.patchArtworkFields(id, { groupId });
                            }
                        });
                    }}
                />
            </Field>

            <ui.Button
                size="sm"
                variant="danger"
                onClick={() => void onRun(async () => {
                    await store.removeArtworks(selection);
                    onClear();
                })}
                {...freeze.writes(busy)}
            >
                <Trash2 size={12} />
                Delete {selection.length}
            </ui.Button>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Voice unit picker
// ---------------------------------------------------------------------------

/**
 * Picks recorded lines for a voice set.
 *
 * Curated, not generated: a fully voiced game has thousands of units, and an
 * EXTRA screen listing all of them is not a feature. Lines already in this entry
 * are shown as taken rather than hidden, so the author can see what they picked.
 */
function VoiceUnitPicker({
    app,
    existing,
    onClose,
    onConfirm,
}: {
    app: PluginApp;
    existing: GalleryVariant[];
    onClose: () => void;
    onConfirm: (units: { unitId: string; text: string; durationSec: number | null }[]) => void;
}) {
    const [units, setUnits] = useState<PluginVoiceUnitEntry[] | null>(null);
    const [query, setQuery] = useState("");
    const [picked, setPicked] = useState<Set<string>>(() => new Set());
    // Reachable only from a control the freeze already switches off - unless the
    // author froze the workspace with this dialog open, which the version rail
    // lets them do.
    const freeze = ui.useFreezeGuard();
    const taken = useMemo(
        () => new Set(existing.map(variant => variant.voiceUnitId).filter((id): id is string => Boolean(id))),
        [existing],
    );

    useEffect(() => {
        let disposed = false;
        app.services.voice.listUnits()
            .then(next => {
                if (!disposed) {
                    setUnits(next);
                }
            })
            .catch(() => {
                if (!disposed) {
                    setUnits([]);
                }
            });
        return () => {
            disposed = true;
        };
    }, [app]);

    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        const all = units ?? [];
        return needle
            ? all.filter(unit =>
                unit.text.toLowerCase().includes(needle)
                || unit.character?.toLowerCase().includes(needle))
            : all;
    }, [query, units]);

    return (
        <ui.Modal isOpen title="Add voice lines" onClose={onClose}>
            <ui.ModalBody>
                <div className="space-y-2">
                    <ui.SearchInput
                        size="sm"
                        fullWidth
                        placeholder="Search lines..."
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                    />
                    {units === null ? (
                        <p className="py-6 text-center text-2xs text-fg-subtle">Loading…</p>
                    ) : units.length === 0 ? (
                        <p className="py-6 text-center text-2xs text-fg-subtle">
                            No recorded voice yet. Import takes in the Voice panel first.
                        </p>
                    ) : (
                        <div className="max-h-72 space-y-0.5 overflow-y-auto">
                            {filtered.map(unit => {
                                const isTaken = taken.has(unit.unitId);
                                const isPicked = picked.has(unit.unitId);
                                return (
                                    <button
                                        key={`${unit.locale}:${unit.unitId}`}
                                        type="button"
                                        disabled={isTaken}
                                        className={`flex w-full min-w-0 items-center gap-2 rounded border px-2 py-1 text-left text-2xs ${
                                            isTaken
                                                ? "border-edge opacity-40"
                                                : isPicked
                                                    ? "border-primary bg-primary/10"
                                                    : "border-edge hover:border-edge-strong hover:bg-fill-subtle"
                                        }`}
                                        onClick={() => setPicked(previous => {
                                            const next = new Set(previous);
                                            if (next.has(unit.unitId)) {
                                                next.delete(unit.unitId);
                                            } else {
                                                next.add(unit.unitId);
                                            }
                                            return next;
                                        })}
                                    >
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate">{unit.text || unit.unitId}</span>
                                            <span className="block truncate text-fg-subtle">
                                                {unit.character ?? "Narration"} · {unit.locale}
                                            </span>
                                        </span>
                                        <span className="shrink-0 tabular-nums text-fg-subtle">
                                            {formatDuration(unit.durationSec)}
                                        </span>
                                        {isTaken && <span className="shrink-0 text-fg-subtle">added</span>}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </ui.ModalBody>
            <ui.ModalFooter>
                <span className="mr-auto text-2xs text-fg-subtle">{picked.size} selected</span>
                <ui.Button size="sm" variant="secondary" onClick={onClose}>Cancel</ui.Button>
                <ui.Button
                    size="sm"
                    variant="primary"
                    {...freeze.writes(picked.size === 0)}
                    onClick={() => onConfirm((units ?? [])
                        .filter(unit => picked.has(unit.unitId))
                        .map(unit => ({
                            unitId: unit.unitId,
                            text: unit.text,
                            durationSec: unit.durationSec,
                        })))}
                >
                    Add {picked.size}
                </ui.Button>
            </ui.ModalFooter>
        </ui.Modal>
    );
}

// ---------------------------------------------------------------------------
// Catalog-wide settings
// ---------------------------------------------------------------------------

function LockedLookModal({
    app,
    store,
    busy,
    onClose,
    onPickPlaceholder,
    onRun,
}: {
    app: PluginApp;
    store: GalleryStore;
    busy: boolean;
    onClose: () => void;
    onPickPlaceholder: () => void;
    onRun: (action: () => Promise<unknown>) => Promise<void>;
}) {
    const settings = store.getSettings();
    const freeze = ui.useFreezeGuard();

    return (
        // The modal still opens while frozen: what it shows - the placeholder and
        // the mask - is catalog data, and it is the only place to read it.
        <ui.Modal isOpen title="How locked entries look in game" onClose={onClose}>
            <ui.ModalBody>
                <div className="space-y-4">
                    <Field label="Default placeholder">
                        <div className="flex items-center gap-2">
                            <GalleryThumb
                                app={app}
                                assetId={settings.lockedImageAssetId}
                                className="h-16 w-24 shrink-0 rounded border border-edge"
                            />
                            <ui.Button
                                size="sm"
                                variant="secondary"
                                onClick={onPickPlaceholder}
                                {...freeze.writes(busy)}
                            >
                                Pick
                            </ui.Button>
                            {settings.lockedImageAssetId && (
                                <ui.IconButton
                                    size="sm"
                                    variant="ghost"
                                    aria-label="Clear placeholder"
                                    onClick={() => void onRun(() => store.patchSettings({
                                        lockedImageAssetId: null,
                                        lockedImageAssetName: null,
                                    }))}
                                    {...freeze.writes(busy, "Clear placeholder")}
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
                            readOnly={freeze.frozen}
                            placeholder={DEFAULT_LOCKED_NAME_MASK}
                            onCommit={lockedNameMask => void onRun(() => store.patchSettings({ lockedNameMask }))}
                        />
                    </Field>
                    <p className="text-2xs text-fg-subtle">Empty shows the real title while locked.</p>
                </div>
            </ui.ModalBody>
            <ui.ModalFooter>
                <ui.Button size="sm" variant="primary" onClick={onClose}>Done</ui.Button>
            </ui.ModalFooter>
        </ui.Modal>
    );
}
