import type { StoryAnimationAsset, StoryDocument } from "@shared/types/story";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import type { VoiceDocument } from "@shared/types/voice";
import { isAppearanceModel, type AppearanceVariant } from "@shared/types/ui-editor/appearance";
import { blueprintImageAssetId } from "@shared/types/blueprint/valueTypes";
import { BUILTIN_EDITOR_FONT_ID_PREFIX } from "@/lib/ui-editor/fonts/builtinVirtualEditorFonts";
import { DEV_MODE_SAVE_PREVIEW_ASSET_ID_PREFIX } from "@shared/types/devModeSave";
import type { SearchJumpTarget } from "../search/searchIndexModel";

/**
 * Asset reverse lookup — the pure model.
 *
 * Extraction turns each document that can *hold* an asset id into a flat {@link AssetReference}
 * list; the service owns *when* slices rebuild, this file owns *what counts as a reference*.
 *
 * Three decisions worth knowing before editing an extractor:
 *
 *  - **Structural sweep, not resolved state.** UI element props are walked structurally rather than
 *    through `AppearanceResolver`. A reference is a reference regardless of which appearance variant
 *    happens to be active, and resolving would report only the variant the resolver picked — the
 *    exact case where "delete is safe" is most likely to be wrong. The cost is that dormancy has to
 *    be judged per site (see below) instead of read off the resolved props.
 *  - **Dormant references are still references.** `ImageFill.assetId` deliberately survives a
 *    `fillType` flip to `"color"` (so the image comes back when the user flips back), so the id sits
 *    in the document doing nothing visible. Those sites are reported with `dormant: true` rather
 *    than dropped: deleting the asset would silently empty the fill the user is about to restore.
 *    `resourceDiagnostics` gates on `fillType === "image"` because it asks a different question —
 *    "is this widget broken *right now*" — and that gate is wrong for deletion safety.
 *  - **Not every id is a library asset.** Builtin font stacks and dev-mode save previews are
 *    id-shaped but have no library row behind them; they are filtered at the single choke point
 *    {@link isLibraryAssetId} so no extractor can forget.
 *
 * Deliberately out of scope: `app://fs/{hash}` URLs are keyed by content hash, not asset id, so the
 * id is not recoverable from them; and `blueprint.data.jsonLiteral` params are arbitrary
 * author-supplied JSON, which would need a heuristic UUID scan to cover and would report phantoms.
 */

/** Which kind of document holds the reference — drives grouping and the icon in the UI. */
export type ReferenceSiteKind = "story" | "blueprint" | "uiElement" | "voice" | "character";

export interface AssetReference {
    /** Stable unique id (React key, and the dedupe key when slices are merged). */
    id: string;
    assetId: string;
    kind: ReferenceSiteKind;
    /** Primary label — the containing entity (scene, blueprint, widget, character). */
    label: string;
    /** Context line: `story › scene`, the variant name, the locale… */
    detail?: string;
    /**
     * Dotted path of the field holding the id (`audio.assetId`, `appearance.imageFill`). Shown
     * verbatim as the "where" column, so it should read as the field an author would recognise.
     */
    field: string;
    /** Stored but not currently rendered — see the dormancy note in the file header. */
    dormant?: boolean;
    /** Reuse of the global-search navigation layer; absent when a site has no deep link yet. */
    target?: SearchJumpTarget;
}

/**
 * Reject id-shaped values that have no asset-library row behind them.
 *
 * Every extractor funnels through here rather than filtering locally, because each of these
 * prefixes reaches more than one extractor (builtin fonts land in both UI props and appearance
 * rows) and a missed one shows up as a phantom usage that blocks a legitimate delete.
 */
export function isLibraryAssetId(value: unknown): value is string {
    if (typeof value !== "string") {
        return false;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return false;
    }
    return (
        !trimmed.startsWith(BUILTIN_EDITOR_FONT_ID_PREFIX) &&
        !trimmed.startsWith(DEV_MODE_SAVE_PREVIEW_ASSET_ID_PREFIX)
    );
}

