import { resolveEntrySurfaceId } from "@shared/types/ui-editor/entrySurface";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
    BLUEPRINT_NODE_TYPE_LIST_APPEND_ITEM,
    BLUEPRINT_NODE_TYPE_LIST_CLEAR,
    BLUEPRINT_NODE_TYPE_LIST_INSERT_ITEM,
    BLUEPRINT_NODE_TYPE_LIST_REFRESH_ITEMS,
    BLUEPRINT_NODE_TYPE_LIST_REMOVE_ITEM,
    BLUEPRINT_NODE_TYPE_LIST_REMOVE_ITEM_AT,
    BLUEPRINT_NODE_TYPE_LIST_SET_ITEM_FIELD_AT,
    BLUEPRINT_NODE_TYPE_LIST_SET_ITEMS,
    BLUEPRINT_NODE_TYPE_LIST_SORT_BY_FIELD,
} from "@shared/types/blueprint/graph";
import type { UIComponentDefinition, UIDocument, UIElement, UISurface } from "@shared/types/ui-editor/document";
import { getUIComponentLink, getUIComponentParams, isUIComponentTextParam } from "@shared/types/ui-editor/document";
import { isAppearanceModel, type AppearanceValueRow } from "@shared/types/ui-editor/appearance";
import {
    isOperableWidgetType,
    resolveSurfaceActionBindings,
    type UIInputPointerGesture,
} from "@shared/types/ui-editor/inputAction";
import {
    readUITextSite,
    uiTextHasWords,
    uiTextSiteOf,
    uiTextSitesOf,
    uiTextUnitBindingOf,
    uiTextUnitId,
    type UITextSite,
    type UITextUnitBinding,
} from "@shared/types/ui-editor/textSource";
import {
    buildUIFrameGraph,
    getUIFrameWidgetProps,
    listUIFrameSites,
    UI_FRAME_ELEMENT_TYPE,
    type UIFrameSite,
} from "@shared/types/ui-editor/frame";
import { isListLikeWidgetType, isUIListItemTemplateChild } from "@shared/types/ui-editor/list";
import { findOwningListItemTemplate } from "@shared/types/ui-editor/listItemContext";
import { resolveUIStruct } from "@shared/types/ui-editor/builtinStructs";
import { findUIStructField } from "@shared/types/ui-editor/struct";
import { uiTextSampleCauseOf } from "@shared/types/ui-editor/textSample";
import {
    listUIPlacementTextValues,
    uiComponentTextValueUnitBinding,
    uiTextComponentParamOf,
} from "@shared/types/ui-editor/componentTextParams";
import { indexUITextWriters, type UITextWriterIndex } from "@shared/types/ui-editor/textWriters";
import type { SearchJumpTarget } from "../../workspace/services/search/searchIndexModel";
import { widgetPrivateBlueprintHasSlotHead } from "../../ui-editor/blueprint-runtime/widgetPrivateBlueprintHeads";
import { blueprintNodeRegistry } from "../../ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { widgetModuleRegistry } from "../../ui-editor/widget-modules/registryInstance";
import { registerCoreBlueprintNodes } from "../../ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { readBlueprintElementRefParams } from "../../ui-editor/blueprint-nodes/built-in/elementRefUtils";
import { listBlueprintGraphSites, type BlueprintGraphSite } from "../blueprintSites";
import type { LintContext } from "../context";
import type { LintFinding, LintLocation, LintRule } from "../types";
import { REFERENCE_KIND_BY_OPTIONS_SOURCE } from "./blueprint";

/**
 * `ui` - pages and widgets that do not do what the canvas suggests they do.
 *
 * The surface editor validates what it has open, and `blueprint` validates the graphs. Neither can
 * answer a question that spans the two: a page is reached from a graph, a button is wired from a
 * graph, and the surface editor draws both exactly the same whether the wiring exists or not. A
 * button with nothing behind it is indistinguishable from a working one until a player presses it.
 *
 * Three facts every rule here obeys:
 *
 *  - **A null document is not an empty one.** `ctx.uiDocument` / `ctx.blueprintDocument` are `null`
 *    when the service could not be read, and a rule that treated that as "the project has no
 *    graphs" would report every page in the project as unreachable off one failed read.
 *  - **Only what a surface holds is swept - except by the Page widget rules.** A component
 *    *definition* is not a page, and one definition placed on four pages would report the same
 *    defect four times from places the author did not write it. Component instances are skipped for
 *    the mirror-image reason - their wiring lives in the definition, where this sweep is not
 *    looking, so judging them would be judging evidence it does not have. The Page widget rules
 *    sweep definitions too, and file what they find under the definition, once
 *    (`componentLocation`): a Page widget in a card draws a page wherever the card is placed, and a
 *    card's Page widget naming the page the card sits on is exactly the loop those rules exist for.
 *  - **Runtime semantics decide what counts as wired, not the inspector.** A click travels: an
 *    element with no listener hands the event to its parent (`isPointerPositionElementEvent`), a
 *    list row's clicks belong to the list, and an `On Element Click` head anywhere in the project
 *    listens without the widget carrying any wiring of its own at all. A rule that read only the
 *    widget's own blueprint would report a working button on every one of those shapes.
 */

// ---------------------------------------------------------------------------
// Shared: walking a document's pages
// ---------------------------------------------------------------------------

/** One element on a page, with the chain from it up to the page root (nearest ancestor first). */
type SurfaceElementSite = {
    surface: UISurface;
    element: UIElement;
    ancestors: readonly UIElement[];
};

/**
 * The page's name, as its card in the interface panel shows it - which is the stored name for every
 * page, the entry page included. A report names the page the author will look for on that list.
 */
function surfaceDisplayName(surface: UISurface): string {
    return surface.name;
}

export function surfaceLocation(surface: UISurface, element?: UIElement): LintLocation {
    const name = element?.name?.trim();
    return {
        kind: "surface",
        surfaceId: surface.id,
        surfaceName: surfaceDisplayName(surface),
        ...(element ? { elementId: element.id } : {}),
        ...(name ? { elementName: name } : {}),
    };
}

/**
 * What opening a finding on a page opens: the page, with the widget the finding is about selected
 * when there is one - the same widget its location names, so the row the report draws and the
 * selection the click makes cannot disagree.
 */
export function surfaceTarget(surface: UISurface, element?: UIElement): SearchJumpTarget {
    return { kind: "uiSurface", surfaceId: surface.id, ...(element ? { elementId: element.id } : {}) };
}

/** A widget inside a component definition, filed under the definition by its name. */
function componentLocation(component: UIComponentDefinition, element?: UIElement): LintLocation {
    const name = element?.name?.trim();
    return {
        kind: "component",
        componentId: component.id,
        componentName: component.name.trim(),
        ...(element ? { elementId: element.id } : {}),
        ...(name ? { elementName: name } : {}),
    };
}

