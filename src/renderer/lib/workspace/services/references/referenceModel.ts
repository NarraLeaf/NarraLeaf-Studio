import type { StoryAnimationAsset, StoryDocument } from "@shared/types/story";
import { listSceneBlocksInDocumentOrder, listScenesInDocumentOrder } from "@shared/types/story";
import type {
  BlueprintDocument,
  BlueprintGraphEdge,
  BlueprintGraphIr
} from "@shared/types/blueprint/document";
import {
  BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL,
  BLUEPRINT_NODE_TYPE_LITERAL,
  BLUEPRINT_NODE_TYPE_LITERAL_JSON,
  BLUEPRINT_NODE_TYPE_LITERAL_STRING
} from "@shared/types/blueprint/graph";
import type { BlueprintAssetPinKind } from "@shared/types/blueprint/valueTypes";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import type { VoiceDocument } from "@shared/types/voice";
import { isAppearanceModel, type AppearanceVariant } from "@shared/types/ui-editor/appearance";
import { blueprintImageAssetId } from "@shared/types/blueprint/valueTypes";
import { BUILTIN_EDITOR_FONT_ID_PREFIX } from "@/lib/ui-editor/fonts/builtinVirtualEditorFonts";
import { DEV_MODE_SAVE_PREVIEW_ASSET_ID_PREFIX } from "@shared/types/devModeSave";
import { parseAssetUrlToken } from "@/lib/workspace/assets/assetUrlTokens";
import type { SearchJumpTarget } from "../search/searchIndexModel";

/**
 * Asset reverse lookup — the pure model.
 *
 * Extraction turns each document that can *hold* an asset id into a flat {@link AssetReference}
 * list plus the {@link ReferenceIndexGap}s it could not turn into one; the service owns *when*
 * slices rebuild, this file owns *what counts as a reference* and *what counts as not knowing*.
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
 * ## The index says when it does not know
 *
 * Two shapes hold an asset without naming its id, and neither can be read by pattern-matching the
 * value. Both are covered as far as they can be, and what remains is *reported*, because the caller
 * that matters is deciding whether deleting a file is safe:
 *
 *  - **`app://fs/{token}` URLs.** A widget's `backgroundImage` and the legacy `imageUrl` are
 *    free-text URL fields, and a grant token carries no information about the file it opens. The
 *    tokens this session minted are recorded as they are minted (`assets/assetUrlTokens.ts`) and
 *    resolved back to an asset id here. Any other token yields a `hashUrlUnresolved` gap.
 *  - **`blueprint.data.jsonLiteral` params.** Covered structurally rather than by scanning JSON for
 *    id-shaped strings, which would report references that do not exist and block legitimate
 *    deletes. A pin declares that it carries an asset (`BlueprintNodePinDef.assetRef`), and an edge
 *    into such a pin is followed to its source: a JSON or String literal there is read as the asset
 *    it feeds. A source that computes its value yields a `computedAssetPin` gap.
 *
 * Every reason that clears {@link ReferenceIndexResult.complete} is listed on
 * {@link ReferenceGapReason}, and that union is the whole list: an index that never built, a slice
 * that threw, a document that would not load, a blueprint this walk cannot read (a script module,
 * or one no owner claims), a node type the catalogue does not know, and the two above. A gap says
 * which kinds of asset it could be hiding a use of, so one unreadable widget does not put the
 * sounds beyond deleting — see {@link ReferenceIndexGap.affects}.
 *
 * **Known and deliberately not covered:** `UIComponentLink.params` is a bag of author-typed strings
 * (`document.ts`), and a component param is declared `type: "string"` with no asset-typed variant to
 * declare instead. Reporting a gap per component instance would fire on every project that uses a
 * param for a label, which is nearly all of them; reading the values would be the id-shaped-string
 * heuristic this file refuses everywhere else. Closing it needs an asset-typed component param.
 *
 * Nothing may treat an incomplete index as "nothing uses this": the asset delete guard refuses for
 * the kinds in doubt, and `assets/unused` withholds those kinds and says why.
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

/** The slices the index is assembled from; a gap names the one it came from. */
export type ReferenceSliceKind =
  | "story"
  | "storyAnimation"
  | "blueprint"
  | "ui"
  | "voice"
  | "character";