/** Group references by asset id — the shape the panel queries. */
export function buildReferenceIndex(references: readonly AssetReference[]): Map<string, AssetReference[]> {
    const index = new Map<string, AssetReference[]>();
    for (const reference of references) {
        const bucket = index.get(reference.assetId);
        if (bucket) {
            bucket.push(reference);
        } else {
            index.set(reference.assetId, [reference]);
        }
    }
    return index;
}

// ---------------------------------------------------------------------------
// Story
// ---------------------------------------------------------------------------

/**
 * Story slice: scene default backgrounds plus every block payload that carries an asset id.
 *
 * Superset of `StoryService.collectDocumentAssetLocks` — that walker omits `image.assetId` and
 * `video.assetId`, so an image or video used only from a story block currently reports as unused.
 */
export function extractStoryAssetReferences(document: StoryDocument, storyName: string): AssetReference[] {
    const references: AssetReference[] = [];

    for (const scene of Object.values(document.scenes)) {
        const sceneName = scene.name;
        const detail = `${storyName} › ${sceneName}`;

        const pushBlockReference = (blockId: string, field: string, assetId: unknown) => {
            if (!isLibraryAssetId(assetId)) {
                return;
            }
            references.push({
                id: `story:${document.id}:${scene.id}:${blockId}:${field}`,
                assetId: assetId.trim(),
                kind: "story",
                label: sceneName,
                detail,
                field,
                target: {
                    kind: "storyBlock",
                    storyId: document.id,
                    sceneId: scene.id,
                    blockId,
                    storyName,
                    sceneName,
                },
            });
        };

        if (isLibraryAssetId(scene.defaultBackgroundAssetId)) {
            references.push({
                id: `story:${document.id}:${scene.id}:__scene__:defaultBackgroundAssetId`,
                assetId: scene.defaultBackgroundAssetId.trim(),
                kind: "story",
                label: sceneName,
                detail,
                field: "scene.defaultBackgroundAssetId",
                target: { kind: "storyScene", storyId: document.id, sceneId: scene.id, storyName, sceneName },
            });
        }

        // `blocks` is a flat record — control-flow nesting lives in id lists, not in the values —
        // so this covers blocks inside conditions and loops without recursing.
        for (const block of Object.values(scene.blocks)) {
            if (block.kind === "nodeAction" && block.payload.action === "dialogue") {
                pushBlockReference(block.id, "dialogue.voiceAssetId", block.payload.voiceAssetId);
                continue;
            }
            if (block.kind !== "action") {
                continue;
            }
            const payload = block.payload;
            switch (payload.action) {
                case "setBackground":
                    pushBlockReference(block.id, "background.assetId", payload.assetId);
                    break;
                case "character":
                    pushBlockReference(block.id, "character.assetId", payload.assetId);
                    break;
                case "audio":
                    pushBlockReference(block.id, "audio.assetId", payload.assetId);
                    break;
                case "image":
                    pushBlockReference(block.id, "image.assetId", payload.assetId);
                    break;
                case "video":
                    pushBlockReference(block.id, "video.assetId", payload.assetId);
                    break;
                case "displayable":
                    pushBlockReference(block.id, "displayable.maskAssetId", payload.maskAssetId);
                    break;
                default:
                    break;
            }
        }
    }

    return references;
}

/**
 * Story animation slice: the two preview images on an animation asset.
 *
 * Editor-only - the compiler ignores both, and neither affects the produced Transform. They are
 * still library assets an author picked, so deleting one silently empties the Story Motion preview
 * they set up. "Unused by the runtime" and "safe to delete" are different questions, and this index
 * answers the second.
 */
export function extractStoryAnimationAssetReferences(animation: StoryAnimationAsset): AssetReference[] {
    const references: AssetReference[] = [];

    const push = (field: string, assetId: unknown) => {
        if (!isLibraryAssetId(assetId)) {
            return;
        }
        references.push({
            id: `storyAnimation:${animation.id}:${field}`,
            assetId: assetId.trim(),
            kind: "story",
            label: animation.name,
            detail: animation.targetKind,
            field: `animation.${field}`,
        });
    };

    push("previewAssetId", animation.previewAssetId);
    push("previewBackgroundAssetId", animation.previewBackgroundAssetId);

    return references;
}

