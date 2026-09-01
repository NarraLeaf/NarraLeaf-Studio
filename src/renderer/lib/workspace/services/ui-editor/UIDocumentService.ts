import {
    UI_DOCUMENT_MIN_SUPPORTED_VERSION,
    UI_DOCUMENT_SCHEMA_VERSION,
    UIDocument,
    UISurface,
    UISurfaceId,
    UISurfaceKind,
    UIHost,
    UISurfaceDesignSize,
    UISurfaceSettings,
    UIStageSlotId,
    UIStageSurfaceMount,
    UIElement,
    UIElementId,
    UIElementValueBindingValueType,
    UIComponentDefinition,
    UIComponentId,
    UISlotDefinition,
    UILayout,
    isUIFlowLayoutParentElement,
    uiElementTypeAcceptsChildren,
    getUIComponentLink,
    isLinkedUIComponentElement,
    type UIComponentParam,
} from "@shared/types/ui-editor/document";
import { foldLegacyImageProps, UI_IMAGE_ELEMENT_TYPE } from "@shared/types/ui-editor/legacyImageProps";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import type { LiveUIOp } from "@shared/live/ops";
import { applyUIParts, diffUIParts, uiPartsUpdates, type LiveUIParts } from "@shared/live/uiParts";
import { RendererError } from "@shared/utils/error";
import { translate } from "@/lib/i18n";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import { roundUILayoutGeometryFields } from "@/lib/ui-editor/layout/roundLayoutGeometry";
import { reportWorkspaceAnomaly } from "@/lib/workspace/recovery/anomalyLog";
import { ProjectNameConvention } from "../../project/nameConvention";
import { Service } from "../Service";
import { IUIDocumentService, Services, WorkspaceContext } from "../services";
import { DEFAULT_AUTOSAVE_DELAY_MS, DEFAULT_AUTOSAVE_MAX_WAIT_MS, DebouncedSaver } from "../autosave/DebouncedSaver";
import { registerAutoSaver } from "../autosave/SaveStatusService";
import { LocalBlueprintService } from "./LocalBlueprintService";
import { UIEditorHistoryService, cloneUIHistoryDocument } from "./UIEditorHistoryService";
import type { TranslationKey } from "@shared/i18n";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope } from "../history/historyScopes";
import { UIDocumentContentRevisions } from "./uiDocumentContentRevisions";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { UuidService } from "../core/UuidService";
import { EventEmitter } from "../ui/EventEmitter";
import {
    applyPlannedMove,
    applyUngroupContainer,
    canUngroupContainer,
    collectSubtreeElementIds,
    filterToTopLevelMovers,
    layoutPatchForReparent,
    normalizeFlowChildLayout,
    normalizeFlowChildLayouts,
    normalizeListSlotsForMovedChildren,
    planMoveElementsInSurface,
    type MoveUiElementsResult,
} from "./uiDocumentTreeMove";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import { isValidUIInsertParent } from "@/lib/ui-editor/tree/resolveInsertTargetParent";
import type { UIEditorClipboardPayload } from "@/lib/ui-editor/commands/uiEditorClipboard";
import {
    cloneWidgetMainBlueprintForPaste,
    cloneWidgetValueBlueprintForPaste,
    remapElementValueBindingBlueprintIds,
} from "./blueprint/cloneBlueprintForPaste";
import { registerPrivateBlueprintAsActive } from "./blueprint/ownerRecords";
import {
    componentWidgetMainOwnerKey,
    ownerRefToIndexKey,
    surfaceMainOwnerKey,
    widgetMainOwnerKey,
    widgetValueOwnerKey,
} from "./blueprint/ownerKeys";
import type {
    Blueprint,
    BlueprintDocument,
    BlueprintGraphIr,
    BlueprintGraphNode,
    BlueprintOwnerRef,
    BlueprintPrivateOwnerRecord,
} from "@shared/types/blueprint/document";
import { migrateBlueprintDocumentToLatest } from "@shared/blueprint/migrateBlueprintDocument";
import { anchorComponentId, anchorElementId } from "@shared/blueprint/ownerShape";
import type { UITemplateSurfacePlacement } from "@shared/types/uiTemplateRegistry";
import { assertValidBlueprintDocument } from "./blueprint/documentValidation";
import {
    BLUEPRINT_GRAPH_IR_META_KIND,
    BLUEPRINT_NODE_PARAM_EVENT_HEAD_KEY_NAME,
    BLUEPRINT_NODE_TYPE_DATA_JSON_GET,
    BLUEPRINT_NODE_TYPE_DATA_NOT_NULL,
    BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_FLOW_IF,
    BLUEPRINT_NODE_TYPE_GAME_CHOOSE,
    BLUEPRINT_NODE_TYPE_GAME_GET_NAMETAG,
    BLUEPRINT_NODE_TYPE_GAME_GET_SPEAKER_AVATAR,
    BLUEPRINT_NODE_TYPE_GAME_NEXT,
    BLUEPRINT_NODE_TYPE_IMAGE_SET_ASSET,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_PROPS,
    BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT,
} from "@shared/types/blueprint/graph";
import {
    DEFAULT_APP_SURFACE_NAME,
    DEFAULT_UI_DOCUMENT_NAME,
    DEFAULT_UI_ROOT_NAME,
    DEFAULT_UI_SURFACE_SIZE,
    MAIN_APP_SURFACE_ID,
} from "@shared/constants/ui-editor";
import { isListLikeWidgetType, type UIListElementExtra } from "@shared/types/ui-editor/list";
import {
    UI_STRUCT_ID_CHOICE_ITEM,
    UI_STRUCT_ID_NOTIFICATION_ITEM,
    UI_STRUCT_ID_NVL_ITEM,
} from "@shared/types/ui-editor/builtinStructs";
import type { UIStructField } from "@shared/types/ui-editor/struct";
import { applyUIStructFieldsForOwner, pruneUIStructs } from "@shared/types/ui-editor/structLibrary";
import {
    dedupeUIInputBindings,
    normalizeUIInputActionLibrary,
    normalizeUIInputBindings,
    normalizeUISurfaceActionEnablements,
    pruneUISurfaceActionEnablements,
    type UIInputActionDef,
    type UIInputBinding,
    type UISurfaceActionEnablement,
} from "@shared/types/ui-editor/inputAction";
import { isWidgetTypeOf } from "@shared/types/ui-editor/widgetInheritance";
import { getUISliderChildSlot, type UISliderElementExtra } from "@shared/types/ui-editor/slider";
import {
    UI_SWITCH_ELEMENT_TYPE,
    getUISwitchChildSlot,
    type UISwitchElementExtra,
} from "@shared/types/ui-editor/switch";
import {
    isDefaultUIPageAnimationSettings,
    normalizeUIPageAnimationSettings,
    type UIPageAnimationSettings,
} from "@shared/types/ui-editor/pageAnimation";
import {
    DEFAULT_UI_STAGE_SLOT_ID,
    normalizeUIStageSlotId,
} from "@shared/types/ui-editor/stageSlots";
import { defaultContainerWidgetProps, type ContainerWidgetProps } from "@shared/types/ui-editor/container";
import { defaultTextWidgetProps, type TextWidgetProps } from "@/lib/ui-editor/widget-modules/builtin/text/types";
import { defaultListWidgetProps, type ListWidgetProps } from "@/lib/ui-editor/widget-modules/builtin/list/types";
import {
    createInitialContainerAppearance,
    createInitialImageAppearanceFromProps,
    createInitialTextAppearance,
    isUsableAppearanceModel,
} from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";

type UIDocumentServiceEvents = {
    documentChanged: UIDocument;
    dirtyChanged: boolean;
};

type CreateSurfaceInput = {
    kind: UISurfaceKind;
    name: string;
    host: UIHost;
    designSize?: UISurfaceDesignSize;
    settings?: UISurfaceSettings;
    stageMount?: UIStageSurfaceMount;
};

type UIDocumentMutationHistoryOptions =
    | {
          surfaceId: string;
          mergeKey?: string;
          mergeWindowMs?: number;
      }
    | false;

type UIDocumentMutationOptions = {
    history?: UIDocumentMutationHistoryOptions;
    /**
     * An effect arriving, rather than a gesture leaving.
     *
     * The one flag that makes the sink stand aside. Without it applying an effect would hand the
     * operation straight back to the sink it came from, and the room would answer itself for ever.
     */
    live?: boolean;
};

/**
 * Somewhere for an interface edit to go instead of into the document.
 *
 * **The seam a live session hangs off, and the reason the interface editor needs no live-session code
 * at all.** It is `StoryOpSink`'s shape and the same bargain - with a sink installed the document is
 * not touched, and the screen changes when the operation comes back as somebody's effect - but it
 * hangs somewhere else, and where is the whole design:
 *
 * The story service asks its sink from **each of eleven mutators**, because each of them is one
 * gesture and can state it. This service has some forty, and they all funnel into one private
 * `mutateDocument(mutator)` whose mutator is an opaque closure. Asking there is the only place that
 * cannot fall behind - and what can be stated there is not the gesture but its result, which
 * `mutateDocument` obtains by running the mutator against a copy and comparing (see
 * `@shared/live/uiParts`). So the vocabulary is a delta of records, and it is **exhaustive over
 * gestures by construction**: the forty that exist and the forty-first that lands next month are all
 * carried, and none of them has to know a session exists.
 *
 * One method, for `StoryOpSink`'s reason: there are exactly two outcomes, and a second method would
 * be a second way to spell one of them.
 *
 * ⚠ **A guest's second gesture on one record inside a single round trip supersedes the first**, and
 * that is a property of every whole-record operation in this vocabulary rather than of this one: a
 * guest's document does not move until the host answers, so both deltas are computed against the same
 * state and the later one carries the earlier one's fields as they were. `update-character`,
 * `update-asset` and `set-translation` all behave this way and always have. What keeps it small here
 * is that each gesture is self-contained - a drag commits once at its end, and the inspector's text
 * fields carry their whole draft on every throttled commit - so the two gestures have to be
 * different KINDS of edit to the same element, made a network round trip apart.
 */
export type UIOpSink = {
    /**
     * Take one operation, or decline it.
     *
     * True means the sink has it and the document must not be touched. False means the sink is not
     * speaking for this document and the mutation carries on as usual.
     */
    handle(op: LiveUIOp): boolean;
};

const COMPONENT_EDITOR_SURFACE_ID_PREFIX = "component-editor:";

function createDefaultPageSurfaceSettings(settings?: UISurfaceSettings): UISurfaceSettings {
    return {
        ...settings,
        pageAnimation: normalizeUIPageAnimationSettings(settings?.pageAnimation),
    };
}

const DEFAULT_STAGE_SLOT_ID: UIStageSlotId = DEFAULT_UI_STAGE_SLOT_ID;
const COMPONENT_LINKED_LAYOUT_KEYS = new Set<keyof UILayout>(["x", "y", "width", "height", "rotation"]);
const DEFAULT_COMPONENT_SIZE: UISurfaceDesignSize = { width: 240, height: 120 };
const DIALOG_SENTENCE_WIDGET_TYPE = "nl.dialog.sentence";
const NOTIFICATION_LIST_WIDGET_TYPE = "nl.notification.list";
const CHOICE_LIST_WIDGET_TYPE = "nl.choice.list";
const NVL_LIST_WIDGET_TYPE = "nl.nvl.list";
const NVL_TEXTS_WIDGET_TYPE = "nl.nvl.texts";

type DialogStageTemplate = {
    elements: Record<UIElementId, UIElement>;
    interactionLayerId: UIElementId;
    panelId: UIElementId;
    avatarId: UIElementId;
    stackId: UIElementId;
    nametagId: UIElementId;
    sentenceId: UIElementId;
};

type NotificationStageTemplate = {
    elements: Record<UIElementId, UIElement>;
    listId: UIElementId;
    itemContainerId: UIElementId;
    itemTextId: UIElementId;
};

type ChoiceStageTemplate = {
    elements: Record<UIElementId, UIElement>;
    listId: UIElementId;
    itemContainerId: UIElementId;
    itemTextId: UIElementId;
};

type NvlStageTemplate = {
    elements: Record<UIElementId, UIElement>;
    interactionLayerId: UIElementId;
    panelId: UIElementId;
    listId: UIElementId;
    nametagId: UIElementId;
    textsId: UIElementId;
};

/** One stage-slot creation template: authored elements plus post-insert blueprint seeding. */
type StageSlotTemplate = {
    elements: Record<UIElementId, UIElement>;
    configure: (surfaceId: UISurfaceId) => void;
};

function getComponentPreviewDesignSize(component: UIComponentDefinition): UISurfaceDesignSize {
    return {
        width: component.previewMeta?.width ?? DEFAULT_COMPONENT_SIZE.width,
        height: component.previewMeta?.height ?? DEFAULT_COMPONENT_SIZE.height,
    };
}

function cloneJson<T>(value: T): T {
    return value == null ? value : JSON.parse(JSON.stringify(value)) as T;
}

function createDuplicateName(baseName: string, existingNames: Set<string>): string {
    const base = translate("defaultDoc.pageCopy", { name: baseName.trim() || translate("defaultDoc.pageName") });
    if (!existingNames.has(base)) {
        return base;
    }
    let i = 2;
    while (existingNames.has(`${base} ${i}`)) {
        i += 1;
    }
    return `${base} ${i}`;
}

/**
 * The name a thing arriving from a template keeps.
 *
 * Deliberately not {@link createDuplicateName}: that one renders "Dialogue Copy",
 * which is the truth about a duplicate and a lie about an import — the author has
 * no "Dialogue" to have copied. So the template's own name stands, and a numeric
 * suffix appears only when it genuinely collides with something already here.
 */
function createImportedName(baseName: string, existingNames: Set<string>): string {
    const base = baseName.trim() || translate("defaultDoc.pageName");
    if (!existingNames.has(base)) {
        return base;
    }
    let i = 2;
    while (existingNames.has(`${base} ${i}`)) {
        i += 1;
    }
    return `${base} ${i}`;
}

function isReferenceKey(key: string, suffix: string): boolean {
    return key === suffix || key.endsWith(suffix[0].toUpperCase() + suffix.slice(1));
}

type SurfaceDuplicateRemapContext = {
    oldSurfaceId: string;
    newSurfaceId: string;
    elementIdMap: Record<string, string>;
    blueprintIdMap: Record<string, string>;
    /** Optional source-assetId -> project-assetId map, set only when importing a
     * template that ships resources; absent (and inert) for in-document duplicate. */
    assetIdMap?: Record<string, string>;
    /** Optional source-componentId -> project-componentId map, set only when importing
     * a template that ships components. A duplicate within one document keeps pointing
     * at the same library entry, so it leaves this absent. */
    componentIdMap?: Record<string, string>;
    /**
     * Optional source-surfaceId -> project-surfaceId map covering *every* surface of a
     * multi-surface template, set only on import.
     *
     * `oldSurfaceId`/`newSurfaceId` above describe the one surface currently being
     * copied, which is all a duplicate needs. An import needs more: an `nl.frame`
     * on one of a template's surfaces points at a *sibling* surface, and that
     * reference is not the surface being copied — so without this it survived
     * untouched and named an id no project holds.
     */
    surfaceIdMap?: Record<string, string>;
};

function remapSurfaceDuplicateReferenceValue<T>(value: T, ctx: SurfaceDuplicateRemapContext, key?: string): T {
    if (typeof value === "string") {
        if (key && isReferenceKey(key, "surfaceId") && value === ctx.oldSurfaceId) {
            return ctx.newSurfaceId as T;
        }
        // A reference to another surface of the same template (nl.frame's
        // targetSurfaceId is the one that matters today).
        if (key && ctx.surfaceIdMap && isReferenceKey(key, "surfaceId") && ctx.surfaceIdMap[value]) {
            return ctx.surfaceIdMap[value] as T;
        }
        if (key && isReferenceKey(key, "elementId") && ctx.elementIdMap[value]) {
            return ctx.elementIdMap[value] as T;
        }
        if (key && isReferenceKey(key, "blueprintId") && ctx.blueprintIdMap[value]) {
            return ctx.blueprintIdMap[value] as T;
        }
        if (key && ctx.assetIdMap && isReferenceKey(key, "assetId") && ctx.assetIdMap[value]) {
            return ctx.assetIdMap[value] as T;
        }
        // Reaches `extra.componentLink.componentId`, which is how an element on an
        // imported surface says "I am an instance of that library component".
        if (key && ctx.componentIdMap && isReferenceKey(key, "componentId") && ctx.componentIdMap[value]) {
            return ctx.componentIdMap[value] as T;
        }
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(item => remapSurfaceDuplicateReferenceValue(item, ctx)) as T;
    }
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [childKey, childValue] of Object.entries(value)) {
            out[childKey] = remapSurfaceDuplicateReferenceValue(childValue, ctx, childKey);
        }
        return out as T;
    }
    return value;
}

function remapDuplicatedBlueprintOwner(owner: BlueprintOwnerRef, ctx: SurfaceDuplicateRemapContext): BlueprintOwnerRef | null {
    if (owner.kind === "surfaceMain" && owner.surfaceId === ctx.oldSurfaceId) {
        return { kind: "surfaceMain", surfaceId: ctx.newSurfaceId };
    }
    if (owner.kind === "widgetMain" && owner.surfaceId === ctx.oldSurfaceId) {
        const newElementId = ctx.elementIdMap[owner.elementId];
        return newElementId ? { kind: "widgetMain", surfaceId: ctx.newSurfaceId, elementId: newElementId } : null;
    }
    if (owner.kind === "widgetValue" && owner.surfaceId === ctx.oldSurfaceId) {
        const newElementId = ctx.elementIdMap[owner.elementId];
        return newElementId
            ? { kind: "widgetValue", surfaceId: ctx.newSurfaceId, elementId: newElementId, propPath: owner.propPath }
            : null;
    }
    return null;
}

function cloneBlueprintForSurfaceDuplicate(
    source: Blueprint,
    newBlueprintId: string,
    ctx: SurfaceDuplicateRemapContext,
): Blueprint | null {
    const owner = remapDuplicatedBlueprintOwner(source.owner, ctx);
    if (!owner) {
        return null;
    }
    const cloned = remapSurfaceDuplicateReferenceValue(cloneJson(source), ctx);
    cloned.id = newBlueprintId;
    cloned.owner = owner;
    return cloned;
}

function createContainerTemplateProps(overrides: Partial<ContainerWidgetProps>): ContainerWidgetProps {
    const props: ContainerWidgetProps = {
        ...cloneJson(defaultContainerWidgetProps),
        ...overrides,
    };
    props.appearance = createInitialContainerAppearance(props);
    return props;
}

function createTextTemplateProps(overrides: Partial<TextWidgetProps>): TextWidgetProps {
    const props: TextWidgetProps = {
        ...cloneJson(defaultTextWidgetProps),
        ...overrides,
    };
    props.appearance = createInitialTextAppearance(props);
    return props;
}

/**
 * `nl.image` has no exported default-props bag, so the widget module's own insert defaults are the
 * single source of truth here; overrides land on top and the appearance model is rebuilt from the
 * merged result (the module's serialized one describes the defaults, not what we just wrote).
 */
function createImageTemplateProps(overrides: Record<string, unknown>): Record<string, unknown> {
    const defaults = widgetModuleRegistry.get("nl.image")?.createDefaultElement().props ?? {};
    const props: Record<string, unknown> = {
        ...cloneJson(defaults),
        ...overrides,
    };
    props.appearance = createInitialImageAppearanceFromProps(props);
    return props;
}

function createListTemplateProps(overrides: Partial<ListWidgetProps>): ListWidgetProps {
    const props: ListWidgetProps = {
        ...cloneJson(defaultListWidgetProps),
        ...overrides,
    };
    if (overrides.scrollbar) {
        props.scrollbar = {
            ...cloneJson(defaultListWidgetProps.scrollbar),
            ...overrides.scrollbar,
        };
    }
    return props;
}

function ensureElementSerializedAppearance(element: UIElement): boolean {
    if (element.type === "nl.container") {
        const props: ContainerWidgetProps = {
            ...cloneJson(defaultContainerWidgetProps),
            ...(element.props ?? {}),
        };
        if (isUsableAppearanceModel(props.appearance)) {
            return false;
        }
        props.appearance = createInitialContainerAppearance(props);
        element.props = props;
        return true;
    }
    if (isWidgetTypeOf(element.type, "nl.text")) {
        const props: TextWidgetProps = {
            ...cloneJson(defaultTextWidgetProps),
            ...(element.props ?? {}),
        };
        if (isUsableAppearanceModel(props.appearance)) {
            return false;
        }
        props.appearance = createInitialTextAppearance(props);
        element.props = props;
        return true;
    }
    return false;
}

function sanitizeComponentName(name: string | undefined, fallback: string): string {
    const trimmed = String(name ?? "").trim();
    return trimmed.length > 0 ? trimmed : fallback;
}

/** Whether a blueprint holds anything an author wrote, as opposed to the empty shell selecting an element creates. */
function blueprintHasAuthoredGraph(blueprint: Blueprint): boolean {
    if (blueprint.program.kind !== "graph") {
        return true;
    }
    const graphs = blueprint.program.graphs;
    const collections = [graphs.events ?? {}, graphs.functions ?? {}];
    return collections.some(collection =>
        Object.values(collection).some(entry => Object.keys(entry?.graph?.nodes ?? {}).length > 0),
    );
}

/**
 * An element as it goes into a component definition.
 *
 * The private blueprints of the elements taken in are cloned alongside (see
 * `carryWidgetBlueprintsIntoComponent`) and re-keyed to the component, because that is what makes
 * the component worth placing: an author who selects a working save slot and asks for a component
 * should get a working save slot, not a picture of one.
 *
 * `valueBindings` does not survive, and that is deliberate rather than an oversight. A value binding
 * inside a component instance is cached without the instance in its key, so every placement would
 * read one entry - twelve slots showing the same line of text, with nothing to suggest why. Dropping
 * the binding leaves a visibly empty field instead, which an author can see and fix. Restore this
 * once the value runtime is keyed per instance.
 */
function stripElementForComponentDefinition(element: UIElement): UIElement {
    const next = cloneJson(element);
    if (next.extra?.componentLink) {
        const { componentLink: _componentLink, ...rest } = next.extra;
        next.extra = Object.keys(rest).length > 0 ? rest : undefined;
    }
    delete next.valueBindings;
    return next;
}

function collectComponentSubtreeElementIds(elements: Record<string, UIElement>, rootElementId: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const walk = (elementId: string) => {
        if (seen.has(elementId)) {
            return;
        }
        const element = elements[elementId];
        if (!element) {
            return;
        }
        seen.add(elementId);
        out.push(elementId);
        element.childrenIds.forEach(walk);
    };
    walk(rootElementId);
    return out;
}

function calculateElementsBounds(elements: UIElement[]): UISurfaceDesignSize & { x: number; y: number } {
    if (elements.length === 0) {
        return { x: 0, y: 0, ...DEFAULT_COMPONENT_SIZE };
    }
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const element of elements) {
        const x0 = Math.min(element.layout.x, element.layout.x + element.layout.width);
        const y0 = Math.min(element.layout.y, element.layout.y + element.layout.height);
        const x1 = Math.max(element.layout.x, element.layout.x + element.layout.width);
        const y1 = Math.max(element.layout.y, element.layout.y + element.layout.height);
        minX = Math.min(minX, x0);
        minY = Math.min(minY, y0);
        maxX = Math.max(maxX, x1);
        maxY = Math.max(maxY, y1);
    }
    return {
        x: Number.isFinite(minX) ? minX : 0,
        y: Number.isFinite(minY) ? minY : 0,
        width: Math.max(1, Number.isFinite(maxX - minX) ? maxX - minX : DEFAULT_COMPONENT_SIZE.width),
        height: Math.max(1, Number.isFinite(maxY - minY) ? maxY - minY : DEFAULT_COMPONENT_SIZE.height),
    };
}