/** A widget inside a component definition: the definition's editor, with the widget selected. */
export function componentTarget(component: UIComponentDefinition, element?: UIElement): SearchJumpTarget {
    return { kind: "uiComponent", componentId: component.id, ...(element ? { elementId: element.id } : {}) };
}

/** Where a Page widget's finding is filed and what opening it opens, or null for a host that is gone. */
function frameSiteLocation(
    document: UIDocument,
    site: UIFrameSite,
): { location: LintLocation; target: SearchJumpTarget } | null {
    if (site.host.kind === "surface") {
        const surfaceId = site.host.surfaceId;
        const surface = document.surfaces.find(candidate => candidate.id === surfaceId);
        return surface ? { location: surfaceLocation(surface, site.element), target: surfaceTarget(surface, site.element) } : null;
    }
    const componentId = site.host.componentId;
    const component = (document.components ?? []).find(candidate => candidate.id === componentId);
    return component
        ? { location: componentLocation(component, site.element), target: componentTarget(component, site.element) }
        : null;
}

/**
 * Every element on every page, depth first, each carrying its ancestry.
 *
 * A cycle in `childrenIds` would otherwise hang the sweep, so a node already visited is not
 * descended into a second time: a malformed document is something lint has to survive rather than
 * something it may assume away.
 */
function listSurfaceElements(document: UIDocument): SurfaceElementSite[] {
    const sites: SurfaceElementSite[] = [];
    for (const surface of document.surfaces ?? []) {
        const seen = new Set<string>();
        const visit = (elementId: string, ancestors: readonly UIElement[]): void => {
            const element = document.elements[elementId];
            if (!element || seen.has(elementId)) {
                return;
            }
            seen.add(elementId);
            sites.push({ surface, element, ancestors });
            const nextAncestors = [element, ...ancestors];
            for (const childId of element.childrenIds ?? []) {
                visit(childId, nextAncestors);
            }
        };
        visit(surface.rootElementId, []);
    }
    return sites;
}

function elementProps(element: UIElement): Record<string, unknown> {
    return (element.props ?? {}) as Record<string, unknown>;
}

function readStringProp(props: Record<string, unknown>, key: string): string {
    const value = props[key];
    return typeof value === "string" ? value : "";
}

// ---------------------------------------------------------------------------
// Interface words and their translation units
// ---------------------------------------------------------------------------

/**
 * The sites of an element's words a player reads - read from the shared table (`textSites.ts`), the
 * one `useLocalizedWidgetText` resolves at run time, and for a plugin's widget from the props its
 * manifest declares (`uiTextSitesOf`), the ones its drawing resolves. That is what makes the answers
 * here checkable: a prop the table did not list would be translated by the runtime and missed here,
 * and a prop it listed by mistake would be reported while nothing can translate it. A `sample` site
 * (the dialogue line, the NVL line) holds stand-in words the game replaces with the story's, so no
 * player reads them and nothing here looks at them.
 */
function playerWordsSitesOf(element: UIElement): UITextSite[] {
    return uiTextSitesOf(element.type).filter(site => site.role === "words");
}


/** A face a widget's words can be drawn in, and the state that shows them in it. */
export type SurfaceTextFace = {
    /** The widget's own typeface in this face. Absent means it follows the project. */
    fontAssetId?: string;
    /**
     * The name of the widget's state (an appearance variant) that draws the words in this face.
     * Absent for the state the widget rests in.
     */
    state?: string;
};

/** The literal a widget shows a player, with the unit that translates it and the faces it is drawn in. */
export type SurfaceTextSite = {
    surface: UISurface;
    element: UIElement;
    /** `ui:<elementId>.<prop>` - the implicit unit, which is the row a target locale carries. */
    unitId: string;
    /** The author's own words, which is what renders when nothing translated them. */
    text: string;
    /** Every face the words can be drawn in, the resting one first (`listWidgetTextFaces`). Never empty. */
    faces: SurfaceTextFace[];
};

/** Whether an appearance row applies whatever state the widget is in. */
function isUnconditionalRow(row: AppearanceValueRow): boolean {
    return !row.conditions || Object.keys(row.conditions).length === 0;
}

/**
 * Every face a widget's words can be drawn in: the one it rests in first, then each the widget's
 * other states (appearance variants) switch to, each typeface once.
 *
 * A state draws the font its `fontAssetId` rows give - every row, since each applies in some
 * condition (hovered, pressed, selected) - and the widget's own font wherever no row applies, the way
 * the appearance resolver composes it. A widget with no appearance model draws its own font. A face
 * a state shares with the resting one is the resting one's.
 */
export function listWidgetTextFaces(element: UIElement): SurfaceTextFace[] {
    const props = elementProps(element);
    const own = readStringProp(props, "fontAssetId").trim();
    const faces: SurfaceTextFace[] = [];
    const add = (fontAssetId: string, state: string | undefined): void => {
        if (faces.some(face => (face.fontAssetId ?? "") === fontAssetId)) {
            return;
        }
        faces.push({ ...(fontAssetId ? { fontAssetId } : {}), ...(state ? { state } : {}) });
    };
    const appearance = props.appearance;
    if (!isAppearanceModel(appearance) || appearance.variants.length === 0) {
        add(own, undefined);
        return faces;
    }
    const resting = appearance.variants.find(variant => variant.id === appearance.defaultVariantId) ?? appearance.variants[0];
    for (const variant of [resting, ...appearance.variants.filter(candidate => candidate !== resting)]) {
        const state = variant === resting ? undefined : variant.name.trim() || undefined;
        const rows = variant.propertyGroups.find(group => group.key === "fontAssetId")?.rows ?? [];
        for (const row of rows) {
            add(typeof row.value === "string" ? row.value.trim() : "", state);
        }
        if (!rows.some(isUnconditionalRow)) {
            add(own, state);
        }
    }
    return faces;
}

/**
 * Every literal on every page that a player will read.
 *
 * Shared with `typography` lint, which asks a different question of the same three props: not
 * whether the words can be translated but whether any font can draw them. Both have to walk the same
 * sites or they would disagree about what counts as text a player sees, and the second one to be
 * written would be the one that quietly missed a widget kind.
 *
 * The literal is reported whether or not the widget is bound to a key, because a binding decides
 * which *words* render, not whether the widget shows any: an unresolved key falls back to exactly
 * this text.
 *
 * Each site carries every face its words can be drawn in - the widget's resting one and those its
 * other states switch to (`listWidgetTextFaces`) - because a typeface a state switches to has to be
 * able to draw the words as much as the resting one does.
 *
 * A component placement on the page puts on screen the words it gives its component's text
 * parameters, drawn in the faces of each widget inside the definition that shows them; each of those
 * is a site too, under the placement's unit (`listUIPlacementTextValues`). A value that names a key
 * is the key's words, which are checked as keys.
 */