// ---------------------------------------------------------------------------
// Blueprint
// ---------------------------------------------------------------------------

/**
 * Blueprint slice: image-asset params and bare font-id params on graph nodes.
 *
 * Walks events, functions **and macros**. `extractBlueprintEntries` in the search index omits
 * macros; a node buried in a macro is exactly the kind of usage a delete guard must not miss.
 */
export function extractBlueprintAssetReferences(
    document: BlueprintDocument,
    resolveNodeLabel?: (nodeType: string) => string | undefined,
): AssetReference[] {
    const references: AssetReference[] = [];

    const ownerKeyByBlueprintId = new Map<string, string>();
    for (const [ownerKey, record] of Object.entries(document.ownerRecords)) {
        for (const blueprintId of [record.activeBlueprintId, ...record.privateBlueprintIds]) {
            if (blueprintId && !ownerKeyByBlueprintId.has(blueprintId)) {
                ownerKeyByBlueprintId.set(blueprintId, ownerKey);
            }
        }
    }

    for (const blueprint of Object.values(document.blueprints)) {
        const ownerKey = ownerKeyByBlueprintId.get(blueprint.id);
        if (!ownerKey || blueprint.program.kind !== "graph") {
            continue;
        }

        const graphs = blueprint.program.graphs;
        const slots: Array<{ focus: "event" | "function" | "macro"; graphId: string; ir: { nodes?: Record<string, { id: string; type: string; params?: Record<string, unknown> }> } | undefined }> = [
            ...Object.entries(graphs.events).map(([graphId, slot]) => ({ focus: "event" as const, graphId, ir: slot.graph })),
            ...Object.entries(graphs.functions).map(([graphId, slot]) => ({ focus: "function" as const, graphId, ir: slot.graph })),
            ...Object.entries(graphs.macros ?? {}).map(([graphId, slot]) => ({ focus: "macro" as const, graphId, ir: slot.graph })),
        ];

        for (const { focus, graphId, ir } of slots) {
            for (const node of Object.values(ir?.nodes ?? {})) {
                const nodeLabel = resolveNodeLabel?.(node.type) ?? node.type;
                const target: SearchJumpTarget = {
                    kind: "blueprint",
                    blueprintId: blueprint.id,
                    ownerKey,
                    focusNodeId: node.id,
                    // Macro graphs have no focus slot of their own; the node id still lands the
                    // editor on the right graph.
                    ...(focus === "event" ? { focusEventId: graphId } : {}),
                    ...(focus === "function" ? { focusFunctionId: graphId } : {}),
                };

                const params = node.params ?? {};

                // `normalizeBlueprintImageAssetValue` also accepts a bare string, so legacy graphs
                // that stored the raw id instead of the `{kind:"imageAsset"}` wrapper are covered.
                //
                // The pin was renamed `assetId` → `asset`, and Set Image Asset still falls back to
                // the old name when `asset` is unset (widgetPropertyNodes.ts). Mirroring that
                // precedence rather than reading both keeps a graph saved before the rename from
                // reporting its image as unused, without inventing a second live reference for a
                // node that has already been migrated.
                const assetParam = params.asset !== undefined ? params.asset : params.assetId;
                const assetField = params.asset !== undefined ? "asset" : "assetId";
                const imageAssetId = blueprintImageAssetId(assetParam);
                if (isLibraryAssetId(imageAssetId)) {
                    references.push({
                        id: `bp:${blueprint.id}:${graphId}:${node.id}:${assetField}`,
                        assetId: imageAssetId,
                        kind: "blueprint",
                        label: nodeLabel,
                        detail: blueprint.name,
                        field: assetField,
                        target,
                    });
                }

                // Font pins are typed plain `string`, not tagged as assets — the key name is the
                // only signal, so this stays a literal key check.
                if (isLibraryAssetId(params.fontAssetId)) {
                    references.push({
                        id: `bp:${blueprint.id}:${graphId}:${node.id}:fontAssetId`,
                        assetId: params.fontAssetId.trim(),
                        kind: "blueprint",
                        label: nodeLabel,
                        detail: blueprint.name,
                        field: "fontAssetId",
                        target,
                    });
                }
            }
        }
    }

    return references;
}

