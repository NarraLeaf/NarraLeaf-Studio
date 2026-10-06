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
    uiElementTypeAcceptsUserChildren,
    getUIStructuralChildSlot,
    getUIStructuralSlotPointerProp,
    getUIComponentLink,
    isLinkedUIComponentElement,
    isUIComponentTextParam,
    type UIComponentParam,
    type UIElementValueBinding,
    type UIPageParam,
} from "@shared/types/ui-editor/document";
import { getUIPageParams, normalizeUIPageParams, setActiveUIPageParams } from "@shared/types/ui-editor/pageParams";
import { entrySurfacePointerMisses, isEntrySurface, resolveEntrySurface } from "@shared/types/ui-editor/entrySurface";
import { buildUIComponentEditorSurfaceId, buildUIComponentSurfaceId } from "@shared/types/ui-editor/componentInstanceKey";
import { foldLegacyImageProps, UI_IMAGE_ELEMENT_TYPE } from "@shared/types/ui-editor/legacyImageProps";
import {
    migrateUITextSourcesV13,
    settleIncomingUITextSources,
    uiTextSiteWithOwnWords,
    UI_TEXT_SOURCES_SCHEMA_VERSION,
    type UITextArrivalConversion,
    type UITextCarriedKeys,
    type UITextMigrationChange,
} from "@shared/types/ui-editor/textSourceMigration";
import { readUITextSite, uiTextSitesOf, uiTextUnitId } from "@shared/types/ui-editor/textSource";
import { findUIComponentHoldingElement } from "@shared/types/ui-editor/componentTextParams";
import {
    mapCopiedUIComponentDefaultUnits,
    mapCopiedUIPageDefaultUnits,
    mapCopiedUITextUnits,
} from "@shared/types/ui-editor/textUnitCopies";
import type { LocalizationUnit } from "@shared/types/localization";
import type { LocalizationService } from "../localization/LocalizationService";
import {
    createCarriedTranslationPort,
    planCarriedTranslations,
    readProjectLocales,
    readProjectTranslations,
    writeCarriedTranslations,
    type CarriedTranslations,
} from "../localization/carriedTranslations";
import type { WorkspaceFreezeService } from "../core/WorkspaceFreezeService";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import type { LiveUIOp } from "@shared/live/ops";
import { applyUIParts, diffUIParts, uiPartsUpdates, type LiveUIParts } from "@shared/live/uiParts";
import { ProjectDocumentTooNewError } from "@shared/documents/newerSchema";
import { describeProjectDocumentTooNew } from "@shared/documents/tooNewMessage";
import { RendererError } from "@shared/utils/error";
import { i18nStore, translate } from "@/lib/i18n";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import { widgetDefaultWordsFor } from "@/lib/ui-editor/widget-modules/defaultWords";
import type { UIWidgetDefaultWords } from "@/lib/ui-editor/widget-modules/types";
import { roundUILayoutGeometryFields } from "@/lib/ui-editor/layout/roundLayoutGeometry";
import { reportWorkspaceAnomaly } from "@/lib/workspace/recovery/anomalyLog";
import { ProjectNameConvention } from "../../project/nameConvention";
import { Service } from "../Service";
import { IUIDocumentService, Services, WorkspaceContext } from "../services";
import { DEFAULT_AUTOSAVE_DELAY_MS, DEFAULT_AUTOSAVE_MAX_WAIT_MS, DebouncedSaver } from "../autosave/DebouncedSaver";
import { registerAutoSaver } from "../autosave/SaveStatusService";
import { storeWrite } from "../autosave/writeReport";
import { LocalBlueprintService } from "./LocalBlueprintService";
import { UIEditorHistoryService, cloneUIHistoryDocument } from "./UIEditorHistoryService";
import type { TranslationKey } from "@shared/i18n";
import { HistoryService } from "../history/HistoryService";
import type { HistoryLabel } from "../history/historyModel";
import { HistoryEntryTag, projectHistoryScope } from "../history/historyScopes";
import type { UIGraphService } from "./UIGraphService";
import {
    captureUILibraryRecords,
    insertUILibraryRecords,
    isEmptyUILibraryRecords,
    removeUILibraryBlueprints,
    removeUILibraryRecords,
    restoreUILibraryBlueprints,
    type UILibraryRecords,
} from "./uiLibraryRecords";
import {
    promoteElementToComponentRoot,
    resolveComponentRootPromotionRefusal,
    wrapComponentRootInContainer,
} from "./componentRootSwap";
import { UIDocumentContentRevisions } from "./uiDocumentContentRevisions";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { UuidService } from "../core/UuidService";
import type { UIService } from "../core/UIService";
import { isBlueprintEntryTabShowing } from "@/apps/workspace/modules/blueprint-lite/blueprintEntryTabId";
import { EventEmitter } from "../ui/EventEmitter";
import {
    applyGroupElements,
    applyPlannedMove,
    applyUngroupContainer,
    canUngroupContainer,
    collectSubtreeElementIds,
    filterToTopLevelMovers,
    layoutPatchForReparent,
    normalizeFlowChildLayout,
    normalizeFlowChildLayouts,
    normalizeListSlotsForMovedChildren,
    planGroupElements,
    planMoveElementsInSurface,
    type MoveUiElementsResult,
    type PlannedGroup,
} from "./uiDocumentTreeMove";
import { createGroupContainerProps } from "@/lib/ui-editor/widget-modules/builtin/container/groupProps";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import { parentTakesAddedElements } from "@/lib/ui-editor/tree/resolveAddTarget";
import type { UIEditorClipboardPayload } from "@/lib/ui-editor/commands/uiEditorClipboard";
import {
    cloneWidgetMainBlueprintForPaste,
    cloneWidgetValueBlueprintForPaste,
    remapElementValueBindingBlueprintIds,
} from "./blueprint/cloneBlueprintForPaste";
import { setPrivateOwnerBlueprint } from "./blueprint/ownerRecords";
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
    resolveUIStruct,
} from "@shared/types/ui-editor/builtinStructs";
import { coerceItemToStruct, type UIStructField } from "@shared/types/ui-editor/struct";
import {
    applyUIStructFieldsForOwner,
    applyUIStructShapeForOwner,
    pruneUIStructs,
    remapUIListFieldIds,
} from "@shared/types/ui-editor/structLibrary";
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
          /** A component editor step that moves the definition's placements too; see `UIEditorComponentDocumentSnapshot.placements`. */
          withPlacements?: boolean;
          /** What the step is called in the Edit menu, when it is more than an edit to the surface. */
          label?: HistoryLabel;
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

/** The container Group creates for a plan, before it is put in the tree. */
function createGroupElement(id: string, plan: PlannedGroup): UIElement {
    return {
        id,
        type: "nl.container",
        name: translate("widgets.defaults.group.name"),
        parentId: plan.parentId,
        childrenIds: [],
        layout: { ...plan.groupLayout, visible: true, opacity: 1 },
        props: createGroupContainerProps(plan.flow),
    };
}

/**
 * A component definition seen as a document of its own - one surface rooted at the component's root
 * - so the tree planners written for surfaces can read and edit its elements table in place.
 */
function componentAsDocument(document: UIDocument, component: UIComponentDefinition, surfaceId: string): UIDocument {
    return {
        ...document,
        surfaces: [
            {
                id: surfaceId,
                name: component.name,
                host: "app",
                kind: "appSurface",
                designSize: getComponentPreviewDesignSize(component),
                rootElementId: component.rootElementId,
            },
        ],
        elements: component.elements,
    };
}

function getComponentPreviewDesignSize(component: UIComponentDefinition): UISurfaceDesignSize {
    return {
        width: component.previewMeta?.width ?? DEFAULT_COMPONENT_SIZE.width,
        height: component.previewMeta?.height ?? DEFAULT_COMPONENT_SIZE.height,
    };
}

function cloneJson<T>(value: T): T {
    return value == null ? value : JSON.parse(JSON.stringify(value)) as T;
}