export function listSurfaceTextSites(document: UIDocument): SurfaceTextSite[] {
    const sites: SurfaceTextSite[] = [];
    for (const { surface, element } of listSurfaceElements(document)) {
        for (const { value, shownBy } of listUIPlacementTextValues(document, element)) {
            if (value.key || !value.text.trim()) {
                continue;
            }
            // Every face of every widget inside the definition that shows the value, each typeface once.
            const faces: SurfaceTextFace[] = [];
            for (const face of shownBy.flatMap(listWidgetTextFaces)) {
                if (!faces.some(known => (known.fontAssetId ?? "") === (face.fontAssetId ?? ""))) {
                    faces.push(face);
                }
            }
            sites.push({ surface, element, unitId: value.unitId, text: value.text, faces });
        }
        const faces = listWidgetTextFaces(element);
        for (const site of playerWordsSitesOf(element)) {
            const text = readUITextSite(element, site).text;
            if (!text.trim()) {
                continue;
            }
            sites.push({
                surface,
                element,
                unitId: uiTextUnitId(element.id, site.textProp),
                text,
                faces,
            });
        }
    }
    return sites;
}

/** The translation unit a widget's text is read through at run time (`uiTextUnitBindingOf`). */
export type InterfaceTextUnitBinding = UITextUnitBinding;

/** One widget whose words a target locale is expected to translate, and where it lives. */
export type InterfaceTextUnitSite = {
    element: UIElement;
    location: LintLocation;
    target: SearchJumpTarget;
    /** The widget's own literal, which is what renders when no translation is found. */
    literal: string;
    binding: InterfaceTextUnitBinding;
};

/**
 * Every widget on a page or in a component definition that reads its words through a translation
 * unit, in the order the pages and then the definitions are listed.
 *
 * The same precedence the game applies (`uiTextUnitBindingOf`): a named key wins, and otherwise the
 * widget's own words are read through its own unit. Words with no letter in them are left out, as the
 * localization panel leaves them out - they read the same in every language and have no row. Component
 * definitions are walked once each, under the definition, for the reason the Page widget rules give;
 * an instance carries none of the definition's words, so it is skipped here as it is everywhere else.
 *
 * A widget's own unit is not read where its words are sample text (`textSample.ts`) - a value binding
 * or a blueprint decides what the game shows there, and the translation table has no row for them -
 * so `writers` (`indexUITextWriters`) are required.
 *
 * What an instance does carry is the words it gives its component's text parameters, which a widget
 * inside the definition shows: each is read through the key it names or through the placement's own
 * unit (the definition's, for a default it falls back to), and listed under the placement.
 */
export function listInterfaceTextUnitSites(document: UIDocument, writers: UITextWriterIndex): InterfaceTextUnitSite[] {
    const sites: InterfaceTextUnitSite[] = [];
    const read = (element: UIElement, location: LintLocation, target: SearchJumpTarget): void => {
        for (const { value } of listUIPlacementTextValues(document, element)) {
            const binding = uiComponentTextValueUnitBinding(value);
            if (binding) {
                sites.push({ element, location, target, literal: value.text, binding });
            }
        }
        if (getUIComponentLink(element)) {
            return;
        }
        for (const site of playerWordsSitesOf(element)) {
            const binding = uiTextUnitBindingOf(element, site);
            if (binding?.kind === "implicit" && uiTextSampleCauseOf(element, site, writers.get(element.id))) {
                continue;
            }
            if (binding) {
                sites.push({ element, location, target, literal: readUITextSite(element, site).text, binding });
            }
        }
    };
    for (const { surface, element } of listSurfaceElements(document)) {
        read(element, surfaceLocation(surface, element), surfaceTarget(surface, element));
    }
    for (const component of document.components ?? []) {
        for (const element of Object.values(component.elements ?? {})) {
            read(element, componentLocation(component, element), componentTarget(component, element));
        }
    }
    return sites;
}

/** Longest literal carried into the message; past this it is clipped, as a story excerpt is. */
const TEXT_EXCERPT_MAX_CHARS = 48;

export function clipLiteral(text: string): string {
    const flattened = text.replace(/\s+/g, " ").trim();
    return flattened.length > TEXT_EXCERPT_MAX_CHARS
        ? `${flattened.slice(0, TEXT_EXCERPT_MAX_CHARS - 1)}…`
        : flattened;
}

// ---------------------------------------------------------------------------
// ui/page-unreachable
// ---------------------------------------------------------------------------

/**
 * Node params whose dropdown is filled from the project's pages.
 *
 * Derived from the table `blueprint/reference-missing` checks dangling references against, rather
 * than from a list of node types: `Go Page` is not the only way in - `Show Layer`, `Show Confirm`
 * and `Quit Game` all put a page on screen - and every one of them was found by asking the node what
 * its dropdown is filled from. A node added later that picks a page is covered the day it declares
 * the source, without anyone remembering this file exists.
 */
const SURFACE_OPTIONS_SOURCES: ReadonlySet<string> = new Set(
    Object.entries(REFERENCE_KIND_BY_OPTIONS_SOURCE)
        .filter(([, kind]) => kind === "surface")
        .map(([source]) => source),
);

/**
 * Every page some graph can open.
 *
 * Two readings, because there are two kinds of node here. A node the registry knows is read through
 * its declared params, which is precise. A node it does **not** know - a plugin's, or one this build
 * does not carry - has params whose meaning is unavailable, so every string value on it that spells
 * a page id is taken as a way to that page. That direction is deliberate: the cost of over-counting
 * is a page this rule stays quiet about, and the cost of under-counting is a warning on a page that
 * works, which is the failure that gets a rule switched off.
 */
function collectGraphSurfaceTargets(ctx: LintContext, surfaceIds: ReadonlySet<string>): Set<string> {
    registerCoreBlueprintNodes();
    const opened = new Set<string>();
    for (const site of listBlueprintGraphSites(ctx.blueprintDocument)) {
        for (const node of Object.values(site.ir.nodes ?? {})) {
            const params = node.params ?? {};
            if (!blueprintNodeRegistry.get(node.type)) {
                for (const value of Object.values(params)) {
                    if (typeof value === "string" && surfaceIds.has(value.trim())) {
                        opened.add(value.trim());
                    }
                }
                continue;
            }
            for (const param of blueprintNodeRegistry.resolveCatalogEntryForNode(node.type, params).inspectorParams ?? []) {
                if (!param.dynamicOptionsSource || !SURFACE_OPTIONS_SOURCES.has(param.dynamicOptionsSource)) {
                    continue;
                }
                const value = String(params[param.key] ?? "").trim();
                if (value) {
                    opened.add(value);
                }
            }
        }
    }
    return opened;
}

/** Pages embedded by a Page widget, from anywhere in the document - components included. */
function collectFrameSurfaceTargets(document: UIDocument): Set<string> {
    const embedded = new Set<string>();
    const read = (element: UIElement): void => {
        if (element.type !== UI_FRAME_ELEMENT_TYPE) {
            return;
        }
        const target = getUIFrameWidgetProps(element).targetSurfaceId;
        if (target) {
            embedded.add(target);
        }
    };
    for (const element of Object.values(document.elements ?? {})) {
        read(element);
    }
    for (const component of document.components ?? []) {
        for (const element of Object.values(component.elements ?? {})) {
            read(element);
        }
    }
    return embedded;
}