// ---------------------------------------------------------------------------
// UI editor
// ---------------------------------------------------------------------------

function readRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * An `ImageFill` is dormant when its containing prop bag currently fills with a colour. The sibling
 * `fillType` lives next to the fill, so dormancy is decided at the same nesting level rather than
 * from the element root — a scrollbar track can fill with an image while the widget itself does not.
 */
function isDormantFill(container: Record<string, unknown>): boolean {
    return "fillType" in container && container.fillType !== "image";
}

function extractElementAssetReferences(element: UIElement, ownerLabel: string | undefined): AssetReference[] {
    const references: AssetReference[] = [];
    const props = readRecord(element.props);
    if (!props) {
        return references;
    }

    const label = element.name?.trim() || element.type;
    const push = (suffix: string, field: string, assetId: unknown, dormant?: boolean, detail?: string) => {
        if (!isLibraryAssetId(assetId)) {
            return;
        }
        references.push({
            id: `ui:${element.id}:${suffix}`,
            assetId: assetId.trim(),
            kind: "uiElement",
            label,
            detail: detail ?? ownerLabel,
            field,
            ...(dormant ? { dormant: true } : {}),
        });
    };

    /**
     * Recursive because `imageFill` appears at four different depths on flat props alone (root,
     * scrollbar track, scrollbar thumb, and list item chrome). Enumerating the known paths meant a
     * new nested chrome prop silently stopped being scanned; the walk cannot drift that way.
     *
     * Arrays are descended too. No widget stores an asset-bearing bag in one today, so this buys
     * nothing right now - but "the walk cannot drift" is only true if it holds for a prop shape
     * nobody has written yet, and an array is the obvious next one.
     */
    const walkValue = (value: unknown, childPath: string, depth: number) => {
        if (depth > 6) {
            return;
        }
        if (Array.isArray(value)) {
            value.forEach((item, index) => walkValue(item, `${childPath}[${index}]`, depth + 1));
            return;
        }
        const child = readRecord(value);
        if (child) {
            walk(child, childPath, depth + 1);
        }
    };

    const walk = (node: Record<string, unknown>, path: string, depth: number) => {
        if (depth > 6) {
            return;
        }
        for (const [key, value] of Object.entries(node)) {
            // `appearance` is handled separately — it is a structured variant model, not a prop bag,
            // and it carries a variant name worth surfacing.
            if (key === "appearance") {
                continue;
            }
            const childPath = path ? `${path}.${key}` : key;

            if (key === "imageFill") {
                const fill = readRecord(value);
                if (fill) {
                    push(childPath, childPath, fill.assetId, isDormantFill(node));
                }
                continue;
            }
            if (key === "fontAssetId") {
                push(childPath, childPath, value);
                continue;
            }
            walkValue(value, childPath, depth);
        }
    };
    walk(props, "", 0);

    // Legacy `nl.image` stored the id bare on props; `getImageWidgetRectangleProps` upgrades it to
    // an `imageFill` lazily at read time, so the bare string is still what sits on disk.
    //
    // The upgrade fires on `legacyAssetId && !hasAssetInFill && !hasBg`, so the presence of an
    // `imageFill` object is not what decides it - an `imageFill` with a null `assetId` still lets the
    // bare id win. Testing for the object alone dropped that reference entirely, and the widget went
    // on rendering an asset nothing claimed to use.
    //
    // Dormancy is the upgrade itself, not the stored `fillType`: when it fires it forces
    // `fillType: "image"`, so the reference is live however the prop bag was left. When something
    // else supplies the fill the bare id renders nothing - still reported, because clearing that fill
    // brings it back (see the dormancy note in the file header).
    if (element.type === "nl.image") {
        const fill = readRecord(props.imageFill);
        const hasAssetInFill = typeof fill?.assetId === "string" && fill.assetId.trim().length > 0;
        const hasBackgroundImage = typeof props.backgroundImage === "string" && props.backgroundImage.trim().length > 0;
        push("assetId", "assetId", props.assetId, hasAssetInFill || hasBackgroundImage);
    }

    const appearance = props.appearance;
    if (isAppearanceModel(appearance)) {
        for (const variant of appearance.variants as AppearanceVariant[]) {
            const variantDetail = ownerLabel ? `${ownerLabel} › ${variant.name}` : variant.name;
            const fillTypeGroup = variant.propertyGroups.find(group => group.key === "fillType");
            // A variant that pins fillType to a non-image value makes its own imageFill rows
            // dormant; with no fillType group the variant inherits the element's flat prop.
            const variantDormant = fillTypeGroup
                ? !fillTypeGroup.rows.some(row => (row as { value?: unknown }).value === "image")
                : isDormantFill(props);

            for (const group of variant.propertyGroups) {
                if (group.key !== "imageFill" && group.key !== "fontAssetId") {
                    continue;
                }
                group.rows.forEach((row, rowIndex) => {
                    const value = (row as { value?: unknown }).value;
                    const suffix = `appearance:${variant.id}:${group.key}:${rowIndex}`;
                    const field = `appearance.${group.key}`;
                    if (group.key === "fontAssetId") {
                        push(suffix, field, value, false, variantDetail);
                        return;
                    }
                    const fill = readRecord(value);
                    if (fill) {
                        push(suffix, field, fill.assetId, variantDormant, variantDetail);
                    }
                });
            }
        }
    }

    return references;
}

