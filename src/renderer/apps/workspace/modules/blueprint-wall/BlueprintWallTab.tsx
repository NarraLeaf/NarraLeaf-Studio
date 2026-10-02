import { memo, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useTranslation } from "@/lib/i18n";
import type { EditorTabComponentProps } from "@/lib/workspace/services/ui/types";
import { Services } from "@/lib/workspace/services/services";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { BlueprintNodeCatalogService } from "@/lib/workspace/services/ui-editor/BlueprintNodeCatalogService";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { resolveFirstBlueprintLayerPreview } from "@/lib/ui-editor/widget-modules/shared/blueprint/blueprintLayerPreviewModel";
import { useWorkspace } from "../../context";
import { useBlueprintDocumentRevision } from "../blueprint-lite/hooks/useBlueprintDocumentRevision";
import { useOpenBlueprintTarget, type BlueprintOpenOptions } from "../blueprint-lite/hooks/useOpenBlueprintTarget";
import { blueprintEntryContextMenu } from "../blueprint-lite/hooks/blueprintEntryGesture";
import { BlueprintWallThumbnail } from "./BlueprintWallThumbnail";
import {
    buildBlueprintWall,
    countBlueprintWallTiles,
    type BlueprintWallGroup,
    type BlueprintWallTile,
} from "./blueprintWallModel";

/**
 * True from the first time the element comes into view, and from then on.
 *
 * A thumbnail is worth drawing only once someone could see it, and a tile that has been drawn keeps
 * its picture when scrolled away rather than blanking and redrawing on the way back.
 */
function useSeen(ref: RefObject<HTMLElement | null>): boolean {
    const [seen, setSeen] = useState(false);
    useEffect(() => {
        const element = ref.current;
        if (seen || !element) {
            return;
        }
        if (typeof IntersectionObserver === "undefined") {
            setSeen(true);
            return;
        }
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) {
                setSeen(true);
                observer.disconnect();
            }
        }, { rootMargin: "200px" });
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref, seen]);
    return seen;
}

type TileProps = {
    tile: BlueprintWallTile;
    /** Bumps when any blueprint changes, so a drawn thumbnail follows edits made elsewhere. */
    revision: number;
    localBp: LocalBlueprintService | null;
    nodeCatalog: BlueprintNodeCatalogService | null;
    onOpen: (tile: BlueprintWallTile, options?: BlueprintOpenOptions) => void;
};

const BlueprintWallTileCard = memo(function BlueprintWallTileCard({
    tile,
    revision,
    localBp,
    nodeCatalog,
    onOpen,
}: TileProps) {
    const { t, tn } = useTranslation();
    const ref = useRef<HTMLButtonElement>(null);
    const seen = useSeen(ref);
    const model = useMemo(
        () => (seen ? resolveFirstBlueprintLayerPreview(localBp, nodeCatalog, tile.blueprintId) : null),
        // `revision` stands in for the blueprint itself, which is mutated in place.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [seen, localBp, nodeCatalog, tile.blueprintId, revision],
    );
    const open = (options?: BlueprintOpenOptions) => onOpen(tile, options);
    const detail = tile.nodeCount > 0 ? tn("blueprint.overview.nodes", tile.nodeCount) : null;
    // App logic and page logic are named by their kind, so the kind is not said twice.
    const meta = [tile.kindLabel === tile.title ? null : tile.kindLabel, detail].filter(Boolean).join(" · ");

    return (
        <button
            ref={ref}
            type="button"
            className="group flex min-w-0 flex-col rounded-md border border-edge bg-surface-raised p-1.5 text-left transition-colors duration-150 hover:border-edge-strong hover:bg-fill-subtle focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
            onClick={() => open()}
            // Double click is the intent a preview tab waits for: keep this one.
            onDoubleClick={() => open({ preview: false })}
            onContextMenu={blueprintEntryContextMenu(open)}
            data-tip={t("blueprint.entry.openInWindow")}
        >
            <div className="h-24 w-full overflow-hidden rounded-sm bg-surface-canvas">
                <BlueprintWallThumbnail model={model} />
            </div>
            <div className="mt-1.5 w-full truncate px-0.5 text-xs text-fg">{tile.title}</div>
            <div className="min-h-4 w-full truncate px-0.5 text-2xs text-fg-subtle">{meta}</div>
        </button>
    );
});