function createDuplicateName(baseName: string, existingNames: Set<string>, fallbackName = translate("defaultDoc.pageName")): string {
    const base = translate("defaultDoc.nameCopy", { name: baseName.trim() || fallbackName });
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
    const graphs = blueprint.graphs;
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

/**
 * What the Edit menu calls the step an import leaves: the page it added, or how many, and the
 * definitions only when no page came - a template's components arrive to serve its pages.
 */
function describeImportStep(surfaces: readonly UISurface[], components: readonly UIComponentDefinition[]): HistoryLabel {
    if (surfaces.length === 1) {
        return { key: "uiEditor.history.importSurface" as TranslationKey, params: { name: surfaces[0].name } };
    }
    if (surfaces.length > 1) {
        return { key: "uiEditor.history.importSurfaces" as TranslationKey, params: { count: surfaces.length } };
    }
    if (components.length === 1) {
        return { key: "uiEditor.history.importComponent" as TranslationKey, params: { name: components[0].name } };
    }
    return { key: "uiEditor.history.importComponents" as TranslationKey, params: { count: components.length } };
}

/** One template's fetched documents plus a resolved placement, ready to import.
 * `assetIdMap` maps the template's original asset ids to the ids they were
 * ingested under in this project; empty/undefined for asset-free templates. */
export type ImportTemplateBundleInput = {
    document: unknown;
    graphs: unknown;
    placement: ImportTemplatePlacement;
    assetIdMap?: Record<string, string>;
    /**
     * The words, and translations, of the keys the document's widgets name - for the ones this
     * project lacks, which arrive holding those words themselves (`settleIncomingUITextSources`).
     */
    textKeys?: UITextCarriedKeys;
    /**
     * What every language says about the words the document's widgets write directly, by unit id
     * under the ids the widgets have in `document` - a page copied in another window brings them.
     * Without it, widgets whose ids this project already translates (a page copied in this window)
     * take those translations.
     */
    translations?: CarriedTranslations;
    /**
     * Whether the import is one step on the project's undo stack, which takes back every page and
     * definition it added. On unless a caller's own flow goes on to change more than the import did
     * - the starter title page also moves the entry page and removes the blank one, and a step that
     * took back only its middle would leave the project with neither page.
     */
    history?: boolean;
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
        save: () => this.writeDocument(this.getDocument()),
        onError: err => console.warn("[UIDocumentService] auto-save failed", err),
    });
    private afterMutateHook: (() => void) | null = null;
    /** Where edits go instead of into the document, when something else owns them. See {@link UIOpSink}. */
    private opSink: UIOpSink | null = null;
    private historySuppressionDepth = 0;
    private readonly contentRevisions = new UIDocumentContentRevisions();
    /** What the v13 step changed that an author can see, until the workspace has said so. */
    private textSourceMigrationChanges: UITextMigrationChange[] = [];

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        const uuidService = ctx.services.get<UuidService>(Services.Uuid);
        // The translation library, because opening a document older than v13 writes the translation
        // edits its step makes there (see `migrateTextSources`).
        const localizationService = ctx.services.get<LocalizationService>(Services.Localization);
        await depend([filesystemService, projectService, uuidService, localizationService]);
        await registerAutoSaver(ctx, depend, "uiDocument", "workspace.shell.save.stores.uiDocument", this.autoSaver);
        // The pages' declared parameters are what the nodes that open a page grow inputs from, and
        // pin resolution reads them from the shared table rather than from this service. Every
        // route a document arrives or changes by announces it here, the first load included.
        this.events.on("documentChanged", document => setActiveUIPageParams(document.surfaces));

        await this.ensureDocumentDir();
        await this.load();
    }

    public getDocument(): UIDocument {
        if (!this.document) {
            throw new RendererError("UI document not initialized");
        }
        return this.document;
    }

    /**
     * The project's document: every page with its elements, and every component definition.
     *
     * The same object as {@link getDocument} here. It is its own method for the component editor,
     * whose document service answers `getDocument` with a view of one definition - the definition's
     * elements and none of the pages' - and answers this with the project's. Whatever asks where a
     * Page widget's page leads (what that page places, what its own Page widgets draw) asks this.
     */
    public getPageDocument(): UIDocument {
        return this.getDocument();
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
        const migrated = this.migrateIfNeeded(await this.migrateTextSources(result.data));
        this.document = migrated;
        const schemaChanged = result.data.schemaVersion !== migrated.schemaVersion;
        const normalizedChanged = loadedSnapshot !== JSON.stringify(migrated);
        const entrySurfaceChanged = this.ensureEntrySurface(this.document);
        const flowLayoutsChanged = normalizeFlowChildLayouts(this.document);
        const needsSave = schemaChanged || normalizedChanged || entrySurfaceChanged || flowLayoutsChanged;
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

    /**
     * Write `document` now instead of waiting for the auto-save.
     *
     * A write that fails is handed back to the auto-saver, which retries it on its backoff. This
     * cancels the saver's pending write because it supersedes it, and without handing it back the
     * change would wait for the author's next edit - while the save-failure notice, told this file
     * is one a saver retries, says it is being retried. Not before the document is loaded: a seed
     * written while the project opens has nothing for the saver to write, and its failure fails the
     * open.
     */
    public async save(document: UIDocument): Promise<void> {
        try {
            await this.writeDocument(document);
        } catch (error) {
            if (this.document) {
                this.autoSaver.schedule();
            }
            throw error;
        }
    }

    private async writeDocument(document: UIDocument): Promise<void> {
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
        return fs.writeFileNoFollowOrCreate(
            path,
            data,
            "utf-8",
            storeWrite("workspace.shell.save.stores.uiDocument", "retried"),
        );
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

    /**
     * Write several elements' layouts as one change: one `documentChanged` and one undo step.
     *
     * `mergeKey` folds this step into the previous one when that carried the same key and was
     * recorded within the merge window - how a run of arrow-key nudges stays a single undo.
     */
    public updateElementLayouts(
        layoutPatches: Record<string, Partial<UILayout>>,
        options: { mergeKey?: string } = {},
    ): void {
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
            history: surfaceId ? { surfaceId, mergeKey: options.mergeKey } : false,
        });
    }

    /**
     * `skipHistory` is for bookkeeping writes nobody asked for - an inspector filling in the
     * appearance keys an element predates, the moment it is selected. Recorded, that left an undo
     * step behind every first selection, so Ctrl+Z after looking around a page did nothing visible.
     */
    public updateElementProps(
        elementId: string,
        propsPatch: Record<string, unknown>,
        options: { skipHistory?: boolean } = {},
    ): void {
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
            history: surfaceId && !options.skipHistory
                ? {
                      surfaceId,
                      mergeKey: `props:${elementId}:${Object.keys(propsPatch).sort().join(",")}`,
                  }
                : false,
        });
    }

    /**
     * Every widget that reads its words from `keyName`, turned into one that holds `words` itself.
     *
     * What removing a key does to the widgets that use it: each keeps showing what it showed, and none
     * is left naming a key the project no longer has. Component definitions' widgets are included; an
     * instance holds none of its definition's words, but a text parameter's value it reads from the key
     * becomes the key's words, given directly (prop `param.<paramId>`). One change to the document,
     * outside any page's undo history, like the removal of the key it goes with. Returns each site it
     * converted, for the translations that go with the words (`ui:<elementId>.<prop>`).
     */
    public giveKeyedWidgetsTheirWords(keyName: string, words: string): { elementId: string; prop: string }[] {
        const converted: { elementId: string; prop: string }[] = [];
        this.mutateDocument(document => {
            const visit = (table: Record<string, UIElement>): void => {
                for (const element of Object.values(table)) {
                    // A placement that reads a text parameter's value from the key takes the key's
                    // words as the value it gives, translated through its own unit from now on.
                    const link = getUIComponentLink(element);
                    if (link?.paramKeys) {
                        const paramIds = Object.keys(link.paramKeys).filter(paramId => link.paramKeys?.[paramId] === keyName);
                        if (paramIds.length > 0) {
                            const params = { ...(link.params ?? {}) };
                            const paramKeys = { ...link.paramKeys };
                            for (const paramId of paramIds) {
                                params[paramId] = words;
                                delete paramKeys[paramId];
                                converted.push({ elementId: element.id, prop: `param.${paramId}` });
                            }
                            element.extra = {
                                ...(element.extra ?? {}),
                                componentLink: {
                                    componentId: link.componentId,
                                    linked: true,
                                    params,
                                    ...(Object.keys(paramKeys).length > 0 ? { paramKeys } : {}),
                                },
                            };
                        }
                    }
                    if (isLinkedUIComponentElement(element)) {
                        continue;
                    }
                    // Every site that reads the key: a plugin's widget can read several of its words
                    // from one.
                    for (const site of uiTextSitesOf(element.type)) {
                        if (!site.keyProp || site.role !== "words" || readUITextSite(element, site).key !== keyName) {
                            continue;
                        }
                        element.props = uiTextSiteWithOwnWords(element, site, words).props;
                        converted.push({ elementId: element.id, prop: site.textProp });
                    }
                }
            };
            visit(document.elements);
            for (const component of document.components ?? []) {
                visit(component.elements);
            }
        }, { history: false });
        return converted;
    }

    /**
     * Whether this project has a named key, for settling elements that arrive from elsewhere. A key
     * registry that has not been read answers yes for every key, so nothing is converted on a guess.
     */
    private readonly hasTextKey = (name: string): boolean => {
        let keys: Record<string, unknown> | undefined;
        try {
            keys = this.getContext().services.get<LocalizationService>(Services.Localization).getKeysIfLoaded()?.keys;
        } catch {
            keys = undefined;
        }
        return keys ? Object.prototype.hasOwnProperty.call(keys, name) : true;
    };

    /**
     * The translations of the keys arriving widgets were turned away from, filed under the widgets'
     * own units in this project's languages. `converted` carries the widgets' ids in this document.
     *
     * In the background: a language's library may still have to be read, and the elements have
     * arrived already. A language the keys came with no translation for gets none.
     */
    private adoptArrivingTranslations(converted: readonly UITextArrivalConversion[], carried: UITextCarriedKeys | undefined): void {
        if (!carried || converted.length === 0) {
            return;
        }
        let localization: LocalizationService;
        try {
            localization = this.getContext().services.get<LocalizationService>(Services.Localization);
        } catch {
            return;
        }
        const config = localization.getConfiguration();
        void (async () => {
            for (const { code } of config.locales) {
                if (code === config.sourceLocale) {
                    continue;
                }
                const set: Record<string, LocalizationUnit> = {};
                for (const site of converted) {
                    const unit = carried[site.keyName]?.translations?.[code];
                    if (unit?.target) {
                        set[uiTextUnitId(site.elementId, site.prop)] = { ...unit };
                    }
                }
                if (Object.keys(set).length === 0) {
                    continue;
                }
                try {
                    await localization.loadDocument(code);
                    localization.applyUnitEdits(code, { set, remove: [] });
                } catch (error) {
                    console.warn(`[UIDocumentService] could not bring translations into ${code}`, error);
                }
            }
        })();
    }

    /**
     * Give copied widgets the translations their originals' own words have, under the copies' ids.
     *
     * A widget's own words are translated through a unit named after the widget, so a copy - pasted,
     * duplicated, inside a duplicated page or component - would otherwise arrive translated in no
     * language. `table` is the arriving elements under their old ids, `idMap` what each became; `skip`
     * are the sites whose words came from a key this project lacks, which bring the key's translations
     * instead (`adoptArrivingTranslations`). `extra` are units owned by something other than an element
     * - a copied component's parameter defaults - already re-keyed, old id to new.
     *
     * `carried` is what a clipboard brought with it, which is what a paste from another project has
     * to go on, and a copy as it was when it was made. Without it the originals are this project's own
     * and their translations are read from its documents. Either way only languages this project
     * declares are written, a review is not inherited, and the write is not part of the paste's undo
     * step (`carriedTranslations.ts`).
     */
    private carryCopiedTranslations(
        table: Readonly<Record<string, UIElement>>,
        idMap: Readonly<Record<string, string>>,
        skip: readonly { elementId: string; prop: string }[],
        carried: CarriedTranslations | undefined,
        extra?: ReadonlyMap<string, string>,
    ): void {
        const units = new Map([...mapCopiedUITextUnits(table, idMap, skip), ...(extra ?? [])]);
        if (units.size === 0) {
            return;
        }
        let localization: LocalizationService;
        try {
            localization = this.getContext().services.get<LocalizationService>(Services.Localization);
        } catch {
            return;
        }
        const isFrozen = (): boolean => {
            try {
                return this.getContext().services.get<WorkspaceFreezeService>(Services.WorkspaceFreeze).isFrozen();
            } catch {
                return false;
            }
        };
        void (async () => {
            try {
                const translations = carried ?? await readProjectTranslations(localization, [...units.keys()]);
                if (!translations) {
                    return;
                }
                const plan = planCarriedTranslations(translations, units, new Set(readProjectLocales(localization)));
                if (plan.carried > 0) {
                    await writeCarriedTranslations(createCarriedTranslationPort(localization, isFrozen), plan);
                }
            } catch (error) {
                console.warn("[UIDocumentService] could not carry the copied widgets' translations", error);
            }
        })();
    }

    /**
     * The changes the v13 step made on opening this document that an author can see, handed over
     * once: the workspace tells the author about them in one notice, and a second ask is empty.
     */
    public takeTextSourceMigrationChanges(): UITextMigrationChange[] {
        const changes = this.textSourceMigrationChanges;
        this.textSourceMigrationChanges = [];
        return changes;
    }

    /**
     * The words a widget inserted into this project is given: in the project's source language, the
     * language its game is written in (`widgetDefaultWordsFor`).
     */
    private widgetDefaultWords(): UIWidgetDefaultWords {
        let sourceLocale: string | undefined;
        try {
            sourceLocale = this.getContext().services.get<LocalizationService>(Services.Localization).getConfiguration().sourceLocale;
        } catch {
            sourceLocale = undefined;
        }
        return widgetDefaultWordsFor(sourceLocale);
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

    /**
     * {@link setListItemStructFields} for a list inside a component definition, one step in the
     * definition's own history.
     *
     * The library's rules are the document's, not the page's: a shape another list names - on a page
     * or in any definition - is forked rather than reshaped (`applyUIStructFieldsForOwner` walks the
     * definitions too), and the pruning that follows counts what definitions name.
     */
    public setComponentListItemStructFields(componentId: string, elementId: string, fields: readonly UIStructField[]): void {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        this.mutateDocument(document => {
            const component = (document.components ?? []).find(item => item.id === componentId);
            const element = component?.elements[elementId];
            if (!component || !element || isLinkedUIComponentElement(element)) {
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
            component.updatedAt = new Date().toISOString();
            document.structs = pruneUIStructs({ ...document, structs: applied.structs });
        }, { history: this.componentHistory(componentId) });
    }

    /**
     * Give one list one of the engine's shapes, or (`null`) a shape of its own again.
     *
     * One step: the pointer, the rows read into the new shape, the list's key field and its item
     * template's field bindings moved to the field of the same name, and the library pruned. Undo takes
     * all of it back, the library included (`UIEditorHistoryService` slices the shapes a page names).
     */
    public setListItemStructShape(elementId: string, shapeId: string | null): void {
        const surfaceId = this.getElementSurfaceId(elementId);
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        this.mutateDocument(document => {
            const element = document.elements[elementId];
            if (!element || isLinkedUIComponentElement(element)) {
                return;
            }
            applyListItemStructShape(document, document.elements, element, shapeId, () => uuidService.generate());
        }, {
            history: surfaceId ? { surfaceId } : false,
        });
    }

    /** {@link setListItemStructShape} for a list inside a component definition, in its own history. */
    public setComponentListItemStructShape(componentId: string, elementId: string, shapeId: string | null): void {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        this.mutateDocument(document => {
            const component = (document.components ?? []).find(item => item.id === componentId);
            const element = component?.elements[elementId];
            if (!component || !element || isLinkedUIComponentElement(element)) {
                return;
            }
            if (applyListItemStructShape(document, component.elements, element, shapeId, () => uuidService.generate())) {
                component.updatedAt = new Date().toISOString();
            }
        }, { history: this.componentHistory(componentId) });
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
        const id = fieldId?.trim();
        this.setElementPlainValueBinding(elementId, propPath, id ? { kind: "listItemField", fieldId: id } : null);
    }

    /**
     * Show one of its page's text parameters in the words of an element on that page, or (`null`)
     * stop showing one. The page's counterpart of `setElementComponentParamBinding`: an element on a
     * Game UI, which declares no parameters, is left alone.
     */
    public setElementPageParamBinding(elementId: string, propPath: string, paramId: string | null): void {
        const surfaceId = this.getElementSurfaceId(elementId);
        const surface = surfaceId ? this.getDocument().surfaces.find(item => item.id === surfaceId) : undefined;
        if (surface?.kind !== "appSurface") {
            return;
        }
        const id = paramId?.trim();
        this.setElementPlainValueBinding(elementId, propPath, id ? { kind: "pageParam", paramId: id } : null);
    }

    /**
     * Bind one prop of one element on a surface to something that needs no blueprint - a field of its
     * list row, a text parameter of its page - or (`null`) unbind it. A Blueprint Value the prop was
     * bound to is torn down on the way (`clearElementBlueprintValueBinding`).
     */
    private setElementPlainValueBinding(
        elementId: string,
        propPath: string,
        binding: Extract<UIElementValueBinding, { kind: "listItemField" | "pageParam" }> | null,
    ): void {
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
            if (!binding) {
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
                [propPath]: binding,
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
        const removedBlueprintId = localBp.getWidgetValueBlueprintId(surfaceId, elementId, propPath);
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
        if (removedBlueprintId) {
            this.closeTabsShowingBlueprint(removedBlueprintId);
        }
    }

    /**
     * Close the editor tabs showing a value blueprint that clearing its binding has just removed.
     *
     * The blueprint is the binding's own - minted for this element's prop and named for it - but the
     * author writes their logic into it, so its removal is one step on the page's undo history above,
     * blueprint included. A tab left open on it said only that the blueprint could not be found, and
     * while it stayed the active editor the inspector's Ctrl+Z went to its stack instead of the page's,
     * so the step that would bring the logic back was out of reach from where the author was. Closed,
     * the page the binding belongs to is the editor the inspector edits again.
     */
    private closeTabsShowingBlueprint(blueprintId: string): void {
        const ui = this.getContext().services.get<UIService>(Services.UI);
        for (const tab of ui.editor.getAll()) {
            if (isBlueprintEntryTabShowing(tab, blueprintId)) {
                ui.editor.close(tab.id);
            }
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

    /**
     * Wrap elements in a new group - an invisible container that takes their place - and return the
     * group's id, or null when they cannot be wrapped (see `planGroupElements` for which can, and
     * for why nothing on screen moves).
     *
     * One mutation, so Undo puts the tree back as it was in one step.
     */
    public groupElements(surfaceId: string, elementIds: readonly string[]): string | null {
        const plan = planGroupElements(this.getDocument(), surfaceId, elementIds);
        if (!plan) {
            return null;
        }
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const group = createGroupElement(uuidService.generate(), plan);
        this.mutateDocument(document => {
            applyGroupElements(document, plan, group);
        }, {
            history: { surfaceId },
        });
        return group.id;
    }

    /**
     * Rename one layer.
     *
     * A linked component instance renames like any other layer: its name is copied from the
     * definition once, when the instance is placed, and is the instance's own from then on - it is
     * how the outline tells "save slot 1" from "save slot 2". Props and shape are what the definition
     * owns, and their own setters still refuse them on an instance.
     */
    public renameElement(elementId: string, name: string): void {
        const trimmed = name.trim();
        if (!trimmed) {
            return;
        }
        const surfaceId = this.getElementSurfaceId(elementId);
        this.mutateDocument(document => {
            const el = document.elements[elementId];
            if (!el || el.type === "nl.root") {
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
                ? historyService.captureSnapshot(historyOptions.surfaceId, { withPlacements: historyOptions.withPlacements })
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
                after: historyService.captureSnapshot(historyOptions.surfaceId, { withPlacements: historyOptions.withPlacements }),
                mergeKey: historyOptions.mergeKey,
                mergeWindowMs: historyOptions.mergeWindowMs,
                label: historyOptions.label,
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

    /**
     * Where an edit to a component definition is recorded: the definition's own undo stack, named by
     * the component editor's surface id (`UIEditorHistoryService` maps that to the definition's
     * scope). One stack per definition, so undoing in one component tab never touches another
     * definition or any page - and an instance on a page draws the definition from the library each
     * time, so putting the definition back puts every placement back with it.
     */
    private componentHistory(componentId: string, mergeKey?: string): UIDocumentMutationHistoryOptions {
        return { surfaceId: buildUIComponentEditorSurfaceId(componentId), mergeKey };
    }

    private getGraphService(): UIGraphService | null {
        try {
            return this.getContext().services.get<UIGraphService>(Services.UIGraph);
        } catch {
            return null;
        }
    }

    /**
     * One step on the project's undo stack, for an operation on the library as a whole - adding,
     * copying, deleting or importing pages and definitions.
     *
     * The project's stack rather than any editor's, for the reason {@link reorderSurfaces} gives:
     * these are made from the rail, and that is the stack Ctrl+Z and the Edit menu reach from there
     * (`resolveWorkspaceUndoScope`). A definition's own stack holds edits *inside* it, and a deleted
     * definition has no tab to press Ctrl+Z in.
     *
     * Each step is a command over whole records, not a snapshot of the library: whichever direction
     * runs reads the records as they stand at that moment and writes them back exactly, and nothing
     * else in the library is touched. Tagged, so a live session drops these steps with the interface
     * editors' stacks (`LiveSessionService`): taking back an addition after a session would remove
     * whatever the room built inside it.
     */
    private pushLibraryStep(label: HistoryLabel, step: { undo: () => void; redo: () => void }): void {
        let history: HistoryService;
        try {
            history = this.getContext().services.get<HistoryService>(Services.History);
        } catch {
            return;
        }
        history.pushCommand(projectHistoryScope(), { label, ...step, tag: HistoryEntryTag.UILibrary });
    }

    /**
     * Take pages and definitions out of the project, and return them as they stood.
     *
     * Empty when nothing left this copy of the document - ids it does not hold, or an operation sink
     * that took the gesture: inside a live session the removal arrives as an effect later, the
     * lifecycle sweep collects the blueprints then, and undo is the session's.
     */
    private takeLibraryRecords(ids: { surfaceIds?: readonly string[]; componentIds?: readonly string[] }): UILibraryRecords {
        const graph = this.getGraphService();
        const records = captureUILibraryRecords(this.getDocument(), graph?.getDocument().blueprintDocument ?? null, ids);
        if (isEmptyUILibraryRecords(records)) {
            return records;
        }
        this.mutateDocument(document => removeUILibraryRecords(document, records), { history: false });
        const document = this.getDocument();
        const stillHere =
            records.surfaces.some(record => document.surfaces.some(surface => surface.id === record.surface.id))
            || records.components.some(record => (document.components ?? []).some(component => component.id === record.component.id));
        if (stillHere) {
            return { surfaces: [], components: [] };
        }
        // The sweep that followed the write has already collected them where it is wired; this makes
        // the two documents agree where it is not, and writes nothing when there is nothing left.
        const left = [...records.surfaces, ...records.components].some(record =>
            Object.keys(record.blueprint.ownerRecords).some(key => graph?.getDocument().blueprintDocument.ownerRecords[key]));
        if (graph && left) {
            graph.applyGraphMutation(next => {
                removeUILibraryBlueprints(next.blueprintDocument, records);
                assertValidBlueprintDocument(next.blueprintDocument);
            });
        }
        return records;
    }

    /**
     * Put records {@link takeLibraryRecords} returned back where they stood.
     *
     * Blueprints first: the sweep that follows the document write gives a widget with no blueprint a
     * fresh, empty one, and it must find each record's own already in place.
     */
    private putLibraryRecords(records: UILibraryRecords): void {
        if (isEmptyUILibraryRecords(records)) {
            return;
        }
        this.getGraphService()?.applyGraphMutation(document => {
            restoreUILibraryBlueprints(document.blueprintDocument, records);
            assertValidBlueprintDocument(document.blueprintDocument);
        });
        this.mutateDocument(document => insertUILibraryRecords(document, records), { history: false });
    }

    /**
     * Leave the step that takes back pages and definitions an operation just added.
     *
     * Nothing is recorded when none of them is in this copy of the document, which is what an
     * operation sink taking the gesture looks like (the reasoning {@link reorderSurfaces} gives).
     */
    private recordLibraryAddition(
        ids: { surfaceIds: readonly string[]; componentIds: readonly string[] },
        label: HistoryLabel,
    ): void {
        const document = this.getDocument();
        const arrived =
            ids.surfaceIds.some(id => document.surfaces.some(surface => surface.id === id))
            || ids.componentIds.some(id => (document.components ?? []).some(component => component.id === id));
        if (!arrived) {
            return;
        }
        let held: UILibraryRecords = { surfaces: [], components: [] };
        this.pushLibraryStep(label, {
            undo: () => {
                held = this.takeLibraryRecords(ids);
            },
            redo: () => this.putLibraryRecords(held),
        });
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
        return this.normalizePageParams(
            this.normalizeLegacyImageProps(this.normalizeInputModel(this.migrateSchemaVersion(document))),
        );
    }

    /**
     * Every page's declared parameters, in the shape this build reads (`normalizeUIPageParams`).
     *
     * A normalizer for the reason {@link normalizeInputModel} is one: an empty list and no list mean
     * the same thing, so a page that declares none keeps its record as short as it was. A Game UI's
     * are dropped - the player mounts it with nothing, so nothing could ever fill them.
     */
    private normalizePageParams(document: UIDocument): UIDocument {
        for (const surface of document.surfaces) {
            if (!("params" in surface)) {
                continue;
            }
            const params = surface.kind === "appSurface" ? normalizeUIPageParams(surface.params) : [];
            if (params.length > 0) {
                (surface as { params?: UIPageParam[] }).params = params;
            } else {
                delete (surface as { params?: unknown }).params;
            }
        }
        return document;
    }

    /**
     * The v13 step, for the project's own document as it is opened (`textSourceMigration.ts`).
     *
     * Not part of {@link migrateIfNeeded}, which is also how a template or a page copied from another
     * project comes in: this step reads the project's key registry and translation files, and the
     * translation edits it makes are written here, through the localization service, before the
     * document itself is saved by `load`. Written first so that a document still at v12 on disk -
     * its own save failed - is migrated again on the next open, and the edits are such that applying
     * them twice changes nothing.
     *
     * A key registry or a language file that cannot be read stops the open rather than being read
     * as empty: an element whose key could not be found is turned into one that holds its own words,
     * and a registry that is merely unreadable today would turn every keyed element in the project
     * into one, for good.
     */
    private async migrateTextSources(document: UIDocument): Promise<UIDocument> {
        const version = document.schemaVersion;
        if (
            typeof version !== "number"
            || version >= UI_TEXT_SOURCES_SCHEMA_VERSION
            || version < UI_DOCUMENT_MIN_SUPPORTED_VERSION
        ) {
            // Current, or one `migrateSchemaVersion` is about to refuse.
            return document;
        }
        const localization = this.getContext().services.get<LocalizationService>(Services.Localization);
        const config = localization.getConfiguration();
        const keys = await localization.loadKeys();
        const translations: Record<string, Record<string, LocalizationUnit>> = {};
        for (const { code } of config.locales) {
            if (code !== config.sourceLocale) {
                translations[code] = (await localization.loadDocument(code)).units;
            }
        }
        const result = migrateUITextSourcesV13(document, {
            keys: Object.fromEntries(Object.entries(keys.keys).map(([name, key]) => [name, key.sourceText])),
            sourceLocale: config.sourceLocale,
            translations,
        });
        this.textSourceMigrationChanges = result.changes;
        const edits = Object.entries(result.localeEdits);
        if (edits.length > 0) {
            for (const [locale, edit] of edits) {
                localization.applyUnitEdits(locale, edit);
            }
            await localization.flushPendingChanges();
        }
        return result.document;
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
            // Both version numbers, in the one wording every reader of a too-new project document
            // uses. Without them the failure screen said only that the file was newer, which cannot
            // tell an author a damaged file from a project a newer Studio has already opened - and
            // those two call for opposite actions.
            const refusal = new ProjectDocumentTooNewError(
                "uiDocument",
                ProjectNameConvention.EditorUIDocument.join("/"),
                document.schemaVersion,
                UI_DOCUMENT_SCHEMA_VERSION,
            );
            throw new RendererError(
                describeProjectDocumentTooNew(refusal, i18nStore.getLocale()),
                { cause: refusal },
            );
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

    /**
     * Remove a surface and its tree. The entry page is refused: a game has to start somewhere, and
     * the way to delete the page it starts on is to make another page the entry first.
     */
    public deleteSurface(surfaceId: string): void {
        if (isEntrySurface(this.getDocument(), surfaceId)) {
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
            tag: HistoryEntryTag.UILibrary,
        });
    }

    /**
     * Make this page the one the game starts on.
     *
     * Only a page can be the entry - a Game UI has nothing to show before a story runs - and asking
     * for the page that already is changes nothing and records nothing. The pages keep their ids:
     * the document stores which one is the entry (`UIDocument.entrySurfaceId`), so every blueprint
     * and every `Go Page` that names either page still names the same page afterwards.
     *
     * On the project stack, for the reason {@link reorderSurfaces} gives: it is an edit to no one
     * surface, made from the panel. The entry restores to what the file stored rather than to the
     * page that was resolved, so taking this back leaves a document that never named an entry as
     * short as it was.
     */
    public setEntrySurface(surfaceId: string): void {
        const document = this.getDocument();
        const target = document.surfaces.find(surface => surface.id === surfaceId);
        if (!target || target.kind !== "appSurface" || isEntrySurface(document, surfaceId)) {
            return;
        }
        const before = document.entrySurfaceId;
        this.applyEntrySurface(surfaceId);
        const after = this.getDocument().entrySurfaceId;
        // An operation sink took the gesture and this copy of the document has not changed yet.
        if (after === before) {
            return;
        }
        this.getContext().services.get<HistoryService>(Services.History).pushCommand(projectHistoryScope(), {
            label: { key: "uiEditor.history.setEntryPage" as TranslationKey, params: { name: target.name } },
            undo: () => this.applyEntrySurface(before),
            redo: () => this.applyEntrySurface(after),
            tag: HistoryEntryTag.UILibrary,
        });
    }

    private applyEntrySurface(surfaceId: string | undefined): void {
        this.mutateDocument(document => {
            if (surfaceId) {
                document.entrySurfaceId = surfaceId;
            } else {
                delete document.entrySurfaceId;
            }
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
                const sourceBlueprint = sourceBlueprintDocument.blueprints[ownerRecord.blueprintId];
                const owner = sourceBlueprint?.owner;
                if (!owner || !remapDuplicatedBlueprintOwner(owner, {
                    oldSurfaceId: sourceSurface.id,
                    newSurfaceId,
                    elementIdMap,
                    blueprintIdMap: {},
                })) {
                    continue;
                }
                ownerRecordsToClone[ownerKey] = cloneJson(ownerRecord);
                if (!blueprintIdMap[ownerRecord.blueprintId]) {
                    blueprintIdMap[ownerRecord.blueprintId] = uuidService.generate();
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
                const newBlueprintId = blueprintIdMap[sourceOwnerRecord.blueprintId];
                const sourceBlueprint = sourceBlueprintDocument?.blueprints[sourceOwnerRecord.blueprintId];
                if (!newBlueprintId || !sourceBlueprint) {
                    continue;
                }
                const newOwner = remapDuplicatedBlueprintOwner(sourceBlueprint.owner, remapContext);
                if (!newOwner) {
                    continue;
                }
                // The encoder, not a chain that reproduces it. Two of these had grown here, both
                // handling exactly the three kinds `remapDuplicatedBlueprintOwner` can return - so
                // the trailing branch was unreachable, and the format was written out in a third
                // and fourth place that could drift from it.
                const newOwnerKey = ownerRefToIndexKey(newOwner);
                const clonedBlueprint = cloneBlueprintForSurfaceDuplicate(sourceBlueprint, newBlueprintId, remapContext);
                if (!clonedBlueprint) {
                    continue;
                }
                bpDoc.blueprints[newBlueprintId] = clonedBlueprint;
                bpDoc.ownerRecords[newOwnerKey] = { blueprintId: newBlueprintId };
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
        // The copies' own words, translated as the originals' are, and the page's parameter defaults.
        this.carryCopiedTranslations(
            sourceDocument.elements,
            elementIdMap,
            [],
            undefined,
            mapCopiedUIPageDefaultUnits([sourceSurface], { [sourceSurface.id]: duplicatedSurface.id }),
        );

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
        const migratedSource = this.migrateIfNeeded(this.coerceIncomingUIDocument(input.document));
        // Text is settled the way this project stores it, against this project's keys - which is all a
        // template or a page from elsewhere can be settled against.
        const arrivals: UITextArrivalConversion[] = [];
        const settle = (table: Record<string, UIElement>): Record<string, UIElement> => {
            const settled = settleIncomingUITextSources(table, { hasKey: this.hasTextKey, carried: input.textKeys });
            arrivals.push(...settled.converted);
            return settled.table;
        };
        const sourceDocument: UIDocument = {
            ...migratedSource,
            elements: settle(migratedSource.elements),
            ...(migratedSource.components
                ? { components: migratedSource.components.map(component => ({ ...component, elements: settle(component.elements) })) }
                : {}),
        };
        /** Every arriving element's id in this document, by its id in the source. */
        const arrivedIds: Record<string, string> = {};

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

        // A template is a document of its own, and a document always has a page under the main id -
        // the empty one it was created with, which is not what the template is offering. A copied
        // page has nothing else in its payload: whatever page it was, it arrives as a page of this
        // project under an id of its own (every id below is regenerated), and never as the entry.
        const importable = input.placement === IMPORT_PLACEMENT_FROM_SOURCE
            ? sourceDocument.surfaces
            : sourceDocument.surfaces.filter(surface => surface.id !== MAIN_APP_SURFACE_ID);
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
            arrivedIds,
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
                arrivedIds,
            );
            if (imported) {
                importedSurfaces.push(imported);
            }
        }

        this.adoptArrivingTranslations(
            arrivals
                .filter(site => arrivedIds[site.elementId])
                .map(site => ({ ...site, elementId: arrivedIds[site.elementId] })),
            input.textKeys,
        );
        this.carryCopiedTranslations(
            {
                ...sourceDocument.elements,
                ...Object.assign({}, ...(sourceDocument.components ?? []).map(component => component.elements)),
            },
            arrivedIds,
            arrivals,
            input.translations,
            new Map([
                ...mapCopiedUIComponentDefaultUnits(sourceDocument.components ?? [], componentIdMap),
                ...mapCopiedUIPageDefaultUnits(sourceDocument.surfaces, surfaceIdMap),
            ]),
        );
        if (input.history !== false) {
            // One step for everything the bundle added: its pages and its definitions, with their
            // blueprints. Files the caller brought into the asset library first, and the translations
            // filed above, stay in the project - undoing leaves them unused, and redoing finds them.
            this.recordLibraryAddition(
                {
                    surfaceIds: importedSurfaces.map(surface => surface.id),
                    componentIds: importedComponents.map(component => component.id),
                },
                describeImportStep(importedSurfaces, importedComponents),
            );
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
        /** Filled with each copied element's new id, by its id in the source. */
        idSink?: Record<string, string>,
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
            if (idSink) {
                Object.assign(idSink, elementIdMap);
            }

            const blueprintIdMap: Record<string, string> = {};
            if (sourceBlueprintDocument) {
                for (const [blueprintId, blueprint] of Object.entries(sourceBlueprintDocument.blueprints)) {
                    if (anchorComponentId(blueprint.owner) === source.id) {
                        blueprintIdMap[blueprintId] = uuidService.generate();
                    }
                }
            }

            // A component's elements live outside any surface. The surface fields reach the
            // element references in the component's own blueprints, which name the definition's
            // surface under either of its two spellings (`normalizeUIElementRefSurfaceId`): each
            // is carried over to the copy under the spelling it had.
            const remapContext: SurfaceDuplicateRemapContext = {
                oldSurfaceId: buildUIComponentEditorSurfaceId(source.id),
                newSurfaceId: buildUIComponentEditorSurfaceId(newComponentId),
                surfaceIdMap: { [buildUIComponentSurfaceId(source.id)]: buildUIComponentSurfaceId(newComponentId) },
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
                    setPrivateOwnerBlueprint(bpDoc, ownerKey, blueprint.id);
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
        /** Filled with each copied element's new id, by its id in the source. */
        idSink?: Record<string, string>,
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
        if (idSink) {
            Object.assign(idSink, elementIdMap);
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
                const sourceBlueprint = sourceBlueprintDocument.blueprints[ownerRecord.blueprintId];
                const owner = sourceBlueprint?.owner;
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
                if (!blueprintIdMap[ownerRecord.blueprintId]) {
                    blueprintIdMap[ownerRecord.blueprintId] = uuidService.generate();
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

        const sourcePageParams = getUIPageParams(sourceSurface);
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
                // What the page is opened with comes along with it: the lists on it and the graphs
                // copied beside it read those names, and the nodes that open it grow inputs from them.
                ...(sourcePageParams.length > 0 ? { params: sourcePageParams } : {}),
            };

        localBp?.applyBlueprintMutation(bpDoc => {
            for (const sourceOwnerRecord of Object.values(ownerRecordsToClone)) {
                const newBlueprintId = blueprintIdMap[sourceOwnerRecord.blueprintId];
                const sourceBlueprint = sourceBlueprintDocument?.blueprints[sourceOwnerRecord.blueprintId];
                if (!newBlueprintId || !sourceBlueprint) {
                    continue;
                }
                const newOwner = remapDuplicatedBlueprintOwner(sourceBlueprint.owner, remapContext);
                if (!newOwner) {
                    continue;
                }
                // The encoder, not a chain that reproduces it. Two of these had grown here, both
                // handling exactly the three kinds `remapDuplicatedBlueprintOwner` can return - so
                // the trailing branch was unreachable, and the format was written out in a third
                // and fourth place that could drift from it.
                const newOwnerKey = ownerRefToIndexKey(newOwner);
                const clonedBlueprint = cloneBlueprintForSurfaceDuplicate(sourceBlueprint, newBlueprintId, remapContext);
                if (!clonedBlueprint) {
                    continue;
                }
                bpDoc.blueprints[newBlueprintId] = clonedBlueprint;
                bpDoc.ownerRecords[newOwnerKey] = { blueprintId: newBlueprintId };
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
        this.recordLibraryAddition(
            { surfaceIds: [], componentIds: [component.id] },
            { key: "uiEditor.history.createComponent" as TranslationKey, params: { name: component.name } },
        );
        return component;
    }

    /**
     * A new definition made of copies of elements on a page, with the logic they carry.
     *
     * The page is not changed, so the step that takes this back is the library's - the project's
     * stack, the one {@link createEmptyComponent} uses - rather than the page's.
     */
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
                const sourceBlueprintId = blueprintDocument.ownerRecords[ownerKey]?.blueprintId;
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
            // Element references the carried logic makes to the page now point into the definition,
            // and are stored under its own surface: the one the runtime compares them against.
            const remapContext: SurfaceDuplicateRemapContext = {
                oldSurfaceId: surfaceId,
                newSurfaceId: buildUIComponentSurfaceId(componentId),
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
                    setPrivateOwnerBlueprint(bpDoc, ownerKey, blueprint.id);
                }
            });
        }
        this.recordLibraryAddition(
            { surfaceIds: [], componentIds: [component.id] },
            { key: "uiEditor.history.createComponent" as TranslationKey, params: { name: component.name } },
        );
        return component;
    }

    /** Recorded in the definition's own undo stack, as a page's name is in the page's. */
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
        }, { history: this.componentHistory(componentId, `component:${componentId}:name`) });
    }

    /**
     * Replace a component's declared params.
     *
     * Instances keep values for ids that survive: a param is identified by `id`, so renaming one in
     * the inspector does not unset it anywhere. Values for ids that were removed are left on their
     * instances rather than swept - re-adding a param by the same id is how an author undoes a
     * deletion, and sweeping would make that a data loss with no warning. That is also why undoing
     * this - one step in the definition's own stack - needs nothing from the instances: their values
     * were never touched, so the restored declaration finds them where it left them.
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
                    type: isUIComponentTextParam(param) ? ("text" as const) : ("string" as const),
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
        }, { history: this.componentHistory(componentId) });
    }

    /**
     * Replace the parameters a page declares.
     *
     * A parameter is identified by `id`, so the nodes that open the page and the `Get Page Param`
     * nodes that read it keep pointing at it through a rename. What reads it by name - the key its
     * value travels under - is followed in the same step where it lives on the page itself: a list on
     * the page bound to the old name is bound to the new one. Anything elsewhere that names it (a Page
     * widget on another page giving it a value, a script) is left alone, because this page's undo must
     * not reach into another page; the project check reports those.
     *
     * A removed parameter's values are not swept from anywhere, as a component's are not: re-adding it
     * is how an author takes a deletion back.
     */
    public setPageParams(surfaceId: string, params: UIPageParam[]): void {
        const surface = this.getDocument().surfaces.find(item => item.id === surfaceId);
        if (!surface || surface.kind !== "appSurface") {
            return;
        }
        const before = normalizeUIPageParams(surface.params);
        const next = normalizeUIPageParams(params);
        const renamed = new Map<string, string>();
        for (const param of next) {
            const previous = before.find(item => item.id === param.id);
            if (previous && previous.name !== param.name) {
                renamed.set(previous.name, param.name);
            }
        }
        this.mutateDocument(document => {
            const target = document.surfaces.find(item => item.id === surfaceId);
            if (!target || target.kind !== "appSurface") {
                return;
            }
            if (next.length > 0) {
                target.params = next;
            } else {
                delete target.params;
            }
            if (renamed.size === 0) {
                return;
            }
            for (const elementId of collectSubtreeElementIds(document, target.rootElementId)) {
                const element = document.elements[elementId];
                const binding = element?.props?.itemsBinding as { kind?: unknown; key?: unknown } | undefined;
                if (!element || !isListLikeWidgetType(element.type) || binding?.kind !== "pageProp" || typeof binding.key !== "string") {
                    continue;
                }
                const nextKey = renamed.get(binding.key);
                if (nextKey !== undefined) {
                    element.props = { ...element.props, itemsBinding: { ...binding, key: nextKey } };
                }
            }
        }, { history: { surfaceId } });
    }

    /**
     * Set one param value on one instance. An empty string is a value, not a reset.
     *
     * Words written for a text parameter replace a key the instance named for it: a value holds one
     * or the other (`UIComponentLink.paramKeys`).
     */
    public setComponentInstanceParam(elementId: string, paramId: string, value: string): void {
        const surfaceId = this.getElementSurfaceId(elementId);
        this.mutateDocument(document => {
            const element = document.elements[elementId];
            const link = getUIComponentLink(element);
            if (!element || !link) {
                return;
            }
            const { [paramId]: _droppedKey, ...paramKeys } = link.paramKeys ?? {};
            const { paramKeys: _keys, ...rest } = link;
            element.extra = {
                ...(element.extra ?? {}),
                componentLink: {
                    ...rest,
                    params: { ...(link.params ?? {}), [paramId]: value },
                    ...(Object.keys(paramKeys).length > 0 ? { paramKeys } : {}),
                },
            };
        }, {
            history: surfaceId ? { surfaceId, mergeKey: `component-param:${elementId}:${paramId}` } : false,
        });
    }

    /**
     * Name the translation key one instance's text parameter is read from, or (`null`) name none.
     *
     * Naming a key removes the words the instance held for the parameter - a value holds one source -
     * and naming none leaves the parameter with neither, which falls back to the definition's default.
     */
    public setComponentInstanceParamKey(elementId: string, paramId: string, keyName: string | null): void {
        const surfaceId = this.getElementSurfaceId(elementId);
        this.mutateDocument(document => {
            const element = document.elements[elementId];
            const link = getUIComponentLink(element);
            if (!element || !link) {
                return;
            }
            const { [paramId]: _droppedWords, ...params } = link.params ?? {};
            const { [paramId]: _droppedKey, ...paramKeys } = link.paramKeys ?? {};
            const name = keyName?.trim();
            if (name) {
                paramKeys[paramId] = name;
            }
            element.extra = {
                ...(element.extra ?? {}),
                componentLink: {
                    componentId: link.componentId,
                    linked: true,
                    ...(Object.keys(params).length > 0 ? { params } : {}),
                    ...(Object.keys(paramKeys).length > 0 ? { paramKeys } : {}),
                },
            };
        }, {
            history: surfaceId ? { surfaceId, mergeKey: `component-param:${elementId}:${paramId}` } : false,
        });
    }

    /**
     * Remove definitions from the library, as one step on the project's undo stack.
     *
     * Placements of them on pages are left as they are, and draw as missing until the definition is
     * back or they are replaced. Undo puts each definition back at its place in the library with its
     * widgets' blueprints and the item shapes its lists name, and every placement draws it again.
     */
    public deleteComponents(componentIds: string[]): void {
        const ids = [...new Set(componentIds)];
        if (ids.length === 0) {
            return;
        }
        let held = this.takeLibraryRecords({ componentIds: ids });
        if (isEmptyUILibraryRecords(held)) {
            return;
        }
        const label: HistoryLabel = held.components.length === 1
            ? { key: "uiEditor.history.deleteComponent" as TranslationKey, params: { name: held.components[0].component.name } }
            : { key: "uiEditor.history.deleteComponents" as TranslationKey, params: { count: held.components.length } };
        this.pushLibraryStep(label, {
            undo: () => this.putLibraryRecords(held),
            redo: () => {
                held = this.takeLibraryRecords({ componentIds: ids });
            },
        });
    }

    /** One copy of a definition; see {@link duplicateComponents}. */
    public duplicateComponent(componentId: string): UIComponentDefinition | null {
        return this.duplicateComponents([componentId])[0] ?? null;
    }

    /**
     * A copy of each definition, added to the end of the library, as one step on the project's undo
     * stack. The copies' translations are written in the background and are not part of the step:
     * undoing leaves them unused, and redoing finds them again (`carryCopiedTranslations`).
     */
    public duplicateComponents(componentIds: readonly string[]): UIComponentDefinition[] {
        const copies: UIComponentDefinition[] = [];
        // The step is named after what was copied, not after the copy: "duplicate component Save slot".
        const sourceNames: string[] = [];
        for (const componentId of componentIds) {
            const name = this.getComponent(componentId)?.name;
            const copy = this.copyComponent(componentId);
            if (copy && name !== undefined) {
                copies.push(copy);
                sourceNames.push(name);
            }
        }
        if (copies.length > 0) {
            this.recordLibraryAddition(
                { surfaceIds: [], componentIds: copies.map(copy => copy.id) },
                copies.length === 1
                    ? { key: "uiEditor.history.duplicateComponent" as TranslationKey, params: { name: sourceNames[0] } }
                    : { key: "uiEditor.history.duplicateComponents" as TranslationKey, params: { count: copies.length } },
            );
        }
        return copies;
    }

    private copyComponent(componentId: string): UIComponentDefinition | null {
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
            name: createDuplicateName(
                source.name,
                new Set((this.getDocument().components ?? []).map(component => component.name)),
                translate("defaultDoc.componentName"),
            ),
            rootElementId: idMap[source.rootElementId],
            elements,
            createdAt: now,
            updatedAt: now,
        };
        this.mutateDocument(document => {
            document.components = [...(document.components ?? []), component];
        }, { history: false });
        // The copy's own words and its parameters' defaults, translated as the original's are.
        this.carryCopiedTranslations(
            source.elements,
            idMap,
            [],
            undefined,
            mapCopiedUIComponentDefaultUnits([source], { [source.id]: newComponentId }),
        );
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
                                surfaceId: buildUIComponentEditorSurfaceId(newComponentId),
                                elementId: idMap[binding.target.elementId] ?? binding.target.elementId,
                            };
                        }
                        if (binding.source.kind === "field" && binding.source.blueprintId === oldBpId) {
                            binding.source = { ...binding.source, blueprintId: newBpId };
                        }
                    }
                }
                bpDoc.blueprints[newBpId] = cloned;
                setPrivateOwnerBlueprint(
                    bpDoc,
                    componentWidgetMainOwnerKey(newComponentId, newElementId),
                    newBpId,
                );
            }
        });
        return component;
    }

    /**
     * One element of a definition's layout, as `updateElementLayout` is one of a page's: an undo step
     * of its own, folded into the previous one when that wrote the same fields of the same element
     * within the merge window - so typing a number into the inspector is one step, not one a key.
     * `skipHistory` is for the write a gesture makes on its way to the one it records.
     */
    public updateComponentElementLayout(
        componentId: string,
        elementId: string,
        layoutPatch: Partial<UILayout>,
        options: { skipHistory?: boolean } = {},
    ): void {
        const patchKeys = Object.keys(layoutPatch).sort();
        this.mutateDocument(document => {
            const component = (document.components ?? []).find(item => item.id === componentId);
            if (component) {
                this.writeComponentElementLayout(component, elementId, layoutPatch);
            }
        }, {
            history: options.skipHistory
                ? false
                : this.componentHistory(componentId, `layout:${elementId}:${patchKeys.join(",")}`),
        });
    }

    /**
     * Several elements of one definition as one change: one `documentChanged` and one undo step, as
     * `updateElementLayouts` is on a page - a drag of three elements is undone by one Ctrl+Z.
     * `mergeKey` folds the step into the previous one when that carried the same key and was
     * recorded within the merge window, which is how a run of arrow-key nudges stays one undo.
     */
    public updateComponentElementLayouts(
        componentId: string,
        layoutPatches: Record<string, Partial<UILayout>>,
        options: { mergeKey?: string } = {},
    ): void {
        if (Object.keys(layoutPatches).length === 0) {
            return;
        }
        this.mutateDocument(document => {
            const component = (document.components ?? []).find(item => item.id === componentId);
            if (!component) {
                return;
            }
            for (const [elementId, layoutPatch] of Object.entries(layoutPatches)) {
                this.writeComponentElementLayout(component, elementId, layoutPatch);
            }
        }, { history: this.componentHistory(componentId, options.mergeKey) });
    }

    private writeComponentElementLayout(
        component: UIComponentDefinition,
        elementId: string,
        layoutPatch: Partial<UILayout>,
    ): void {
        const element = component.elements[elementId];
        if (!element) {
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
    }

    /**
     * Bind one prop of one element of a component definition to a field of its list row or to a text
     * parameter of the component - the two value bindings that need no blueprint - or (`null`) unbind
     * it. A definition's elements take no Blueprint Value (`ComponentDocumentServiceAdapter`), so there
     * is no blueprint to clear on the way.
     */
    public setComponentElementValueBinding(
        componentId: string,
        elementId: string,
        propPath: string,
        binding: Extract<UIElementValueBinding, { kind: "listItemField" | "componentParam" }> | null,
    ): void {
        this.mutateDocument(document => {
            const component = (document.components ?? []).find(item => item.id === componentId);
            const element = component?.elements[elementId];
            if (!component || !element) {
                return;
            }
            if (binding) {
                element.valueBindings = { ...(element.valueBindings ?? {}), [propPath]: binding };
            } else if (element.valueBindings) {
                delete element.valueBindings[propPath];
                if (Object.keys(element.valueBindings).length === 0) {
                    delete element.valueBindings;
                }
            }
            component.updatedAt = new Date().toISOString();
        }, { history: this.componentHistory(componentId) });
    }

    /**
     * Show one of a component's text parameters in the words of an element of its definition, or
     * (`null`) stop showing one. The component is the one whose definition holds the element; an
     * element on a page has no parameters to show and is left alone.
     */
    public setElementComponentParamBinding(elementId: string, propPath: string, paramId: string | null): void {
        const component = findUIComponentHoldingElement(this.getDocument(), elementId);
        if (!component) {
            return;
        }
        const id = paramId?.trim();
        this.setComponentElementValueBinding(component.id, elementId, propPath, id ? { kind: "componentParam", paramId: id } : null);
    }

    /** `skipHistory` as {@link updateElementProps} takes it. */
    public updateComponentElementProps(
        componentId: string,
        elementId: string,
        propsPatch: Record<string, unknown>,
        options: { skipHistory?: boolean } = {},
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
        }, {
            history: options.skipHistory
                ? false
                : this.componentHistory(componentId, `props:${elementId}:${Object.keys(propsPatch).sort().join(",")}`),
        });
    }

    public updateComponentElementAnimation(
        componentId: string,
        elementId: string,
        animation: UIPageAnimationSettings | null,
        options: { mergeKey?: string } = {},
    ): void {
        this.mutateDocument(document => {
            const component = (document.components ?? []).find(item => item.id === componentId);
            const element = component?.elements[elementId];
            if (!component || !element) {
                return;
            }
            applyElementAnimation(element, animation);
            component.updatedAt = new Date().toISOString();
        }, { history: this.componentHistory(componentId, options.mergeKey ?? `animation:${elementId}`) });
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
        }, {
            history: this.componentHistory(componentId, `extra:${elementId}:${Object.keys(extraPatch).sort().join(",")}`),
        });
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
        }, { history: this.componentHistory(componentId) });
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
        }, { history: this.componentHistory(componentId) });
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
        }, { history: this.componentHistory(componentId) });
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
        }, { history: this.componentHistory(componentId) });
        return { ok: true };
    }

    /**
     * `ungroupContainers` for a component definition's elements, over a document made of the
     * component alone. Returns the ids that were lifted out.
     */
    public ungroupComponentContainers(componentId: string, containerIds: readonly string[]): string[] {
        const document = this.getDocument();
        const component = (document.components ?? []).find(item => item.id === componentId);
        const surfaceId = `component:${componentId}`;
        if (
            !component ||
            !containerIds.some(id => canUngroupContainer(componentAsDocument(document, component, surfaceId), surfaceId, id))
        ) {
            return [];
        }
        const lifted: string[] = [];
        this.mutateDocument(doc => {
            const liveComponent = (doc.components ?? []).find(item => item.id === componentId);
            if (!liveComponent) {
                return;
            }
            const view = componentAsDocument(doc, liveComponent, surfaceId);
            for (const containerId of containerIds) {
                lifted.push(...(applyUngroupContainer(view, surfaceId, containerId) ?? []));
            }
            liveComponent.updatedAt = new Date().toISOString();
        }, { history: this.componentHistory(componentId) });
        return lifted;
    }

    /**
     * `groupElements` for a component definition's elements: the same plan, read and applied over a
     * document made of the component alone, as `moveComponentElements` does.
     */
    public groupComponentElements(componentId: string, elementIds: readonly string[]): string | null {
        const document = this.getDocument();
        const component = (document.components ?? []).find(item => item.id === componentId);
        if (!component) {
            return null;
        }
        const surfaceId = `component:${componentId}`;
        const plan = planGroupElements(componentAsDocument(document, component, surfaceId), surfaceId, elementIds);
        if (!plan) {
            return null;
        }
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const group = createGroupElement(uuidService.generate(), plan);
        this.mutateDocument(doc => {
            const liveComponent = (doc.components ?? []).find(item => item.id === componentId);
            if (!liveComponent) {
                return;
            }
            applyGroupElements(componentAsDocument(doc, liveComponent, surfaceId), plan, group);
            liveComponent.updatedAt = new Date().toISOString();
        }, { history: this.componentHistory(componentId) });
        return group.id;
    }

    /**
     * Make an element its definition's root, taking off the container it sat alone in.
     *
     * One step in the definition's history, and the one step there that reaches the pages: every
     * placement is given the box the element took up inside it (`promoteElementToComponentRoot`), and
     * taking the step back gives the boxes back with the definition.
     */
    public promoteComponentElementToRoot(componentId: string, elementId: string): boolean {
        const component = this.getComponent(componentId);
        const element = component?.elements[elementId];
        if (!component || !element || resolveComponentRootPromotionRefusal(component.elements, component.rootElementId, elementId)) {
            return false;
        }
        let promoted = false;
        this.mutateDocument(document => {
            promoted = promoteElementToComponentRoot(document, componentId, elementId);
            const liveComponent = (document.components ?? []).find(item => item.id === componentId);
            if (promoted && liveComponent) {
                liveComponent.updatedAt = new Date().toISOString();
            }
        }, {
            history: {
                surfaceId: buildUIComponentEditorSurfaceId(componentId),
                withPlacements: true,
                label: { key: "uiEditor.history.setRootElement" as TranslationKey, params: { name: this.describeElementForHistory(element) } },
            },
        });
        return promoted;
    }

    /**
     * Put an empty container around a definition's root, as its new root. Returns the container's id.
     *
     * The container takes the root's size and draws nothing of its own, so the definition and every
     * placement look as they did, and the root can now be given siblings.
     */
    public wrapComponentRoot(componentId: string): string | null {
        const component = this.getComponent(componentId);
        const root = component?.elements[component.rootElementId];
        if (!component || !root) {
            return null;
        }
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const wrapper: UIElement = {
            id: uuidService.generate(),
            type: "nl.container",
            name: translate("defaultDoc.rootName"),
            parentId: null,
            childrenIds: [],
            layout: { x: 0, y: 0, width: root.layout.width, height: root.layout.height, opacity: 1, visible: true },
            props: createGroupContainerProps(null),
        };
        this.mutateDocument(document => {
            const liveComponent = (document.components ?? []).find(item => item.id === componentId);
            if (!liveComponent) {
                return;
            }
            wrapComponentRootInContainer(liveComponent, wrapper);
            liveComponent.updatedAt = new Date().toISOString();
        }, {
            history: {
                surfaceId: buildUIComponentEditorSurfaceId(componentId),
                label: { key: "uiEditor.history.wrapRoot" as TranslationKey, params: { name: this.describeElementForHistory(root) } },
            },
        });
        return this.getComponent(componentId)?.rootElementId === wrapper.id ? wrapper.id : null;
    }

    /** An element as an Edit menu step names it: its own name, or its widget's. */
    private describeElementForHistory(element: UIElement): string {
        return element.name?.trim() || widgetModuleRegistry.get(element.type)?.displayName || element.type;
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
            const defaults = definition.createDefaultElement(this.widgetDefaultWords());
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
        }, { history: this.componentHistory(componentId) });
        return created;
    }

    public pasteComponentClipboardPayload(
        componentId: string,
        targetParentId: string,
        beforeChildId: string | null,
        incoming: UIEditorClipboardPayload,
    ): { ok: true; newRootIds: string[] } | { ok: false; reason: "invalid_clipboard" | "invalid_target" } {
        if (incoming.v !== 1 || incoming.topLevelElementIds.length === 0 || Object.keys(incoming.elements).length === 0) {
            return { ok: false, reason: "invalid_clipboard" };
        }
        // Text settled the way this project stores it, against this project's keys.
        const textArrival = settleIncomingUITextSources(incoming.elements, { hasKey: this.hasTextKey, carried: incoming.textKeys });
        const payload: UIEditorClipboardPayload = textArrival.table === incoming.elements
            ? incoming
            : { ...incoming, elements: textArrival.table };
        const document = this.getDocument();
        const component = (document.components ?? []).find(item => item.id === componentId);
        const target = component?.elements[targetParentId];
        // The same answer a page gives (`parentTakesAddedElements`), asked of the definition's own elements.
        if (!component || !target || !parentTakesAddedElements(
            { ...document, elements: component.elements },
            target,
            payload.topLevelElementIds.map(id => payload.elements[id]),
        )) {
            return { ok: false, reason: "invalid_target" };
        }
        const fillsPartSlots = !uiElementTypeAcceptsUserChildren(target.type);
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
                const isTop = payload.topLevelElementIds.includes(oldId);
                copy.parentId = isTop
                    ? targetParentId
                    : source.parentId && elementIdMap[source.parentId]
                      ? elementIdMap[source.parentId]
                      : null;
                copy.childrenIds = source.childrenIds.filter(childId => elementIdMap[childId]).map(childId => elementIdMap[childId]);
                liveComponent.elements[newId] = copy;
                const partSlot = isTop && fillsPartSlots ? getUIStructuralChildSlot(liveParent.type, copy.extra) : null;
                const pointer = partSlot ? getUIStructuralSlotPointerProp(liveParent.type, partSlot) : null;
                if (pointer) {
                    liveParent.props = { ...(liveParent.props ?? {}), [pointer]: newId };
                }
            }
            const insertAt = beforeChildId ? liveParent.childrenIds.indexOf(beforeChildId) : -1;
            const withoutMoved = liveParent.childrenIds.filter(id => !newRootIds.includes(id));
            liveParent.childrenIds = insertAt >= 0
                ? [...withoutMoved.slice(0, insertAt), ...newRootIds, ...withoutMoved.slice(insertAt)]
                : [...withoutMoved, ...newRootIds];
            normalizeFlowChildLayouts({ ...doc, elements: liveComponent.elements }, newRootIds);
            liveComponent.updatedAt = new Date().toISOString();
        }, { history: this.componentHistory(componentId) });
        this.adoptArrivingTranslations(
            textArrival.converted
                .filter(site => elementIdMap[site.elementId])
                .map(site => ({ ...site, elementId: elementIdMap[site.elementId] })),
            payload.textKeys,
        );
        this.carryCopiedTranslations(payload.elements, elementIdMap, textArrival.converted, payload.translations);
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
                    setPrivateOwnerBlueprint(
                        bpDoc,
                        widgetMainOwnerKey(surfaceId, newElementId),
                        newBpId,
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

        const defaultElement = definition.createDefaultElement(this.widgetDefaultWords());
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
        incoming: UIEditorClipboardPayload,
    ): { ok: true; newRootIds: string[] } | { ok: false; reason: "invalid_clipboard" | "invalid_target" } {
        if (incoming.v !== 1 || incoming.topLevelElementIds.length === 0 || Object.keys(incoming.elements).length === 0) {
            return { ok: false, reason: "invalid_clipboard" };
        }
        // Text settled the way this project stores it, against this project's keys.
        const textArrival = settleIncomingUITextSources(incoming.elements, { hasKey: this.hasTextKey, carried: incoming.textKeys });
        const payload: UIEditorClipboardPayload = textArrival.table === incoming.elements
            ? incoming
            : { ...incoming, elements: textArrival.table };

        const document = this.getDocument();
        const effectiveRootId = resolveSurfaceRootElementId(document, surfaceId);
        if (!effectiveRootId) {
            return { ok: false, reason: "invalid_target" };
        }
        const allowed = collectSubtreeElementIds(document, effectiveRootId);
        const target = document.elements[targetParentId];
        const pastedTops = payload.topLevelElementIds.map(id => payload.elements[id]);
        if (!target || !allowed.has(targetParentId) || !parentTakesAddedElements(document, target, pastedTops)) {
            return { ok: false, reason: "invalid_target" };
        }
        if (beforeChildId != null) {
            const beforeEl = document.elements[beforeChildId];
            if (!beforeEl || beforeEl.parentId !== targetParentId) {
                return { ok: false, reason: "invalid_target" };
            }
        }
        // Past the check above, a target that takes no author's children is a widget taking back its
        // own parts - a copied handle into a Slider whose handle is gone.
        const fillsPartSlots = !uiElementTypeAcceptsUserChildren(target.type);

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

                const partSlot = isTop && fillsPartSlots ? getUIStructuralChildSlot(parentEl.type, copy.extra) : null;
                if (partSlot) {
                    // A part's layout is its place inside its widget, so it keeps it: a handle copied
                    // from one Slider sits where a handle sits in the next. The widget is pointed at
                    // it too, where it keeps its parts' ids - see `getUIStructuralSlotPointerProp`.
                    copy.layout = roundUILayoutGeometryFields({ ...copy.layout });
                    const pointer = getUIStructuralSlotPointerProp(parentEl.type, partSlot);
                    if (pointer) {
                        parentEl.props = { ...(parentEl.props ?? {}), [pointer]: newId };
                    }
                } else if (isTop) {
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
                setPrivateOwnerBlueprint(
                    bpDoc,
                    widgetMainOwnerKey(surfaceId, newElementId),
                    newBpId,
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
                setPrivateOwnerBlueprint(
                    bpDoc,
                    widgetValueOwnerKey(surfaceId, newElementId, owner.propPath),
                    newBpId,
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

        this.adoptArrivingTranslations(
            textArrival.converted
                .filter(site => elementIdMap[site.elementId])
                .map(site => ({ ...site, elementId: elementIdMap[site.elementId] })),
            payload.textKeys,
        );
        this.carryCopiedTranslations(payload.elements, elementIdMap, textArrival.converted, payload.translations);
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
            if (!blueprint) {
                return;
            }
            blueprint.graphs.events = {
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
            if (!blueprint) {
                return;
            }
            blueprint.graphs.events = {
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
            if (!blueprint) {
                return;
            }
            blueprint.graphs.events = {
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
            if (!blueprint) {
                return;
            }
            const initEntry = blueprint.graphs.events?.init;
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
            if (!blueprint) {
                return;
            }
            blueprint.graphs.events = {
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
            if (!blueprint) {
                return;
            }
            blueprint.graphs.events = {
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

    /**
     * A page for the game to start on, whatever the file said. True when the document had to change.
     *
     * Three repairs, each for a document that arrived broken - by a merge, a hand edit, or an older
     * tool - and none of which a document Studio wrote ever needs:
     *
     *  - **no page at all**: one is made, under the main id when nothing holds it, so a project
     *    always has somewhere to start;
     *  - **an entry page whose root element is missing**: it gets an empty one, so it can be opened;
     *  - **a stored entry that names no page**: the pointer is dropped, and the entry is the page the
     *    document would name without it (`resolveEntrySurface` already reads it that way - this only
     *    stops the file from saying something it does not mean).
     *
     * ⚠ **It never changes a page's id.** This used to give the first page the main id when no page
     * had it, which was harmless only while the main page could not be deleted. Now that the entry is
     * a pointer and the old main page can be deleted like any other, doing that would quietly re-file
     * every blueprint and every `Go Page` that named the page by the id it had.
     */
    private ensureEntrySurface(document: UIDocument): boolean {
        const designSize = this.getProjectDesignSize();
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        let changed = false;
        if (entrySurfacePointerMisses(document)) {
            delete document.entrySurfaceId;
            changed = true;
        }
        const entry = resolveEntrySurface(document);
        if (entry) {
            if (!document.elements[entry.rootElementId]) {
                const rootElementId = uuidService.generate();
                entry.rootElementId = rootElementId;
                document.elements[rootElementId] = this.createRootElement(rootElementId, designSize);
                changed = true;
            }
            return changed;
        }

        const rootElementId = uuidService.generate();
        const mainIdTaken = document.surfaces.some(surface => surface.id === MAIN_APP_SURFACE_ID);
        const surface: UISurface = {
            id: mainIdTaken ? uuidService.generate() : MAIN_APP_SURFACE_ID,
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

/**
 * The shared half of the two `set...ListItemStructShape` methods: `elements` is the table the list
 * lives in. Answers whether anything changed.
 */
function applyListItemStructShape(
    document: UIDocument,
    elements: Record<string, UIElement>,
    element: UIElement,
    shapeId: string | null,
    generateId: () => string,
): boolean {
    const props = (element.props ?? {}) as Record<string, unknown>;
    const currentStructId = typeof props.itemStructId === "string" ? props.itemStructId : null;
    const applied = applyUIStructShapeForOwner({ document, currentStructId, shapeId, generateId });
    if (applied.structId === currentStructId) {
        return false;
    }
    const struct = resolveUIStruct({ structs: applied.structs }, applied.structId);
    element.props = {
        ...props,
        itemStructId: applied.structId,
        ...(Array.isArray(props.items) ? { items: props.items.map(item => coerceItemToStruct(struct, item)) } : {}),
    };
    remapUIListFieldIds(elements, element.id, applied.fieldIds);
    document.structs = pruneUIStructs({ ...document, structs: applied.structs });
    return true;
}