/**
 * Why one site could not be turned into a reference.
 *
 * Enumerated rather than free text so a consumer can act on the kind (and a message can be written
 * for it) without parsing a sentence.
 */
export type ReferenceGapReason =
  /** Nothing has been read yet, so the index describes no part of the project. */
  | "indexNotBuilt"
  /** A slice threw while being built, so everything it would have contributed is missing. */
  | "sliceFailed"
  /** A document could not be loaded or parsed, so its references were never seen. */
  | "documentUnreadable"
  /** A blueprint this walk cannot read: a script module, or one no owner claims. */
  | "blueprintProgramNotWalked"
  /** A node type the catalogue does not know, so which of its params hold assets is unknown. */
  | "unknownNodeType"
  /** An `app://fs/{token}` URL whose token this session did not mint, so it names no asset. */
  | "hashUrlUnresolved"
  /** An asset pin fed by a node that computes its value, so the asset is only known at run time. */
  | "computedAssetPin";

/**
 * The kinds of library asset a gap can cast doubt on.
 *
 * Narrower than `AssetType` on purpose: what a gap knows is what the *site* could hold, and a site
 * holds a picture or a typeface. Nothing in the project can put a sound behind an image URL.
 */
export type ReferenceAssetKind = "image" | "font";

export interface ReferenceIndexGap {
  reason: ReferenceGapReason;
  /** Absent when the gap is the whole index rather than one slice of it. */
  slice?: ReferenceSliceKind;
  /**
   * Where it is, in the words the author's own document uses (`Main Story › Opening`,
   * `Title Screen.backgroundImage`). Shown verbatim, so it has to read as a place they can go to.
   * Absent only when the gap has no site: an index that never built is not anywhere.
   */
  location?: string;
  /**
   * Which kinds of asset this gap could be hiding a use of. **Absent means every kind** — an
   * unread document can hold anything.
   *
   * This is what keeps one bad site from disabling the whole library. A widget with a picture the
   * index cannot identify says nothing about whether a sound is used, and without the distinction
   * a single pasted URL would make every asset in the project undeletable and silence the unused
   * report entirely.
   */
  affects?: readonly ReferenceAssetKind[];
  /** Reuse of the global-search navigation layer; absent when a site has no deep link. */
  target?: SearchJumpTarget;
}

/**
 * Whether the index covers the whole project, and where it does not.
 *
 * A boolean alone would be unactionable: "something is missing" with no way to say what, and no way
 * for a message to send the author anywhere. `complete` is `gaps.length === 0` for a built index,
 * and false for an index that never finished building at all.
 *
 * `complete` answers the project-wide question. A consumer asking about particular assets asks
 * {@link referenceGapsAffecting} instead, which is the difference between "one widget is unclear"
 * and "nothing may be deleted".
 */
export interface ReferenceIndexResult {
  complete: boolean;
  gaps: readonly ReferenceIndexGap[];
}

/**
 * The gaps that cast doubt on assets of these kinds.
 *
 * A gap with no `affects` is returned for every question, because an unread document can hold a use
 * of anything. Passing no kinds asks the project-wide question and returns every gap.
 */
export function referenceGapsAffecting(
  gaps: readonly ReferenceIndexGap[],
  kinds?: readonly ReferenceAssetKind[]
): ReferenceIndexGap[] {
  if (!kinds) {
    return [...gaps];
  }
  return gaps.filter((gap) => !gap.affects || gap.affects.some((kind) => kinds.includes(kind)));
}

/**
 * What an extractor that can fail to understand a site returns.
 *
 * Only the two extractors that can produce a gap return this shape; the rest return references,
 * because their fields are typed and there is nothing for them to fail to understand. Adding a gap
 * site to one of those is a signature change, which is the point: it cannot be added quietly.
 */
export interface ReferenceExtraction {
  references: AssetReference[];
  gaps: ReferenceIndexGap[];
}