/**
 * Write an element's animation, or take it away.
 *
 * An all-default record is the same as none, and is stored as none: an author who tries a preset and
 * puts it back must leave the document as they found it.
 */
function applyElementAnimation(element: UIElement, animation: UIPageAnimationSettings | null): void {
    if (!animation) {
        delete element.animation;
        return;
    }
    const normalized = normalizeUIPageAnimationSettings(animation);
    if (isDefaultUIPageAnimationSettings(normalized)) {
        delete element.animation;
        return;
    }
    element.animation = normalized;
}

/** What a template import touched: the surfaces added, any library components it
 * brought with them, and any stage slots that were already occupied so their
 * surface was skipped (surfaced to the user). */
export type ImportTemplateResult = {
    importedSurfaces: UISurface[];
    skippedSlots: UIStageSlotId[];
    /** Components copied into the project's library; empty for surface-only templates. */
    importedComponents: UIComponentDefinition[];
};

/**
 * Placement read off the surface being imported instead of declared by the caller.
 *
 * A template states where its screen belongs, because the document it ships is a design and not a
 * page out of anyone's project. A surface copied from another project already is one: it was a Page
 * or a Game UI over there, and a Game UI sat in a named stage slot. Both are carried across rather
 * than asked about again — an author copying their dialog layout is not choosing a slot for it.
 */
export const IMPORT_PLACEMENT_FROM_SOURCE = "sourceSurface" as const;

/** Where an import puts its surfaces: one declared placement, or each surface's own. */
export type ImportTemplatePlacement = UITemplateSurfacePlacement | typeof IMPORT_PLACEMENT_FROM_SOURCE;

/**
 * The placement one surface lands under.
 *
 * A source surface with no mount is a Page, and a Page has nowhere else to be; a stage surface
 * brings its slot. Whether that slot is free is a separate question, answered against the receiving
 * document by {@link UIDocumentService.importTemplateBundle}.
 */
export function resolveImportedSurfacePlacement(
    declared: ImportTemplatePlacement,
    sourceSurface: UISurface,
): UITemplateSurfacePlacement {
    if (declared !== IMPORT_PLACEMENT_FROM_SOURCE) {
        return declared;
    }
    return sourceSurface.kind === "stageSurface"
        ? { kind: "stageSurface", slotId: sourceSurface.mount?.slotId ?? DEFAULT_UI_STAGE_SLOT_ID }
        : { kind: "appSurface" };
}

/** One template's fetched documents plus a resolved placement, ready to import.
 * `assetIdMap` maps the template's original asset ids to the ids they were
 * ingested under in this project; empty/undefined for asset-free templates. */
export type ImportTemplateBundleInput = {
    document: unknown;
    graphs: unknown;
    placement: ImportTemplatePlacement;
    assetIdMap?: Record<string, string>;
};

export class UIDocumentService extends Service<UIDocumentService> implements IUIDocumentService {
    private document: UIDocument | null = null;
    private readonly events = new EventEmitter<UIDocumentServiceEvents>();
    private revision = 0;
    private lastSavedRevision = 0;
    private dirty = false;
    private readonly autoSaver = new DebouncedSaver({
        delayMs: DEFAULT_AUTOSAVE_DELAY_MS,
        maxWaitMs: DEFAULT_AUTOSAVE_MAX_WAIT_MS,
        save: () => this.save(this.getDocument()),
        onError: err => console.warn("[UIDocumentService] auto-save failed", err),
    });
    private afterMutateHook: (() => void) | null = null;
    /** Where edits go instead of into the document, when something else owns them. See {@link UIOpSink}. */
    private opSink: UIOpSink | null = null;
    private historySuppressionDepth = 0;
    private readonly contentRevisions = new UIDocumentContentRevisions();

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        const uuidService = ctx.services.get<UuidService>(Services.Uuid);
        await depend([filesystemService, projectService, uuidService]);
        await registerAutoSaver(ctx, depend, "uiDocument", "workspace.shell.save.stores.uiDocument", this.autoSaver);