/**
 * Pages named by a component instance rather than by the graph that opens them.
 *
 * One nav entry placed once per destination reads which page it opens from its own params, so the
 * `Go Page` inside the definition names nothing and the graph sweep above sees no way in to any of
 * them. The values are here instead - authored, in the document, one per placement.
 *
 * Read the same way the sweep reads a node it does not know: any value that spells a page id counts.
 * A param's meaning is the definition's business, and the trade this rule already made applies
 * unchanged - over-counting costs a page it stays quiet about, under-counting costs a warning on a
 * page that works, which is the failure that gets a rule switched off.
 */
function collectComponentParamSurfaceTargets(document: UIDocument, surfaceIds: ReadonlySet<string>): Set<string> {
    const opened = new Set<string>();
    for (const element of Object.values(document.elements ?? {})) {
        const link = getUIComponentLink(element);
        for (const value of Object.values(link?.params ?? {})) {
            const trimmed = value.trim();
            if (surfaceIds.has(trimmed)) {
                opened.add(trimmed);
            }
        }
    }
    return opened;
}

/**
 * A page a player can never get to.
 *
 * **"Nothing does `Go Page` to it" is not the test.** The start page is entered by name and nothing
 * navigates to it; a Game UI is mounted into a stage slot by the engine; a page shown inside a Page
 * widget is embedded rather than navigated to; and `Show Layer`, `Show Confirm` and `Quit Game` all
 * open a page without being `Go Page`. Each of those is a page that works, and a rule that reported
 * them would spend its first run warning about the title screen - which is how the reader learns to
 * skip this rule's findings.
 *
 * Stage surfaces are not candidates at all rather than being excluded one by one: they are mounted
 * by their `mount` slot, so "who navigates here" is not a question about them.
 *
 * Silent when either document could not be read: `null` is a failed read, and answering it as "no
 * graphs in this project" would report every page but the entry one off a single unrelated failure.
 */
function runPageUnreachable(ctx: LintContext): LintFinding[] {
    const document = ctx.uiDocument;
    if (!document || !ctx.blueprintDocument) {
        return [];
    }
    const pages = (document.surfaces ?? []).filter(surface => surface.kind === "appSurface");
    const surfaceIds = new Set(pages.map(surface => surface.id));
    const entered = collectGraphSurfaceTargets(ctx, surfaceIds);
    for (const embedded of collectFrameSurfaceTargets(document)) {
        entered.add(embedded);
    }
    const entrySurfaceId = resolveEntrySurfaceId(document);
    return pages
        .filter(surface => surface.id !== entrySurfaceId && !entered.has(surface.id))
        .map(surface => ({
            ruleId: "ui/page-unreachable" as const,
            messageKey: "lint.rule.uiPageUnreachable.message" as const,
            location: surfaceLocation(surface),
            target: surfaceTarget(surface),
        }));
}

// ---------------------------------------------------------------------------
// ui/empty-behavior
// ---------------------------------------------------------------------------

/** The widget event slot a press arrives on, and the one a list raises for a row. */
const CLICK_EVENT_ID = "mouseClick";
const LIST_ITEM_CLICK_EVENT_ID = "itemClick";

/**
 * Whether the widget's own blueprint carries a head node that starts on this slot.
 *
 * Answered by the shared reader rather than here, because this rule is not the only place that has
 * to ask: the surface editor's interaction diagnostics ask the same question, and they spent four
 * months answering it by reading a field on the element that widgets stopped carrying. See
 * `widgetPrivateBlueprintHeads`.
 */
function hasPrivateBlueprintHead(ctx: LintContext, surfaceId: string, element: UIElement, eventId: string): boolean {
    return widgetPrivateBlueprintHasSlotHead(ctx.blueprintDocument, { surfaceId }, element, eventId);
}

/**
 * Every `(surfaceId, elementId)` an `On Element Click` head anywhere in the project listens to.
 *
 * Collected once for the whole sweep rather than searched per widget: the heads live in the page's
 * own blueprint and in each widget's, so answering the question per candidate would walk every graph
 * in the project once per button on it.
 *
 * `elementType` is not part of the key even though the dispatcher matches on it. A head naming the
 * right element with a stale type is a head that will not fire, which is a real defect - but it is
 * a *broken* wire rather than a missing one, and reporting it here would send the author looking for
 * the button they already wired instead of at the node that names it.
 */
function collectElementClickTargets(ctx: LintContext): Set<string> {
    const wired = new Set<string>();
    for (const site of listBlueprintGraphSites(ctx.blueprintDocument)) {
        for (const node of Object.values(site.ir.nodes ?? {})) {
            if (node.type !== BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK) {
                continue;
            }
            const ref = readBlueprintElementRefParams(node.params);
            if (ref) {
                wired.add(`${ref.surfaceId}\u0000${ref.elementId}`);
            }
        }
    }
    return wired;
}

/**
 * Whether pressing this widget runs anything at all.
 *
 * The whole ancestry is asked, not just the widget, because that is what a click does: a pointer
 * event nothing on the element listens for is handed to its parent, so a plain button inside a
 * wired container is a working button. A list row is the same story told by a different event - the
 * list raises `itemClick` for whatever was pressed inside it - so an ancestor list that listens
 * covers the controls in its item template.
 */
function isClickHandledSomewhere(
    ctx: LintContext,
    site: SurfaceElementSite,
    elementClickTargets: ReadonlySet<string>,
): boolean {
    for (const element of [site.element, ...site.ancestors]) {
        if (elementClickTargets.has(`${site.surface.id}\u0000${element.id}`)) {
            return true;
        }
        if (hasPrivateBlueprintHead(ctx, site.surface.id, element, CLICK_EVENT_ID)) {
            return true;
        }
        if (
            isListLikeWidgetType(element.type)
            && hasPrivateBlueprintHead(ctx, site.surface.id, element, LIST_ITEM_CLICK_EVENT_ID)
        ) {
            return true;
        }
    }
    return false;
}

/**
 * Widgets whose silence is a defect.
 *
 * A button, because a button exists to be pressed - one that does nothing is the defect this rule
 * was written for, and it is invisible on the canvas. No other type: an image or a container that
 * runs nothing when pressed is scenery, which is the overwhelmingly common case and not a defect.
 *
 * A button with interaction switched off is not a candidate either: it is drawn as unavailable and
 * takes no clicks, so having no handler is the correct state and reporting it would be a warning
 * whose only fix is to make the widget lie.
 */
function isClickableCandidate(element: UIElement): boolean {
    return element.type === "nl.button" && elementProps(element).interactionDisabled !== true;
}