/** Resolves an `app://fs/{token}` token back to the asset the renderer minted it for. */
export type AssetUrlTokenResolver = (token: string) => string | null;

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
export function buildReferenceIndex(
  references: readonly AssetReference[]
): Map<string, AssetReference[]> {
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
export function extractStoryAssetReferences(
  document: StoryDocument,
  storyName: string
): AssetReference[] {
  const references: AssetReference[] = [];

  for (const scene of listScenesInDocumentOrder(document)) {
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
          sceneName
        }
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
        target: {
          kind: "storyScene",
          storyId: document.id,
          sceneId: scene.id,
          storyName,
          sceneName
        }
      });
    }

    if (isLibraryAssetId(scene.bgm?.assetId)) {
      references.push({
        id: `story:${document.id}:${scene.id}:__scene__:bgm`,
        assetId: scene.bgm!.assetId.trim(),
        kind: "story",
        label: sceneName,
        detail,
        field: "scene.bgm.assetId",
        target: {
          kind: "storyScene",
          storyId: document.id,
          sceneId: scene.id,
          storyName,
          sceneName
        }
      });
    }

    // Depth first, so the "used by" list under an asset reads down the scene the way the author
    // wrote it. The record's key order would be UUID order once it has been rewritten once.
    for (const block of listSceneBlocksInDocumentOrder(scene)) {
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
export function extractStoryAnimationAssetReferences(
  animation: StoryAnimationAsset
): AssetReference[] {
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
      field: `animation.${field}`
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
 * One asset-bearing pin on one node type, as the node catalogue declares it.
 *
 * `paramKey` is where the id is stored when the pin is not wired; it defaults to the pin id and
 * differs only on the Image Asset literal node, which publishes `value` and stores `asset`.
 */
export interface BlueprintAssetPin {
  pinId: string;
  kind: BlueprintAssetPinKind;
  paramKey: string;
  /** Only an input can be fed by an edge, so only an input can be followed to a source. */
  input: boolean;
  /**
   * `"published"` pins hold nothing and hide nothing - see {@link BlueprintAssetPinRef.origin}.
   * They are declared here anyway, because being declared is what tells the edge walk that a
   * value arriving from one is accounted for rather than unreadable.
   */
  origin?: "stored" | "published";
}

/**
 * Declared asset pins for a node type.
 *
 * **`null` means the catalogue has never heard of this type** — a node left behind by an uninstalled
 * plugin, or a document from a newer Studio. That is not the same as a node with no asset pins, and
 * conflating them is how an asset held by such a node becomes invisible while the index reports full
 * coverage. An empty array means "known, and holds none".
 */
export type BlueprintAssetPinResolver = (nodeType: string) => readonly BlueprintAssetPin[] | null;

/**
 * The pins covered without a catalogue.
 *
 * Present so the model stays usable on its own (and so a catalogue lookup that fails cannot shrink
 * coverage): the resolver's answer is merged onto these, never substituted for them. `assetId` is
 * absent because it is the pre-rename spelling of `asset` and is handled with its own precedence
 * rule below.
 */
const DEFAULT_BLUEPRINT_ASSET_PINS: readonly BlueprintAssetPin[] = [
  { pinId: "asset", kind: "image", paramKey: "asset", input: true },
  { pinId: "fontAssetId", kind: "font", paramKey: "fontAssetId", input: true }
];

/**
 * The Image Asset literal's output, so an edge from one is recognised as already covered rather
 * than read a second time from the node that consumes it.
 *
 * Bound to that node type rather than added to the list above, because `value` is the output pin of
 * every literal node there is. Applied to all of them it would make each one look like a node that
 * stores its own asset, and the whole legacy-literal path below would never run.
 */
const IMAGE_ASSET_LITERAL_PINS: readonly BlueprintAssetPin[] = [
  ...DEFAULT_BLUEPRINT_ASSET_PINS,
  { pinId: "value", kind: "image", paramKey: "asset", input: false }
];

/**
 * Literal nodes whose stored value is the asset, and which say nothing about that in their type.
 *
 * These are the legacy shape: before an asset pin could be picked on the node itself, an author
 * wired a JSON or String literal into it. The value is read only when the edge lands on a pin that
 * *declares* it carries an asset — never by scanning literals for id-shaped strings, which would
 * invent references and block deletes that are perfectly safe.
 */
const GENERIC_LITERAL_NODE_TYPES: ReadonlySet<string> = new Set<string>([
  BLUEPRINT_NODE_TYPE_LITERAL_JSON,
  BLUEPRINT_NODE_TYPE_LITERAL_STRING,
  BLUEPRINT_NODE_TYPE_LITERAL
]);

/**
 * Key for "which edges land on this pin".
 *
 * The separator is a character no id can contain, so two different (node, pin) pairs cannot
 * collide into one bucket and hand a node an edge that belongs to its neighbour.
 */
function incomingEdgeKey(nodeId: string, pinId: string): string {
  return `${nodeId}\u0000${pinId}`;
}

/** The asset id a pin value holds, by the kind of asset the pin declares. */
function readAssetPinValue(kind: BlueprintAssetPinKind, value: unknown): string | null {
  if (kind === "image") {
    const imageAssetId = blueprintImageAssetId(value);
    return isLibraryAssetId(imageAssetId) ? imageAssetId : null;
  }
  return isLibraryAssetId(value) ? value.trim() : null;
}

/**
 * Blueprint slice: every pin the catalogue declares as asset-bearing, on every graph node.
 *
 * Walks events, functions **and macros**. `extractBlueprintEntries` in the search index omits
 * macros; a node buried in a macro is exactly the kind of usage a delete guard must not miss.
 */
export function extractBlueprintAssetReferences(
  document: BlueprintDocument,
  options: {
    resolveNodeLabel?: (nodeType: string) => string | undefined;
    resolveAssetPins?: BlueprintAssetPinResolver;
  } = {}
): ReferenceExtraction {
  const { resolveNodeLabel, resolveAssetPins } = options;
  const references: AssetReference[] = [];
  const gaps: ReferenceIndexGap[] = [];

  const assetPinsByType = new Map<string, readonly BlueprintAssetPin[]>();
  const unknownNodeTypes = new Set<string>();
  const reportedUnknownSites = new Set<string>();
  const assetPinsFor = (nodeType: string): readonly BlueprintAssetPin[] => {
    const cached = assetPinsByType.get(nodeType);
    if (cached) {
      return cached;
    }
    const declared = resolveAssetPins?.(nodeType);
    if (declared === null) {
      unknownNodeTypes.add(nodeType);
    }
    const merged: BlueprintAssetPin[] =
      nodeType === BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL
        ? [...IMAGE_ASSET_LITERAL_PINS]
        : [...DEFAULT_BLUEPRINT_ASSET_PINS];
    for (const pin of declared ?? []) {
      if (!merged.some((existing) => existing.pinId === pin.pinId)) {
        merged.push(pin);
      }
    }
    assetPinsByType.set(nodeType, merged);
    return merged;
  };

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
      /**
       * Two shapes this walk cannot read, and both used to leave no trace at all.
       *
       * A `scriptModule` blueprint is TypeScript the author wrote (`blueprintFactories.ts`
       * creates them), and an asset id in that source is a plain string literal this file has
       * no business parsing. A blueprint no `ownerRecords` entry claims is unreachable from
       * here for a different reason: without an owner there is no jump target to report it
       * under. Either way an asset used only from it was reported as used by nothing.
       */
      gaps.push({
        reason: "blueprintProgramNotWalked",
        slice: "blueprint",
        location: blueprint.name
      });
      continue;
    }

    const graphs = blueprint.program.graphs;
    const slots: Array<{
      focus: "event" | "function" | "macro";
      graphId: string;
      ir: BlueprintGraphIr | undefined;
    }> = [
      ...Object.entries(graphs.events).map(([graphId, slot]) => ({
        focus: "event" as const,
        graphId,
        ir: slot.graph
      })),
      ...Object.entries(graphs.functions).map(([graphId, slot]) => ({
        focus: "function" as const,
        graphId,
        ir: slot.graph
      })),
      ...Object.entries(graphs.macros ?? {}).map(([graphId, slot]) => ({
        focus: "macro" as const,
        graphId,
        ir: slot.graph
      }))
    ];

    for (const { focus, graphId, ir } of slots) {
      const nodes = ir?.nodes ?? {};
      // Grouped by the pin they land on, so following one asset pin is a lookup rather than a
      // scan of every edge in the graph per pin.
      const incomingEdges = new Map<string, BlueprintGraphEdge[]>();
      for (const edge of ir?.edges ?? []) {
        const key = incomingEdgeKey(edge.to.nodeId, edge.to.port);
        const bucket = incomingEdges.get(key);
        if (bucket) {
          bucket.push(edge);
        } else {
          incomingEdges.set(key, [edge]);
        }
      }

      for (const node of Object.values(nodes)) {
        const nodeLabel = resolveNodeLabel?.(node.type) ?? node.type;
        const target: SearchJumpTarget = {
          kind: "blueprint",
          blueprintId: blueprint.id,
          ownerKey,
          focusNodeId: node.id,
          // Macro graphs have no focus slot of their own; the node id still lands the
          // editor on the right graph.
          ...(focus === "event" ? { focusEventId: graphId } : {}),
          ...(focus === "function" ? { focusFunctionId: graphId } : {})
        };

        const params = node.params ?? {};
        const push = (suffix: string, field: string, assetId: string) => {
          references.push({
            id: `bp:${blueprint.id}:${graphId}:${node.id}:${suffix}`,
            assetId,
            kind: "blueprint",
            label: nodeLabel,
            detail: blueprint.name,
            field,
            target
          });
        };

        const assetPins = assetPinsFor(node.type);
        if (
          unknownNodeTypes.has(node.type) &&
          !reportedUnknownSites.has(`${blueprint.id} ${node.type}`)
        ) {
          // Reported once per blueprint rather than once per node: an uninstalled plugin
          // leaves dozens of identical nodes behind, and dozens of identical findings say
          // nothing the first one did not.
          reportedUnknownSites.add(`${blueprint.id} ${node.type}`);
          gaps.push({
            reason: "unknownNodeType",
            slice: "blueprint",
            location: `${blueprint.name} › ${nodeLabel}`,
            target
          });
        }
        // Keyed by stored key rather than by pin, because two pins can name the same one
        // (`value` publishes what `asset` stores) and reading it twice would list one site
        // twice in the "used by" panel.
        const readParamKeys = new Set<string>();

        for (const pin of assetPins) {
          if (pin.origin !== "published" && !readParamKeys.has(pin.paramKey)) {
            readParamKeys.add(pin.paramKey);
            // `normalizeBlueprintImageAssetValue` also accepts a bare string, so legacy
            // graphs that stored the raw id instead of the `{kind:"imageAsset"}` wrapper
            // are covered.
            const stored = readAssetPinValue(pin.kind, params[pin.paramKey]);
            if (stored) {
              push(pin.paramKey, pin.paramKey, stored);
            }
          }
          if (!pin.input) {
            continue;
          }
          for (const edge of incomingEdges.get(incomingEdgeKey(node.id, pin.pinId)) ?? []) {
            const source = nodes[edge.from.nodeId];
            if (!source) {
              continue;
            }
            // A source pin that declares what it carries is not a hole. Either it
            // stores the asset, in which case its own node already reported it and
            // reading it again would double the site, or it publishes one the host
            // resolves at run time, which is no library reference at all.
            if (assetPinsFor(source.type).some((sourcePin) => sourcePin.pinId === edge.from.port)) {
              continue;
            }
            if (!GENERIC_LITERAL_NODE_TYPES.has(source.type)) {
              gaps.push({
                reason: "computedAssetPin",
                slice: "blueprint",
                location: `${blueprint.name} › ${nodeLabel}.${pin.pinId}`,
                // The pin says which kind of asset can arrive on it, so this casts
                // no doubt on the rest of the library.
                affects: [pin.kind],
                target
              });
              continue;
            }
            const wired = readAssetPinValue(pin.kind, source.params?.value);
            if (wired) {
              push(`${pin.pinId}:from:${source.id}`, pin.paramKey, wired);
            }
          }
        }

        // The pin was renamed `assetId` → `asset`, and Set Image Asset still falls back to
        // the old name when `asset` is unset (widgetPropertyNodes.ts). Mirroring that
        // precedence rather than reading both keeps a graph saved before the rename from
        // reporting its image as unused, without inventing a second live reference for a
        // node that has already been migrated.
        if (params.asset === undefined) {
          const legacyAssetId = readAssetPinValue("image", params.assetId);
          if (legacyAssetId) {
            push("assetId", "assetId", legacyAssetId);
          }
        }
      }
    }
  }

  return { references, gaps };
}