function BlueprintWallSection({
    group,
    ...tileProps
}: { group: BlueprintWallGroup } & Omit<TileProps, "tile">) {
    const { t } = useTranslation();
    return (
        <section className="pb-6" data-blueprint-overview-group={group.kind}>
            <div className="mb-2 flex min-w-0 items-baseline gap-2">
                <h2 className="truncate text-sm font-medium text-fg">{group.title}</h2>
                <span className="shrink-0 text-2xs text-fg-subtle">{group.caption}</span>
            </div>
            {group.tiles.length > 0 ? (
                <div
                    className="grid gap-2"
                    style={{ gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))" }}
                >
                    {group.tiles.map(tile => (
                        <BlueprintWallTileCard key={tile.key} tile={tile} {...tileProps} />
                    ))}
                </div>
            ) : (
                <div className="text-xs text-fg-subtle">{t("blueprint.overview.noBlueprints")}</div>
            )}
        </section>
    );
}

/**
 * Every blueprint in the project on one page, grouped by the page, Game UI, component or story it
 * belongs to. A tile opens its blueprint the way every other entry does: click for a preview tab,
 * double click to keep it, right click for a window of its own.
 *
 * Kept-alive tabs stay mounted while hidden, so the wall follows edits only while it is the visible
 * tab and catches up the moment it is shown again.
 */
export function BlueprintWallTab({ active }: EditorTabComponentProps) {
    const { t, tn } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const openBlueprint = useOpenBlueprintTarget();
    const blueprintRevision = useBlueprintDocumentRevision();
    const [uiRevision, setUiRevision] = useState(0);
    const [storyRevision, setStoryRevision] = useState(0);

    const services = useMemo(() => {
        if (!isInitialized || !context) {
            return null;
        }
        return {
            localBp: context.services.get<LocalBlueprintService>(Services.LocalBlueprint),
            nodeCatalog: context.services.get<BlueprintNodeCatalogService>(Services.BlueprintNodeCatalog),
            uiDocument: context.services.get<UIDocumentService>(Services.UIDocument),
            story: context.services.get<StoryService>(Services.Story),
        };
    }, [context, isInitialized]);

    useEffect(() => {
        if (!services) {
            return;
        }
        return services.uiDocument.onDocumentChanged(() => setUiRevision(value => value + 1));
    }, [services]);

    useEffect(() => {
        if (!services) {
            return;
        }
        const bump = () => setStoryRevision(value => value + 1);
        // Stories load when an editor opens one. A story blueprint is listed under the scene whose
        // row names it, so every story has to be in memory to say which scene that is.
        let disposed = false;
        void services.story.loadAllStories().then(() => {
            if (!disposed) {
                bump();
            }
        });
        const offDocument = services.story.onDocumentChanged(bump);
        const offLibrary = services.story.onLibraryChanged(bump);
        return () => {
            disposed = true;
            offDocument();
            offLibrary();
        };
    }, [services]);

    // What the wall last drew from. Frozen while the tab is hidden, so a hidden wall rebuilds nothing.
    const [shown, setShown] = useState({ blueprint: blueprintRevision, ui: uiRevision, story: storyRevision });
    useEffect(() => {
        if (active) {
            setShown({ blueprint: blueprintRevision, ui: uiRevision, story: storyRevision });
        }
    }, [active, blueprintRevision, uiRevision, storyRevision]);

    const groups = useMemo<BlueprintWallGroup[]>(() => {
        if (!services) {
            return [];
        }
        let blueprints;
        try {
            blueprints = services.localBp.getBlueprintDocument();
        } catch {
            return [];
        }
        let ui: UIDocument | null = null;
        try {
            ui = services.uiDocument.getDocument();
        } catch {
            ui = null;
        }
        const stories = services.story.listStories().map(entry => ({
            id: entry.id,
            name: entry.name,
            document: services.story.getLoadedStoryDocument(entry.id),
        }));
        return buildBlueprintWall({ blueprints, ui, stories, t });
        // The documents are mutated in place; the revisions stand in for them.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [services, t, shown]);

    const handleOpen = useMemo(
        () => (tile: BlueprintWallTile, options?: BlueprintOpenOptions) => openBlueprint(tile.target, options),
        [openBlueprint],
    );

    const total = countBlueprintWallTiles(groups);

    return (
        <div className="h-full overflow-y-auto bg-surface" data-blueprint-overview="">
            <div className="mx-auto max-w-6xl px-6 py-5">
                <div className="mb-4 flex items-baseline gap-3">
                    <h1 className="text-base font-semibold text-fg">{t("blueprint.overview.title")}</h1>
                    <span className="text-xs text-fg-subtle">{tn("blueprint.overview.count", total)}</span>
                </div>
                {groups.map(group => (
                    <BlueprintWallSection
                        key={group.key}
                        group={group}
                        revision={shown.blueprint}
                        localBp={services?.localBp ?? null}
                        nodeCatalog={services?.nodeCatalog ?? null}
                        onOpen={handleOpen}
                    />
                ))}
            </div>
        </div>
    );
}