/**
 * A clickable widget with nothing behind it.
 *
 * `blueprint/empty-event` covers the other half - a graph that exists and runs nothing - and cannot
 * see this one: a button nobody ever wired has no graph for that rule to find, so between the two of
 * them the state that reads worst to a player (press, nothing happens) had no rule at all.
 */
function runEmptyBehavior(ctx: LintContext): LintFinding[] {
    const document = ctx.uiDocument;
    if (!document) {
        return [];
    }
    const elementClickTargets = collectElementClickTargets(ctx);
    const findings: LintFinding[] = [];
    for (const site of listSurfaceElements(document)) {
        if (getUIComponentLink(site.element) || !isClickableCandidate(site.element)) {
            continue;
        }
        if (isClickHandledSomewhere(ctx, site, elementClickTargets)) {
            continue;
        }
        findings.push({
            ruleId: "ui/empty-behavior",
            messageKey: "lint.rule.uiEmptyBehavior.message",
            location: surfaceLocation(site.surface, site.element),
            target: surfaceTarget(site.surface, site.element),
        });
    }
    return findings;
}

/**
 * A widget whose type the project cannot load.
 *
 * The interface counterpart of `blueprint/unknown-node`, and it arises the same way: widget types
 * beyond Studio's own come from plugins, so an unknown one means the plugin that defined it is
 * uninstalled, switched off for this project, or failed to load. The canvas already draws the
 * element as unknown and keeps its data; what this rule adds is the refusal, because a build that
 * shipped it would ship a page with a hole where the author placed a control.
 *
 * An error rather than a warning for that reason: nothing draws, so what ships is not what was
 * written, and both gestures that answer it are the author's to make - install the plugin, or
 * remove the element.
 *
 * Naming the type rather than the element: the type is what says which plugin is missing, and an
 * element id is a generated id nobody can look up.
 *
 * The registry is asked as the editor asks it, so a plugin that is loaded and drawing produces no
 * finding at all. Only the stage pool is swept, for the reason at the head of this file.
 *
 * An empty registry is not a project with no widgets, and is treated the way a null document is:
 * `Service.initializeAll` loads the widget catalogue before any workspace service exists, so
 * nothing registered at all means a caller that is not a workspace - and judging that would report
 * every element in the project. The catalogue is deliberately not loaded from here: it is the whole
 * built-in widget tree, and a rule that pulled it in would cost seconds in a sweep that is meant to
 * be cheap.
 */
function runUnknownWidget(ctx: LintContext): LintFinding[] {
    const document = ctx.uiDocument;
    if (!document || widgetModuleRegistry.list().length === 0) {
        return [];
    }
    const findings: LintFinding[] = [];
    for (const site of listSurfaceElements(document)) {
        if (widgetModuleRegistry.has(site.element.type)) {
            continue;
        }
        findings.push({
            ruleId: "ui/unknown-widget",
            messageKey: "lint.rule.uiUnknownWidget.message",
            messageParams: { type: site.element.type },
            location: surfaceLocation(site.surface, site.element),
            target: surfaceTarget(site.surface, site.element),
        });
    }
    return findings;
}

/**
 * An instance of a library component the project does not have.
 *
 * A linked instance holds nothing of its own - its whole appearance is the definition it points at,
 * so an instance whose `componentId` resolves to nothing draws exactly nothing, in the canvas and
 * in the game alike, with no mark on the page to say why. That is the one shape this programme
 * refuses to let a project ship silently.
 *
 * It arises two ways and the report is the same for both: a component deleted from the library
 * while instances of it were still placed, and a selection copied out of another project, where
 * every id is a UUID that project minted (`uiEditorForeignPaste`). An error rather than a warning,
 * because both leave a page with a hole in it, and both have a gesture that answers them - add the
 * component, or unlink the instance.
 *
 * Only the stage pool is swept, for the reason at the head of this file: a component definition is
 * not a page, and an instance nested inside one has no surface to file the finding under. A
 * definition holding a broken instance is reported through whichever pages place it.
 */
function runComponentMissing(ctx: LintContext): LintFinding[] {
    const document = ctx.uiDocument;
    if (!document) {
        return [];
    }
    const known = new Set((document.components ?? []).map(component => component.id));
    const findings: LintFinding[] = [];
    for (const site of listSurfaceElements(document)) {
        const componentId = getUIComponentLink(site.element)?.componentId;
        if (!componentId || known.has(componentId)) {
            continue;
        }
        findings.push({
            ruleId: "ui/component-missing",
            messageKey: "lint.rule.uiComponentMissing.message",
            location: surfaceLocation(site.surface, site.element),
            target: surfaceTarget(site.surface, site.element),
        });
    }
    return findings;
}

/**
 * A Page widget embedding a page the project does not have.
 *
 * The sibling of {@link runComponentMissing}, and there for the same reason: a frame draws the page
 * its `targetSurfaceId` names and nothing else, so a target that resolves to nothing is a
 * rectangle of nothing on a page that gives no sign why. It arises from deleting a page that was
 * still embedded, and from pasting a frame copied out of another project, where the surface id is a
 * UUID that project minted.
 *
 * A frame with no target at all is a frame the author has not finished placing, not a broken one -
 * it is skipped, so a page under construction is never reported.
 *
 * A Page widget inside a component definition is swept too, and reported once under the definition:
 * it draws the page it names wherever the component is placed, so a missing one is a hole in every
 * page that places it.
 */
function runFrameTargetMissing(ctx: LintContext): LintFinding[] {
    const document = ctx.uiDocument;
    if (!document) {
        return [];
    }
    const known = new Set((document.surfaces ?? []).map(surface => surface.id));
    const findings: LintFinding[] = [];
    for (const site of listUIFrameSites(document)) {
        const target = getUIFrameWidgetProps(site.element).targetSurfaceId;
        if (!target || known.has(target)) {
            continue;
        }
        const filed = frameSiteLocation(document, site);
        if (!filed) {
            continue;
        }
        findings.push({
            ruleId: "ui/frame-target-missing",
            messageKey: "lint.rule.uiFrameTargetMissing.message",
            ...filed,
        });
    }
    return findings;
}

/**
 * A Page widget embedding a page that leads back to it.
 *
 * Drawing that page would draw the widget again inside it, without end; what the game draws instead
 * is a "Page loop blocked" placeholder where the page was meant to be. "Leads back" counts every way
 * one tree draws another: a Page widget naming a page, and a component placed on the way - so a card
 * whose Page widget names the page the card is placed on is caught, and so is the same card placed in
 * a list row, or inside another component.
 *
 * Every widget on a loop is reported, each where it is, rather than one per loop: which of them the
 * game blocks depends on which page the player opens first, and any one of them is where the loop can
 * be broken. A widget in a component definition is reported once under the definition, however many
 * times the component is placed.
 *
 * The inspector's page picker does not let one be picked, so this is what a document reaches by
 * other routes - a paste, a script, a page restructured under a widget that already named it, or a
 * project from before the picker could see through components.
 */