// ---------------------------------------------------------------------------
// UI editor
// ---------------------------------------------------------------------------

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * An `ImageFill` is dormant when its containing prop bag currently fills with a colour. The sibling
 * `fillType` lives next to the fill, so dormancy is decided at the same nesting level rather than
 * from the element root — a scrollbar track can fill with an image while the widget itself does not.
 */
function isDormantFill(container: Record<string, unknown>): boolean {
  return "fillType" in container && container.fillType !== "image";
}

/**
 * The free-text URL props. Both take whatever the author types, so either can hold an
 * `app://fs/{token}` grant URL, which names a file without naming the asset it belongs to.
 */
const URL_VALUED_PROP_KEYS: ReadonlySet<string> = new Set(["backgroundImage", "imageUrl"]);

function extractElementAssetReferences(
  element: UIElement,
  ownerLabel: string | undefined,
  resolveAssetToken: AssetUrlTokenResolver | undefined,
  gaps: ReferenceIndexGap[]
): AssetReference[] {
  const references: AssetReference[] = [];
  const props = readRecord(element.props);
  if (!props) {
    return references;
  }

  const label = element.name?.trim() || element.type;
  const push = (
    suffix: string,
    field: string,
    assetId: unknown,
    dormant?: boolean,
    detail?: string
  ) => {
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
      ...(dormant ? { dormant: true } : {})
    });
  };

  /**
   * A URL prop resolves to an asset only when this session minted the token in it.
   *
   * Anything else is a gap rather than a resolution. The likeliest such URL is a dead one — a
   * grant token pasted in from an earlier run, whose grant died with that process, so the widget
   * draws nothing. But "likeliest" is not "certain", and the two are indistinguishable from here:
   * a token this session did not mint may still be a live grant another window holds. The gap is
   * scoped to pictures, which is what a URL prop can draw, so a widget nobody has fixed does not
   * put every sound and typeface in the project beyond deleting.
   *
   * A plain `https:` address is neither reference nor gap — it names no library asset at all.
   */
  const pushUrlValue = (
    suffix: string,
    field: string,
    value: unknown,
    dormant?: boolean,
    detail?: string
  ) => {
    const token = parseAssetUrlToken(value);
    if (!token) {
      return;
    }
    const assetId = resolveAssetToken?.(token);
    if (assetId) {
      push(suffix, field, assetId, dormant, detail);
      return;
    }
    gaps.push({
      reason: "hashUrlUnresolved",
      slice: "ui",
      location: `${label}.${field}`,
      affects: ["image"]
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
      /**
       * The literal names `surfaceResourcePreload.ts` keys its preload walk on. Until
       * `nl.video` there was no widget storing a bare asset id under `assetId`, so this walk
       * only knew `imageFill` / `fontAssetId` plus the `nl.image` legacy branch below - which
       * means a new widget naming its prop `assetId` was preloaded by the shipped game and
       * simultaneously invisible to "what uses this asset", the one place an author looks
       * before deleting it. The two walks now agree on the same names.
       *
       * `nl.image`'s bare id is skipped here because the branch below pushes it under this
       * exact reference id, with a dormancy rule this generic arm cannot express.
       */
      if (key === "assetId" || key === "posterAssetId") {
        if (!(key === "assetId" && element.type === "nl.image")) {
          push(childPath, childPath, value);
        }
        continue;
      }
      if (URL_VALUED_PROP_KEYS.has(key)) {
        // The picture a URL prop draws is as much a use of an asset as a picked id is; the
        // only difference is that the URL cannot say so by itself.
        pushUrlValue(childPath, childPath, value);
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
    const hasBackgroundImage =
      typeof props.backgroundImage === "string" && props.backgroundImage.trim().length > 0;
    push("assetId", "assetId", props.assetId, hasAssetInFill || hasBackgroundImage);
  }

  const appearance = props.appearance;
  if (isAppearanceModel(appearance)) {
    for (const variant of appearance.variants as AppearanceVariant[]) {
      const variantDetail = ownerLabel ? `${ownerLabel} › ${variant.name}` : variant.name;
      const fillTypeGroup = variant.propertyGroups.find((group) => group.key === "fillType");
      // A variant that pins fillType to a non-image value makes its own imageFill rows
      // dormant; with no fillType group the variant inherits the element's flat prop.
      const variantDormant = fillTypeGroup
        ? !fillTypeGroup.rows.some((row) => (row as { value?: unknown }).value === "image")
        : isDormantFill(props);

      for (const group of variant.propertyGroups) {
        if (
          group.key !== "imageFill" &&
          group.key !== "fontAssetId" &&
          !URL_VALUED_PROP_KEYS.has(group.key)
        ) {
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
          if (URL_VALUED_PROP_KEYS.has(group.key)) {
            pushUrlValue(suffix, field, value, variantDormant, variantDetail);
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
export function extractUIDocumentAssetReferences(
  document: UIDocument,
  options: { resolveAssetToken?: AssetUrlTokenResolver } = {}
): ReferenceExtraction {
  const references: AssetReference[] = [];
  const gaps: ReferenceIndexGap[] = [];

  /**
   * A Surface's background picture is held by the Surface, not by any element in it, so the two
   * element pools below cannot see it. Left out, the one page-sized image in a project would be
   * the one asset "where is this used?" swore nothing used.
   */
  for (const surface of document.surfaces ?? []) {
    const assetId = surface.settings?.backgroundImage?.assetId;
    if (!isLibraryAssetId(assetId)) {
      continue;
    }
    references.push({
      id: `ui:surface:${surface.id}:backgroundImage`,
      assetId: assetId.trim(),
      kind: "uiElement",
      label: surface.name,
      field: "backgroundImage",
      target: { kind: "uiSurface", surfaceId: surface.id }
    });
  }

  for (const element of Object.values(document.elements)) {
    references.push(
      ...extractElementAssetReferences(element, undefined, options.resolveAssetToken, gaps)
    );
  }
  for (const component of document.components ?? []) {
    for (const element of Object.values(component.elements)) {
      references.push(
        ...extractElementAssetReferences(element, component.name, options.resolveAssetToken, gaps)
      );
    }
  }

  return { references, gaps };
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
      field: "voice.assetId"
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
  /**
   * Every image the appearance uses, with a slot key that stays stable across renames and a
   * human-readable detail. Flattened by the caller because the two appearance kinds address their
   * images differently — a preset character by pose, a layered one by layer and tag — and a
   * reference does not care which.
   */
  appearanceAssets: ReadonlyArray<{
    slot: string;
    detail: string;
    assetId: string | null | undefined;
  }>;
}

/** Character slice: profile thumbnail plus every image the appearance uses. */
export function extractCharacterAssetReferences(
  characters: readonly ReferenceScannableCharacter[]
): AssetReference[] {
  const references: AssetReference[] = [];

  for (const character of characters) {
    if (isLibraryAssetId(character.thumbnailAssetId)) {
      references.push({
        id: `char:${character.id}:thumbnail`,
        assetId: character.thumbnailAssetId.trim(),
        kind: "character",
        label: character.name,
        field: "profile.thumbnail"
      });
    }
    for (const entry of character.appearanceAssets) {
      if (!isLibraryAssetId(entry.assetId)) {
        continue;
      }
      references.push({
        id: `char:${character.id}:${entry.slot}`,
        assetId: entry.assetId.trim(),
        kind: "character",
        label: character.name,
        detail: entry.detail,
        field: "appearance"
      });
    }
  }

  return references;
}