/**
 * UI slice: both element pools. `document.elements` is the stage; `document.components[].elements`
 * is a disjoint pool — a component's elements are not mirrored into the stage pool, so scanning
 * only the stage misses every asset used inside a reusable component.
 */
export function extractUIDocumentAssetReferences(document: UIDocument): AssetReference[] {
    const references: AssetReference[] = [];

    for (const element of Object.values(document.elements)) {
        references.push(...extractElementAssetReferences(element, undefined));
    }
    for (const component of document.components ?? []) {
        for (const element of Object.values(component.elements)) {
            references.push(...extractElementAssetReferences(element, component.name));
        }
    }

    return references;
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

/** Voice slice: one document per locale, each unit keyed by the story `textId` it voices. */
export function extractVoiceAssetReferences(document: VoiceDocument): AssetReference[] {
    const references: AssetReference[] = [];
    for (const [textId, unit] of Object.entries(document.units)) {
        if (!isLibraryAssetId(unit.assetId)) {
            continue;
        }
        references.push({
            id: `voice:${document.locale}:${textId}`,
            assetId: unit.assetId.trim(),
            kind: "voice",
            label: textId,
            detail: document.locale,
            field: "voice.assetId",
        });
    }
    return references;
}

// ---------------------------------------------------------------------------
// Character
// ---------------------------------------------------------------------------

/** The slice of a character the extractor needs; matches `Character` structurally. */
export interface ReferenceScannableCharacter {
    id: string;
    name: string;
    thumbnailAssetId?: string | null;
    forms: ReadonlyArray<{ name: string; variantAssetIds: Readonly<Record<string, string | null | undefined>> }>;
}

/** Character slice: profile thumbnail plus every appearance variant asset. */
export function extractCharacterAssetReferences(
    characters: readonly ReferenceScannableCharacter[],
): AssetReference[] {
    const references: AssetReference[] = [];

    for (const character of characters) {
        if (isLibraryAssetId(character.thumbnailAssetId)) {
            references.push({
                id: `char:${character.id}:thumbnail`,
                assetId: character.thumbnailAssetId.trim(),
                kind: "character",
                label: character.name,
                field: "profile.thumbnail",
            });
        }
        for (const form of character.forms) {
            for (const [variantName, assetId] of Object.entries(form.variantAssetIds)) {
                if (!isLibraryAssetId(assetId)) {
                    continue;
                }
                references.push({
                    id: `char:${character.id}:${form.name}:${variantName}`,
                    assetId: assetId.trim(),
                    kind: "character",
                    label: character.name,
                    detail: `${form.name} › ${variantName}`,
                    field: "form.variantAssets",
                });
            }
        }
    }

    return references;
}