function runFrameLoop(ctx: LintContext): LintFinding[] {
    const document = ctx.uiDocument;
    if (!document) {
        return [];
    }
    const graph = buildUIFrameGraph(document);
    const findings: LintFinding[] = [];
    for (const site of listUIFrameSites(document)) {
        const reason = graph.targetInvalidReason({
            host: site.host,
            frameElementId: site.element.id,
            targetSurfaceId: getUIFrameWidgetProps(site.element).targetSurfaceId,
        });
        if (reason !== "self" && reason !== "cycle") {
            continue;
        }
        const filed = frameSiteLocation(document, site);
        if (!filed) {
            continue;
        }
        findings.push({
            ruleId: "ui/frame-loop",
            messageKey: "lint.rule.uiFrameLoop.message",
            ...filed,
        });
    }
    return findings;
}

/**
 * A prop bound to an item field that the list drawing it no longer declares.
 *
 * The failure is silent and looks like authored content: the element keeps drawing whatever literal
 * it was given, so a row that was showing a save's chapter name goes back to showing the word the
 * template was drawn with, in every row, and nothing anywhere says the field is gone. It arises from
 * removing a field, from renaming a widget's shape into one that no longer has it, and from pasting
 * a row template into a list with a different shape.
 *
 * A binding on an element no list draws is the same finding: it also resolves to nothing.
 */
function runListItemFieldMissing(ctx: LintContext): LintFinding[] {
    const document = ctx.uiDocument;
    if (!document) {
        return [];
    }
    const findings: LintFinding[] = [];
    for (const site of listSurfaceElements(document)) {
        const bindings = site.element.valueBindings;
        if (!bindings) {
            continue;
        }
        const fieldIds = Object.values(bindings)
            .filter(binding => binding.kind === "listItemField")
            .map(binding => (binding as { fieldId: string }).fieldId);
        if (fieldIds.length === 0) {
            continue;
        }
        const context = findOwningListItemTemplate(document, site.element);
        const struct = context ? resolveUIStruct(document, context.structId) : null;
        for (const fieldId of fieldIds) {
            if (findUIStructField(struct, fieldId)) {
                continue;
            }
            findings.push({
                ruleId: "ui/list-item-field-missing",
                messageKey: "lint.rule.uiListItemFieldMissing.message",
                location: surfaceLocation(site.surface, site.element),
                target: surfaceTarget(site.surface, site.element),
            });
        }
    }
    return findings;
}

// ---------------------------------------------------------------------------
// ui/component-param-missing
// ---------------------------------------------------------------------------

/**
 * A widget inside a component definition whose words show a parameter the component does not
 * declare as a text parameter.
 *
 * Every placement then shows nothing there - a placement answers the binding, and has no words to
 * give it - while the component's own editor goes on drawing the widget's sample words, so the
 * definition looks whole. It arises from removing a parameter, from making it a string parameter, and
 * from pasting the widget out of another component. A widget on a page bound to a parameter - pasted
 * out of a component - is the same finding: no placement gives it words, and the game shows none.
 */
function runComponentParamMissing(ctx: LintContext): LintFinding[] {
    const document = ctx.uiDocument;
    if (!document) {
        return [];
    }
    const findings: LintFinding[] = [];
    for (const { surface, element } of listSurfaceElements(document)) {
        const site = uiTextSiteOf(element.type);
        if (site && uiTextComponentParamOf(element, site) !== null) {
            findings.push({
                ruleId: "ui/component-param-missing",
                messageKey: "lint.rule.uiComponentParamMissing.messageOutside",
                location: surfaceLocation(surface, element),
                target: surfaceTarget(surface, element),
            });
        }
    }
    for (const component of document.components ?? []) {
        const textParams = new Set(getUIComponentParams(component).filter(isUIComponentTextParam).map(param => param.id));
        for (const element of Object.values(component.elements ?? {})) {
            const site = uiTextSiteOf(element.type);
            const paramId = site ? uiTextComponentParamOf(element, site) : null;
            if (paramId === null || textParams.has(paramId)) {
                continue;
            }
            findings.push({
                ruleId: "ui/component-param-missing",
                messageKey: "lint.rule.uiComponentParamMissing.message",
                location: componentLocation(component, element),
                target: componentTarget(component, element),
            });
        }
    }
    return findings;
}

// ---------------------------------------------------------------------------
// ui/list-text-untranslated
// ---------------------------------------------------------------------------

/**
 * Nodes in a list's own blueprint that write its rows. A list whose own graph writes them shows the
 * graph's rows, not the ones written into its content.
 */
const LIST_ROW_WRITER_NODE_TYPES: ReadonlySet<string> = new Set([
    BLUEPRINT_NODE_TYPE_LIST_SET_ITEMS,
    BLUEPRINT_NODE_TYPE_LIST_CLEAR,
    BLUEPRINT_NODE_TYPE_LIST_APPEND_ITEM,
    BLUEPRINT_NODE_TYPE_LIST_INSERT_ITEM,
    BLUEPRINT_NODE_TYPE_LIST_REMOVE_ITEM,
    BLUEPRINT_NODE_TYPE_LIST_REMOVE_ITEM_AT,
    BLUEPRINT_NODE_TYPE_LIST_SET_ITEM_FIELD_AT,
    BLUEPRINT_NODE_TYPE_LIST_SORT_BY_FIELD,
    BLUEPRINT_NODE_TYPE_LIST_REFRESH_ITEMS,
]);

/**
 * Lists whose rows something other than their written content may decide: every list a graph names
 * by id anywhere in the project, every list whose own graph writes rows, and every list whose own
 * blueprint has a script layer (a script cannot be read, so it is credited with writing them).
 *
 * Over-counting here only keeps the rule quiet about a list it could have reported; under-counting
 * would report a list whose rows a graph replaces, telling the author words no player reads are not
 * translated.
 */
function listsWithRowsFromElsewhere(ctx: LintContext): Set<string> {
    const ids = new Set<string>();
    for (const site of listBlueprintGraphSites(ctx.blueprintDocument)) {
        const owner = site.owner as BlueprintGraphSite["owner"] | undefined;
        const ownElementId = owner?.kind === "widgetMain" || owner?.kind === "componentWidgetMain" ? owner.elementId : null;
        for (const node of Object.values(site.ir.nodes ?? {})) {
            if (ownElementId && LIST_ROW_WRITER_NODE_TYPES.has(node.type)) {
                ids.add(ownElementId);
            }
            for (const value of Object.values(node.params ?? {})) {
                if (typeof value === "string" && value.trim()) {
                    ids.add(value.trim());
                }
            }
        }
    }
    for (const blueprint of Object.values(ctx.blueprintDocument?.blueprints ?? {})) {
        const owner = blueprint.owner;
        if (owner && (owner.kind === "widgetMain" || owner.kind === "componentWidgetMain")) {
            const layers = Object.values(blueprint.graphs?.events ?? {});
            if (layers.some(layer => Boolean((layer as { script?: unknown }).script))) {
                ids.add(owner.elementId);
            }
        }
    }
    return ids;
}

