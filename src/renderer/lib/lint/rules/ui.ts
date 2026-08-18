import { DEFAULT_APP_SURFACE_NAME, MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import {
  BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
  resolveBlueprintEventHeadTypesForUiSlot
} from "@shared/types/blueprint/graph";
import type { UIDocument, UIElement, UISurface } from "@shared/types/ui-editor/document";
import { getUIComponentLink } from "@shared/types/ui-editor/document";
import { getUIFrameWidgetProps, UI_FRAME_ELEMENT_TYPE } from "@shared/types/ui-editor/frame";
import { isListLikeWidgetType } from "@shared/types/ui-editor/list";
import type { SearchJumpTarget } from "../../workspace/services/search/searchIndexModel";
import { widgetMainOwnerKey } from "../../workspace/services/ui-editor/blueprint/ownerKeys";
import { blueprintNodeRegistry } from "../../ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "../../ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { readBlueprintElementRefParams } from "../../ui-editor/blueprint-nodes/built-in/elementRefUtils";
import { listBlueprintGraphSites } from "../blueprintSites";
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
 *  - **Only what a surface holds is swept.** A component *definition* is not a page: its elements
 *    have no surface to file a finding under, and one definition placed on four pages would report
 *    the same defect from a location the report cannot navigate to. Component instances are skipped
 *    for the mirror-image reason - their wiring lives in the definition, where this sweep is not
 *    looking, so judging them would be judging evidence it does not have.
 *  - **Runtime semantics decide what counts as wired, not the inspector.** A click travels: an
 *    element with no listener hands the event to its parent (`isPointerPositionElementEvent`), a
 *    list row's clicks belong to the list, and an `On Element Click` head anywhere in the project
 *    listens without the widget carrying any binding at all. A rule that read only the widget's own
 *    `behavior` would report a working button on every one of those shapes.
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
 * The page's name as every other surface spells it.
 *
 * The main page is shown under a fixed name in the surface list, the canvas menu and the rename
 * dialog whatever its stored `name` says (`getSurfaceDisplayLabel`), so a report that used the
 * stored one would name a page the author cannot find in the panel they are being sent to.
 */
function surfaceDisplayName(surface: UISurface): string {
  return surface.id === MAIN_APP_SURFACE_ID ? DEFAULT_APP_SURFACE_NAME : surface.name;
}

function surfaceLocation(surface: UISurface, element?: UIElement): LintLocation {
  const name = element?.name?.trim();
  return {
    kind: "surface",
    surfaceId: surface.id,
    surfaceName: surfaceDisplayName(surface),
    ...(element ? { elementId: element.id } : {}),
    ...(name ? { elementName: name } : {})
  };
}

function surfaceTarget(surface: UISurface): SearchJumpTarget {
  return { kind: "uiSurface", surfaceId: surface.id };
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
// ui/unlocalized-text
// ---------------------------------------------------------------------------

/**
 * Widget text an author writes and a player reads, with the two ways of binding it.
 *
 * The same three sites `useLocalizedWidgetText` resolves at run time, which is what makes the answer
 * checkable: a prop this table did not list would be translated by the runtime and reported as
 * unlocalized here, and a prop it listed by mistake would be reported while nothing can translate
 * it. `optInProp` is the implicit unit (`ui:<elementId>.<prop>`); a text input has no such flag on
 * its props at all, so its placeholder is bound by a named key or not at all.
 */
const LOCALIZABLE_TEXT_SITES: Readonly<
  Record<
    string,
    { readonly textProp: string; readonly keyProp: string; readonly optInProp?: string }
  >
> = {
  "nl.text": { textProp: "text", keyProp: "localizationKey", optInProp: "localizable" },
  "nl.button": { textProp: "label", keyProp: "localizationKey", optInProp: "localizable" },
  "nl.textInput": { textProp: "placeholder", keyProp: "placeholderLocalizationKey" }
};

/** Longest literal carried into the message; past this it is clipped, as a story excerpt is. */
const TEXT_EXCERPT_MAX_CHARS = 48;

/**
 * Whether a literal is prose at all.
 *
 * One letter, in any script, is the test - which covers the three exclusions this rule owes
 * ("", "1,250", "…") with one predicate rather than three that would each miss the combinations of
 * the others ("100%", "12:30", "→"). A label with no letter in it reads the same in every language,
 * and reporting one is how a rule teaches an author that its findings are not worth reading.
 */
function hasTranslatableWord(text: string): boolean {
  return /\p{L}/u.test(text);
}

function clipLiteral(text: string): string {
  const flattened = text.replace(/\s+/g, " ").trim();
  return flattened.length > TEXT_EXCERPT_MAX_CHARS
    ? `${flattened.slice(0, TEXT_EXCERPT_MAX_CHARS - 1)}…`
    : flattened;
}

/**
 * A literal on a page that no locale can ever change.
 *
 * **Silent until the project has a second language.** In a single-language project writing the words
 * straight onto the button is not a defect, it is the whole point of a text field, so a rule that
 * fired there would open with one finding per label on a project that has nothing wrong with it -
 * and the author's only move would be to switch the rule off for good, taking the day they add a
 * locale with them. `localization` is `null` until the project configures one, and a target list
 * holding only the source locale is not a second language either.
 *
 * A widget that opted in through `localizable` is bound just as firmly as one naming a key: the
 * implicit unit `ui:<elementId>.<prop>` is a row in every target locale's document. Both are
 * "translatable"; neither is reported.
 */
function runUnlocalizedText(ctx: LintContext): LintFinding[] {
  const document = ctx.uiDocument;
  const localization = ctx.localization;
  if (!document || !localization) {
    return [];
  }
  const secondLanguages = localization.targetLocales.filter(
    (locale) => locale && locale !== localization.sourceLocale
  );
  if (secondLanguages.length === 0) {
    return [];
  }
  const findings: LintFinding[] = [];
  for (const { surface, element } of listSurfaceElements(document)) {
    const site = LOCALIZABLE_TEXT_SITES[element.type];
    if (!site || getUIComponentLink(element)) {
      continue;
    }
    const props = elementProps(element);
    const text = readStringProp(props, site.textProp);
    if (!hasTranslatableWord(text)) {
      continue;
    }
    const boundToKey = readStringProp(props, site.keyProp).trim().length > 0;
    const boundToUnit = site.optInProp !== undefined && props[site.optInProp] === true;
    if (boundToKey || boundToUnit) {
      continue;
    }
    findings.push({
      ruleId: "ui/unlocalized-text",
      messageKey: "lint.rule.uiUnlocalizedText.message",
      // The literal itself, because nothing in the location can carry it and it is the only
      // thing that tells forty findings on one page apart.
      messageParams: { text: clipLiteral(text) },
      location: surfaceLocation(surface, element),
      target: surfaceTarget(surface)
    });
  }
  return findings;
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
    .map(([source]) => source)
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
function collectGraphSurfaceTargets(
  ctx: LintContext,
  surfaceIds: ReadonlySet<string>
): Set<string> {
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
      for (const param of blueprintNodeRegistry.resolveCatalogEntryForNode(node.type, params)
        .inspectorParams ?? []) {
        if (
          !param.dynamicOptionsSource ||
          !SURFACE_OPTIONS_SOURCES.has(param.dynamicOptionsSource)
        ) {
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
 * The page a build starts on.
 *
 * Every launcher - Run, Test, and the compiled game - opens {@link MAIN_APP_SURFACE_ID} by name, so
 * that surface is entered whether or not anything navigates to it. The fallback to the first app
 * surface mirrors `resolveGameRuntimeEntrySurface`, which is what the shell falls back to when the
 * pack names no entry: without it a document that somehow lost its main page would report *every*
 * page as unreachable, including the one the game boots into.
 */
function resolveEntrySurfaceId(document: UIDocument): string | undefined {
  const surfaces = document.surfaces ?? [];
  return (
    surfaces.find((surface) => surface.id === MAIN_APP_SURFACE_ID)?.id ??
    surfaces.find((surface) => surface.kind === "appSurface")?.id
  );
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
  const pages = (document.surfaces ?? []).filter((surface) => surface.kind === "appSurface");
  const surfaceIds = new Set(pages.map((surface) => surface.id));
  const entered = collectGraphSurfaceTargets(ctx, surfaceIds);
  for (const embedded of collectFrameSurfaceTargets(document)) {
    entered.add(embedded);
  }
  const entrySurfaceId = resolveEntrySurfaceId(document);
  return pages
    .filter((surface) => surface.id !== entrySurfaceId && !entered.has(surface.id))
    .map((surface) => ({
      ruleId: "ui/page-unreachable" as const,
      messageKey: "lint.rule.uiPageUnreachable.message" as const,
      location: surfaceLocation(surface),
      target: surfaceTarget(surface)
    }));
}

// ---------------------------------------------------------------------------
// ui/empty-behavior
// ---------------------------------------------------------------------------

/** The widget event slot a press arrives on, and the one a list raises for a row. */
const CLICK_EVENT_ID = "mouseClick";
const LIST_ITEM_CLICK_EVENT_ID = "itemClick";

/** Whether the widget's own `behavior` record runs anything for this slot. */
function hasBehaviorBinding(element: UIElement, eventId: string): boolean {
  const binding = element.behavior?.events?.[eventId];
  if (!binding) {
    return false;
  }
  return (
    binding.kind === "blueprintEvent" || (binding.kind === "actions" && binding.actions.length > 0)
  );
}

/**
 * Whether the widget's own blueprint carries a head node that starts on this slot.
 *
 * The graph's *name* is not consulted, deliberately: the dispatcher looks for a head node of a type
 * the slot allows, in any of the blueprint's event graphs, so a handler an author put on a layer
 * called anything at all still runs. `resolveBlueprintEventHeadTypesForUiSlot` is the same function
 * it asks, so the two cannot disagree about which heads count for which widget.
 */
function hasPrivateBlueprintHead(
  ctx: LintContext,
  surfaceId: string,
  element: UIElement,
  eventId: string
): boolean {
  const document = ctx.blueprintDocument;
  if (!document) {
    return false;
  }
  const heads = new Set(resolveBlueprintEventHeadTypesForUiSlot(eventId, element.type));
  if (heads.size === 0) {
    return false;
  }
  const blueprintId =
    document.ownerRecords?.[widgetMainOwnerKey(surfaceId, element.id)]?.activeBlueprintId;
  const blueprint = blueprintId ? document.blueprints?.[blueprintId] : undefined;
  if (!blueprint || blueprint.program.kind !== "graph") {
    // A script-module blueprint exports its handlers as functions this sweep cannot read, so an
    // owner that has one is credited with listening rather than reported for staying silent.
    return Boolean(blueprint);
  }
  return Object.values(blueprint.program.graphs.events ?? {}).some((eventGraph) =>
    Object.values(eventGraph?.graph?.nodes ?? {}).some((node) => heads.has(node.type))
  );
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
  elementClickTargets: ReadonlySet<string>
): boolean {
  for (const element of [site.element, ...site.ancestors]) {
    if (elementClickTargets.has(`${site.surface.id}\u0000${element.id}`)) {
      return true;
    }
    if (
      hasBehaviorBinding(element, CLICK_EVENT_ID) ||
      hasPrivateBlueprintHead(ctx, site.surface.id, element, CLICK_EVENT_ID)
    ) {
      return true;
    }
    if (
      isListLikeWidgetType(element.type) &&
      (hasBehaviorBinding(element, LIST_ITEM_CLICK_EVENT_ID) ||
        hasPrivateBlueprintHead(ctx, site.surface.id, element, LIST_ITEM_CLICK_EVENT_ID))
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
 * was written for, and it is invisible on the canvas. Plus any widget carrying an explicit `noop`
 * on its click slot, whatever its type: `noop` is not a state an author picks, it is what a binding
 * degrades to when the graph it pointed at is deleted, so an image or a container wearing one used
 * to do something and now does not.
 *
 * A button with interaction switched off is not a candidate: it is drawn as unavailable and takes no
 * clicks, so having no handler is the correct state and reporting it would be a warning whose only
 * fix is to make the widget lie.
 */
function isClickableCandidate(element: UIElement): boolean {
  if (element.behavior?.events?.[CLICK_EVENT_ID]?.kind === "noop") {
    return true;
  }
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
      target: surfaceTarget(site.surface)
    });
  }
  return findings;
}

export const UI_LINT_RULES: readonly LintRule[] = [
  {
    id: "ui/unlocalized-text",
    category: "ui",
    defaultSeverity: "warning",
    slug: "uiUnlocalizedText",
    run: (ctx) => runUnlocalizedText(ctx)
  },
  {
    id: "ui/page-unreachable",
    category: "ui",
    // A warning rather than an error: a page nothing opens yet is what a page under construction
    // looks like, and an error would refuse the build of a project the author is halfway through.
    defaultSeverity: "warning",
    slug: "uiPageUnreachable",
    run: (ctx) => runPageUnreachable(ctx)
  },
  {
    id: "ui/empty-behavior",
    category: "ui",
    defaultSeverity: "warning",
    slug: "uiEmptyBehavior",
    run: (ctx) => runEmptyBehavior(ctx)
  }
];