        await this.ensureDocumentDir();
        await this.load();
    }

    public getDocument(): UIDocument {
        if (!this.document) {
            throw new RendererError("UI document not initialized");
        }
        return this.document;
    }

    public async load(): Promise<UIDocument> {
        const fs = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const documentPath = this.getDocumentPath();
        const exists = await fs.isFileExists(documentPath);
        if (!exists.ok) {
            throw new RendererError(exists.error?.message || "Failed to access UI document path");
        }

        if (!exists.data) {
            const created = this.createEmptyDocument();
            await this.save(created);
            this.document = created;
            return created;
        }

        const result = await fs.readJSON<UIDocument>(documentPath);
        if (!result.ok) {
            if (result.error.code === FsRejectErrorCode.NOT_FOUND) {
                const created = this.createEmptyDocument();
                await this.save(created);
                this.document = created;
                return created;
            }
            // Fatal - this is on the startup path - and the message alone does not say which of the
            // interface documents it was. Recorded with the path before the code is dropped.
            reportWorkspaceAnomaly({
                source: "interface",
                operationKey: "workspace.recovery.operations.interfaceDocumentRead",
                path: documentPath,
                error: result.error,
                severity: "fatal",
            });
            throw new RendererError(result.error.message);
        }

        const loadedSnapshot = JSON.stringify(result.data);
        const migrated = this.migrateIfNeeded(result.data);
        this.document = migrated;
        const schemaChanged = result.data.schemaVersion !== migrated.schemaVersion;
        const normalizedChanged = loadedSnapshot !== JSON.stringify(migrated);
        const mainSurfaceChanged = this.ensureMainSurface(this.document);
        const flowLayoutsChanged = normalizeFlowChildLayouts(this.document);
        const needsSave = schemaChanged || normalizedChanged || mainSurfaceChanged || flowLayoutsChanged;
        if (needsSave) {
            await this.save(this.document);
            this.contentRevisions.reset();
            this.revision = 0;
            this.lastSavedRevision = 0;
            this.setDirty(false);
            return this.document;
        }
        this.contentRevisions.reset();
        this.revision = 0;
        this.lastSavedRevision = 0;
        this.setDirty(false);
        this.events.emit("documentChanged", this.document);
        return migrated;
    }

    public async save(document: UIDocument): Promise<void> {
        const fs = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        await this.ensureDocumentDir();
        const documentPath = this.getDocumentPath();
        // This write supersedes whatever the timer was going to do.
        this.autoSaver.cancel();
        const updated: UIDocument = {
            ...document,
            meta: {
                ...document.meta,
                updatedAt: new Date().toISOString(),
            },
        };
        const data = JSON.stringify(updated, null, 2);
        const result = await this.writeDocumentFile(fs, documentPath, data);
        if (!result.ok) {
            throw new RendererError(result.error.message);
        }
        this.document = updated;
        this.lastSavedRevision = this.revision;
        this.setDirty(false);
        this.events.emit("documentChanged", this.document);
    }

    /**
     * The one route `uidoc.json` goes out by.
     *
     * **Not `fs.write`.** That verb mints a write grant over IPC and then `PUT`s the payload back
     * through the app protocol; the pair costs about the same whatever the payload weighs, and this
     * document is written on every auto-save while the author drags things around a surface. The
     * direct call is the same atomic temp-fsync-rename core reached in one structured-clone IPC
     * call. `BaseFileSystemService.writeFileNoFollowOrCreate` carries the measurement.
     *
     * The shape this service needs is exactly the one that verb was added for: the file has to be
     * *created* on the first open of a project that has never had an interface document (see
     * {@link load}, which saves a freshly built empty document) and *replaced* on every save after
     * that. `writeFileNoFollow` can only overwrite and `ensureRegularFile` writes nothing when the
     * file is already there.
     *
     * What changes for the author: a `uidoc.json` that is a symlink, a non-regular file or has a
     * hard link is now refused with `INVALID_PATH` instead of being written through. Nothing in
     * Studio creates any of those, and a symlinked or junctioned `editor/ui/` *directory* still
     * works - only the final path component is inspected.
     *
     * What does not change is what this method reads back: a real failure is still `ok: false` with
     * a code, still reported to `SaveStatusService` through `observeWrites`, and still thrown from
     * {@link save}. A refused write still answers `ok` with `refused`; this service, like every
     * document service other than `StoryService`, does not read that flag and clears its dirty state
     * on `ok` alone - unchanged by the swap, and announced to the author on the latch's own channel.
     */
    private writeDocumentFile(fs: FileSystemService, path: string, data: string): Promise<FsRequestResult<void>> {
        return fs.writeFileNoFollowOrCreate(path, data, "utf-8");
    }

    /**
     * Write out anything the auto-save timer still owes, and wait for it.
     *
     * The uniform name across every document service, so the shutdown/hand-off flush can call them
     * all without knowing what each one persists.
     */
    public async flushPendingChanges(): Promise<void> {
        await this.autoSaver.flush();
    }

    public onDocumentChanged(handler: (doc: UIDocument) => void): () => void {
        return this.events.on("documentChanged", handler);
    }

    public onDirtyChanged(handler: (dirty: boolean) => void): () => void {
        return this.events.on("dirtyChanged", handler);
    }

    public setAfterMutateHook(hook: (() => void) | null): void {
        this.afterMutateHook = hook;
    }

    public restoreDocumentFromHistory(
        document: UIDocument,
        options: { skipAfterMutateHook?: boolean } = {},
    ): void {
        const next = cloneUIHistoryDocument(document);
        normalizeFlowChildLayouts(next);
        this.document = next;
        this.revision += 1;
        this.setDirty(true);
        this.scheduleAutoSave();
        this.events.emit("documentChanged", this.document);
        if (!options.skipAfterMutateHook) {
            this.afterMutateHook?.();
        }
    }

    public runSurfaceHistoryTransaction(surfaceId: string, action: () => void): void {
        const historyService = this.getHistoryService();
        if (!historyService) {
            action();
            return;
        }
        const beforeHistory = historyService.captureSnapshot(surfaceId);
        this.historySuppressionDepth += 1;
        try {
            action();
        } finally {
            this.historySuppressionDepth -= 1;
        }
        historyService.record({
            surfaceId,
            before: beforeHistory,
            after: historyService.captureSnapshot(surfaceId),
        });
    }

    public isDirty(): boolean {
        return this.dirty;
    }

    public getRevision(): number {
        return this.revision;
    }

    /**
     * A counter for one surface, bumped only when that surface's own content changed.
     *
     * {@link getRevision} moves on every edit anywhere in the document, so anything keyed on it
     * redraws for edits it does not show. The interface panel keeps a live element tree per surface,
     * which is what makes that difference worth having.
     */
    public getSurfaceContentRevision(surfaceId: string): number {
        return this.contentRevisions.getSurfaceContentRevision(this.getDocument(), this.revision, surfaceId);
    }

    /** The component-library counterpart of {@link getSurfaceContentRevision}. */
    public getComponentContentRevision(componentId: string): number {
        return this.contentRevisions.getComponentContentRevision(this.getDocument(), this.revision, componentId);
    }

    public updateElementLayout(
        elementId: string,
        layoutPatch: Partial<UILayout>,
        options: { skipHistory?: boolean } = {},
    ): void {
        const surfaceId = this.getElementSurfaceId(elementId);
        const patchKeys = Object.keys(layoutPatch).sort();
        this.mutateDocument(document => {
            const element = document.elements[elementId];
            if (!element) {
                return;
            }
            const effectivePatch = isLinkedUIComponentElement(element)
                ? this.filterLinkedComponentLayoutPatch(layoutPatch)
                : layoutPatch;
            if (Object.keys(effectivePatch).length === 0) {
                return;
            }
            element.layout = roundUILayoutGeometryFields({
                ...element.layout,
                ...effectivePatch,
            });
            normalizeFlowChildLayout(document, element);
        }, {
            history: !options.skipHistory && surfaceId
                ? {
                      surfaceId,
                      mergeKey: `layout:${elementId}:${patchKeys.join(",")}`,
                  }
                : false,
        });
    }

    public updateElementLayouts(layoutPatches: Record<string, Partial<UILayout>>): void {
        const elementIds = Object.keys(layoutPatches);
        if (elementIds.length === 0) {
            return;
        }
        const surfaceId = this.getCommonSurfaceIdForElements(elementIds);
        this.mutateDocument(document => {
            elementIds.forEach(elementId => {
                const element = document.elements[elementId];
                if (!element) {
                    return;
                }
                const patch = isLinkedUIComponentElement(element)
                    ? this.filterLinkedComponentLayoutPatch(layoutPatches[elementId])
                    : layoutPatches[elementId];
                if (Object.keys(patch).length === 0) {
                    return;
                }
                element.layout = roundUILayoutGeometryFields({
                    ...element.layout,
                    ...patch,
                });
                normalizeFlowChildLayout(document, element);
            });
        }, {
            history: surfaceId ? { surfaceId } : false,
        });
    }

    public updateElementProps(elementId: string, propsPatch: Record<string, unknown>): void {
        const surfaceId = this.getElementSurfaceId(elementId);
        this.mutateDocument(document => {
            const element = document.elements[elementId];
            if (!element) {
                return;
            }
            if (isLinkedUIComponentElement(element)) {
                return;
            }
            element.props = {
                ...(element.props ?? {}),
                ...propsPatch,
            };
            normalizeFlowChildLayout(document, element);
            if (isUIFlowLayoutParentElement(element)) {
                normalizeFlowChildLayouts(document, element.childrenIds);
            }
        }, {
            history: surfaceId
                ? {
                      surfaceId,
                      mergeKey: `props:${elementId}:${Object.keys(propsPatch).sort().join(",")}`,
                  }
                : false,
        });
    }

    /** A fresh id for something this document will own. */
    public generateId(): string {
        return this.getContext().services.get<UuidService>(Services.Uuid).generate();
    }

    /**
     * Declare the shape of one widget's items.
     *
     * Fields and the pointer to them are written in one transaction, and the library is pruned in
     * the same one: a shape that stops being named by anything has no author-visible existence to
     * preserve, and leaving it behind would let a later widget silently adopt a stale spelling
     * through the reuse rule. Undo restores both halves because both are in the snapshot.
     *
     * Refuses on a linked component instance for the same reason props do: the definition owns the
     * shape, and an instance that could redeclare it would be editing every other instance.
     */
    public setListItemStructFields(elementId: string, fields: readonly UIStructField[]): void {
        const surfaceId = this.getElementSurfaceId(elementId);
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        this.mutateDocument(document => {
            const element = document.elements[elementId];
            if (!element || isLinkedUIComponentElement(element)) {
                return;
            }
            const currentStructId = (element.props as Record<string, unknown> | undefined)?.itemStructId;
            const applied = applyUIStructFieldsForOwner({
                document,
                ownerElementId: elementId,
                currentStructId: typeof currentStructId === "string" ? currentStructId : null,
                fields,
                generateId: () => uuidService.generate(),
            });
            element.props = {
                ...(element.props ?? {}),
                itemStructId: applied.structId,
            };
            document.structs = pruneUIStructs({ ...document, structs: applied.structs });
        }, {
            history: surfaceId ? { surfaceId } : false,
        });
    }

    /** What the gestures of this project mean, keyed by id. */
    public getInputActions(): Record<string, UIInputActionDef> {
        return this.getDocument().actions ?? {};
    }

    /**
     * Add an entry to the project's action vocabulary.
     *
     * Bindings start empty: the project default is what every surface inherits, so guessing one
     * would silently wire a gesture the author never asked for into every interface at once.
     */
    public createInputAction(name: string, bindings?: readonly UIInputBinding[]): UIInputActionDef | null {
        const actionName = name.trim();
        if (!actionName) {
            return null;
        }
        const actionId = this.getContext().services.get<UuidService>(Services.Uuid).generate();
        const action: UIInputActionDef = {
            id: actionId,
            name: actionName,
            // A preset lays these down once and is spent. Nothing records which one it was, so the
            // action is editable from here on exactly as one typed from nothing would be.
            bindings: normalizeUIInputBindings(bindings ?? []),
        };
        this.mutateDocument(document => {
            document.actions = { ...(document.actions ?? {}), [actionId]: action };
        }, { history: false });
        return action;
    }

    /** Rename one vocabulary entry. Surfaces store the id, so nothing they answer moves. */
    public renameInputAction(actionId: string, name: string): void {
        const nextName = name.trim();
        if (!nextName) {
            return;
        }
        this.mutateDocument(document => {
            const action = document.actions?.[actionId];
            if (!action || action.name === nextName) {
                return;
            }
            action.name = nextName;
        }, { history: false });
    }

    /**
     * Replace the bindings a surface gets unless it overrides them.
     *
     * Every surface that took the default is rebound by this, which is the point of the vocabulary
     * being a project-level table; a surface that had said otherwise keeps what it said.
     */
    public setInputActionBindings(actionId: string, bindings: readonly UIInputBinding[]): void {
        this.mutateDocument(document => {
            const action = document.actions?.[actionId];
            if (!action) {
                return;
            }
            action.bindings = normalizeUIInputBindings(bindings);
        }, { history: false });
    }

    /**
     * Drop one vocabulary entry, and every surface's answer to it, in one transaction.
     *
     * Both halves together for the reason `setListItemStructFields` prunes in its own transaction: a
     * surface left answering an action nothing defines is a row with no name and no bindings, and a
     * later action minted onto the same id would inherit those replies without anyone asking for it.
     */
    public deleteInputAction(actionId: string): void {
        this.mutateDocument(document => {
            if (!document.actions?.[actionId]) {
                return;
            }
            const actions = { ...document.actions };
            delete actions[actionId];
            document.actions = actions;
            const remaining = new Set(Object.keys(actions));
            for (const surface of document.surfaces) {
                if (!surface.actions) {
                    continue;
                }
                const kept = pruneUISurfaceActionEnablements(surface.actions, remaining);
                if (kept.length === surface.actions.length) {
                    continue;
                }
                surface.actions = kept;
            }
        }, { history: false });
    }

    /**
     * Whether this surface answers one of the project's actions.
     *
     * Enabling adds a bare enablement: the action's own bindings are what it answers to, and the
     * row an author sees says exactly that. Disabling removes the record rather than flagging it
     * off - a surface that does not answer an action has nothing to store about it.
     */
    public setSurfaceActionEnabled(surfaceId: string, actionId: string, enabled: boolean): void {
        const id = actionId.trim();
        if (!id) {
            return;
        }
        this.updateSurface(surfaceId, surface => {
            const current = surface.actions ?? [];
            if (!enabled) {
                const kept = current.filter(entry => entry.actionId !== id);
                if (kept.length === current.length) {
                    return;
                }
                if (kept.length === 0) {
                    delete surface.actions;
                    return;
                }
                surface.actions = kept;
                return;
            }
            if (current.some(entry => entry.actionId === id)) {
                return;
            }
            surface.actions = [...current, { actionId: id }];
        });
    }

    /**
     * Change one field of one surface's answer.
     *
     * A key **present** in the patch is written even when its value is `undefined`, which is how
     * `overrideBindings` is cleared - an override present but empty means "no gesture here" and is a
     * different statement from having no override at all (see `resolveSurfaceActionBindings`).
     */
    public updateSurfaceActionEnablement(
        surfaceId: string,
        actionId: string,
        patch: Partial<Omit<UISurfaceActionEnablement, "actionId">>,
    ): void {
        this.updateSurface(surfaceId, surface => {
            const enablement = surface.actions?.find(entry => entry.actionId === actionId);
            if (!enablement) {
                return;
            }
            for (const key of Object.keys(patch) as (keyof typeof patch)[]) {
                const value = patch[key];
                if (value === undefined) {
                    delete enablement[key];
                    continue;
                }
                (enablement as Record<string, unknown>)[key] = value;
            }
        }, { mergeKey: `surface:${surfaceId}:action:${actionId}:${Object.keys(patch).sort().join(",")}` });
    }

    /**
     * Bind one prop of one element to a field of the list item it is drawn for. `null` unbinds.
     *
     * Its own entry point rather than a shape passed through `ensureElementBlueprintValueBinding`,
     * because the two bindings cost different things: that one mints a blueprint the author then
     * owns and has to be torn down with `clearElementBlueprintValueBinding`, and this one is a
     * field id. Switching between them therefore goes through the clear, which is why it runs here.
     */
    public setElementListItemFieldBinding(elementId: string, propPath: string, fieldId: string | null): void {
        const surfaceId = this.getElementSurfaceId(elementId);
        if (isLinkedUIComponentElement(this.getDocument().elements[elementId])) {
            return;
        }
        const existing = this.getDocument().elements[elementId]?.valueBindings?.[propPath];
        if (existing?.kind === "blueprintValue") {
            this.clearElementBlueprintValueBinding(elementId, propPath);
        }
        this.mutateDocument(document => {
            const element = document.elements[elementId];
            if (!element) {
                return;
            }
            const id = fieldId?.trim();
            if (!id) {
                if (!element.valueBindings) {
                    return;
                }
                delete element.valueBindings[propPath];
                if (Object.keys(element.valueBindings).length === 0) {
                    delete element.valueBindings;
                }
                return;
            }
            element.valueBindings = {
                ...(element.valueBindings ?? {}),
                [propPath]: { kind: "listItemField", fieldId: id },
            };
        }, {
            history: surfaceId ? { surfaceId } : false,
        });
    }

    public ensureElementBlueprintValueBinding(
        elementId: string,
        propPath: string,
        input: { valueType: UIElementValueBindingValueType; displayName?: string; literalValue?: unknown },
    ): { blueprintId: string } {
        const surfaceId = this.getElementSurfaceId(elementId);
        if (!surfaceId) {
            throw new RendererError(`Element ${elementId} does not belong to a surface`);
        }
        if (isLinkedUIComponentElement(this.getDocument().elements[elementId])) {
            throw new RendererError("Linked component instances cannot edit Blueprint Value bindings");
        }
        const historyService = this.getHistoryService();
        const beforeHistory = historyService ? historyService.captureSnapshot(surfaceId) : null;
        const localBp = this.getContext().services.get<LocalBlueprintService>(Services.LocalBlueprint);
        const blueprintId = localBp.ensureWidgetValueBlueprint({
            surfaceId,
            elementId,
            propPath,
            valueType: input.valueType,
            displayName: input.displayName,
            literalValue: input.literalValue,
        });
        this.mutateDocument(document => {
            const element = document.elements[elementId];
            if (!element) {
                return;
            }
            element.valueBindings = {
                ...(element.valueBindings ?? {}),
                [propPath]: {
                    kind: "blueprintValue",
                    blueprintId,
                    valueType: input.valueType,
                },
            };
        }, { history: false });
        if (historyService && beforeHistory) {
            historyService.record({
                surfaceId,
                before: beforeHistory,
                after: historyService.captureSnapshot(surfaceId),
            });
        }
        return { blueprintId };
    }

    public clearElementBlueprintValueBinding(elementId: string, propPath: string): void {
        const surfaceId = this.getElementSurfaceId(elementId);
        if (!surfaceId) {
            return;
        }
        if (isLinkedUIComponentElement(this.getDocument().elements[elementId])) {
            return;
        }
        const historyService = this.getHistoryService();
        const beforeHistory = historyService ? historyService.captureSnapshot(surfaceId) : null;
        const localBp = this.getContext().services.get<LocalBlueprintService>(Services.LocalBlueprint);
        localBp.removeWidgetValueBlueprint(surfaceId, elementId, propPath);
        this.mutateDocument(document => {
            const element = document.elements[elementId];
            if (!element?.valueBindings) {
                return;
            }
            delete element.valueBindings[propPath];
            if (Object.keys(element.valueBindings).length === 0) {
                delete element.valueBindings;
            }
        }, { history: false });
        if (historyService && beforeHistory) {
            historyService.record({
                surfaceId,
                before: beforeHistory,
                after: historyService.captureSnapshot(surfaceId),
            });
        }
    }

    /**
     * How this element arrives and leaves. `null` clears it.
     *
     * Unlike props and extras this is allowed on a linked component instance: the animation belongs
     * to where the instance was placed, not to the definition, exactly as its position and size do.
     */
    public updateElementAnimation(
        elementId: string,
        animation: UIPageAnimationSettings | null,
        options: { mergeKey?: string } = {},
    ): void {
        const surfaceId = this.getElementSurfaceId(elementId);
        this.mutateDocument(document => {
            const element = document.elements[elementId];
            if (!element) {
                return;
            }
            applyElementAnimation(element, animation);
        }, {
            history: surfaceId
                ? {
                      surfaceId,
                      mergeKey: options.mergeKey ?? `animation:${elementId}`,
                  }
                : false,
        });
    }

    public updateElementExtra(elementId: string, extraPatch: Record<string, unknown>): void {
        const surfaceId = this.getElementSurfaceId(elementId);
        this.mutateDocument(document => {
            const element = document.elements[elementId];
            if (!element) {
                return;
            }
            if (isLinkedUIComponentElement(element)) {
                return;
            }
            element.extra = {
                ...(element.extra ?? {}),
                ...extraPatch,
            };
            normalizeFlowChildLayout(document, element);
        }, {
            history: surfaceId
                ? {
                      surfaceId,
                      mergeKey: `extra:${elementId}:${Object.keys(extraPatch).sort().join(",")}`,
                  }
                : false,
        });
    }

    public reorderChildren(parentId: string, orderedChildIds: string[]): void {
        const surfaceId = this.getElementSurfaceId(parentId);
        this.mutateDocument(document => {
            const parent = document.elements[parentId];
            if (!parent || isLinkedUIComponentElement(parent)) {
                return;
            }
            parent.childrenIds = [...orderedChildIds];
            normalizeFlowChildLayouts(document, orderedChildIds);
        }, {
            history: surfaceId ? { surfaceId } : false,
        });
    }

    public moveElementsInSurface(
        surfaceId: string,
        elementIds: string[],
        targetParentId: string,
        beforeChildId: string | null,
    ): MoveUiElementsResult {
        const document = this.getDocument();
        if (isLinkedUIComponentElement(document.elements[targetParentId])) {
            return { ok: false, reason: "invalid_target" };
        }
        const planned = planMoveElementsInSurface(document, surfaceId, elementIds, targetParentId, beforeChildId);
        if (!planned.ok) {
            return planned;
        }
        this.mutateDocument(doc => {
            applyPlannedMove(doc, planned.plan);
            normalizeListSlotsForMovedChildren(doc, targetParentId, elementIds);
        }, {
            history: { surfaceId },
        });
        return { ok: true };
    }

    /**
     * Dissolve each group: its children take its place among its siblings, then it is removed.
     * Returns the ids that were lifted out, for the caller to select.
     *
     * One mutation, so several groups going at once are one undo step, and so is the pair of edits
     * each dissolve is made of - lifting the children and removing the shell. Every id is
     * re-checked against the live document as the loop runs, because dissolving an outer group
     * reparents an inner one that may be in the same batch.
     */
    public ungroupContainers(surfaceId: string, containerIds: string[]): string[] {
        const document = this.getDocument();
        if (!containerIds.some(id => canUngroupContainer(document, surfaceId, id))) {
            return [];
        }
        const lifted: string[] = [];
        this.mutateDocument(doc => {
            for (const containerId of containerIds) {
                lifted.push(...(applyUngroupContainer(doc, surfaceId, containerId) ?? []));
            }
        }, {
            history: { surfaceId },
        });
        return lifted;
    }

    public renameElement(elementId: string, name: string): void {
        const trimmed = name.trim();
        if (!trimmed) {
            return;
        }
        const surfaceId = this.getElementSurfaceId(elementId);
        this.mutateDocument(document => {
            const el = document.elements[elementId];
            if (!el || el.type === "nl.root" || isLinkedUIComponentElement(el)) {
                return;
            }
            el.name = trimmed;
        }, {
            history: surfaceId ? { surfaceId } : false,
        });
    }

    public deleteElements(elementIds: string[]): void {
        if (elementIds.length === 0) {
            return;
        }
        const surfaceId = this.getCommonSurfaceIdForElements(elementIds);
        this.mutateDocument(document => {
            const rootIds = new Set(document.surfaces.map(surface => surface.rootElementId));
            const toRemove = new Set<string>();

            const collect = (elementId: string) => {
                if (toRemove.has(elementId) || rootIds.has(elementId)) {
                    return;
                }
                const element = document.elements[elementId];
                if (!element) {
                    return;
                }
                toRemove.add(elementId);
                element.childrenIds.forEach(childId => collect(childId));
            };

            elementIds.forEach(id => collect(id));

            if (toRemove.size === 0) {
                return;
            }

            for (const element of Object.values(document.elements)) {
                if (element.childrenIds.length > 0) {
                    element.childrenIds = element.childrenIds.filter(childId => !toRemove.has(childId));
                }
            }

            for (const id of toRemove) {
                delete document.elements[id];
            }
        }, {
            history: surfaceId ? { surfaceId } : false,
        });
    }

    /**
     * Send interface edits somewhere else, or take them back. Null restores the ordinary behaviour.
     *
     * See {@link UIOpSink} for why it hangs on the private mutator rather than on the public ones.
     */
    public setOperationSink(sink: UIOpSink | null): void {
        this.opSink = sink;
    }

    /**
     * Apply one operation to the document, **without consulting the sink**.
     *
     * The other side of the seam: what a live session calls when an effect arrives and the screen is
     * finally allowed to change. It goes through the same `mutateDocument` every gesture does - which
     * is not a detail, because the dirty marking, the auto-save, `documentChanged` and the blueprint
     * reconciliation all hang off it, and a document that changed without them is one the editor
     * never redraws and the disk never receives.
     *
     * **Nothing recorded here enters this author's undo stack.** An effect is somebody else's edit
     * landing on this machine, and an undo stack that offered to take it back would be offering to
     * delete a stranger's work. Inside a session, undo is sending the inverse of one's own last
     * operation instead; see the live layer's `inverseOf`.
     *
     * ⚠ **The records are copied on the way in.** They arrived inside a message the sender may still
     * be holding - the host keeps every effect it broadcast - and applying writes them into the
     * document, which then edits them in place.
     */
    public applyLiveOp(op: LiveUIOp): void {
        switch (op.op) {
            case "write-ui":
                this.applyParts(op.parts);
                return;
            default: {
                // The switch is exhaustive over the vocabulary and this is what says so. The
                // callback returns void, so a verb nobody applied here would be a silent no-op: the
                // effect lands everywhere else in the room and does nothing on this machine, which
                // is the divergence the digest catches one message too late.
                const unapplied: never = op.op;
                throw new RendererError(`No applier for live interface operation: ${String(unapplied)}`);
            }
        }
    }

    private applyParts(parts: LiveUIParts): void {
        const copy = JSON.parse(JSON.stringify(parts)) as LiveUIParts;
        this.mutateDocument(document => applyUIParts(document, copy), { live: true });
    }

    private mutateDocument(mutator: (document: UIDocument) => void, options: UIDocumentMutationOptions = {}): void {
        if (this.opSink && !options.live) {
            // Run the gesture against a copy and state what it did to the document, rather than
            // doing it. Nothing here reads the gesture: the comparison *is* the statement, which is
            // what makes a verb impossible to forget. See {@link UIOpSink}.
            const current = this.getDocument();
            const draft = cloneUIHistoryDocument(current);
            mutator(draft);
            const parts = diffUIParts(current, draft);
            if (parts === null) {
                // A mutation that changed nothing must not become a message: several of this
                // service's methods are no-ops against the wrong element, and a room full of empty
                // operations would cost a broadcast, a sequence number and an undo step each.
                return;
            }
            // ⚠ Which of the records were already here travels with the delta. Nothing in a delta's
            // shape distinguishes a new element from one somebody deleted while it was being
            // dragged, and applied blind the second of those puts a deleted element back on every
            // screen in the room with every machine agreeing about it.
            const updates = uiPartsUpdates(current, parts);
            if (this.opSink.handle({ op: "write-ui", parts, ...(updates.length === 0 ? {} : { updates }) })) {
                return;
            }
        }
        const historyService = this.getHistoryService();
        const historyOptions = options.history;
        const beforeHistory =
            historyService && historyOptions && this.historySuppressionDepth === 0
                ? historyService.captureSnapshot(historyOptions.surfaceId)
                : null;
        const document = this.getDocument();
        mutator(document);
        this.revision += 1;
        this.setDirty(true);
        this.scheduleAutoSave();
        this.events.emit("documentChanged", document);
        this.afterMutateHook?.();
        if (historyService && historyOptions && beforeHistory && this.historySuppressionDepth === 0) {
            historyService.record({
                surfaceId: historyOptions.surfaceId,
                before: beforeHistory,
                after: historyService.captureSnapshot(historyOptions.surfaceId),
                mergeKey: historyOptions.mergeKey,
                mergeWindowMs: historyOptions.mergeWindowMs,
            });
        }
    }

    private scheduleAutoSave(): void {
        this.autoSaver.schedule();
    }

    private setDirty(value: boolean): void {
        if (this.dirty === value) {
            return;
        }
        this.dirty = value;
        this.events.emit("dirtyChanged", value);
    }

    private getHistoryService(): UIEditorHistoryService | null {
        try {
            return this.getContext().services.get<UIEditorHistoryService>(Services.UIEditorHistory);
        } catch {
            return null;
        }
    }

    private getElementSurfaceId(elementId: string): string | null {
        const document = this.getDocument();
        let currentId: string | null = elementId;
        while (currentId) {
            const element: UIElement | undefined = document.elements[currentId];
            if (!element) {
                return null;
            }
            if (element.parentId === null) {
                return document.surfaces.find(surface => surface.rootElementId === currentId)?.id ?? null;
            }
            currentId = element.parentId;
        }
        return null;
    }

    private getCommonSurfaceIdForElements(elementIds: string[]): string | null {
        let surfaceId: string | null = null;
        for (const elementId of elementIds) {
            const nextSurfaceId = this.getElementSurfaceId(elementId);
            if (!nextSurfaceId) {
                continue;
            }
            if (!surfaceId) {
                surfaceId = nextSurfaceId;
                continue;
            }
            if (surfaceId !== nextSurfaceId) {
                return null;
            }
        }
        return surfaceId;
    }

    private filterLinkedComponentLayoutPatch(layoutPatch: Partial<UILayout>): Partial<UILayout> {
        const out: Partial<UILayout> = {};
        for (const [key, value] of Object.entries(layoutPatch) as Array<[keyof UILayout, UILayout[keyof UILayout]]>) {
            if (COMPONENT_LINKED_LAYOUT_KEYS.has(key)) {
                (out as Record<string, unknown>)[key] = value;
            }
        }
        return out;
    }

    private migrateIfNeeded(document: UIDocument): UIDocument {
        return this.normalizeLegacyImageProps(this.normalizeInputModel(this.migrateSchemaVersion(document)));
    }

    /**
     * Every `nl.image` written in the shape that came before `imageFill`, rewritten into it.
     *
     * A normalizer rather than a numbered migration, for the reason `normalizeInputModel` gives: it
     * reconstructs nothing a reader could not have derived, so a document that has been through it
     * is not a different schema. What makes it worth running at all is that it *converges* - the
     * load path saves when normalizing changed anything, so an old element is rewritten once and
     * the translation stops having to live at render time.
     *
     * Component definitions are walked as well as surfaces. A component's elements are the same
     * elements with a different owner, and one authored before the current shape would otherwise
     * keep the old keys wherever it was placed.
     */
    private normalizeLegacyImageProps(document: UIDocument): UIDocument {
        const pools = [document.elements, ...(document.components ?? []).map(component => component.elements)];
        for (const pool of pools) {
            for (const element of Object.values(pool ?? {})) {
                if (element.type !== UI_IMAGE_ELEMENT_TYPE) {
                    continue;
                }
                const folded = foldLegacyImageProps(element.props);
                if (folded) {
                    element.props = folded;
                }
            }
        }
        return document;
    }

    /**
     * The input vocabulary and every surface's reply to it, read the way this build understands them.
     *
     * Runs on every load rather than in one numbered migration, and carries **no** schema bump. The
     * precedent is the struct library: fields whose absence already means a defined default are read
     * through a normalizer instead of being backfilled once, so a document written by an older
     * Studio loads with an empty vocabulary, `capture`, and no enablements without ever having
     * claimed to be a newer schema. The numbered migrations here are the other kind - each one
     * restructures elements a normalizer could not reconstruct.
     *
     * `input` and `actions` are written back only when the surface carries them, so a project that
     * has never opened the input panel keeps its surface records exactly as short as they were and
     * the load path's "did normalizing change anything" check stays quiet.
     */
    private normalizeInputModel(document: UIDocument): UIDocument {
        const actions = normalizeUIInputActionLibrary(document.actions);
        if (Object.keys(actions).length > 0) {
            document.actions = actions;
        } else {
            delete document.actions;
        }
        for (const surface of document.surfaces) {
            // Surfaces no longer carry an input mode. Documents written before v12 do, and the field
            // is dropped here as well as in the migration so that one pasted in from an older
            // project does not carry a setting nothing reads.
            delete (surface as { input?: unknown }).input;
            if (surface.actions !== undefined) {
                surface.actions = normalizeUISurfaceActionEnablements(surface.actions);
            }
        }
        return document;
    }

    /**
     * Whatever was on disk, at the current version - or a refusal.
     *
     * The ladder that used to run from v1 is gone. Every step it held was a no-op past v1: the bumps
     * from v2 to v10 each recorded that an older Studio must refuse a newer document, and none of
     * them converted anything, so the "migration" was the version stamp plus the normalize pass that
     * runs on a current document anyway. v1 was the one real step, and the surfaces it converted -
     * `playerStageSurface` / `playerOverlaySurface`, before a stage surface named the slot it mounts
     * into - have not been written by any build for months.
     *
     * So there is a floor and no rungs. v10 is read because it differs from v11 by nothing a reader
     * has to reconstruct; below that a document is refused rather than opened as though the missing
     * shapes were merely absent.
     */
    private migrateSchemaVersion(document: UIDocument): UIDocument {
        if (document.schemaVersion > UI_DOCUMENT_SCHEMA_VERSION) {
            throw new RendererError("UI document schema is newer than this Studio version");
        }
        if (document.schemaVersion < UI_DOCUMENT_MIN_SUPPORTED_VERSION) {
            throw new RendererError(
                `UI document schema v${document.schemaVersion} is older than this Studio version can read`
                + ` (v${UI_DOCUMENT_MIN_SUPPORTED_VERSION} is the oldest supported)`,
            );
        }
        const from = document.schemaVersion;
        const carried = from < 12 ? this.migrateSurfaceBindingOverrides(document) : document;
        return this.normalizeSpecialChildSlots({
            ...this.ensureComponentLibrary(carried),
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        });
    }

    /**
     * v12: a surface that changed an action's bindings gets an action of its own.
     *
     * Until v12 a surface could add bindings to an action or replace them outright, so the gestures
     * an action answered to were spread across every surface that answered it. The record is gone,
     * and dropping it through the normalizer would take the gestures with it - a Log page that
     * closed on a scroll would quietly close on nothing. So the override is read one last time here
     * and turned into what it was always describing: a separate action, with the bindings that
     * surface actually used, named after the one it came from.
     *
     * Surfaces that overrode the same action the same way share the action this mints, because they
     * were one statement written twice. A surface whose override worked out to the project's own
     * bindings is left pointing at the original - there was nothing to carry.
     */
    private migrateSurfaceBindingOverrides(document: UIDocument): UIDocument {
        type LegacyEnablement = UISurfaceActionEnablement & {
            addBindings?: unknown;
            overrideBindings?: unknown;
        };

        const vocabulary = normalizeUIInputActionLibrary(document.actions);
        if (Object.keys(vocabulary).length === 0) {
            return document;
        }
        const minted = new Map<string, string>();
        let changed = false;

        const takenIds = new Set(Object.keys(vocabulary));
        const mintId = (base: string): string => {
            let candidate = base;
            let n = 2;
            while (takenIds.has(candidate)) {
                candidate = `${base}-${n}`;
                n += 1;
            }
            takenIds.add(candidate);
            return candidate;
        };

        for (const surface of document.surfaces ?? []) {
            const enablements = surface.actions as LegacyEnablement[] | undefined;
            if (!enablements?.length) {
                continue;
            }
            for (const enablement of enablements) {
                const def = vocabulary[enablement.actionId];
                if (!def) {
                    continue;
                }
                const override = enablement.overrideBindings !== undefined
                    ? normalizeUIInputBindings(enablement.overrideBindings)
                    : dedupeUIInputBindings([
                        ...def.bindings,
                        ...normalizeUIInputBindings(enablement.addBindings),
                    ]);
                if (enablement.overrideBindings === undefined && enablement.addBindings === undefined) {
                    continue;
                }
                const signature = `${enablement.actionId}:${JSON.stringify(override)}`;
                if (signature === `${enablement.actionId}:${JSON.stringify(def.bindings)}`) {
                    continue;
                }
                let mintedId = minted.get(signature);
                if (!mintedId) {
                    mintedId = mintId(`${def.id}-${surface.id}`);
                    minted.set(signature, mintedId);
                    vocabulary[mintedId] = {
                        id: mintedId,
                        name: `${def.name} (${surface.name})`,
                        bindings: override,
                    };
                }
                enablement.actionId = mintedId;
                changed = true;
            }
        }

        if (!changed) {
            return document;
        }
        return { ...document, actions: vocabulary };
    }

    private withComponentLibrary(document: UIDocument): UIDocument {
        return {
            ...document,
            components: Array.isArray((document as UIDocument & { components?: unknown }).components)
                ? (document as UIDocument & { components: UIComponentDefinition[] }).components
                : [],
        };
    }

    private ensureComponentLibrary(document: UIDocument): UIDocument {
        return this.withComponentLibrary(document);
    }

    private normalizeSpecialChildSlots(document: UIDocument): UIDocument {
        document = this.withComponentLibrary(document);
        for (const surface of document.surfaces) {
            if (surface.kind !== "stageSurface") {
                continue;
            }
            const rawMount = (surface as UISurface & { mount?: unknown }).mount;
            const rawMountRecord = rawMount && typeof rawMount === "object"
                ? rawMount as Record<string, unknown>
                : {};
            surface.mount = {
                kind: "slot",
                slotId: normalizeUIStageSlotId(rawMountRecord.slotId),
            };
            surface.settings = {
                backgroundColor: "transparent",
                ...(surface.settings ?? {}),
            };
        }
        for (const element of Object.values(document.elements)) {
            ensureElementSerializedAppearance(element);
            if (isListLikeWidgetType(element.type)) {
                const props = (element.props ?? {}) as Record<string, unknown>;
                const scrollbar = props.scrollbar && typeof props.scrollbar === "object"
                    ? props.scrollbar as Record<string, unknown>
                    : {};
                const trackElementId = typeof scrollbar.trackElementId === "string" ? scrollbar.trackElementId : null;
                const thumbElementId = typeof scrollbar.thumbElementId === "string" ? scrollbar.thumbElementId : null;
                for (const childId of element.childrenIds) {
                    const child = document.elements[childId];
                    if (!child) {
                        continue;
                    }
                    const slot = child.extra?.listSlot;
                    if (slot === "itemTemplate" || slot === "scrollbarTrack" || slot === "scrollbarThumb") {
                        continue;
                    }
                    child.extra = {
                        ...(child.extra ?? {}),
                        listSlot:
                            childId === trackElementId
                                ? "scrollbarTrack"
                                : childId === thumbElementId
                                  ? "scrollbarThumb"
                                  : "itemTemplate",
                    };
                }
                continue;
            }
            if (element.type === "nl.slider") {
                const props = (element.props ?? {}) as Record<string, unknown>;
                const trackElementId = typeof props.trackElementId === "string" ? props.trackElementId : null;
                const handleElementId = typeof props.handleElementId === "string" ? props.handleElementId : null;
                for (const childId of element.childrenIds) {
                    const child = document.elements[childId];
                    if (!child || getUISliderChildSlot(child.extra) != null) {
                        continue;
                    }
                    const sliderSlot =
                        childId === handleElementId
                            ? "handle"
                            : childId === trackElementId
                              ? "track"
                              : null;
                    if (!sliderSlot) {
                        continue;
                    }
                    child.extra = {
                        ...(child.extra ?? {}),
                        sliderSlot,
                    };
                }
            }
            if (element.type === UI_SWITCH_ELEMENT_TYPE) {
                const props = (element.props ?? {}) as Record<string, unknown>;
                const trackElementId = typeof props.trackElementId === "string" ? props.trackElementId : null;
                const thumbElementId = typeof props.thumbElementId === "string" ? props.thumbElementId : null;
                for (const childId of element.childrenIds) {
                    const child = document.elements[childId];
                    if (!child || getUISwitchChildSlot(child.extra) != null) {
                        continue;
                    }
                    const switchSlot =
                        childId === thumbElementId
                            ? "thumb"
                            : childId === trackElementId
                              ? "track"
                              : null;
                    if (!switchSlot) {
                        continue;
                    }
                    child.extra = {
                        ...(child.extra ?? {}),
                        switchSlot,
                    };
                }
            }
        }
        return document;
    }

    private createEmptyDocument(): UIDocument {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const designSize = this.getProjectDesignSize();
        const now = new Date().toISOString();
        const documentId = uuidService.generate();
        const rootElementId = uuidService.generate();

        const rootElement = this.createRootElement(rootElementId, designSize);

        const surface: UISurface = {
            id: MAIN_APP_SURFACE_ID,
            name: DEFAULT_APP_SURFACE_NAME,
            host: "app",
            kind: "appSurface",
            designSize: {
                width: designSize.width,
                height: designSize.height,
            },
            rootElementId,
            settings: createDefaultPageSurfaceSettings(),
        };

        const doc: UIDocument = {
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            id: documentId,
            name: DEFAULT_UI_DOCUMENT_NAME,
            surfaces: [surface],
            components: [],
            elements: {
                [rootElementId]: rootElement,
            },
            meta: {
                createdAt: now,
                updatedAt: now,
            },
        };
        this.contentRevisions.reset();
        this.revision = 0;
        this.lastSavedRevision = 0;
        this.setDirty(false);
        this.events.emit("documentChanged", doc);
        return doc;
    }

    public createSurface(input: CreateSurfaceInput): UISurface {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const designSize = input.designSize ?? this.getProjectDesignSize();
        const rootElementId = uuidService.generate();
        const surfaceId = uuidService.generate();

        const { kind, name, host, settings, stageMount } = input;
        const effectiveMount =
            kind === "stageSurface"
                ? {
                      kind: "slot" as const,
                      slotId: normalizeUIStageSlotId(stageMount?.slotId),
                  }
                : undefined;

        if (kind === "stageSurface" && host !== "player") {
            throw new RendererError("Game UI must be hosted by player");
        }
        if (kind === "appSurface" && host !== "app") {
            throw new RendererError("Pages must be hosted by app");
        }
        if (kind === "stageSurface") {
            const existing = this.getDocument().surfaces.find(surface =>
                surface.kind === "stageSurface" && surface.mount.slotId === effectiveMount?.slotId
            );
            if (existing) {
                return existing;
            }
        }

        const surface: UISurface =
            kind === "stageSurface"
                ? {
                      id: surfaceId,
                      name,
                      host: "player",
                      kind,
                      designSize,
                      rootElementId,
                      settings: {
                          backgroundColor: "transparent",
                          ...(settings ?? {}),
                      },
                      mount: effectiveMount ?? { kind: "slot", slotId: DEFAULT_STAGE_SLOT_ID },
                  }
                : {
                      id: surfaceId,
                      name,
                      host: "app",
                      kind,
                      designSize,
                      rootElementId,
                      settings: createDefaultPageSurfaceSettings(settings),
                  };

        const rootElement = this.createRootElement(rootElementId, designSize);
        const stageTemplate =
            kind === "stageSurface" && effectiveMount
                ? this.createStageSlotTemplate(effectiveMount.slotId, rootElement, designSize)
                : null;
        const templateElements = stageTemplate?.elements ?? {};

        this.mutateDocument(document => {
            document.elements[rootElementId] = rootElement;
            Object.assign(document.elements, templateElements);
            document.surfaces.push(surface);
        });
        stageTemplate?.configure(surface.id);

        return surface;
    }

    public deleteSurface(surfaceId: string): void {
        if (surfaceId === MAIN_APP_SURFACE_ID) {
            return;
        }
        this.mutateDocument(document => {
            const index = document.surfaces.findIndex(surface => surface.id === surfaceId);
            if (index === -1) {
                return;
            }
            const surface = document.surfaces[index];
            document.surfaces.splice(index, 1);

            const toRemove = new Set<string>();
            const collect = (elementId: string) => {
                if (toRemove.has(elementId)) {
                    return;
                }
                const element = document.elements[elementId];
                if (!element) {
                    return;
                }
                toRemove.add(elementId);
                element.childrenIds.forEach(childId => collect(childId));
            };
            collect(surface.rootElementId);

            for (const element of Object.values(document.elements)) {
                if (element.childrenIds.length > 0) {
                    element.childrenIds = element.childrenIds.filter(childId => !toRemove.has(childId));
                }
            }

            for (const id of toRemove) {
                delete document.elements[id];
            }
        });
    }

    /**
     * Put the surfaces in the order given.
     *
     * The order is the document's own - `document.surfaces` is an array and every list of pages is
     * drawn from it - so this takes the whole order rather than a hop from one position to another.
     * The panel that drives it draws one kind at a time and has to say where the other kind's cards
     * stayed; a "move this before that" call could not express that without this method guessing.
     *
     * Surfaces the order does not name keep their places at the end rather than being dropped: an
     * order written against a document that has since gained a page is a stale statement about
     * position, never a request to delete the page it says nothing about.
     *
     * The undo step goes on the **project** stack rather than into the interface editor's own
     * history, which is per surface: this is not an edit to any one surface, and it is made from the
     * panel rather than from an editor - which is the stack Ctrl+Z reaches from there
     * (`resolveWorkspaceUndoScope`). Two id lists is the whole entry.
     *
     * `movedSurfaceId` only names the step for the Edit menu. Leaving it out costs the name, never
     * the entry.
     */
    public reorderSurfaces(orderedSurfaceIds: readonly string[], movedSurfaceId?: string): void {
        const before = this.getDocument().surfaces.map(surface => surface.id);
        const name = movedSurfaceId
            ? this.getDocument().surfaces.find(surface => surface.id === movedSurfaceId)?.name ?? ""
            : "";
        this.applySurfaceOrder(orderedSurfaceIds);
        const after = this.getDocument().surfaces.map(surface => surface.id);
        // Nothing moved, or an operation sink took the gesture and this copy of the document has not
        // moved yet - either way there is no step for this machine to take back.
        if (before.length === after.length && before.every((id, index) => id === after[index])) {
            return;
        }
        this.getContext().services.get<HistoryService>(Services.History).pushCommand(projectHistoryScope(), {
            label: { key: "uiEditor.history.moveSurface" as TranslationKey, params: { name } },
            undo: () => this.applySurfaceOrder(before),
            redo: () => this.applySurfaceOrder(after),
        });
    }

    private applySurfaceOrder(orderedSurfaceIds: readonly string[]): void {
        this.mutateDocument(document => {
            const remaining = new Map(document.surfaces.map(surface => [surface.id, surface]));
            const ordered: UISurface[] = [];
            for (const id of orderedSurfaceIds) {
                const surface = remaining.get(id);
                if (surface) {
                    ordered.push(surface);
                    remaining.delete(id);
                }
            }
            document.surfaces = [...ordered, ...remaining.values()];
        });
    }

    public renameSurface(surfaceId: string, name: string): void {
        const nextName = name.trim();
        if (!nextName) {
            return;
        }
        const currentSurface = this.getDocument().surfaces.find(surface => surface.id === surfaceId);
        if (!currentSurface || currentSurface.name === nextName) {
            return;
        }
        this.mutateDocument(document => {
            const surface = document.surfaces.find(next => next.id === surfaceId);
            if (!surface) {
                return;
            }
            surface.name = nextName;
        }, {
            // Typed a character at a time, so one entry per name rather than per keystroke.
            history: { surfaceId, mergeKey: `surface:${surfaceId}:name` },
        });
    }

    /**
     * Edit a surface's own record - its name, its background, its page animation, its slot.
     *
     * Recorded in the surface's undo stack like every other edit to that surface. It was not, for as
     * long as this method existed: `mutateDocument` records only when a caller says which surface the
     * edit belongs to, and this one never did - so changing a page's background colour was the one
     * kind of edit in the interface editor that Ctrl+Z could not take back.
     *
     * `mergeKey` is the caller's, because only the caller knows which field its updater touched.
     * Leaving it out is safe - it costs granularity (one entry per change instead of one per field
     * the author was working on), never the entry itself.
     */
    public updateSurface(
        surfaceId: string,
        updater: (surface: UISurface) => void,
        options: { mergeKey?: string } = {},
    ): void {
        this.mutateDocument(document => {
            const surface = document.surfaces.find(next => next.id === surfaceId);
            if (!surface) {
                return;
            }
            const isMainSurface = surface.id === MAIN_APP_SURFACE_ID;
            updater(surface);
            if (isMainSurface) {
                surface.id = MAIN_APP_SURFACE_ID;
            }
        }, {
            history: { surfaceId, mergeKey: options.mergeKey },
        });
    }

    public duplicateSurface(surfaceId: string, name?: string): UISurface | null {
        const sourceDocument = this.getDocument();
        const sourceSurface = sourceDocument.surfaces.find(next => next.id === surfaceId);
        if (!sourceSurface || sourceSurface.kind !== "appSurface") {
            return null;
        }
        const sourceRootId = sourceSurface.rootElementId;
        if (!sourceDocument.elements[sourceRootId]) {
            return null;
        }

        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const newSurfaceId = uuidService.generate();
        const sourceElementIds = Array.from(collectSubtreeElementIds(sourceDocument, sourceRootId))
            .filter(elementId => Boolean(sourceDocument.elements[elementId]));
        const elementIdMap: Record<string, string> = {};
        for (const elementId of sourceElementIds) {
            elementIdMap[elementId] = uuidService.generate();
        }
        const newRootElementId = elementIdMap[sourceRootId];
        if (!newRootElementId) {
            return null;
        }

        let localBp: LocalBlueprintService | null = null;
        try {
            localBp = this.getContext().services.get<LocalBlueprintService>(Services.LocalBlueprint);
        } catch {
            localBp = null;
        }

        const blueprintIdMap: Record<string, string> = {};
        const ownerRecordsToClone: Record<string, BlueprintPrivateOwnerRecord> = {};
        const sourceBlueprintDocument = localBp?.getBlueprintDocument();
        if (sourceBlueprintDocument) {
            for (const [ownerKey, ownerRecord] of Object.entries(sourceBlueprintDocument.ownerRecords)) {
                const firstBlueprint = ownerRecord.privateBlueprintIds
                    .map(blueprintId => sourceBlueprintDocument.blueprints[blueprintId])
                    .find((blueprint): blueprint is Blueprint => Boolean(blueprint));
                const owner = firstBlueprint?.owner;
                if (!owner || !remapDuplicatedBlueprintOwner(owner, {
                    oldSurfaceId: sourceSurface.id,
                    newSurfaceId,
                    elementIdMap,
                    blueprintIdMap: {},
                })) {
                    continue;
                }
                ownerRecordsToClone[ownerKey] = cloneJson(ownerRecord);
                for (const blueprintId of ownerRecord.privateBlueprintIds) {
                    if (sourceBlueprintDocument.blueprints[blueprintId] && !blueprintIdMap[blueprintId]) {
                        blueprintIdMap[blueprintId] = uuidService.generate();
                    }
                }
            }
        }

        const remapContext: SurfaceDuplicateRemapContext = {
            oldSurfaceId: sourceSurface.id,
            newSurfaceId,
            elementIdMap,
            blueprintIdMap,
        };
        const existingNames = new Set(sourceDocument.surfaces.map(surface => surface.name));
        const nextName = name?.trim() || createDuplicateName(sourceSurface.name, existingNames);
        const duplicatedSurface: UISurface = {
            ...cloneJson(sourceSurface),
            id: newSurfaceId,
            name: nextName,
            rootElementId: newRootElementId,
            settings: sourceSurface.settings
                ? remapSurfaceDuplicateReferenceValue(cloneJson(sourceSurface.settings), remapContext)
                : undefined,
        };

        localBp?.applyBlueprintMutation(bpDoc => {
            for (const sourceOwnerRecord of Object.values(ownerRecordsToClone)) {
                const clonedBlueprintIds = sourceOwnerRecord.privateBlueprintIds
                    .map(oldBlueprintId => blueprintIdMap[oldBlueprintId])
                    .filter((blueprintId): blueprintId is string => Boolean(blueprintId));
                const activeBlueprintId = blueprintIdMap[sourceOwnerRecord.activeBlueprintId];
                if (!activeBlueprintId || clonedBlueprintIds.length === 0) {
                    continue;
                }
                const firstSourceBlueprint = sourceOwnerRecord.privateBlueprintIds
                    .map(oldBlueprintId => sourceBlueprintDocument?.blueprints[oldBlueprintId])
                    .find((blueprint): blueprint is Blueprint => Boolean(blueprint));
                const newOwner = firstSourceBlueprint ? remapDuplicatedBlueprintOwner(firstSourceBlueprint.owner, remapContext) : null;
                if (!newOwner) {
                    continue;
                }
                // The encoder, not a chain that reproduces it. Two of these had grown here, both
                // handling exactly the three kinds `remapDuplicatedBlueprintOwner` can return - so
                // the trailing branch was unreachable, and the format was written out in a third
                // and fourth place that could drift from it.
                const newOwnerKey = ownerRefToIndexKey(newOwner);
                for (const oldBlueprintId of sourceOwnerRecord.privateBlueprintIds) {
                    const sourceBlueprint = sourceBlueprintDocument?.blueprints[oldBlueprintId];
                    const newBlueprintId = blueprintIdMap[oldBlueprintId];
                    if (!sourceBlueprint || !newBlueprintId) {
                        continue;
                    }
                    const clonedBlueprint = cloneBlueprintForSurfaceDuplicate(sourceBlueprint, newBlueprintId, remapContext);
                    if (clonedBlueprint) {
                        bpDoc.blueprints[newBlueprintId] = clonedBlueprint;
                    }
                }
                bpDoc.ownerRecords[newOwnerKey] = {
                    ...cloneJson(sourceOwnerRecord),
                    activeBlueprintId,
                    privateBlueprintIds: clonedBlueprintIds,
                };
            }
        });

        const duplicatedElements: Record<string, UIElement> = {};
        for (const oldElementId of sourceElementIds) {
            const sourceElement = sourceDocument.elements[oldElementId];
            const newElementId = elementIdMap[oldElementId];
            if (!sourceElement || !newElementId) {
                continue;
            }
            const copy = cloneJson(sourceElement);
            copy.id = newElementId;
            copy.parentId = sourceElement.parentId ? elementIdMap[sourceElement.parentId] ?? null : null;
            copy.childrenIds = sourceElement.childrenIds
                .filter(childId => Boolean(elementIdMap[childId]))
                .map(childId => elementIdMap[childId]);
            copy.props = copy.props
                ? remapSurfaceDuplicateReferenceValue(copy.props, remapContext)
                : undefined;
            copy.style = copy.style
                ? remapSurfaceDuplicateReferenceValue(copy.style, remapContext)
                : undefined;
            copy.extra = copy.extra
                ? remapSurfaceDuplicateReferenceValue(copy.extra, remapContext)
                : undefined;
            if (copy.valueBindings) {
                copy.valueBindings = remapElementValueBindingBlueprintIds(copy.valueBindings, blueprintIdMap);
            }
            duplicatedElements[newElementId] = copy;
        }

        this.mutateDocument(document => {
            Object.assign(document.elements, duplicatedElements);
            const sourceIndex = document.surfaces.findIndex(surface => surface.id === sourceSurface.id);
            if (sourceIndex >= 0) {
                document.surfaces.splice(sourceIndex + 1, 0, duplicatedSurface);
            } else {
                document.surfaces.push(duplicatedSurface);
            }
            normalizeFlowChildLayouts(document, Object.keys(duplicatedElements));
        });

        return duplicatedSurface;
    }

    /**
     * Import surfaces that came from outside this document — a downloaded template,
     * or a page copied in another project's window.
     *
     * The input is a `UIDocument` + `UIGraphDocument` pair (possibly on an older
     * schema). Both are migrated to the current schema, every surface / element /
     * blueprint id is regenerated, and cross-references are remapped together — the
     * same discipline as {@link duplicateSurface}, but sourcing from external docs.
     * A surface's blueprints are the part that cannot be done by hand: they are not
     * on the surface but filed in the blueprint document under owner keys naming
     * `(surfaceId, elementId)`, so re-idding a surface without re-keying them leaves
     * a page whose logic still belongs to the ids it had elsewhere.
     *
     * The surface envelope is built from `placement`: a template declares one for
     * the whole bundle, while {@link IMPORT_PLACEMENT_FROM_SOURCE} keeps each
     * surface's own kind and stage slot. Nothing in the user's existing work is
     * replaced; the imported surfaces are appended.
     *
     * A stage surface whose target slot is already occupied is skipped and its slot
     * reported back, so the caller can tell the user rather than silently dropping
     * or clobbering a surface.
     */
    public importTemplateBundle(input: ImportTemplateBundleInput): ImportTemplateResult {
        // migrateIfNeeded is pure (does not touch this.document) and, unlike load(),
        // does not inject a main surface — so only the template's own surfaces come
        // through and the current document is untouched until the final mutate.
        const sourceDocument = this.migrateIfNeeded(this.coerceIncomingUIDocument(input.document));

        let sourceBlueprintDocument: BlueprintDocument | null = null;
        try {
            const rawBlueprint = input.graphs && typeof input.graphs === "object"
                ? (input.graphs as { blueprintDocument?: unknown }).blueprintDocument
                : undefined;
            if (rawBlueprint) {
                const migrated = migrateBlueprintDocumentToLatest(rawBlueprint);
                assertValidBlueprintDocument(migrated);
                sourceBlueprintDocument = migrated;
            }
        } catch (error) {
            // A logic graph that fails to migrate/validate must not block importing
            // the visual layout; drop the blueprints and keep the surface.
            console.warn("[UIDocumentService] template blueprints skipped (invalid)", error);
            sourceBlueprintDocument = null;
        }

        const importable = sourceDocument.surfaces.filter(surface => surface.id !== MAIN_APP_SURFACE_ID);
        const occupiedStageSlots = new Set<UIStageSlotId>(
            this.getDocument().surfaces
                .filter((surface): surface is UISurface & { kind: "stageSurface"; mount: UIStageSurfaceMount } =>
                    surface.kind === "stageSurface")
                .map(surface => surface.mount.slotId),
        );

        const importedSurfaces: UISurface[] = [];
        const skippedSlots: UIStageSlotId[] = [];

        // Components first: a surface element that is an instance of one carries the
        // source component's id, so the map has to exist before any surface is walked.
        const { componentIdMap, importedComponents } = this.importTemplateComponents(
            sourceDocument,
            sourceBlueprintDocument,
            input.assetIdMap,
        );

        // Then every surface's new id, before any of them is copied. A template's
        // surfaces reference each other (an nl.frame embeds a sibling), and the
        // surface holding the reference is copied before the one it points at, so
        // the target's id has to already exist when the first one is walked.
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const surfaceIdMap: Record<string, string> = {};
        for (const sourceSurface of importable) {
            surfaceIdMap[sourceSurface.id] = uuidService.generate();
        }

        for (const sourceSurface of importable) {
            let placement = resolveImportedSurfacePlacement(input.placement, sourceSurface);
            if (placement.kind === "stageSurface") {
                const slotId = placement.slotId ?? DEFAULT_UI_STAGE_SLOT_ID;
                if (occupiedStageSlots.has(slotId)) {
                    skippedSlots.push(slotId);
                    continue;
                }
                occupiedStageSlots.add(slotId);
                placement = { kind: "stageSurface", slotId };
            }
            const imported = this.importSingleSurface(
                sourceSurface,
                sourceDocument,
                sourceBlueprintDocument,
                placement,
                input.assetIdMap,
                componentIdMap,
                surfaceIdMap,
            );
            if (imported) {
                importedSurfaces.push(imported);
            }
        }

        return { importedSurfaces, skippedSlots, importedComponents };
    }

    /**
     * Copy a template's component library into this project, under fresh ids.
     *
     * This is what makes a component-set template possible at all: a component is
     * a self-contained `elements` record plus a root, living in `document.components`
     * rather than on any surface, so the surface walk never reaches it. Each one is
     * re-idded, its `componentWidgetMain` blueprints are cloned the way
     * {@link duplicateComponent} clones them, and the returned map lets the surface
     * walk repoint every instance at the copy.
     *
     * A template with no components returns an empty map and writes nothing.
     */
    private importTemplateComponents(
        sourceDocument: UIDocument,
        sourceBlueprintDocument: BlueprintDocument | null,
        assetIdMap?: Record<string, string>,
    ): { componentIdMap: Record<string, string>; importedComponents: UIComponentDefinition[] } {
        const sourceComponents = sourceDocument.components ?? [];
        if (sourceComponents.length === 0) {
            return { componentIdMap: {}, importedComponents: [] };
        }

        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        let localBp: LocalBlueprintService | null = null;
        try {
            localBp = this.getContext().services.get<LocalBlueprintService>(Services.LocalBlueprint);
        } catch {
            localBp = null;
        }

        const now = new Date().toISOString();
        const componentIdMap: Record<string, string> = {};
        const importedComponents: UIComponentDefinition[] = [];
        // Seeded from what is already here and grown as we go, so two components
        // arriving under the same name in one template do not collide with each other.
        const takenNames = new Set((this.getDocument().components ?? []).map(component => component.name));
        // Blueprint clones are collected across all components and written in one
        // mutation, because `applyBlueprintMutation` is a save point.
        const blueprintClones: { ownerKey: string; blueprint: Blueprint }[] = [];

        for (const source of sourceComponents) {
            if (!source.elements?.[source.rootElementId]) {
                // A component without its own root cannot be rendered or edited.
                console.warn(`[UIDocumentService] template component "${source.name}" skipped (no root element)`);
                continue;
            }
            const newComponentId = uuidService.generate();
            const elementIdMap: Record<string, string> = {};
            for (const elementId of Object.keys(source.elements)) {
                elementIdMap[elementId] = uuidService.generate();
            }

            const blueprintIdMap: Record<string, string> = {};
            if (sourceBlueprintDocument) {
                for (const [blueprintId, blueprint] of Object.entries(sourceBlueprintDocument.blueprints)) {
                    if (anchorComponentId(blueprint.owner) === source.id) {
                        blueprintIdMap[blueprintId] = uuidService.generate();
                    }
                }
            }

            // A component's elements live outside any surface, so the surface fields of
            // the remap context are inert here — only the element/blueprint/asset maps
            // and the component-instance map do work.
            const remapContext: SurfaceDuplicateRemapContext = {
                oldSurfaceId: `${COMPONENT_EDITOR_SURFACE_ID_PREFIX}${source.id}`,
                newSurfaceId: `${COMPONENT_EDITOR_SURFACE_ID_PREFIX}${newComponentId}`,
                elementIdMap,
                blueprintIdMap,
                assetIdMap,
                componentIdMap,
            };

            const elements: Record<string, UIElement> = {};
            for (const [oldElementId, sourceElement] of Object.entries(source.elements)) {
                const copy = cloneJson(sourceElement);
                copy.id = elementIdMap[oldElementId];
                copy.parentId = sourceElement.parentId ? elementIdMap[sourceElement.parentId] ?? null : null;
                copy.childrenIds = sourceElement.childrenIds
                    .filter(childId => Boolean(elementIdMap[childId]))
                    .map(childId => elementIdMap[childId]);
                copy.props = copy.props ? remapSurfaceDuplicateReferenceValue(copy.props, remapContext) : undefined;
                copy.style = copy.style ? remapSurfaceDuplicateReferenceValue(copy.style, remapContext) : undefined;
                copy.extra = copy.extra ? remapSurfaceDuplicateReferenceValue(copy.extra, remapContext) : undefined;
                if (copy.valueBindings) {
                    copy.valueBindings = remapElementValueBindingBlueprintIds(copy.valueBindings, blueprintIdMap);
                }
                elements[copy.id] = copy;
            }
            const newRoot = elements[elementIdMap[source.rootElementId]];
            if (newRoot) {
                newRoot.parentId = null;
            }

            const name = createImportedName(source.name, takenNames);
            takenNames.add(name);
            const component: UIComponentDefinition = {
                ...cloneJson(source),
                id: newComponentId,
                name,
                rootElementId: elementIdMap[source.rootElementId],
                elements,
                createdAt: now,
                updatedAt: now,
            };
            componentIdMap[source.id] = newComponentId;
            importedComponents.push(component);

            if (sourceBlueprintDocument) {
                for (const [oldBlueprintId, newBlueprintId] of Object.entries(blueprintIdMap)) {
                    const sourceBlueprint = sourceBlueprintDocument.blueprints[oldBlueprintId];
                    if (!sourceBlueprint || anchorComponentId(sourceBlueprint.owner) === null) {
                        continue;
                    }
                    // Naming a component and hanging off one of its elements are one anchor
                    // position, so this is never null past the guard above - the type cannot say so.
                    const oldElementId = anchorElementId(sourceBlueprint.owner);
                    const newElementId = oldElementId ? elementIdMap[oldElementId] : undefined;
                    if (!newElementId) {
                        continue;
                    }
                    const cloned = remapSurfaceDuplicateReferenceValue(cloneJson(sourceBlueprint), remapContext);
                    cloned.id = newBlueprintId;
                    cloned.owner = {
                        kind: "componentWidgetMain",
                        componentId: newComponentId,
                        elementId: newElementId,
                    };
                    blueprintClones.push({
                        ownerKey: componentWidgetMainOwnerKey(newComponentId, newElementId),
                        blueprint: cloned,
                    });
                }
            }
        }

        if (importedComponents.length === 0) {
            return { componentIdMap, importedComponents };
        }

        this.mutateDocument(document => {
            document.components = [...(document.components ?? []), ...importedComponents];
        }, { history: false });

        if (blueprintClones.length > 0) {
            localBp?.applyBlueprintMutation(bpDoc => {
                for (const { ownerKey, blueprint } of blueprintClones) {
                    bpDoc.blueprints[blueprint.id] = blueprint;
                    registerPrivateBlueprintAsActive(bpDoc, ownerKey, blueprint.id, blueprint.frontend);
                }
            });
        }

        return { componentIdMap, importedComponents };
    }

    /**
     * A store card's document: the registry's raw JSON, validated and brought up
     * to the current schema, ready to hand to `renderDocumentSurface`.
     *
     * Nothing here touches the open project — `migrateIfNeeded` is pure and this
     * never mutates. That is the whole point: the store draws what a template
     * actually looks like *before* the author decides to import it, so the card is
     * the template rather than a picture of it that can drift.
     *
     * Returns `null` for a document this Studio cannot read, so one bad template
     * costs its own card and not the grid.
     */
    public prepareTemplateDocumentForPreview(raw: unknown): UIDocument | null {
        try {
            return this.migrateIfNeeded(this.coerceIncomingUIDocument(raw));
        } catch (error) {
            console.warn("[UIDocumentService] template preview document rejected", error);
            return null;
        }
    }

    private coerceIncomingUIDocument(raw: unknown): UIDocument {
        if (!raw || typeof raw !== "object") {
            throw new RendererError("Template document is not an object");
        }
        const record = raw as Record<string, unknown>;
        if (
            typeof record.schemaVersion !== "number"
            || !Array.isArray(record.surfaces)
            || typeof record.elements !== "object"
            || record.elements === null
        ) {
            throw new RendererError("Template document is missing required fields");
        }
        return raw as UIDocument;
    }

    private importSingleSurface(
        sourceSurface: UISurface,
        sourceDocument: UIDocument,
        sourceBlueprintDocument: BlueprintDocument | null,
        placement: UITemplateSurfacePlacement,
        assetIdMap?: Record<string, string>,
        componentIdMap?: Record<string, string>,
        surfaceIdMap?: Record<string, string>,
    ): UISurface | null {
        const sourceRootId = sourceSurface.rootElementId;
        if (!sourceDocument.elements[sourceRootId]) {
            return null;
        }

        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        // Reserved by the caller when this is one of several surfaces arriving
        // together, so siblings pointing at it already carry the right id.
        const newSurfaceId = surfaceIdMap?.[sourceSurface.id] ?? uuidService.generate();
        const sourceElementIds = Array.from(collectSubtreeElementIds(sourceDocument, sourceRootId))
            .filter(elementId => Boolean(sourceDocument.elements[elementId]));
        const elementIdMap: Record<string, string> = {};
        for (const elementId of sourceElementIds) {
            elementIdMap[elementId] = uuidService.generate();
        }
        const newRootElementId = elementIdMap[sourceRootId];
        if (!newRootElementId) {
            return null;
        }

        let localBp: LocalBlueprintService | null = null;
        try {
            localBp = this.getContext().services.get<LocalBlueprintService>(Services.LocalBlueprint);
        } catch {
            localBp = null;
        }

        const blueprintIdMap: Record<string, string> = {};
        const ownerRecordsToClone: Record<string, BlueprintPrivateOwnerRecord> = {};
        if (sourceBlueprintDocument) {
            for (const [ownerKey, ownerRecord] of Object.entries(sourceBlueprintDocument.ownerRecords)) {
                const firstBlueprint = ownerRecord.privateBlueprintIds
                    .map(blueprintId => sourceBlueprintDocument.blueprints[blueprintId])
                    .find((blueprint): blueprint is Blueprint => Boolean(blueprint));
                const owner = firstBlueprint?.owner;
                // Only clone blueprints owned by this surface / its widgets. Global
                // blueprints (globalMain) remap to null and are left behind.
                if (!owner || !remapDuplicatedBlueprintOwner(owner, {
                    oldSurfaceId: sourceSurface.id,
                    newSurfaceId,
                    elementIdMap,
                    blueprintIdMap: {},
                })) {
                    continue;
                }
                ownerRecordsToClone[ownerKey] = cloneJson(ownerRecord);
                for (const blueprintId of ownerRecord.privateBlueprintIds) {
                    if (sourceBlueprintDocument.blueprints[blueprintId] && !blueprintIdMap[blueprintId]) {
                        blueprintIdMap[blueprintId] = uuidService.generate();
                    }
                }
            }
        }

        const remapContext: SurfaceDuplicateRemapContext = {
            oldSurfaceId: sourceSurface.id,
            newSurfaceId,
            elementIdMap,
            blueprintIdMap,
            assetIdMap,
            componentIdMap,
            surfaceIdMap,
        };

        const existingNames = new Set(this.getDocument().surfaces.map(surface => surface.name));
        const nextName = createImportedName(sourceSurface.name, existingNames);
        const designSize = sourceSurface.designSize ?? DEFAULT_UI_SURFACE_SIZE;
        const remappedSettings = sourceSurface.settings
            ? remapSurfaceDuplicateReferenceValue(cloneJson(sourceSurface.settings), remapContext)
            : undefined;

        const newSurface: UISurface = placement.kind === "stageSurface"
            ? {
                id: newSurfaceId,
                name: nextName,
                host: "player",
                kind: "stageSurface",
                designSize,
                rootElementId: newRootElementId,
                settings: { backgroundColor: "transparent", ...(remappedSettings ?? {}) },
                mount: { kind: "slot", slotId: placement.slotId ?? DEFAULT_UI_STAGE_SLOT_ID },
            }
            : {
                id: newSurfaceId,
                name: nextName,
                host: "app",
                kind: "appSurface",
                designSize,
                rootElementId: newRootElementId,
                settings: createDefaultPageSurfaceSettings(remappedSettings),
            };

        localBp?.applyBlueprintMutation(bpDoc => {
            for (const sourceOwnerRecord of Object.values(ownerRecordsToClone)) {
                const clonedBlueprintIds = sourceOwnerRecord.privateBlueprintIds
                    .map(oldBlueprintId => blueprintIdMap[oldBlueprintId])
                    .filter((blueprintId): blueprintId is string => Boolean(blueprintId));
                const activeBlueprintId = blueprintIdMap[sourceOwnerRecord.activeBlueprintId];
                if (!activeBlueprintId || clonedBlueprintIds.length === 0) {
                    continue;
                }
                const firstSourceBlueprint = sourceOwnerRecord.privateBlueprintIds
                    .map(oldBlueprintId => sourceBlueprintDocument?.blueprints[oldBlueprintId])
                    .find((blueprint): blueprint is Blueprint => Boolean(blueprint));
                const newOwner = firstSourceBlueprint
                    ? remapDuplicatedBlueprintOwner(firstSourceBlueprint.owner, remapContext)
                    : null;
                if (!newOwner) {
                    continue;
                }
                // The encoder, not a chain that reproduces it. Two of these had grown here, both
                // handling exactly the three kinds `remapDuplicatedBlueprintOwner` can return - so
                // the trailing branch was unreachable, and the format was written out in a third
                // and fourth place that could drift from it.
                const newOwnerKey = ownerRefToIndexKey(newOwner);
                for (const oldBlueprintId of sourceOwnerRecord.privateBlueprintIds) {
                    const sourceBlueprint = sourceBlueprintDocument?.blueprints[oldBlueprintId];
                    const newBlueprintId = blueprintIdMap[oldBlueprintId];
                    if (!sourceBlueprint || !newBlueprintId) {
                        continue;
                    }
                    const clonedBlueprint = cloneBlueprintForSurfaceDuplicate(sourceBlueprint, newBlueprintId, remapContext);
                    if (clonedBlueprint) {
                        bpDoc.blueprints[newBlueprintId] = clonedBlueprint;
                    }
                }
                bpDoc.ownerRecords[newOwnerKey] = {
                    ...cloneJson(sourceOwnerRecord),
                    activeBlueprintId,
                    privateBlueprintIds: clonedBlueprintIds,
                };
            }
        });

        const importedElements: Record<string, UIElement> = {};
        for (const oldElementId of sourceElementIds) {
            const sourceElement = sourceDocument.elements[oldElementId];
            const newElementId = elementIdMap[oldElementId];
            if (!sourceElement || !newElementId) {
                continue;
            }
            const copy = cloneJson(sourceElement);
            copy.id = newElementId;
            copy.parentId = sourceElement.parentId ? elementIdMap[sourceElement.parentId] ?? null : null;
            copy.childrenIds = sourceElement.childrenIds
                .filter(childId => Boolean(elementIdMap[childId]))
                .map(childId => elementIdMap[childId]);
            copy.props = copy.props
                ? remapSurfaceDuplicateReferenceValue(copy.props, remapContext)
                : undefined;
            copy.style = copy.style
                ? remapSurfaceDuplicateReferenceValue(copy.style, remapContext)
                : undefined;
            copy.extra = copy.extra
                ? remapSurfaceDuplicateReferenceValue(copy.extra, remapContext)
                : undefined;
            if (copy.valueBindings) {
                copy.valueBindings = remapElementValueBindingBlueprintIds(copy.valueBindings, blueprintIdMap);
            }
            importedElements[newElementId] = copy;
        }

        // The imported root becomes the new surface's root: no parent, whatever the
        // source tree said.
        const newRoot = importedElements[newRootElementId];
        if (newRoot) {
            newRoot.parentId = null;
        }

        this.mutateDocument(document => {
            Object.assign(document.elements, importedElements);
            document.surfaces.push(newSurface);
            normalizeFlowChildLayouts(document, Object.keys(importedElements));
        });

        return newSurface;
    }

    public getComponent(componentId: string): UIComponentDefinition | undefined {
        return (this.getDocument().components ?? []).find(component => component.id === componentId);
    }

    public getComponentUsageCount(componentId: string): number {
        let count = 0;
        for (const element of Object.values(this.getDocument().elements)) {
            const link = getUIComponentLink(element);
            if (link?.componentId === componentId) {
                count += 1;
            }
        }
        return count;
    }

    public createEmptyComponent(name?: string): UIComponentDefinition {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const now = new Date().toISOString();
        const componentId = uuidService.generate();
        const rootElementId = uuidService.generate();
        const containerModule = widgetModuleRegistry.get("nl.container");
        const defaults = containerModule?.createDefaultElement() ?? {};
        const rootElement: UIElement = {
            id: rootElementId,
            type: "nl.container",
            name: translate("defaultDoc.rootName"),
            parentId: null,
            childrenIds: [],
            layout: roundUILayoutGeometryFields({
                x: 0,
                y: 0,
                width: defaults.layout?.width ?? DEFAULT_COMPONENT_SIZE.width,
                height: defaults.layout?.height ?? DEFAULT_COMPONENT_SIZE.height,
                opacity: defaults.layout?.opacity ?? 1,
                visible: defaults.layout?.visible ?? true,
                rotation: defaults.layout?.rotation,
            }),
            props: defaults.props,
            style: defaults.style,
            extra: defaults.extra,
        };
        const component: UIComponentDefinition = {
            id: componentId,
            name: sanitizeComponentName(name, translate("defaultDoc.componentName")),
            rootElementId,
            elements: {
                [rootElementId]: rootElement,
            },
            previewMeta: {
                width: rootElement.layout.width,
                height: rootElement.layout.height,
            },
            createdAt: now,
            updatedAt: now,
        };
        this.mutateDocument(document => {
            document.components = [...(document.components ?? []), component];
        }, { history: false });
        return component;
    }

    public createComponentFromElements(surfaceId: string, elementIds: string[], name?: string): UIComponentDefinition | null {
        const document = this.getDocument();
        const effectiveRootId = resolveSurfaceRootElementId(document, surfaceId);
        if (!effectiveRootId || elementIds.length === 0) {
            return null;
        }
        const allowed = collectSubtreeElementIds(document, effectiveRootId);
        const topLevelIds = filterToTopLevelMovers(document, elementIds)
            .filter(id => {
                const element = document.elements[id];
                return element && element.type !== "nl.root" && allowed.has(id);
            });
        if (topLevelIds.length === 0) {
            return null;
        }

        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const now = new Date().toISOString();
        const componentId = uuidService.generate();
        const elementIdMap: Record<string, string> = {};
        const componentElements: Record<string, UIElement> = {};
        const selectedTopElements = topLevelIds
            .map(id => document.elements[id])
            .filter((element): element is UIElement => Boolean(element));
        const bounds = calculateElementsBounds(selectedTopElements);

        const collectSourceIds = (rootId: string) => {
            for (const id of collectSubtreeElementIds(document, rootId)) {
                if (!allowed.has(id) || !document.elements[id]) {
                    continue;
                }
                elementIdMap[id] = elementIdMap[id] ?? uuidService.generate();
            }
        };
        topLevelIds.forEach(collectSourceIds);

        let rootElementId: string;
        if (topLevelIds.length === 1) {
            const sourceRootId = topLevelIds[0];
            rootElementId = elementIdMap[sourceRootId];
            for (const [oldId, newId] of Object.entries(elementIdMap)) {
                const source = document.elements[oldId];
                if (!source) {
                    continue;
                }
                const copy = stripElementForComponentDefinition(source);
                copy.id = newId;
                copy.parentId = oldId === sourceRootId
                    ? null
                    : source.parentId && elementIdMap[source.parentId]
                      ? elementIdMap[source.parentId]
                      : null;
                copy.childrenIds = source.childrenIds.filter(childId => elementIdMap[childId]).map(childId => elementIdMap[childId]);
                if (oldId === sourceRootId) {
                    copy.layout = roundUILayoutGeometryFields({
                        ...copy.layout,
                        x: 0,
                        y: 0,
                    });
                }
                componentElements[newId] = copy;
            }
        } else {
            rootElementId = uuidService.generate();
            const rootDefaults = widgetModuleRegistry.get("nl.container")?.createDefaultElement() ?? {};
            const rootElement: UIElement = {
                id: rootElementId,
                type: "nl.container",
                name: translate("defaultDoc.rootName"),
                parentId: null,
                childrenIds: topLevelIds.map(id => elementIdMap[id]).filter(Boolean),
                layout: roundUILayoutGeometryFields({
                    x: 0,
                    y: 0,
                    width: bounds.width,
                    height: bounds.height,
                    opacity: 1,
                    visible: true,
                }),
                props: rootDefaults.props,
                style: rootDefaults.style,
                extra: rootDefaults.extra,
            };
            componentElements[rootElementId] = rootElement;
            for (const [oldId, newId] of Object.entries(elementIdMap)) {
                const source = document.elements[oldId];
                if (!source) {
                    continue;
                }
                const copy = stripElementForComponentDefinition(source);
                copy.id = newId;
                copy.parentId = topLevelIds.includes(oldId)
                    ? rootElementId
                    : source.parentId && elementIdMap[source.parentId]
                      ? elementIdMap[source.parentId]
                      : null;
                copy.childrenIds = source.childrenIds.filter(childId => elementIdMap[childId]).map(childId => elementIdMap[childId]);
                if (topLevelIds.includes(oldId)) {
                    copy.layout = roundUILayoutGeometryFields({
                        ...copy.layout,
                        x: copy.layout.x - bounds.x,
                        y: copy.layout.y - bounds.y,
                    });
                }
                componentElements[newId] = copy;
            }
        }

        const root = componentElements[rootElementId];
        if (!root) {
            return null;
        }

        // Carry the logic across with the layout. Template import already does exactly this in the
        // other direction - a component arriving with its own blueprints - so the remap machinery is
        // the same one, pointed at a real surface as the source instead of a component.
        // Guarded like the surface-duplicate path: a context without the blueprint service still has
        // to be able to extract layout, and the component is worth making either way.
        let localBp: LocalBlueprintService | null = null;
        try {
            localBp = this.getContext().services.get<LocalBlueprintService>(Services.LocalBlueprint);
        } catch {
            localBp = null;
        }
        const blueprintDocument = localBp?.getBlueprintDocument();
        const blueprintIdMap: Record<string, string> = {};
        const carried: { ownerKey: string; blueprint: Blueprint }[] = [];
        if (blueprintDocument) {
            for (const oldElementId of Object.keys(elementIdMap)) {
                const ownerKey = widgetMainOwnerKey(surfaceId, oldElementId);
                const sourceBlueprintId = blueprintDocument.ownerRecords[ownerKey]?.activeBlueprintId;
                const sourceBlueprint = sourceBlueprintId ? blueprintDocument.blueprints[sourceBlueprintId] : undefined;
                // Selecting an element is enough to give it a blueprint, so most elements own an empty
                // one. Cloning those would put a shell in the library for every box in the selection -
                // extracting one save slot carried eighteen blueprints, seventeen of them empty.
                if (sourceBlueprintId && sourceBlueprint && blueprintHasAuthoredGraph(sourceBlueprint)) {
                    blueprintIdMap[sourceBlueprintId] = uuidService.generate();
                }
            }
        }
        if (blueprintDocument && Object.keys(blueprintIdMap).length > 0) {
            const remapContext: SurfaceDuplicateRemapContext = {
                oldSurfaceId: surfaceId,
                newSurfaceId: `${COMPONENT_EDITOR_SURFACE_ID_PREFIX}${componentId}`,
                elementIdMap,
                blueprintIdMap,
            };
            for (const [oldBlueprintId, newBlueprintId] of Object.entries(blueprintIdMap)) {
                const sourceBlueprint = blueprintDocument.blueprints[oldBlueprintId];
                const owner = sourceBlueprint?.owner;
                if (!sourceBlueprint || owner?.kind !== "widgetMain") {
                    continue;
                }
                const newElementId = elementIdMap[owner.elementId];
                if (!newElementId) {
                    continue;
                }
                const cloned = remapSurfaceDuplicateReferenceValue(cloneJson(sourceBlueprint), remapContext) as Blueprint;
                cloned.id = newBlueprintId;
                cloned.owner = { kind: "componentWidgetMain", componentId, elementId: newElementId };
                carried.push({ ownerKey: componentWidgetMainOwnerKey(componentId, newElementId), blueprint: cloned });
            }
        }

        const component: UIComponentDefinition = {
            id: componentId,
            name: sanitizeComponentName(name, selectedTopElements.length === 1 ? (selectedTopElements[0].name ?? translate("defaultDoc.componentName")) : translate("defaultDoc.componentName")),
            rootElementId,
            elements: componentElements,
            previewMeta: {
                width: Math.max(1, Math.abs(root.layout.width)),
                height: Math.max(1, Math.abs(root.layout.height)),
            },
            createdAt: now,
            updatedAt: now,
        };

        this.mutateDocument(doc => {
            doc.components = [...(doc.components ?? []), component];
        }, { history: false });
        if (carried.length > 0) {
            localBp?.applyBlueprintMutation(bpDoc => {
                for (const { ownerKey, blueprint } of carried) {
                    bpDoc.blueprints[blueprint.id] = blueprint;
                    registerPrivateBlueprintAsActive(bpDoc, ownerKey, blueprint.id, blueprint.frontend);
                }
            });
        }
        return component;
    }

    public renameComponent(componentId: string, name: string): void {
        const nextName = name.trim();
        if (!nextName) {
            return;
        }
        this.mutateDocument(document => {
            const component = (document.components ?? []).find(item => item.id === componentId);
            if (!component) {
                return;
            }
            component.name = nextName;
            component.updatedAt = new Date().toISOString();
        }, { history: false });
    }

    /**
     * Replace a component's declared params.
     *
     * Instances keep values for ids that survive: a param is identified by `id`, so renaming one in
     * the inspector does not unset it anywhere. Values for ids that were removed are left on their
     * instances rather than swept - re-adding a param by the same id is how an author undoes a
     * deletion, and sweeping would make that a data loss with no warning.
     */
    public setComponentParams(componentId: string, params: UIComponentParam[]): void {
        this.mutateDocument(document => {
            const component = (document.components ?? []).find(item => item.id === componentId);
            if (!component) {
                return;
            }
            const seen = new Set<string>();
            component.params = params
                .map(param => ({
                    id: param.id.trim(),
                    name: param.name.trim(),
                    type: "string" as const,
                    defaultValue: typeof param.defaultValue === "string" ? param.defaultValue : "",
                }))
                .filter(param => {
                    if (!param.id || seen.has(param.id)) {
                        return false;
                    }
                    seen.add(param.id);
                    return true;
                });
            component.updatedAt = new Date().toISOString();
        }, { history: false });
    }

    /** Set one param value on one instance. An empty string is a value, not a reset. */
    public setComponentInstanceParam(elementId: string, paramId: string, value: string): void {
        const surfaceId = this.getElementSurfaceId(elementId);
        this.mutateDocument(document => {
            const element = document.elements[elementId];
            const link = getUIComponentLink(element);
            if (!element || !link) {
                return;
            }
            element.extra = {
                ...(element.extra ?? {}),
                componentLink: {
                    ...link,
                    params: { ...(link.params ?? {}), [paramId]: value },
                },
            };
        }, {
            history: surfaceId ? { surfaceId, mergeKey: `component-param:${elementId}:${paramId}` } : false,
        });
    }

    public deleteComponents(componentIds: string[]): void {
        const ids = new Set(componentIds);
        if (ids.size === 0) {
            return;
        }
        this.mutateDocument(document => {
            document.components = (document.components ?? []).filter(component => !ids.has(component.id));
        }, { history: false });
    }

    public duplicateComponent(componentId: string): UIComponentDefinition | null {
        const source = this.getComponent(componentId);
        if (!source) {
            return null;
        }
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const now = new Date().toISOString();
        const newComponentId = uuidService.generate();
        const idMap: Record<string, string> = {};
        for (const elementId of Object.keys(source.elements)) {
            idMap[elementId] = uuidService.generate();
        }
        let localBp: LocalBlueprintService | null = null;
        try {
            localBp = this.getContext().services.get<LocalBlueprintService>(Services.LocalBlueprint);
        } catch {
            localBp = null;
        }
        const blueprintIdMap: Record<string, string> = {};
        if (localBp) {
            for (const oldElementId of Object.keys(source.elements)) {
                const oldBpId = localBp.getComponentWidgetMainBlueprintId(source.id, oldElementId);
                if (oldBpId) {
                    blueprintIdMap[oldBpId] = uuidService.generate();
                }
            }
        }
        const elements: Record<string, UIElement> = {};
        for (const [oldId, element] of Object.entries(source.elements)) {
            const copy = cloneJson(element);
            copy.id = idMap[oldId];
            copy.parentId = element.parentId ? idMap[element.parentId] ?? null : null;
            copy.childrenIds = element.childrenIds.filter(childId => idMap[childId]).map(childId => idMap[childId]);
            if (copy.valueBindings) {
                copy.valueBindings = remapElementValueBindingBlueprintIds(copy.valueBindings, blueprintIdMap);
            }
            elements[copy.id] = copy;
        }
        const component: UIComponentDefinition = {
            ...cloneJson(source),
            id: newComponentId,
            name: `${source.name} Copy`,
            rootElementId: idMap[source.rootElementId],
            elements,
            createdAt: now,
            updatedAt: now,
        };
        this.mutateDocument(document => {
            document.components = [...(document.components ?? []), component];
        }, { history: false });
        localBp?.applyBlueprintMutation(bpDoc => {
            for (const [oldBpId, newBpId] of Object.entries(blueprintIdMap)) {
                const sourceBp = bpDoc.blueprints[oldBpId];
                if (!sourceBp || anchorComponentId(sourceBp.owner) !== source.id) {
                    continue;
                }
                const oldElementId = anchorElementId(sourceBp.owner);
                const newElementId = oldElementId ? idMap[oldElementId] : undefined;
                if (!newElementId) {
                    continue;
                }
                const cloned = cloneJson(sourceBp) as Blueprint;
                cloned.id = newBpId;
                cloned.owner = {
                    kind: "componentWidgetMain",
                    componentId: newComponentId,
                    elementId: newElementId,
                };
                if (cloned.bindings) {
                    for (const binding of Object.values(cloned.bindings)) {
                        if (binding.target.kind === "widgetProp") {
                            binding.target = {
                                ...binding.target,
                                surfaceId: `${COMPONENT_EDITOR_SURFACE_ID_PREFIX}${newComponentId}`,
                                elementId: idMap[binding.target.elementId] ?? binding.target.elementId,
                            };
                        }
                        if (binding.source.kind === "field" && binding.source.blueprintId === oldBpId) {
                            binding.source = { ...binding.source, blueprintId: newBpId };
                        }
                    }
                }
                bpDoc.blueprints[newBpId] = cloned;
                registerPrivateBlueprintAsActive(
                    bpDoc,
                    componentWidgetMainOwnerKey(newComponentId, newElementId),
                    newBpId,
                    cloned.frontend,
                );
            }
        });
        return component;
    }

    public updateComponentElementLayout(
        componentId: string,
        elementId: string,
        layoutPatch: Partial<UILayout>,
    ): void {
        this.mutateDocument(document => {
            const component = (document.components ?? []).find(item => item.id === componentId);
            const element = component?.elements[elementId];
            if (!component || !element) {
                return;
            }
            element.layout = roundUILayoutGeometryFields({
                ...element.layout,
                ...layoutPatch,
            });
            component.updatedAt = new Date().toISOString();
            if (component.rootElementId === elementId) {
                component.previewMeta = {
                    ...(component.previewMeta ?? {}),
                    width: Math.max(1, Math.abs(element.layout.width)),
                    height: Math.max(1, Math.abs(element.layout.height)),
                };
            }
        }, { history: false });
    }

    public updateComponentElementProps(
        componentId: string,
        elementId: string,
        propsPatch: Record<string, unknown>,
    ): void {
        this.mutateDocument(document => {
            const component = (document.components ?? []).find(item => item.id === componentId);
            const element = component?.elements[elementId];
            if (!component || !element) {
                return;
            }
            element.props = {
                ...(element.props ?? {}),
                ...propsPatch,
            };
            component.updatedAt = new Date().toISOString();
        }, { history: false });
    }

    public updateComponentElementAnimation(
        componentId: string,
        elementId: string,
        animation: UIPageAnimationSettings | null,
    ): void {
        this.mutateDocument(document => {
            const component = (document.components ?? []).find(item => item.id === componentId);
            const element = component?.elements[elementId];
            if (!component || !element) {
                return;
            }
            applyElementAnimation(element, animation);
            component.updatedAt = new Date().toISOString();
        }, { history: false });
    }

    public updateComponentElementExtra(
        componentId: string,
        elementId: string,
        extraPatch: Record<string, unknown>,
    ): void {
        this.mutateDocument(document => {
            const component = (document.components ?? []).find(item => item.id === componentId);
            const element = component?.elements[elementId];
            if (!component || !element) {
                return;
            }
            element.extra = {
                ...(element.extra ?? {}),
                ...extraPatch,
            };
            component.updatedAt = new Date().toISOString();
        }, { history: false });
    }

    public renameComponentElement(componentId: string, elementId: string, name: string): void {
        const trimmed = name.trim();
        if (!trimmed) {
            return;
        }
        this.mutateDocument(document => {
            const component = (document.components ?? []).find(item => item.id === componentId);
            const element = component?.elements[elementId];
            if (!component || !element) {
                return;
            }
            element.name = trimmed;
            component.updatedAt = new Date().toISOString();
        }, { history: false });
    }

    public reorderComponentChildren(componentId: string, parentId: string, orderedChildIds: string[]): void {
        this.mutateDocument(document => {
            const component = (document.components ?? []).find(item => item.id === componentId);
            const parent = component?.elements[parentId];
            if (!component || !parent || !uiElementTypeAcceptsChildren(parent.type)) {
                return;
            }
            const allowed = new Set(parent.childrenIds);
            const ordered = orderedChildIds.filter(id => allowed.has(id));
            if (ordered.length !== parent.childrenIds.length) {
                return;
            }
            parent.childrenIds = ordered;
            normalizeFlowChildLayouts({ ...document, elements: component.elements }, ordered);
            component.updatedAt = new Date().toISOString();
        }, { history: false });
    }

    public deleteComponentElements(componentId: string, elementIds: string[]): void {
        if (elementIds.length === 0) {
            return;
        }
        this.mutateDocument(document => {
            const component = (document.components ?? []).find(item => item.id === componentId);
            if (!component) {
                return;
            }
            const rootId = component.rootElementId;
            const toRemove = new Set<string>();
            const collect = (elementId: string) => {
                if (elementId === rootId || toRemove.has(elementId)) {
                    return;
                }
                const element = component.elements[elementId];
                if (!element) {
                    return;
                }
                toRemove.add(elementId);
                element.childrenIds.forEach(collect);
            };
            elementIds.forEach(collect);
            if (toRemove.size === 0) {
                return;
            }
            for (const element of Object.values(component.elements)) {
                if (element.childrenIds.length > 0) {
                    element.childrenIds = element.childrenIds.filter(childId => !toRemove.has(childId));
                }
            }
            for (const id of toRemove) {
                delete component.elements[id];
            }
            component.updatedAt = new Date().toISOString();
        }, { history: false });
    }

    public moveComponentElements(
        componentId: string,
        elementIds: string[],
        targetParentId: string,
        beforeChildId: string | null,
    ): MoveUiElementsResult {
        const document = this.getDocument();
        const component = (document.components ?? []).find(item => item.id === componentId);
        const rootId = component?.rootElementId;
        if (!component || !rootId || elementIds.includes(rootId)) {
            return { ok: false, reason: "invalid_movers" };
        }
        const targetParent = component.elements[targetParentId];
        if (!targetParent || !uiElementTypeAcceptsChildren(targetParent.type)) {
            return { ok: false, reason: "invalid_target" };
        }
        const surfaceId = `component:${componentId}`;
        const virtualSurface: UISurface = {
            id: surfaceId,
            name: component.name,
            host: "app",
            kind: "appSurface",
            designSize: getComponentPreviewDesignSize(component),
            rootElementId: rootId,
        };
        const virtualDocument: UIDocument = {
            ...document,
            surfaces: [virtualSurface],
            elements: component.elements,
        };
        const planned = planMoveElementsInSurface(virtualDocument, surfaceId, elementIds, targetParentId, beforeChildId);
        if (!planned.ok) {
            return planned;
        }
        this.mutateDocument(doc => {
            const liveComponent = (doc.components ?? []).find(item => item.id === componentId);
            if (!liveComponent) {
                return;
            }
            const liveVirtualSurface: UISurface = {
                id: surfaceId,
                name: liveComponent.name,
                host: "app",
                kind: "appSurface",
                designSize: getComponentPreviewDesignSize(liveComponent),
                rootElementId: liveComponent.rootElementId,
            };
            const liveVirtualDocument: UIDocument = {
                ...doc,
                surfaces: [liveVirtualSurface],
                elements: liveComponent.elements,
            };
            applyPlannedMove(liveVirtualDocument, planned.plan);
            normalizeFlowChildLayouts(liveVirtualDocument, elementIds);
            liveComponent.updatedAt = new Date().toISOString();
        }, { history: false });
        return { ok: true };
    }

    public createComponentElement(
        componentId: string,
        parentId: string,
        type: string,
        layoutPatch: Partial<UILayout> = {},
    ): UIElement | null {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const definition = widgetModuleRegistry.get(type);
        if (!definition) {
            throw new RendererError(`Unknown element type: ${type}`);
        }
        let created: UIElement | null = null;
        this.mutateDocument(document => {
            const component = (document.components ?? []).find(item => item.id === componentId);
            const parent = component?.elements[parentId];
            if (!component || !parent || !uiElementTypeAcceptsChildren(parent.type)) {
                return;
            }
            const elementId = uuidService.generate();
            const defaults = definition.createDefaultElement();
            const element: UIElement = {
                id: elementId,
                type: definition.type,
                name: defaults.name ?? definition.displayName,
                parentId,
                childrenIds: [],
                layout: roundUILayoutGeometryFields({
                    x: defaults.layout?.x ?? 0,
                    y: defaults.layout?.y ?? 0,
                    width: defaults.layout?.width ?? 100,
                    height: defaults.layout?.height ?? 100,
                    opacity: defaults.layout?.opacity ?? 1,
                    visible: defaults.layout?.visible ?? true,
                    rotation: defaults.layout?.rotation,
                    ...layoutPatch,
                }),
                props: defaults.props,
                style: defaults.style,
                extra: defaults.extra,
            };
            const defaultChildrenResult = definition.createDefaultChildElements?.({
                element,
                generateId: () => uuidService.generate(),
            });
            const defaultChildren = defaultChildrenResult?.children ?? [];
            const elementWithChildren: UIElement = {
                ...element,
                ...(defaultChildrenResult?.elementPatch ?? {}),
                id: element.id,
                type: element.type,
                parentId: element.parentId,
                childrenIds: defaultChildren.length > 0 ? defaultChildren.map(child => child.id) : element.childrenIds,
                layout: {
                    ...element.layout,
                    ...(defaultChildrenResult?.elementPatch?.layout ?? {}),
                },
                props: {
                    ...(element.props ?? {}),
                    ...(defaultChildrenResult?.elementPatch?.props ?? {}),
                },
                style: defaultChildrenResult?.elementPatch?.style ?? element.style,
                valueBindings: undefined,
                extra: defaultChildrenResult?.elementPatch?.extra ?? element.extra,
            };
            component.elements[elementId] = elementWithChildren;
            for (const child of defaultChildren) {
                component.elements[child.id] = {
                    ...child,
                    parentId: elementId,
                    valueBindings: undefined,
                };
            }
            parent.childrenIds = [...parent.childrenIds, elementId];
            normalizeFlowChildLayouts({ ...document, elements: component.elements }, [
                elementId,
                ...defaultChildren.map(child => child.id),
            ]);
            component.updatedAt = new Date().toISOString();
            created = cloneJson(elementWithChildren);
        }, { history: false });
        return created;
    }

    public pasteComponentClipboardPayload(
        componentId: string,
        targetParentId: string,
        beforeChildId: string | null,
        payload: UIEditorClipboardPayload,
    ): { ok: true; newRootIds: string[] } | { ok: false; reason: "invalid_clipboard" | "invalid_target" } {
        if (payload.v !== 1 || payload.topLevelElementIds.length === 0 || Object.keys(payload.elements).length === 0) {
            return { ok: false, reason: "invalid_clipboard" };
        }
        const document = this.getDocument();
        const component = (document.components ?? []).find(item => item.id === componentId);
        const target = component?.elements[targetParentId];
        if (!component || !target || !uiElementTypeAcceptsChildren(target.type)) {
            return { ok: false, reason: "invalid_target" };
        }
        if (beforeChildId != null) {
            const before = component.elements[beforeChildId];
            if (!before || before.parentId !== targetParentId) {
                return { ok: false, reason: "invalid_target" };
            }
        }
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const elementIdMap: Record<string, string> = {};
        for (const oldId of Object.keys(payload.elements)) {
            elementIdMap[oldId] = uuidService.generate();
        }
        const newRootIds = payload.topLevelElementIds
            .map(oldId => elementIdMap[oldId])
            .filter((id): id is string => Boolean(id));
        if (newRootIds.length === 0) {
            return { ok: false, reason: "invalid_clipboard" };
        }

        this.mutateDocument(doc => {
            const liveComponent = (doc.components ?? []).find(item => item.id === componentId);
            const liveParent = liveComponent?.elements[targetParentId];
            if (!liveComponent || !liveParent) {
                return;
            }
            for (const [oldId, source] of Object.entries(payload.elements)) {
                const newId = elementIdMap[oldId];
                if (!newId) {
                    continue;
                }
                const copy = stripElementForComponentDefinition(source);
                copy.id = newId;
                copy.parentId = payload.topLevelElementIds.includes(oldId)
                    ? targetParentId
                    : source.parentId && elementIdMap[source.parentId]
                      ? elementIdMap[source.parentId]
                      : null;
                copy.childrenIds = source.childrenIds.filter(childId => elementIdMap[childId]).map(childId => elementIdMap[childId]);
                liveComponent.elements[newId] = copy;
            }
            const insertAt = beforeChildId ? liveParent.childrenIds.indexOf(beforeChildId) : -1;
            const withoutMoved = liveParent.childrenIds.filter(id => !newRootIds.includes(id));
            liveParent.childrenIds = insertAt >= 0
                ? [...withoutMoved.slice(0, insertAt), ...newRootIds, ...withoutMoved.slice(insertAt)]
                : [...withoutMoved, ...newRootIds];
            normalizeFlowChildLayouts({ ...doc, elements: liveComponent.elements }, newRootIds);
            liveComponent.updatedAt = new Date().toISOString();
        }, { history: false });
        return { ok: true, newRootIds };
    }

    public createComponentInstance(parentId: string, componentId: string, layoutPatch: Partial<UILayout> = {}): UIElement {
        const surfaceId = this.getElementSurfaceId(parentId);
        const document = this.getDocument();
        const component = (document.components ?? []).find(item => item.id === componentId);
        if (!component) {
            throw new RendererError(`Component ${componentId} not found`);
        }
        const root = component.elements[component.rootElementId];
        if (!root) {
            throw new RendererError(`Component ${component.name} root is missing`);
        }
        const parent = document.elements[parentId];
        if (!parent) {
            throw new RendererError("Parent element not found");
        }
        if (isLinkedUIComponentElement(parent)) {
            throw new RendererError("Cannot insert children into a linked component instance");
        }
        if (!uiElementTypeAcceptsChildren(parent.type)) {
            throw new RendererError(`Parent type ${parent.type} cannot have child elements`);
        }
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const elementId = uuidService.generate();
        const element: UIElement = {
            id: elementId,
            type: root.type,
            name: component.name,
            parentId,
            childrenIds: [],
            layout: roundUILayoutGeometryFields({
                x: root.layout.x,
                y: root.layout.y,
                width: root.layout.width,
                height: root.layout.height,
                opacity: 1,
                visible: true,
                rotation: root.layout.rotation,
                ...layoutPatch,
            }),
            extra: {
                componentLink: {
                    componentId,
                    linked: true,
                },
            },
        };
        this.mutateDocument(doc => {
            doc.elements[elementId] = element;
            const parentElement = doc.elements[parentId];
            if (parentElement) {
                parentElement.childrenIds = [...parentElement.childrenIds, elementId];
            }
            normalizeFlowChildLayout(doc, element);
        }, {
            history: surfaceId ? { surfaceId } : false,
        });
        return element;
    }

    public unlinkComponentInstance(elementId: string): string[] {
        const document = this.getDocument();
        const surfaceId = this.getElementSurfaceId(elementId);
        const instance = document.elements[elementId];
        const link = getUIComponentLink(instance);
        if (!instance || !link) {
            return [];
        }
        const component = (document.components ?? []).find(item => item.id === link.componentId);
        const sourceRoot = component?.elements[component.rootElementId];
        if (!component || !sourceRoot) {
            return [];
        }
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const idMap: Record<string, string> = {
            [sourceRoot.id]: instance.id,
        };
        const sourceElementIds = collectComponentSubtreeElementIds(component.elements, sourceRoot.id);
        for (const id of sourceElementIds) {
            idMap[id] = idMap[id] ?? uuidService.generate();
        }
        let localBp: LocalBlueprintService | null = null;
        try {
            localBp = this.getContext().services.get<LocalBlueprintService>(Services.LocalBlueprint);
        } catch {
            localBp = null;
        }
        const blueprintIdMap: Record<string, string> = {};
        if (localBp) {
            for (const sourceElementId of sourceElementIds) {
                const oldBpId = localBp.getComponentWidgetMainBlueprintId(component.id, sourceElementId);
                if (oldBpId) {
                    blueprintIdMap[oldBpId] = uuidService.generate();
                }
            }
        }
        const materializedIds = Object.values(idMap);
        this.mutateDocument(doc => {
            const liveInstance = doc.elements[elementId];
            if (!liveInstance) {
                return;
            }
            const liveComponent = (doc.components ?? []).find(item => item.id === link.componentId);
            const liveRoot = liveComponent?.elements[liveComponent.rootElementId];
            if (!liveComponent || !liveRoot) {
                return;
            }
            for (const [oldId, source] of Object.entries(liveComponent.elements)) {
                if (!idMap[oldId]) {
                    continue;
                }
                const copy = cloneJson(source);
                copy.id = idMap[oldId];
                copy.parentId = oldId === liveRoot.id
                    ? liveInstance.parentId
                    : source.parentId && idMap[source.parentId]
                      ? idMap[source.parentId]
                      : null;
                copy.childrenIds = source.childrenIds.filter(childId => idMap[childId]).map(childId => idMap[childId]);
                if (copy.valueBindings) {
                    copy.valueBindings = remapElementValueBindingBlueprintIds(copy.valueBindings, blueprintIdMap);
                }
                if (oldId === liveRoot.id) {
                    copy.layout = {
                        ...copy.layout,
                        ...liveInstance.layout,
                    };
                    copy.name = liveInstance.name;
                    if (copy.extra?.componentLink) {
                        const { componentLink: _removed, ...rest } = copy.extra;
                        copy.extra = Object.keys(rest).length > 0 ? rest : undefined;
                    }
                }
                doc.elements[copy.id] = copy;
            }
            normalizeFlowChildLayouts(doc, materializedIds);
        }, {
            history: surfaceId ? { surfaceId } : false,
        });
        if (surfaceId && localBp) {
            localBp.applyBlueprintMutation(bpDoc => {
                for (const [oldBpId, newBpId] of Object.entries(blueprintIdMap)) {
                    const sourceBp = bpDoc.blueprints[oldBpId];
                    if (!sourceBp || anchorComponentId(sourceBp.owner) !== component.id) {
                        continue;
                    }
                    const oldElementId = anchorElementId(sourceBp.owner);
                    const newElementId = oldElementId ? idMap[oldElementId] : undefined;
                    if (!newElementId) {
                        continue;
                    }
                    const cloned: Blueprint = cloneWidgetMainBlueprintForPaste({
                        source: sourceBp,
                        newBlueprintId: newBpId,
                        surfaceId,
                        newOwnerElementId: newElementId,
                        elementIdMap: idMap,
                        oldBlueprintId: oldBpId,
                        newBlueprintIdForSourceRemap: newBpId,
                    });
                    bpDoc.blueprints[newBpId] = cloned;
                    registerPrivateBlueprintAsActive(
                        bpDoc,
                        widgetMainOwnerKey(surfaceId, newElementId),
                        newBpId,
                        cloned.frontend,
                    );
                }
            });
        }
        return materializedIds;
    }

    public createElement(parentId: string, type: string, layoutPatch: Partial<UILayout> = {}): UIElement {
        const surfaceId = this.getElementSurfaceId(parentId);
        const definition = widgetModuleRegistry.get(type);
        if (!definition) {
            throw new RendererError(`Unknown element type: ${type}`);
        }
        const document = this.getDocument();
        const parent = document.elements[parentId];
        if (!parent) {
            throw new RendererError("Parent element not found");
        }
        if (isLinkedUIComponentElement(parent)) {
            throw new RendererError("Cannot insert children into a linked component instance");
        }
        if (!uiElementTypeAcceptsChildren(parent.type)) {
            throw new RendererError(`Parent type ${parent.type} cannot have child elements`);
        }
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const elementId = uuidService.generate();

        const defaultElement = definition.createDefaultElement();
        const baseLayout: UILayout = {
            x: defaultElement.layout?.x ?? 0,
            y: defaultElement.layout?.y ?? 0,
            width: defaultElement.layout?.width ?? 100,
            height: defaultElement.layout?.height ?? 100,
            visible: defaultElement.layout?.visible ?? true,
            opacity: defaultElement.layout?.opacity ?? 1,
            rotation: defaultElement.layout?.rotation,
        };
        const layout: UILayout = roundUILayoutGeometryFields({ ...baseLayout, ...layoutPatch });

        const element: UIElement = {
            id: elementId,
            type: definition.type,
            name: defaultElement.name ?? definition.displayName,
            parentId,
            childrenIds: [],
            layout,
            props: defaultElement.props,
            style: defaultElement.style,
            extra:
                isListLikeWidgetType(parent.type)
                    ? ({
                          ...(defaultElement.extra ?? {}),
                          listSlot: "itemTemplate",
                      } satisfies UIListElementExtra)
                    : parent.type === "nl.slider"
                      ? ({
                            ...(defaultElement.extra ?? {}),
                            sliderSlot: getUISliderChildSlot(defaultElement.extra) ?? "track",
                        } satisfies UISliderElementExtra)
                    : parent.type === UI_SWITCH_ELEMENT_TYPE
                      ? ({
                            ...(defaultElement.extra ?? {}),
                            switchSlot: getUISwitchChildSlot(defaultElement.extra) ?? "track",
                        } satisfies UISwitchElementExtra)
                    : defaultElement.extra,
        };
        const defaultChildrenResult = definition.createDefaultChildElements?.({
            element,
            generateId: () => uuidService.generate(),
        });
        const defaultChildren = defaultChildrenResult?.children ?? [];
        const elementWithChildren: UIElement = {
            ...element,
            ...(defaultChildrenResult?.elementPatch ?? {}),
            id: element.id,
            type: element.type,
            parentId: element.parentId,
            childrenIds: defaultChildren.length > 0 ? defaultChildren.map(child => child.id) : element.childrenIds,
            layout: {
                ...element.layout,
                ...(defaultChildrenResult?.elementPatch?.layout ?? {}),
            },
            props: {
                ...(element.props ?? {}),
                ...(defaultChildrenResult?.elementPatch?.props ?? {}),
            },
            style: defaultChildrenResult?.elementPatch?.style ?? element.style,
            extra: defaultChildrenResult?.elementPatch?.extra ?? element.extra,
        };

        this.mutateDocument(documentData => {
            documentData.elements[elementId] = elementWithChildren;
            for (const child of defaultChildren) {
                documentData.elements[child.id] = {
                    ...child,
                    parentId: elementId,
                };
            }
            const parentElement = documentData.elements[parentId];
            if (parentElement) {
                parentElement.childrenIds = [...parentElement.childrenIds, elementId];
            }
            normalizeFlowChildLayouts(documentData, [
                elementId,
                ...defaultChildren.map(child => child.id),
            ]);
        }, {
            history: surfaceId ? { surfaceId } : false,
        });

        return elementWithChildren;
    }

    public pasteClipboardPayload(
        surfaceId: string,
        targetParentId: string,
        beforeChildId: string | null,
        payload: UIEditorClipboardPayload,
    ): { ok: true; newRootIds: string[] } | { ok: false; reason: "invalid_clipboard" | "invalid_target" } {
        if (payload.v !== 1 || payload.topLevelElementIds.length === 0 || Object.keys(payload.elements).length === 0) {
            return { ok: false, reason: "invalid_clipboard" };
        }

        const document = this.getDocument();
        const effectiveRootId = resolveSurfaceRootElementId(document, surfaceId);
        if (!effectiveRootId) {
            return { ok: false, reason: "invalid_target" };
        }
        const allowed = collectSubtreeElementIds(document, effectiveRootId);
        const target = document.elements[targetParentId];
        if (!target || !allowed.has(targetParentId) || !isValidUIInsertParent(target) || isLinkedUIComponentElement(target)) {
            return { ok: false, reason: "invalid_target" };
        }
        if (beforeChildId != null) {
            const beforeEl = document.elements[beforeChildId];
            if (!beforeEl || beforeEl.parentId !== targetParentId) {
                return { ok: false, reason: "invalid_target" };
            }
        }

        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const localBp = this.getContext().services.get<LocalBlueprintService>(Services.LocalBlueprint);
        const historyService = this.getHistoryService();
        const beforeHistory = historyService?.captureSnapshot(surfaceId) ?? null;

        const elementIdMap: Record<string, string> = {};
        for (const oldId of Object.keys(payload.elements)) {
            elementIdMap[oldId] = uuidService.generate();
        }

        const blueprintIdMap: Record<string, string> = {};
        for (const oldBpId of Object.keys(payload.widgetMainBlueprints)) {
            blueprintIdMap[oldBpId] = uuidService.generate();
        }
        for (const oldBpId of Object.keys(payload.widgetValueBlueprints ?? {})) {
            blueprintIdMap[oldBpId] = uuidService.generate();
        }

        const newRootIds: string[] = [];

        this.mutateDocument(doc => {
            const parentEl = doc.elements[targetParentId];
            if (!parentEl) {
                return;
            }

            for (const oldId of Object.keys(payload.elements)) {
                const oldEl = payload.elements[oldId];
                const newId = elementIdMap[oldId];
                const isTop = payload.topLevelElementIds.includes(oldId);
                const copy = JSON.parse(JSON.stringify(oldEl)) as UIElement;
                copy.id = newId;
                if (isTop) {
                    copy.parentId = targetParentId;
                } else if (oldEl.parentId && payload.elements[oldEl.parentId]) {
                    copy.parentId = elementIdMap[oldEl.parentId];
                } else {
                    copy.parentId = null;
                }
                copy.childrenIds = oldEl.childrenIds
                    .filter(cid => payload.elements[cid])
                    .map(cid => elementIdMap[cid]);

                if (copy.valueBindings) {
                    copy.valueBindings = remapElementValueBindingBlueprintIds(copy.valueBindings, blueprintIdMap);
                }
                if (isTop && isListLikeWidgetType(parentEl.type)) {
                    const slot = copy.extra?.listSlot;
                    if (slot !== "itemTemplate" && slot !== "scrollbarTrack" && slot !== "scrollbarThumb") {
                        copy.extra = {
                            ...(copy.extra ?? {}),
                            listSlot: "itemTemplate",
                        };
                    }
                }

                if (isTop) {
                    const mergeLookup = (id: string) => doc.elements[id] ?? payload.elements[id];
                    const patch = layoutPatchForReparent(doc, oldEl, targetParentId, mergeLookup);
                    let layout = { ...copy.layout, ...patch };
                    const sameParentAsSource = oldEl.parentId === targetParentId;
                    if (!isUIFlowLayoutParentElement(parentEl) && sameParentAsSource) {
                        layout = {
                            ...layout,
                            x: (layout.x ?? 0) + 16,
                            y: (layout.y ?? 0) + 16,
                        };
                    }
                    copy.layout = roundUILayoutGeometryFields(layout);
                } else {
                    copy.layout = roundUILayoutGeometryFields({ ...copy.layout });
                }

                doc.elements[newId] = copy;
            }

            newRootIds.length = 0;
            for (const oldRoot of payload.topLevelElementIds) {
                const mapped = elementIdMap[oldRoot];
                if (mapped) {
                    newRootIds.push(mapped);
                }
            }

            let children = [...parentEl.childrenIds];
            children = children.filter(cid => !newRootIds.includes(cid));
            let insertAt = children.length;
            if (beforeChildId != null) {
                const idx = children.indexOf(beforeChildId);
                insertAt = idx === -1 ? children.length : idx;
            }
            children.splice(insertAt, 0, ...newRootIds);
            parentEl.childrenIds = children;
            normalizeFlowChildLayouts(doc, Object.values(elementIdMap));
        }, { history: false });

        localBp.applyBlueprintMutation(bpDoc => {
            for (const [oldBpId, sourceBp] of Object.entries(payload.widgetMainBlueprints)) {
                const newBpId = blueprintIdMap[oldBpId];
                if (!newBpId) {
                    continue;
                }
                const owner = sourceBp.owner;
                if (owner.kind !== "widgetMain" || owner.surfaceId !== payload.sourceSurfaceId) {
                    continue;
                }
                const newElementId = elementIdMap[owner.elementId];
                if (!newElementId || !payload.elements[owner.elementId]) {
                    continue;
                }
                const cloned: Blueprint = cloneWidgetMainBlueprintForPaste({
                    source: sourceBp,
                    newBlueprintId: newBpId,
                    surfaceId,
                    newOwnerElementId: newElementId,
                    elementIdMap,
                    oldBlueprintId: oldBpId,
                    newBlueprintIdForSourceRemap: newBpId,
                });
                bpDoc.blueprints[newBpId] = cloned;
                registerPrivateBlueprintAsActive(
                    bpDoc,
                    widgetMainOwnerKey(surfaceId, newElementId),
                    newBpId,
                    cloned.frontend,
                );
            }
            for (const [oldBpId, sourceBp] of Object.entries(payload.widgetValueBlueprints ?? {})) {
                const newBpId = blueprintIdMap[oldBpId];
                if (!newBpId) {
                    continue;
                }
                const owner = sourceBp.owner;
                if (owner.kind !== "widgetValue" || owner.surfaceId !== payload.sourceSurfaceId) {
                    continue;
                }
                const newElementId = elementIdMap[owner.elementId];
                if (!newElementId || !payload.elements[owner.elementId]) {
                    continue;
                }
                const cloned: Blueprint = cloneWidgetValueBlueprintForPaste({
                    source: sourceBp,
                    newBlueprintId: newBpId,
                    surfaceId,
                    newOwnerElementId: newElementId,
                    propPath: owner.propPath,
                });
                bpDoc.blueprints[newBpId] = cloned;
                registerPrivateBlueprintAsActive(
                    bpDoc,
                    widgetValueOwnerKey(surfaceId, newElementId, owner.propPath),
                    newBpId,
                    cloned.frontend,
                );
            }
        });

        if (historyService && beforeHistory) {
            historyService.record({
                surfaceId,
                before: beforeHistory,
                after: historyService.captureSnapshot(surfaceId),
            });
        }

        return { ok: true, newRootIds };
    }

    private getProjectDesignSize(): UISurfaceDesignSize {
        const projectService = this.getContext().services.get<ProjectService>(Services.Project);
        const projectConfig = projectService.getProjectConfig();
        return projectConfig.metadata?.resolution ?? DEFAULT_UI_SURFACE_SIZE;
    }

    private createRootElement(rootElementId: UIElementId, designSize: UISurfaceDesignSize): UIElement {
        return {
            id: rootElementId,
            type: "nl.root",
            name: DEFAULT_UI_ROOT_NAME,
            parentId: null,
            childrenIds: [],
            layout: {
                x: 0,
                y: 0,
                width: designSize.width,
                height: designSize.height,
                visible: true,
                opacity: 1,
            },
        };
    }

    private createDialogStageTemplate(rootElement: UIElement, designSize: UISurfaceDesignSize): DialogStageTemplate {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const interactionLayerId = uuidService.generate();
        const panelId = uuidService.generate();
        const avatarId = uuidService.generate();
        const stackId = uuidService.generate();
        const nametagId = uuidService.generate();
        const sentenceId = uuidService.generate();
        const panelWidth = Math.round(designSize.width * 0.86);
        const panelHeight = Math.max(180, Math.round(designSize.height * 0.24));
        const panelX = Math.round((designSize.width - panelWidth) / 2);
        const panelY = Math.max(0, designSize.height - panelHeight - Math.round(designSize.height * 0.04));
        const panelInset = 28;
        // The avatar sits in the panel's free layout, and the text column pays for it with left
        // padding rather than becoming a flow sibling: that keeps nametag/sentence stacking as-is
        // and keeps the text baseline steady on lines that resolve no avatar.
        const avatarSize = Math.max(96, Math.min(180, panelHeight - 44));
        const avatarY = Math.max(0, Math.round((panelHeight - avatarSize) / 2));
        const contentPaddingLeft = panelInset + avatarSize + 24;

        rootElement.childrenIds = [interactionLayerId, panelId];

        const interactionLayer: UIElement = {
            id: interactionLayerId,
            type: "nl.container",
            name: translate("defaultDoc.dialog.interactionLayer"),
            parentId: rootElement.id,
            childrenIds: [],
            layout: roundUILayoutGeometryFields({
                x: 0,
                y: 0,
                width: designSize.width,
                height: designSize.height,
                opacity: 1,
                visible: true,
            }),
            props: createContainerTemplateProps({
                layoutKind: "free",
                backgroundColor: "transparent",
                fillVisible: false,
                fillOpacity: 0,
                strokeVisible: false,
                borderWidth: 0,
                stackPaddingTop: 0,
                stackPaddingRight: 0,
                stackPaddingBottom: 0,
                stackPaddingLeft: 0,
                clipContent: false,
            }),
        };

        const panel: UIElement = {
            id: panelId,
            type: "nl.container",
            name: translate("defaultDoc.dialog.panel"),
            parentId: rootElement.id,
            childrenIds: [stackId, avatarId],
            layout: roundUILayoutGeometryFields({
                x: panelX,
                y: panelY,
                width: panelWidth,
                height: panelHeight,
                opacity: 1,
                visible: true,
            }),
            props: createContainerTemplateProps({
                layoutKind: "free",
                backgroundColor: "#0b0d12",
                fillOpacity: 0.78,
                borderRadius: 8,
                borderRadiusTL: 8,
                borderRadiusTR: 8,
                borderRadiusBL: 8,
                borderRadiusBR: 8,
                borderColor: "#f8fafc",
                borderWidth: 1,
                strokeOpacity: 0.18,
                clipContent: true,
            }),
        };

        const avatar: UIElement = {
            id: avatarId,
            type: "nl.image",
            name: translate("defaultDoc.dialog.avatar"),
            parentId: panelId,
            childrenIds: [],
            layout: roundUILayoutGeometryFields({
                x: panelInset,
                y: avatarY,
                width: avatarSize,
                height: avatarSize,
                opacity: 1,
                visible: true,
            }),
            props: createImageTemplateProps({
                // No chrome: with no asset resolved the widget then paints nothing at all, which is
                // what a narrator line or an avatar-less character should look like.
                fillType: "image",
                imageFill: { mode: "cover", assetId: null },
                backgroundColor: "transparent",
                fillVisible: true,
                fillOpacity: 1,
                strokeVisible: false,
                borderWidth: 0,
                borderRadius: 8,
                borderRadiusTL: 8,
                borderRadiusTR: 8,
                borderRadiusBL: 8,
                borderRadiusBR: 8,
                borderRadiusLinked: true,
            }),
        };

        const stack: UIElement = {
            id: stackId,
            type: "nl.container",
            name: translate("defaultDoc.dialog.content"),
            parentId: panelId,
            childrenIds: [nametagId, sentenceId],
            layout: roundUILayoutGeometryFields({
                x: 0,
                y: 0,
                width: panelWidth,
                height: panelHeight,
                opacity: 1,
                visible: true,
            }),
            props: createContainerTemplateProps({
                layoutKind: "stack",
                stackDirection: "vertical",
                stackGap: 10,
                stackPaddingTop: 22,
                stackPaddingRight: panelInset,
                stackPaddingBottom: 22,
                stackPaddingLeft: contentPaddingLeft,
                backgroundColor: "transparent",
                fillVisible: false,
                strokeVisible: false,
                borderWidth: 0,
                clipContent: false,
            }),
        };

        const nametag: UIElement = {
            id: nametagId,
            type: "nl.text",
            name: translate("defaultDoc.dialog.nametag"),
            parentId: stackId,
            childrenIds: [],
            layout: roundUILayoutGeometryFields({
                x: 0,
                y: 0,
                width: 320,
                height: 34,
                opacity: 1,
                visible: true,
            }),
            props: createTextTemplateProps({
                text: translate("defaultDoc.speaker"),
                fontSize: 22,
                color: "#f8d37a",
                fontWeight: "600",
                lineHeight: 1.2,
                textVerticalAlign: "center",
            }),
        };

        const sentence: UIElement = {
            id: sentenceId,
            type: DIALOG_SENTENCE_WIDGET_TYPE,
            name: translate("defaultDoc.dialog.sentence"),
            parentId: stackId,
            childrenIds: [],
            layout: roundUILayoutGeometryFields({
                x: 0,
                y: 0,
                width: Math.max(1, panelWidth - contentPaddingLeft - panelInset),
                height: Math.max(96, panelHeight - 88),
                opacity: 1,
                visible: true,
            }),
            props: createTextTemplateProps({
                text: translate("defaultDoc.dialog.sentenceText"),
                fontSize: 24,
                color: "#f8fafc",
                lineHeight: 1.45,
            }),
        };

        return {
            elements: {
                [interactionLayer.id]: interactionLayer,
                [panel.id]: panel,
                [avatar.id]: avatar,
                [stack.id]: stack,
                [nametag.id]: nametag,
                [sentence.id]: sentence,
            },
            interactionLayerId,
            panelId,
            avatarId,
            stackId,
            nametagId,
            sentenceId,
        };
    }

    private getOptionalLocalBlueprintService(): LocalBlueprintService | null {
        try {
            return this.getContext().services.get<LocalBlueprintService>(Services.LocalBlueprint);
        } catch {
            return null;
        }
    }

    private createDialogContentNextGraph(
        surfaceId: UISurfaceId,
        targets: {
            interactionLayerId: UIElementId;
            panelId: UIElementId;
            avatarId: UIElementId;
            nametagId: UIElementId;
            sentenceId: UIElementId;
        },
    ): BlueprintGraphIr {
        const contentClickHeadId = "dialog.next.contentMouseClick";
        const spaceHeadId = "dialog.next.spaceKeyUp";
        const nextId = "dialog.next";
        const elementClickTargets = [
            {
                nodeId: "dialog.next.interactionLayerElementClick",
                elementId: targets.interactionLayerId,
                elementType: "nl.container",
                y: 210,
            },
            {
                nodeId: "dialog.next.panelElementClick",
                elementId: targets.panelId,
                elementType: "nl.container",
                y: 380,
            },
            {
                nodeId: "dialog.next.avatarElementClick",
                elementId: targets.avatarId,
                elementType: "nl.image",
                y: 550,
            },
            {
                nodeId: "dialog.next.nametagElementClick",
                elementId: targets.nametagId,
                elementType: "nl.text",
                y: 720,
            },
            {
                nodeId: "dialog.next.sentenceElementClick",
                elementId: targets.sentenceId,
                elementType: DIALOG_SENTENCE_WIDGET_TYPE,
                y: 890,
            },
        ] as const;
        const nodes: Record<string, BlueprintGraphNode> = {
            [contentClickHeadId]: {
                id: contentClickHeadId,
                type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
                params: {},
                meta: { editorLayout: { x: 80, y: 40 } },
            },
            [spaceHeadId]: {
                id: spaceHeadId,
                type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP,
                params: {
                    [BLUEPRINT_NODE_PARAM_EVENT_HEAD_KEY_NAME]: " ",
                },
                meta: { editorLayout: { x: 80, y: 1060 } },
            },
            [nextId]: {
                id: nextId,
                type: BLUEPRINT_NODE_TYPE_GAME_NEXT,
                params: {},
                meta: { editorLayout: { x: 560, y: 550 } },
            },
        };
        const edges: NonNullable<BlueprintGraphIr["edges"]> = [
            {
                from: { nodeId: contentClickHeadId, port: "then" },
                to: { nodeId: nextId, port: "in" },
            },
            {
                from: { nodeId: spaceHeadId, port: "then" },
                to: { nodeId: nextId, port: "in" },
            },
        ];
        for (const target of elementClickTargets) {
            nodes[target.nodeId] = {
                id: target.nodeId,
                type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
                params: {
                    surfaceId,
                    elementId: target.elementId,
                    elementType: target.elementType,
                },
                meta: { editorLayout: { x: 80, y: target.y } },
            };
            edges.push({
                from: { nodeId: target.nodeId, port: "then" },
                to: { nodeId: nextId, port: "in" },
            });
        }
        return {
            nodes,
            edges,
            meta: { [BLUEPRINT_GRAPH_IR_META_KIND]: "event" },
        };
    }

    private createNametagUpdateGraph(): BlueprintGraphIr {
        const initHeadId = "nametag.update.init";
        const flushHeadId = "nametag.update.flush";
        const conditionNametagId = "nametag.update.get.condition";
        const textNametagId = "nametag.update.get.text";
        const notNullId = "nametag.update.notNull";
        const ifId = "nametag.update.if";
        const showId = "nametag.update.show";
        const setTextId = "nametag.update.setText";
        const hideId = "nametag.update.hide";
        return {
            nodes: {
                [initHeadId]: {
                    id: initHeadId,
                    type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
                    params: {},
                    meta: { editorLayout: { x: 80, y: 60 } },
                } satisfies BlueprintGraphNode,
                [flushHeadId]: {
                    id: flushHeadId,
                    type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH,
                    params: {},
                    meta: { editorLayout: { x: 80, y: 190 } },
                } satisfies BlueprintGraphNode,
                [conditionNametagId]: {
                    id: conditionNametagId,
                    type: BLUEPRINT_NODE_TYPE_GAME_GET_NAMETAG,
                    params: {},
                    meta: { editorLayout: { x: 300, y: 220 } },
                } satisfies BlueprintGraphNode,
                [textNametagId]: {
                    id: textNametagId,
                    type: BLUEPRINT_NODE_TYPE_GAME_GET_NAMETAG,
                    params: {},
                    meta: { editorLayout: { x: 1030, y: 150 } },
                } satisfies BlueprintGraphNode,
                [notNullId]: {
                    id: notNullId,
                    type: BLUEPRINT_NODE_TYPE_DATA_NOT_NULL,
                    params: {},
                    meta: { editorLayout: { x: 540, y: 260 } },
                } satisfies BlueprintGraphNode,
                [ifId]: {
                    id: ifId,
                    type: BLUEPRINT_NODE_TYPE_FLOW_IF,
                    params: {},
                    meta: { editorLayout: { x: 780, y: 125 } },
                } satisfies BlueprintGraphNode,
                [showId]: {
                    id: showId,
                    type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY,
                    params: { property: "opacity", value: 100 },
                    meta: { editorLayout: { x: 1030, y: 70 } },
                } satisfies BlueprintGraphNode,
                [setTextId]: {
                    id: setTextId,
                    type: BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT,
                    params: {},
                    meta: { editorLayout: { x: 1270, y: 70 } },
                } satisfies BlueprintGraphNode,
                [hideId]: {
                    id: hideId,
                    type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY,
                    params: { property: "opacity", value: 0 },
                    meta: { editorLayout: { x: 1030, y: 220 } },
                } satisfies BlueprintGraphNode,
            },
            edges: [
                {
                    from: { nodeId: initHeadId, port: "then" },
                    to: { nodeId: ifId, port: "in" },
                },
                {
                    from: { nodeId: flushHeadId, port: "then" },
                    to: { nodeId: ifId, port: "in" },
                },
                {
                    from: { nodeId: conditionNametagId, port: "nametag" },
                    to: { nodeId: notNullId, port: "value" },
                },
                {
                    from: { nodeId: notNullId, port: "result" },
                    to: { nodeId: ifId, port: "condition" },
                },
                {
                    from: { nodeId: ifId, port: "true" },
                    to: { nodeId: showId, port: "in" },
                },
                {
                    from: { nodeId: showId, port: "next" },
                    to: { nodeId: setTextId, port: "in" },
                },
                {
                    from: { nodeId: textNametagId, port: "nametag" },
                    to: { nodeId: setTextId, port: "text" },
                },
                {
                    from: { nodeId: ifId, port: "false" },
                    to: { nodeId: hideId, port: "in" },
                },
            ],
            meta: { [BLUEPRINT_GRAPH_IR_META_KIND]: "event" },
        };
    }

    /**
     * On every dialog beat, push the speaking character's avatar into the image widget.
     *
     * `Get Speaker Avatar` answers off the live portrait, so it already carries the differential the
     * character is wearing; a line with no avatar answers null, which clears the widget rather than
     * leaving the previous speaker's face on screen.
     */
    private createAvatarUpdateGraph(): BlueprintGraphIr {
        const initHeadId = "avatar.update.init";
        const flushHeadId = "avatar.update.flush";
        const getAvatarId = "avatar.update.get";
        const setAssetId = "avatar.update.setImageAsset";
        return {
            nodes: {
                [initHeadId]: {
                    id: initHeadId,
                    type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
                    params: {},
                    meta: { editorLayout: { x: 80, y: 60 } },
                } satisfies BlueprintGraphNode,
                [flushHeadId]: {
                    id: flushHeadId,
                    type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH,
                    params: {},
                    meta: { editorLayout: { x: 80, y: 190 } },
                } satisfies BlueprintGraphNode,
                [getAvatarId]: {
                    id: getAvatarId,
                    type: BLUEPRINT_NODE_TYPE_GAME_GET_SPEAKER_AVATAR,
                    params: {},
                    meta: { editorLayout: { x: 300, y: 230 } },
                } satisfies BlueprintGraphNode,
                [setAssetId]: {
                    id: setAssetId,
                    type: BLUEPRINT_NODE_TYPE_IMAGE_SET_ASSET,
                    params: {},
                    meta: { editorLayout: { x: 580, y: 110 } },
                } satisfies BlueprintGraphNode,
            },
            edges: [
                {
                    from: { nodeId: initHeadId, port: "then" },
                    to: { nodeId: setAssetId, port: "in" },
                },
                {
                    from: { nodeId: flushHeadId, port: "then" },
                    to: { nodeId: setAssetId, port: "in" },
                },
                {
                    from: { nodeId: getAvatarId, port: "avatar" },
                    to: { nodeId: setAssetId, port: "asset" },
                },
            ],
            meta: { [BLUEPRINT_GRAPH_IR_META_KIND]: "event" },
        };
    }

    private configureDefaultDialogBlueprints(surfaceId: UISurfaceId, template: DialogStageTemplate): void {
        const localBp = this.getOptionalLocalBlueprintService();
        if (!localBp) {
            return;
        }

        const contentBlueprintId = localBp.ensureWidgetMain(
            surfaceId,
            template.stackId,
            translate("defaultDoc.dialog.content"),
            "nl.container",
        );
        const dialogNextEventId = "dialogNext";
        localBp.applyBlueprintMutation(doc => {
            const blueprint = doc.blueprints[contentBlueprintId];
            if (!blueprint || blueprint.program.kind !== "graph") {
                return;
            }
            blueprint.program.graphs.events = {
                [dialogNextEventId]: {
                    id: dialogNextEventId,
                    name: translate("defaultDoc.dialog.nextEvent"),
                    graph: this.createDialogContentNextGraph(surfaceId, {
                        interactionLayerId: template.interactionLayerId,
                        panelId: template.panelId,
                        avatarId: template.avatarId,
                        nametagId: template.nametagId,
                        sentenceId: template.sentenceId,
                    }),
                },
            };
        });

        const nametagBlueprintId = localBp.ensureWidgetMain(surfaceId, template.nametagId, translate("defaultDoc.dialog.nametag"), "nl.text");
        localBp.applyBlueprintMutation(doc => {
            const blueprint = doc.blueprints[nametagBlueprintId];
            if (!blueprint || blueprint.program.kind !== "graph") {
                return;
            }
            blueprint.program.graphs.events = {
                nametagUpdate: {
                    id: "nametagUpdate",
                    name: translate("defaultDoc.dialog.updateNametagEvent"),
                    graph: this.createNametagUpdateGraph(),
                },
            };
        });

        const avatarBlueprintId = localBp.ensureWidgetMain(surfaceId, template.avatarId, translate("defaultDoc.dialog.avatar"), "nl.image");
        localBp.applyBlueprintMutation(doc => {
            const blueprint = doc.blueprints[avatarBlueprintId];
            if (!blueprint || blueprint.program.kind !== "graph") {
                return;
            }
            blueprint.program.graphs.events = {
                avatarUpdate: {
                    id: "avatarUpdate",
                    name: translate("defaultDoc.dialog.updateAvatarEvent"),
                    graph: this.createAvatarUpdateGraph(),
                },
            };
        });
    }

    /** Resolves the default creation template (elements + blueprint seeding) for a Game UI slot. */
    private createStageSlotTemplate(
        slotId: UIStageSlotId,
        rootElement: UIElement,
        designSize: UISurfaceDesignSize,
    ): StageSlotTemplate | null {
        switch (slotId) {
            case "dialog": {
                const template = this.createDialogStageTemplate(rootElement, designSize);
                return {
                    elements: template.elements,
                    configure: surfaceId => this.configureDefaultDialogBlueprints(surfaceId, template),
                };
            }
            case "notification": {
                const template = this.createNotificationStageTemplate(rootElement, designSize);
                return {
                    elements: template.elements,
                    configure: () => this.configureDefaultNotificationBlueprints(template),
                };
            }
            case "choice": {
                const template = this.createChoiceStageTemplate(rootElement, designSize);
                return {
                    elements: template.elements,
                    configure: surfaceId => this.configureDefaultChoiceBlueprints(surfaceId, template),
                };
            }
            case "nvl": {
                const template = this.createNvlStageTemplate(rootElement, designSize);
                return {
                    elements: template.elements,
                    configure: surfaceId => this.configureDefaultNvlBlueprints(surfaceId, template),
                };
            }
            case "onStage":
                // On-Stage stays a bare transparent click-through root.
                return null;
        }
    }

    private createNotificationStageTemplate(
        rootElement: UIElement,
        designSize: UISurfaceDesignSize,
    ): NotificationStageTemplate {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const listId = uuidService.generate();
        const itemContainerId = uuidService.generate();
        const itemTextId = uuidService.generate();
        const listWidth = Math.round(designSize.width * 0.28);
        const listHeight = Math.round(designSize.height * 0.5);
        const itemWidth = Math.min(420, listWidth);

        rootElement.childrenIds = [listId];

        const list: UIElement = {
            id: listId,
            type: NOTIFICATION_LIST_WIDGET_TYPE,
            name: translate("defaultDoc.notification.list"),
            parentId: rootElement.id,
            childrenIds: [itemContainerId],
            layout: roundUILayoutGeometryFields({
                x: 24,
                y: 24,
                width: listWidth,
                height: listHeight,
                opacity: 1,
                visible: true,
            }),
            props: createListTemplateProps({
                itemStructId: UI_STRUCT_ID_NOTIFICATION_ITEM,
                itemKeyFieldId: "id",
                itemGap: 12,
                items: [
                    { id: "preview-1", message: translate("defaultDoc.notification.messageText") },
                    { id: "preview-2", message: translate("defaultDoc.notification.anotherMessage") },
                ],
                scrollbar: {
                    ...cloneJson(defaultListWidgetProps.scrollbar),
                    enabled: false,
                    visibility: "hidden",
                },
            }),
        };

        const itemContainer: UIElement = {
            id: itemContainerId,
            type: "nl.container",
            name: translate("defaultDoc.notification.item"),
            parentId: listId,
            childrenIds: [itemTextId],
            layout: roundUILayoutGeometryFields({
                x: 0,
                y: 0,
                width: itemWidth,
                height: 56,
                opacity: 1,
                visible: true,
            }),
            props: createContainerTemplateProps({
                layoutKind: "stack",
                stackDirection: "vertical",
                stackGap: 0,
                stackPaddingTop: 12,
                stackPaddingRight: 20,
                stackPaddingBottom: 12,
                stackPaddingLeft: 20,
                backgroundColor: "#0b0d12",
                fillOpacity: 0.72,
                borderRadius: 999,
                borderRadiusTL: 999,
                borderRadiusTR: 999,
                borderRadiusBL: 999,
                borderRadiusBR: 999,
                strokeVisible: false,
                borderWidth: 0,
                clipContent: true,
            }),
            extra: { listSlot: "itemTemplate" },
        };

        const itemText: UIElement = {
            id: itemTextId,
            type: "nl.text",
            name: translate("defaultDoc.notification.message"),
            parentId: itemContainerId,
            childrenIds: [],
            layout: roundUILayoutGeometryFields({
                x: 0,
                y: 0,
                width: Math.max(1, itemWidth - 40),
                height: 32,
                opacity: 1,
                visible: true,
            }),
            props: createTextTemplateProps({
                text: translate("defaultDoc.notification.messageText"),
                fontSize: 20,
                color: "#f8fafc",
                lineHeight: 1.3,
                textVerticalAlign: "center",
            }),
        };

        return {
            elements: {
                [list.id]: list,
                [itemContainer.id]: itemContainer,
                [itemText.id]: itemText,
            },
            listId,
            itemContainerId,
            itemTextId,
        };
    }

    private createChoiceStageTemplate(
        rootElement: UIElement,
        designSize: UISurfaceDesignSize,
    ): ChoiceStageTemplate {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const listId = uuidService.generate();
        const itemContainerId = uuidService.generate();
        const itemTextId = uuidService.generate();
        const listWidth = Math.round(designSize.width * 0.5);
        const listHeight = Math.round(designSize.height * 0.6);
        const listX = Math.round((designSize.width - listWidth) / 2);
        const listY = Math.round((designSize.height - listHeight) / 2);

        rootElement.childrenIds = [listId];

        const list: UIElement = {
            id: listId,
            type: CHOICE_LIST_WIDGET_TYPE,
            name: translate("defaultDoc.choice.list"),
            parentId: rootElement.id,
            childrenIds: [itemContainerId],
            layout: roundUILayoutGeometryFields({
                x: listX,
                y: listY,
                width: listWidth,
                height: listHeight,
                opacity: 1,
                visible: true,
            }),
            props: createListTemplateProps({
                itemStructId: UI_STRUCT_ID_CHOICE_ITEM,
                itemKeyFieldId: "index",
                itemGap: 16,
                items: [
                    { text: translate("defaultDoc.choice.previewA"), index: 0, disabled: false, voiceId: "" },
                    { text: translate("defaultDoc.choice.previewB"), index: 1, disabled: false, voiceId: "" },
                    { text: translate("defaultDoc.choice.previewC"), index: 2, disabled: true, voiceId: "" },
                ],
                scrollbar: {
                    ...cloneJson(defaultListWidgetProps.scrollbar),
                    enabled: false,
                    visibility: "hidden",
                },
            }),
        };

        const itemContainer: UIElement = {
            id: itemContainerId,
            type: "nl.container",
            name: translate("defaultDoc.choice.item"),
            parentId: listId,
            childrenIds: [itemTextId],
            layout: roundUILayoutGeometryFields({
                x: 0,
                y: 0,
                width: listWidth,
                height: 64,
                opacity: 1,
                visible: true,
            }),
            props: createContainerTemplateProps({
                layoutKind: "stack",
                stackDirection: "vertical",
                stackGap: 0,
                stackPaddingTop: 14,
                stackPaddingRight: 24,
                stackPaddingBottom: 14,
                stackPaddingLeft: 24,
                backgroundColor: "#f8fafc",
                fillOpacity: 0.92,
                borderRadius: 8,
                borderRadiusTL: 8,
                borderRadiusTR: 8,
                borderRadiusBL: 8,
                borderRadiusBR: 8,
                strokeVisible: false,
                borderWidth: 0,
                clipContent: true,
            }),
            extra: { listSlot: "itemTemplate" },
        };

        const itemText: UIElement = {
            id: itemTextId,
            type: "nl.text",
            name: translate("defaultDoc.choice.text"),
            parentId: itemContainerId,
            childrenIds: [],
            layout: roundUILayoutGeometryFields({
                x: 0,
                y: 0,
                width: Math.max(1, listWidth - 48),
                height: 36,
                opacity: 1,
                visible: true,
            }),
            props: createTextTemplateProps({
                text: translate("defaultDoc.choice.itemText"),
                fontSize: 24,
                color: "#0b0d12",
                lineHeight: 1.3,
                textAlign: "center",
                textVerticalAlign: "center",
            }),
        };

        return {
            elements: {
                [list.id]: list,
                [itemContainer.id]: itemContainer,
                [itemText.id]: itemText,
            },
            listId,
            itemContainerId,
            itemTextId,
        };
    }

    private createNvlStageTemplate(
        rootElement: UIElement,
        designSize: UISurfaceDesignSize,
    ): NvlStageTemplate {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const interactionLayerId = uuidService.generate();
        const panelId = uuidService.generate();
        const listId = uuidService.generate();
        const nametagId = uuidService.generate();
        const textsId = uuidService.generate();
        const panelWidth = Math.round(designSize.width * 0.86);
        const panelHeight = Math.round(designSize.height * 0.88);
        const panelX = Math.round((designSize.width - panelWidth) / 2);
        const panelY = Math.round(designSize.height * 0.06);
        const listInset = 32;
        const listWidth = Math.max(1, panelWidth - listInset * 2);
        const listHeight = Math.max(1, panelHeight - listInset * 2);

        rootElement.childrenIds = [interactionLayerId, panelId];

        const interactionLayer: UIElement = {
            id: interactionLayerId,
            type: "nl.container",
            name: translate("defaultDoc.nvl.interactionLayer"),
            parentId: rootElement.id,
            childrenIds: [],
            layout: roundUILayoutGeometryFields({
                x: 0,
                y: 0,
                width: designSize.width,
                height: designSize.height,
                opacity: 1,
                visible: true,
            }),
            props: createContainerTemplateProps({
                layoutKind: "free",
                backgroundColor: "transparent",
                fillVisible: false,
                fillOpacity: 0,
                strokeVisible: false,
                borderWidth: 0,
                stackPaddingTop: 0,
                stackPaddingRight: 0,
                stackPaddingBottom: 0,
                stackPaddingLeft: 0,
                clipContent: false,
            }),
        };

        const panel: UIElement = {
            id: panelId,
            type: "nl.container",
            name: translate("defaultDoc.nvl.panel"),
            parentId: rootElement.id,
            childrenIds: [listId],
            layout: roundUILayoutGeometryFields({
                x: panelX,
                y: panelY,
                width: panelWidth,
                height: panelHeight,
                opacity: 1,
                visible: true,
            }),
            props: createContainerTemplateProps({
                layoutKind: "free",
                backgroundColor: "#0b0d12",
                fillOpacity: 0.82,
                borderRadius: 12,
                borderRadiusTL: 12,
                borderRadiusTR: 12,
                borderRadiusBL: 12,
                borderRadiusBR: 12,
                strokeVisible: false,
                borderWidth: 0,
                clipContent: true,
            }),
        };

        const list: UIElement = {
            id: listId,
            type: NVL_LIST_WIDGET_TYPE,
            name: translate("defaultDoc.nvl.list"),
            parentId: panelId,
            childrenIds: [nametagId, textsId],
            layout: roundUILayoutGeometryFields({
                x: listInset,
                y: listInset,
                width: listWidth,
                height: listHeight,
                opacity: 1,
                visible: true,
            }),
            props: createListTemplateProps({
                itemStructId: UI_STRUCT_ID_NVL_ITEM,
                itemKeyFieldId: "index",
                itemGap: 18,
                templateDirection: "vertical",
                templateGap: 6,
                items: [
                    { nametag: translate("defaultDoc.speaker"), index: 0, isActive: false },
                    { nametag: "", index: 1, isActive: true },
                ],
            }),
        };

        const nametag: UIElement = {
            id: nametagId,
            type: "nl.text",
            name: translate("defaultDoc.nvl.nametag"),
            parentId: listId,
            childrenIds: [],
            layout: roundUILayoutGeometryFields({
                x: 0,
                y: 0,
                width: 320,
                height: 30,
                opacity: 1,
                visible: true,
            }),
            props: createTextTemplateProps({
                text: translate("defaultDoc.speaker"),
                fontSize: 20,
                color: "#f8d37a",
                fontWeight: "600",
                lineHeight: 1.2,
                textVerticalAlign: "center",
            }),
            extra: { listSlot: "itemTemplate" },
        };

        const texts: UIElement = {
            id: textsId,
            type: NVL_TEXTS_WIDGET_TYPE,
            name: translate("defaultDoc.nvl.texts"),
            parentId: listId,
            childrenIds: [],
            layout: roundUILayoutGeometryFields({
                x: 0,
                y: 0,
                width: Math.max(1, listWidth - 8),
                height: 64,
                opacity: 1,
                visible: true,
            }),
            props: createTextTemplateProps({
                text: translate("defaultDoc.nvl.entryText"),
                fontSize: 22,
                color: "#f8fafc",
                lineHeight: 1.5,
            }),
            extra: { listSlot: "itemTemplate" },
        };

        return {
            elements: {
                [interactionLayer.id]: interactionLayer,
                [panel.id]: panel,
                [list.id]: list,
                [nametag.id]: nametag,
                [texts.id]: texts,
            },
            interactionLayerId,
            panelId,
            listId,
            nametagId,
            textsId,
        };
    }

    /** Value graph: `Init -> Return Value` fed by `Get List Item Props -> Get JSON Field(propsPath)`. */
    private createListItemPropsValueGraph(propsPath: string): BlueprintGraphIr {
        const headId = "listItemValue.init";
        const getPropsId = "listItemValue.getItemProps";
        const getFieldId = "listItemValue.getField";
        const returnId = "listItemValue.return";
        return {
            nodes: {
                [headId]: {
                    id: headId,
                    type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
                    params: {},
                    meta: { editorLayout: { x: 80, y: 120 } },
                } satisfies BlueprintGraphNode,
                [getPropsId]: {
                    id: getPropsId,
                    type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_PROPS,
                    params: {},
                    meta: { editorLayout: { x: 300, y: 20 } },
                } satisfies BlueprintGraphNode,
                [getFieldId]: {
                    id: getFieldId,
                    type: BLUEPRINT_NODE_TYPE_DATA_JSON_GET,
                    params: { path: propsPath },
                    meta: { editorLayout: { x: 540, y: 30 } },
                } satisfies BlueprintGraphNode,
                [returnId]: {
                    id: returnId,
                    type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
                    params: {},
                    meta: { editorLayout: { x: 800, y: 120 } },
                } satisfies BlueprintGraphNode,
            },
            edges: [
                {
                    from: { nodeId: headId, port: "then" },
                    to: { nodeId: returnId, port: "in" },
                },
                {
                    from: { nodeId: getPropsId, port: "props" },
                    to: { nodeId: getFieldId, port: "json" },
                },
                {
                    from: { nodeId: getFieldId, port: "result" },
                    to: { nodeId: returnId, port: "value" },
                },
            ],
            meta: { [BLUEPRINT_GRAPH_IR_META_KIND]: "event" },
        };
    }

    /**
     * Creates a Blueprint Value binding on a template text element whose init graph reads the
     * current list item props field instead of a literal.
     */
    private seedListItemTextValueBinding(
        elementId: UIElementId,
        propsPath: string,
        displayName: string,
        literalValue: string,
    ): void {
        const localBp = this.getOptionalLocalBlueprintService();
        if (!localBp) {
            return;
        }
        const { blueprintId } = this.ensureElementBlueprintValueBinding(elementId, "text", {
            valueType: "string",
            displayName,
            literalValue,
        });
        localBp.applyBlueprintMutation(doc => {
            const blueprint = doc.blueprints[blueprintId];
            if (!blueprint || blueprint.program.kind !== "graph") {
                return;
            }
            const initEntry = blueprint.program.graphs.events?.init;
            if (!initEntry) {
                return;
            }
            initEntry.graph = this.createListItemPropsValueGraph(propsPath);
        });
    }

    /** Event graph: `Item Click(index) -> Select Choice(index)`. */
    private createChoiceSelectGraph(): BlueprintGraphIr {
        const itemClickHeadId = "choice.select.itemClick";
        const chooseId = "choice.select.choose";
        return {
            nodes: {
                [itemClickHeadId]: {
                    id: itemClickHeadId,
                    type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
                    params: {},
                    meta: { editorLayout: { x: 80, y: 60 } },
                } satisfies BlueprintGraphNode,
                [chooseId]: {
                    id: chooseId,
                    type: BLUEPRINT_NODE_TYPE_GAME_CHOOSE,
                    params: {},
                    meta: { editorLayout: { x: 560, y: 80 } },
                } satisfies BlueprintGraphNode,
            },
            edges: [
                {
                    from: { nodeId: itemClickHeadId, port: "then" },
                    to: { nodeId: chooseId, port: "in" },
                },
                {
                    from: { nodeId: itemClickHeadId, port: "index" },
                    to: { nodeId: chooseId, port: "index" },
                },
            ],
            meta: { [BLUEPRINT_GRAPH_IR_META_KIND]: "event" },
        };
    }

    /**
     * Event graph mirroring the Dialog advancement wiring for the NVL slot. Hosted on the NVL
     * Panel (`nl.container`) because collection widgets like `nl.nvl.list` do not expose a
     * `Mouse Click` head; the panel's own Mouse Click plus Element Click on the interaction layer
     * and the list cover every click region.
     */
    private createNvlNextGraph(
        surfaceId: UISurfaceId,
        targets: {
            interactionLayerId: UIElementId;
        },
    ): BlueprintGraphIr {
        // The panel's own Mouse Click catches every click inside the panel via DOM bubbling
        // (children re-dispatch but never DOM-stopPropagation); the interaction layer Element Click
        // catches clicks in the full-screen area outside the panel.
        const panelClickHeadId = "nvl.next.panelMouseClick";
        const spaceHeadId = "nvl.next.spaceKeyUp";
        const nextId = "nvl.next";
        const elementClickTargets = [
            {
                nodeId: "nvl.next.interactionLayerElementClick",
                elementId: targets.interactionLayerId,
                elementType: "nl.container",
                y: 210,
            },
        ] as const;
        const nodes: Record<string, BlueprintGraphNode> = {
            [panelClickHeadId]: {
                id: panelClickHeadId,
                type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
                params: {},
                meta: { editorLayout: { x: 80, y: 40 } },
            },
            [spaceHeadId]: {
                id: spaceHeadId,
                type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP,
                params: {
                    [BLUEPRINT_NODE_PARAM_EVENT_HEAD_KEY_NAME]: " ",
                },
                meta: { editorLayout: { x: 80, y: 550 } },
            },
            [nextId]: {
                id: nextId,
                type: BLUEPRINT_NODE_TYPE_GAME_NEXT,
                params: {},
                meta: { editorLayout: { x: 560, y: 295 } },
            },
        };
        const edges: NonNullable<BlueprintGraphIr["edges"]> = [
            {
                from: { nodeId: panelClickHeadId, port: "then" },
                to: { nodeId: nextId, port: "in" },
            },
            {
                from: { nodeId: spaceHeadId, port: "then" },
                to: { nodeId: nextId, port: "in" },
            },
        ];
        for (const target of elementClickTargets) {
            nodes[target.nodeId] = {
                id: target.nodeId,
                type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
                params: {
                    surfaceId,
                    elementId: target.elementId,
                    elementType: target.elementType,
                },
                meta: { editorLayout: { x: 80, y: target.y } },
            };
            edges.push({
                from: { nodeId: target.nodeId, port: "then" },
                to: { nodeId: nextId, port: "in" },
            });
        }
        return {
            nodes,
            edges,
            meta: { [BLUEPRINT_GRAPH_IR_META_KIND]: "event" },
        };
    }

    private configureDefaultNotificationBlueprints(template: NotificationStageTemplate): void {
        this.seedListItemTextValueBinding(
            template.itemTextId,
            "message",
            translate("defaultDoc.notification.message"),
            translate("defaultDoc.notification.messageText"),
        );
    }

    private configureDefaultChoiceBlueprints(surfaceId: UISurfaceId, template: ChoiceStageTemplate): void {
        const localBp = this.getOptionalLocalBlueprintService();
        if (!localBp) {
            return;
        }

        this.seedListItemTextValueBinding(template.itemTextId, "text", translate("defaultDoc.choice.text"), translate("defaultDoc.choice.itemText"));

        const listBlueprintId = localBp.ensureWidgetMain(
            surfaceId,
            template.listId,
            translate("defaultDoc.choice.list"),
            CHOICE_LIST_WIDGET_TYPE,
        );
        localBp.applyBlueprintMutation(doc => {
            const blueprint = doc.blueprints[listBlueprintId];
            if (!blueprint || blueprint.program.kind !== "graph") {
                return;
            }
            blueprint.program.graphs.events = {
                choiceSelect: {
                    id: "choiceSelect",
                    name: translate("defaultDoc.choice.selectEvent"),
                    graph: this.createChoiceSelectGraph(),
                },
            };
        });
    }

    private configureDefaultNvlBlueprints(surfaceId: UISurfaceId, template: NvlStageTemplate): void {
        const localBp = this.getOptionalLocalBlueprintService();
        if (!localBp) {
            return;
        }

        this.seedListItemTextValueBinding(template.nametagId, "nametag", translate("defaultDoc.nvl.nametag"), translate("defaultDoc.speaker"));

        // Advancement graph hosted on the Panel (nl.container) - collection widgets like the NVL
        // List do not expose a Mouse Click head.
        const panelBlueprintId = localBp.ensureWidgetMain(
            surfaceId,
            template.panelId,
            translate("defaultDoc.nvl.panel"),
            "nl.container",
        );
        localBp.applyBlueprintMutation(doc => {
            const blueprint = doc.blueprints[panelBlueprintId];
            if (!blueprint || blueprint.program.kind !== "graph") {
                return;
            }
            blueprint.program.graphs.events = {
                nvlNext: {
                    id: "nvlNext",
                    name: translate("defaultDoc.nvl.nextEvent"),
                    graph: this.createNvlNextGraph(surfaceId, {
                        interactionLayerId: template.interactionLayerId,
                    }),
                },
            };
        });
    }

    private ensureMainSurface(document: UIDocument): boolean {
        const designSize = this.getProjectDesignSize();
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const existingMain = document.surfaces.find(surface => surface.id === MAIN_APP_SURFACE_ID);
        let changed = false;
        if (existingMain) {
            if (!document.elements[existingMain.rootElementId]) {
                const rootElementId = uuidService.generate();
                existingMain.rootElementId = rootElementId;
                document.elements[rootElementId] = this.createRootElement(rootElementId, designSize);
                changed = true;
            }
            return changed;
        }

        const candidate = document.surfaces.find(surface => surface.kind === "appSurface");
        if (candidate) {
            candidate.id = MAIN_APP_SURFACE_ID;
            candidate.name = candidate.name || DEFAULT_APP_SURFACE_NAME;
            if (!document.elements[candidate.rootElementId]) {
                const rootElementId = uuidService.generate();
                candidate.rootElementId = rootElementId;
                document.elements[rootElementId] = this.createRootElement(rootElementId, designSize);
            }
            return true;
        }

        const rootElementId = uuidService.generate();
        const surface: UISurface = {
            id: MAIN_APP_SURFACE_ID,
            name: DEFAULT_APP_SURFACE_NAME,
            host: "app",
            kind: "appSurface",
            designSize: {
                width: designSize.width,
                height: designSize.height,
            },
            rootElementId,
            settings: createDefaultPageSurfaceSettings(),
        };

        document.elements[rootElementId] = this.createRootElement(rootElementId, designSize);
        document.surfaces.unshift(surface);
        return true;
    }

    private getDocumentPath(): string {
        return this.getContext().project.resolve(ProjectNameConvention.EditorUIDocument);
    }

    private async ensureDocumentDir(): Promise<void> {
        const fs = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const dir = this.getContext().project.resolve(ProjectNameConvention.EditorUI);
        const exists = await fs.isDirExists(dir);
        if (!exists.ok) {
            throw new RendererError(exists.error?.message || "Failed to access UI document directory");
        }
        if (!exists.data) {
            const created = await fs.createDir(dir);
            if (!created.ok) {
                throw new RendererError(created.error?.message || "Failed to create UI document directory");
            }
        }
    }
}