/**
 * The first word-bearing string the list's rows put on screen: a value in its written content of a
 * field that a text in its row template is bound to. Undefined when the rows show none.
 */
function firstShownListWords(document: UIDocument, list: UIElement): string | undefined {
    const props = elementProps(list);
    const items = Array.isArray(props.items) ? (props.items as unknown[]) : [];
    if (items.length === 0) {
        return undefined;
    }
    const struct = resolveUIStruct(document, typeof props.itemStructId === "string" ? props.itemStructId : null);
    const shownKeys: string[] = [];
    const visit = (elementId: string): void => {
        const element = document.elements[elementId];
        if (!element) {
            return;
        }
        // A row field binds a site Studio offers a binding on; a plugin widget offers none.
        const site = uiTextSiteOf(element.type);
        const binding = site?.role === "words" ? element.valueBindings?.[site.textProp] : undefined;
        if (binding?.kind === "listItemField") {
            const field = findUIStructField(struct, binding.fieldId);
            if (field) {
                shownKeys.push(field.key);
            }
        }
        // A list inside the row reads its own rows, from its own shape.
        if (isListLikeWidgetType(element.type)) {
            return;
        }
        for (const childId of element.childrenIds ?? []) {
            visit(childId);
        }
    };
    for (const childId of list.childrenIds ?? []) {
        if (isUIListItemTemplateChild(document.elements[childId])) {
            visit(childId);
        }
    }
    for (const item of items) {
        if (!item || typeof item !== "object") {
            continue;
        }
        for (const key of shownKeys) {
            const value = (item as Record<string, unknown>)[key];
            if (typeof value === "string" && uiTextHasWords(value)) {
                return value;
            }
        }
    }
    return undefined;
}

/**
 * Words written into a list's content, in a project that has a second language.
 *
 * A list that no data source and no graph fills draws its written content in the game, row for row,
 * and those words have no translation unit: they read the same in every language. Reported once per
 * list, with the first such word, at info severity - the words are shown as written, which is what
 * the author wrote; what the note adds is that no locale changes them.
 *
 * Silent until the project has a second language: in a single-language project words written as
 * they are shown are the whole point of the list, and nothing there is missing a translation. A list
 * fed by the engine in its stage slot (the choice, notification and NVL lists), bound to a data
 * source, or named by any graph is left out: its written content is a layout placeholder there.
 */
function runListTextUntranslated(ctx: LintContext): LintFinding[] {
    const document = ctx.uiDocument;
    const localization = ctx.localization;
    if (!document || !localization) {
        return [];
    }
    const secondLanguages = localization.targetLocales.filter(
        locale => locale && locale !== localization.sourceLocale,
    );
    if (secondLanguages.length === 0) {
        return [];
    }
    const fedElsewhere = listsWithRowsFromElsewhere(ctx);
    const findings: LintFinding[] = [];
    for (const { surface, element } of listSurfaceElements(document)) {
        if (element.type !== "nl.list" || getUIComponentLink(element) || fedElsewhere.has(element.id)) {
            continue;
        }
        if (elementProps(element).itemsBinding) {
            continue;
        }
        const words = firstShownListWords(document, element);
        if (words === undefined) {
            continue;
        }
        findings.push({
            ruleId: "ui/list-text-untranslated",
            messageKey: "lint.rule.uiListTextUntranslated.message",
            messageParams: { text: clipLiteral(words) },
            location: surfaceLocation(surface, element),
            target: surfaceTarget(surface, element),
        });
    }
    return findings;
}

// ---------------------------------------------------------------------------
// ui/localization-key-missing
// ---------------------------------------------------------------------------

/**
 * A widget whose words are read from a translation key the project does not have.
 *
 * The widget shows the key's name, on the canvas and in the game, as a `Get Text` of the same key
 * does. Removing a key turns its widgets into ones holding its words, and a paste or an import does
 * the same for a key the project lacks, so this is reached by a hand-edited document or a `.ui` file
 * applied without `check`. Every place a widget names a key is checked - pages and component
 * definitions - and each widget is reported, since each is fixed on its own.
 *
 * Quiet when the key registry was not read (`null`), which is not a project with no keys.
 */
function runLocalizationKeyMissing(ctx: LintContext): LintFinding[] {
    const document = ctx.uiDocument;
    const keys = ctx.localizationKeys;
    if (!document || !keys) {
        return [];
    }
    const findings: LintFinding[] = [];
    for (const site of listInterfaceTextUnitSites(document, indexUITextWriters(ctx.blueprintDocument))) {
        if (site.binding.kind !== "key" || keys.has(site.binding.keyName)) {
            continue;
        }
        findings.push({
            ruleId: "ui/localization-key-missing",
            messageKey: "lint.rule.uiLocalizationKeyMissing.message",
            messageParams: { key: site.binding.keyName },
            location: site.location,
            target: site.target,
        });
    }
    return findings;
}

// ---------------------------------------------------------------------------
// ui/gesture-answered-twice
// ---------------------------------------------------------------------------

/**
 * The widget event slots a pointer gesture arrives on, and which gestures each of them answers.
 *
 * `mouseWheel` is one slot for four gestures because that is what the head is: it is handed the
 * deltas and works out for itself which way the player turned, so it answers a page bound to any of
 * the four directions. Hover and movement are absent for the same reason they are absent from
 * `UI_INPUT_POINTER_GESTURES` - no action can be bound to them, so they can never collide.
 */
const POINTER_EVENT_SLOT_GESTURES: Readonly<Record<string, readonly UIInputPointerGesture[]>> = {
    mouseClick: ["click"],
    mouseDoubleClick: ["doubleClick"],
    rightClick: ["rightClick"],
    mouseWheel: ["wheelUp", "wheelDown", "wheelLeft", "wheelRight"],
};

/**
 * Whether this widget's own blueprint carries a head node for this slot.
 *
 * Deliberately stricter than {@link hasPrivateBlueprintHead}, and the difference is the polarity of
 * the question. That one asks "is anything listening", where crediting a script-module blueprint
 * nobody can read is the safe answer; this one asks "will two things run", where crediting one would
 * put a finding on every widget with a script module on any page that declares a pointer action.
 * When the graph cannot be read, nothing is claimed.
 */
function hasPointerHeadNode(ctx: LintContext, surfaceId: string, element: UIElement, eventId: string): boolean {
    return widgetPrivateBlueprintHasSlotHead(ctx.blueprintDocument, { surfaceId }, element, eventId, "silent");
}

/** Every pointer gesture this widget answers on its own, by a head node in its own blueprint. */
function widgetAnsweredGestures(ctx: LintContext, surfaceId: string, element: UIElement): Set<UIInputPointerGesture> {
    const answered = new Set<UIInputPointerGesture>();
    for (const [eventId, gestures] of Object.entries(POINTER_EVENT_SLOT_GESTURES)) {
        if (hasPointerHeadNode(ctx, surfaceId, element, eventId)) {
            for (const gesture of gestures) {
                answered.add(gesture);
            }
        }
    }
    return answered;
}

/**
 * A widget answering a gesture its page answers too.
 *
 * `overControls: "skip"` is what a page-wide pointer action uses to stay out of the way of things
 * the player operates, and it decides what a control is from the widget *type* - which is right for
 * every type whose controlness is a property of the type, and blind to the one shape authors reach
 * for constantly: a plain container given a click head and used as a hit target. It is not a Button
 * to `isOperableWidgetType`, so the action fires as well, and both run. Nothing on the canvas shows
 * it, and nothing in either graph is wrong on its own - the defect only exists in the pair.
 *
 * Three things are deliberately *not* reported:
 *
 *  - **A widget the runtime already stands down over**, itself or anywhere up its ancestry. The
 *    same walk `pointerInputClaimedByControl` does, because a rule that judged only the widget would
 *    report every container inside a list.
 *  - **A head somewhere else pointed at this widget** (`On Element Click`). Those run from a graph
 *    the locator here does not name, so the row would send an author to a widget whose own blueprint
 *    is empty.
 */
function runGestureAnsweredTwice(ctx: LintContext): LintFinding[] {
    const document = ctx.uiDocument;
    if (!document || !ctx.blueprintDocument) {
        return [];
    }
    const findings: LintFinding[] = [];
    for (const site of listSurfaceElements(document)) {
        const enablements = site.surface.actions;
        if (!enablements?.length || getUIComponentLink(site.element)) {
            continue;
        }
        const overControl = [site.element, ...site.ancestors].some(element => isOperableWidgetType(element.type));
        const answered = overControl
            ? new Set<UIInputPointerGesture>()
            : widgetAnsweredGestures(ctx, site.surface.id, site.element);
        if (answered.size === 0) {
            continue;
        }
        for (const enablement of enablements) {
            const action = document.actions?.[enablement.actionId];
            if (!action) {
                // An enablement naming an action the project does not define. Inert at run time and
                // reported where the vocabulary is; nothing here can collide with it.
                continue;
            }
            const collides = resolveSurfaceActionBindings(action).some(
                binding => binding.kind === "pointer" && answered.has(binding.gesture),
            );
            if (!collides) {
                continue;
            }
            findings.push({
                ruleId: "ui/gesture-answered-twice",
                messageKey: "lint.rule.uiGestureAnsweredTwice.message",
                // The action's own name rather than its id: it is what the vocabulary panel shows
                // and the only spelling of it the author ever typed.
                messageParams: { action: action.name.trim() || enablement.actionId },
                location: surfaceLocation(site.surface, site.element),
                target: surfaceTarget(site.surface, site.element),
            });
        }
    }
    return findings;
}

export const UI_LINT_RULES: readonly LintRule[] = [
    {
        id: "ui/page-unreachable",
        category: "ui",
        // A warning rather than an error: a page nothing opens yet is what a page under construction
        // looks like, and an error would refuse the build of a project the author is halfway through.
        defaultSeverity: "warning",
        slug: "uiPageUnreachable",
        run: ctx => runPageUnreachable(ctx),
    },
    {
        id: "ui/empty-behavior",
        category: "ui",
        defaultSeverity: "warning",
        slug: "uiEmptyBehavior",
        run: ctx => runEmptyBehavior(ctx),
    },
    {
        id: "ui/unknown-widget",
        category: "ui",
        // An error, and the same standing `blueprint/unknown-node` has: the type is not in the
        // build, so the element draws nothing and the game diverges from the page the author sees.
        defaultSeverity: "error",
        slug: "uiUnknownWidget",
        run: ctx => runUnknownWidget(ctx),
    },
    {
        id: "ui/component-missing",
        category: "ui",
        // An error, like every other dangling reference: the widget draws nothing and says nothing,
        // and a build that shipped it would ship a hole in a page.
        defaultSeverity: "error",
        slug: "uiComponentMissing",
        run: ctx => runComponentMissing(ctx),
    },
    {
        id: "ui/frame-target-missing",
        category: "ui",
        defaultSeverity: "error",
        slug: "uiFrameTargetMissing",
        run: ctx => runFrameTargetMissing(ctx),
    },
    {
        id: "ui/frame-loop",
        category: "ui",
        // An error, like the missing page beside it: the game draws a "Page loop blocked" placeholder
        // where the author placed a page, which is the game diverging from the page they built.
        defaultSeverity: "error",
        slug: "uiFrameLoop",
        run: ctx => runFrameLoop(ctx),
    },
    {
        id: "ui/list-item-field-missing",
        category: "ui",
        // A warning rather than an error: the widget still draws, with the value it was authored
        // with, so the page is whole - it is just showing the same thing in every row. Refusing the
        // build over it would stop an author who is mid-way through reshaping a list.
        defaultSeverity: "warning",
        slug: "uiListItemFieldMissing",
        run: ctx => runListItemFieldMissing(ctx),
    },
    {
        id: "ui/component-param-missing",
        category: "ui",
        // A warning, as the missing item field is: the page is whole and every other part of the
        // component draws; what is missing is the words one widget was meant to show, and an author
        // half-way through reshaping a component's parameters should not have the build refused.
        defaultSeverity: "warning",
        slug: "uiComponentParamMissing",
        run: ctx => runComponentParamMissing(ctx),
    },
    {
        id: "ui/gesture-answered-twice",
        category: "ui",
        // Info, not warning. Nothing here is broken: both handlers run, which is often exactly what
        // was wanted - a click that plays a sound on the widget and advances the page. The rule
        // cannot tell those apart from the document, so it can only name the pair; the fix is one of
        // three different edits depending on what the author meant, and a warning that cannot say
        // which is a warning an author learns to scroll past. It also shows up the moment the page
        // is tried, unlike the references this category reports at error severity, which stay
        // invisible until a player finds them.
        defaultSeverity: "info",
        slug: "uiGestureAnsweredTwice",
        run: ctx => runGestureAnsweredTwice(ctx),
    },
    {
        id: "ui/list-text-untranslated",
        category: "ui",
        // Info: the words are shown exactly as written, so nothing deviates from what the author
        // wrote; the note is that no locale changes them.
        defaultSeverity: "info",
        slug: "uiListTextUntranslated",
        run: ctx => runListTextUntranslated(ctx),
    },
    {
        id: "ui/localization-key-missing",
        category: "ui",
        // A warning rather than an error: the widget still shows words - its own stored ones, or an
        // old translation - so the page is whole; what is wrong is that they no longer come from
        // where the author pointed them.
        defaultSeverity: "warning",
        slug: "uiLocalizationKeyMissing",
        run: ctx => runLocalizationKeyMissing(ctx),
    },
];
