/**
 * What the interface CLI knows about widget types, read from the same declarations the editor uses.
 *
 * There is no second catalogue. A widget's props come from the element its own module builds when an
 * author inserts it (`createDefaultElement`), its events and commands from the shared logic table
 * (`widgetLogic.ts`), its bindable props from the table the value runtime consults, its child rules
 * from `document.ts`, and where it may be inserted from the insert palette's config. A prop renamed
 * in any of those is renamed here on the next run.
 *
 * The one hand-written part is {@link WIDGET_NOTES}, and it is deliberately small: it holds the
 * handful of facts that no declaration states and that silently produce a wrong-looking widget when
 * an author does not know them. Everything a declaration can answer is read, never restated.
 *
 * Comments in English per project convention.
 */

import {
    uiElementTypeAcceptsChildren,
    uiElementTypeAcceptsUserChildren,
    type UIElement,
} from "@shared/types/ui-editor/document";
import { listEngineUIStructIds, resolveUIStruct } from "@shared/types/ui-editor/builtinStructs";
import { UI_STAGE_SLOT_IDS } from "@shared/types/ui-editor/stageSlots";
import type { UIStructDef } from "@shared/types/ui-editor/struct";
import { getWidgetLogicApi, type WidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { getWidgetTypeParent } from "@shared/types/ui-editor/widgetInheritance";
import { uiTextSitesOf, type UITextSite } from "@shared/types/ui-editor/textSource";
import {
    UI_INTERACTION_SOUND_KINDS,
    UI_INTERACTION_SOUND_PROP,
    uiElementTypeTakesInteractionSounds,
} from "@shared/types/ui-editor/interactionSounds";
import { BuiltinWidgetModules } from "@/lib/ui-editor/widget-modules/builtin";
import { DEFAULT_INSERT_PALETTE_CONFIG, type InsertPaletteConfigEntry } from "@/lib/ui-editor/widget-modules/insertPalette";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";
import { listBindableValueTargets } from "@/lib/ui-editor/blueprint-runtime/BlueprintValueRuntimeStore";
import { blueprintNodeRegistry, registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes";
import { queryNodes } from "../blueprint-cli/catalog";
import { propAssignmentKey } from "./dsl/parse";
import { cliPluginOwnerOf, listCliPluginWidgetModules } from "./plugins";
import { nearest } from "./text";

export type WidgetPropDoc = {
    key: string;
    /** The JavaScript shape of the default, which is what an author has to write. */
    valueType: string;
    /** The default the widget is inserted with, as JSON. */
    defaultValue: unknown;
    /** True when the parent type declares the same prop, so it is not this widget's own. */
    inherited: boolean;
};

export type WidgetPartDoc = {
    name: string;
    type: string;
    /** The structural slot marker the part carries, which is how the parent finds it again. */
    slot?: string;
};

export type WidgetSummary = {
    type: string;
    displayName: string;
    /** `primary`, `overflow`, or `internal` for a type the palette never offers. */
    palette: "primary" | "overflow" | "internal";
    /** Surface kinds the palette restricts this type to; empty means any. */
    surfaceKinds: string[];
    /** Stage slots the palette restricts this type to; empty means any. */
    stageSlots: string[];
    extends?: string;
    /** The plugin a widget type comes from, when `--plugin` loaded one that contributes it. */
    plugin?: string;
    acceptsUserChildren: boolean;
    operable: boolean;
    supportsPrivateBlueprint: boolean;
    propCount: number;
};

export type WidgetDetail = WidgetSummary & {
    acceptsChildren: boolean;
    props: WidgetPropDoc[];
    bindableProps: { propPath: string; valueType: string }[];
    events: { id: string; displayName: string; dispatchKind: string; headNodeTypes: string[]; description?: string }[];
    commands: { id: string; displayName: string; availability: string; description?: string }[];
    readableState: { id: string; displayName: string; description?: string }[];
    writableProps: { propPath: string; displayName: string; description?: string }[];
    /**
     * The palette categories of the nodes that act on this widget from its own blueprint - the ones
     * offered there and nowhere else, event heads aside. They are what an author reaches `commands`,
     * `readableState` and `writableProps` with; from any other blueprint it is the Element category.
     */
    ownBlueprintNodeCategories: string[];
    /** Parts the widget builds for itself when inserted, which an author must not delete. */
    parts: WidgetPartDoc[];
    /** States the widget's own state bar offers, for widgets whose states are not appearance variants. */
    editorStates: { id: string | null; name: string }[];
    notes: string[];
};

/**
 * How a label's marks are written, which is one model on every widget that draws a label: the same
 * runs, the same marks and the same fallback, whatever the widget calls its string.
 */
function markedLabelNote(stringProp: string): string {
    return `\`${stringProp}\` is the label's plain string and stays the one every other thing reads. A label `
        + "whose words are marked also carries `rich`, an array of `{text, marks}` runs spelling the same "
        + "string: `marks` may hold `bold`, `italic`, `color`, `ruby`, `emphasis` "
        + "(`dot`/`circle`/`sesame`/`under-dot`) and `fontSizeStep` (steps away from the label's own size). "
        + `The runs are drawn only while they still spell \`${stringProp}\`, so a translated label, a list `
        + `row's field or a \`${stringProp}\` driven by a value blueprint falls back to the plain string.`;
}

/**
 * Where a widget's words come from: one source, stored once. A translation key replaces the words -
 * in the game and on the canvas alike - and a keyed widget holds none of its own; without a key the
 * widget's own words are shown and translated through its own unit.
 */
function keyedWordsNote(widget: string, site: UITextSite, keyProp: string): string {
    const stringProp = site.textProp;
    return `A ${widget} with \`${keyProp}\` is read from that translation key - in the game, and on the `
        + `canvas - and holds no \`${stringProp}\` of its own. Its words are the key's source text in `
        + "`editor/localization/keys.json`, translated as the key; `show` prints them as a comment. "
        + `Without the key, the ${widget}'s own \`${stringProp}\` is shown, and translated through the `
        + `element's own unit (\`ui:<elementId>.${stringProp}\`) whenever the project has a second language.`;
}

/** What a widget is called in a note about its words. */
const TEXT_SITE_NOUNS: Readonly<Record<string, string>> = {
    "nl.text": "text",
    "nl.button": "button",
    "nl.textInput": "text input",
};

/**
 * The notes about a widget's words, read from its text sites (`textSites.ts`, and for a plugin's widget
 * the props its manifest declares) rather than written per widget, so a widget whose words gain a key
 * or marks gains the note with them.
 */
function textSiteNotes(type: string): string[] {
    const notes: string[] = [];
    for (const site of uiTextSitesOf(type)) {
        if (site.role !== "words") {
            continue;
        }
        if (site.marksProp) {
            notes.push(markedLabelNote(site.textProp));
        }
        if (site.keyProp && site.canvasDrawsKey) {
            notes.push(keyedWordsNote(TEXT_SITE_NOUNS[type] ?? type, site, site.keyProp));
        }
        if (site.valueBinding === "offered") {
            notes.push(componentParamWordsNote(TEXT_SITE_NOUNS[type] ?? type, site.textProp));
        }
    }
    return notes;
}

/**
 * How a widget inside a component shows words each placement gives it: a text parameter, bound the
 * way a list row's field is, translated per placement.
 */
function componentParamWordsNote(widget: string, stringProp: string): string {
    return `Inside a component definition, \`bind ${stringProp} = param <paramId>\` shows one of the `
        + "component's text parameters (`param <paramId> <name> type=text = <default>`): every placement "
        + "draws the value it gives - written directly, `component <id> <paramId>=\"…\"`, or as a key, "
        + "`<paramId>.key=<key>` - on the canvas and in the game, and no graph is involved. Words written "
        + "directly are translated through the placement's own unit (`ui:<placementId>.param.<paramId>`), "
        + "a default through the component's (`ui:<componentId>.param.<paramId>`). The "
        + `${widget}'s own \`${stringProp}\` is then sample text, drawn only while the component itself is edited.`;
}

/**
 * Facts about a widget that no declaration in the repository states.
 *
 * Each one has cost somebody a wrong-looking interface at least once, and each is about *authoring*
 * rather than about the type: a caller writing a template needs them before the first write, and no
 * amount of reading `createDefaultElement` produces them. Keep this list short - a note that a
 * declaration could carry belongs in the declaration.
 */
const WIDGET_NOTES: Readonly<Record<string, readonly string[]>> = {
    "nl.container": [
        "A container written with `fillVisible = false` alone still paints white. The renderer reads "
            + "the matching row of `appearance.variants[*].propertyGroups`, and the flat prop is only the "
            + "baseline it is laid over - change both, or copy the whole `props` bag from a container that "
            + "already looks right.",
        "Children are laid out absolutely unless `layoutKind` is `stack` or `scroll`. A stack keeps its "
            + "children on one line until `stackWrap = true`; wrapped lines pack against the start of the "
            + "cross axis with `stackGap` between them, and `stackAlignItems` then reads within each line "
            + "rather than across the whole box.",
    ],
    "nl.button": [
        "A new button carries an `appearance` model seeded from its flat props. Writing a colour on the "
            + "flat prop alone leaves the variant row holding the old one; see the container note.",
    ],
    "nl.image": [
        "The picture is `imageFill.assetId`, not a bare `assetId`. `imageFill.assetId` is also the only "
            + "image prop a value blueprint can drive, which is what makes per-row thumbnails possible.",
    ],
    "nl.list": [
        "A list repeats one authored child - its item template - once per item. The elements inside the "
            + "template read their row through `bind <prop> = field <fieldId>`, and the field ids come from "
            + "the struct named by `itemStructId`.",
        "`repeatDirection` is one axis and `repeatWrap = true` adds the other: items flow along the "
            + "direction, break at the edge of the list's box, and the lines pack from the start with "
            + "`itemGap` between them - which is how a grid is built from one item template. Wrapping also "
            + "turns the axis the list scrolls along, since what grows is now the stack of lines.",
    ],
    "nl.slider": [
        "The track and the handle are elements the widget built and pointed at through "
            + "`trackElementId` / `handleElementId`. Do not re-parent or delete them.",
    ],
    "nl.switch": [
        "The track and the thumb are elements the widget built and pointed at through "
            + "`trackElementId` / `thumbElementId`. The on/off look belongs on their appearance variants, "
            + "and the thumb's travel on the `on` variant's `transformOffsetX`.",
    ],
    "nl.frame": [
        "A frame draws another Page inside this one. `targetSurfaceId` names the surface, and `params` is "
            + "the prop bag that surface reads through `Get Page Prop`.",
        "`props.animation = {…}` overrides how the target Page enters and leaves inside this frame; unset, "
            + "the Page's own animation plays. It is written with the prefix because a bare `animation = {…}` "
            + "is the frame element's own enter/exit, as on every element - the same shape of record, so "
            + "writing the wrong one is not an error, it just animates the frame instead of its page.",
    ],
    "nl.root": [
        "Every surface and every component definition has exactly one, and it is not insertable: it is "
            + "the tree's root, created with the surface.",
    ],
};

/** The palette entry for a type, which is what says where it may be inserted. */
function paletteEntry(type: string): InsertPaletteConfigEntry | undefined {
    // Widened to the declared entry type: the config is `as const`, so each element is its own
    // literal type and the union has no common `placement` to read.
    const config: readonly InsertPaletteConfigEntry[] = DEFAULT_INSERT_PALETTE_CONFIG;
    // A plugin's widget is not in the config; the editor lists every one in the palette's overflow
    // menu (`listPluginInsertPaletteEntries`), on any surface.
    return config.find(entry => entry.type === type) ?? (cliPluginOwnerOf(type) ? { type, placement: "overflow" } : undefined);
}

/** Studio's widgets, and those of any plugin this run was handed with `--plugin`. */
export function listWidgetModules(): UIWidgetModule[] {
    return [...BuiltinWidgetModules, ...listCliPluginWidgetModules()];
}

export function findWidgetModule(type: string): UIWidgetModule | undefined {
    return listWidgetModules().find(module => module.type === type);
}

/**
 * The props a freshly inserted widget of this type carries.
 *
 * Read from the element the module builds rather than from a type declaration, because the defaults
 * are the only machine-readable statement of what a widget's prop bag holds - the types are erased
 * before anything can ask. A widget may also carry keys no default declares (the props naming where
 * its words come from - see `textSites.ts`), so this is the shape of a new widget, not a closed set.
 */
function readProps(module: UIWidgetModule): Record<string, unknown> {
    try {
        return (module.createDefaultElement().props ?? {}) as Record<string, unknown>;
    } catch {
        return {};
    }
}

function describeValue(value: unknown): string {
    if (value === undefined) {
        // A default the module leaves unset. The prop is real - the widget reads it - but a new
        // element carries no value for it, so JSON never sees the key.
        return "unset";
    }
    if (value === null) {
        return "null";
    }
    if (Array.isArray(value)) {
        return "array";
    }
    return typeof value;
}

export function summariseWidget(module: UIWidgetModule): WidgetSummary {
    const entry = paletteEntry(module.type);
    const logic: WidgetLogicApi | undefined = module.logicApi ?? getWidgetLogicApi(module.type);
    return {
        type: module.type,
        displayName: safeDisplayName(module),
        palette: entry ? (entry.placement ?? "primary") : "internal",
        surfaceKinds: [...(entry?.surfaceKinds ?? [])],
        stageSlots: [...(entry?.stageSlots ?? [])],
        extends: module.extends ?? getWidgetTypeParent(module.type),
        ...(cliPluginOwnerOf(module.type) ? { plugin: cliPluginOwnerOf(module.type) } : {}),
        acceptsUserChildren: uiElementTypeAcceptsUserChildren(module.type),
        operable: logic?.operable === true,
        supportsPrivateBlueprint: logic?.supportsPrivateBlueprint === true,
        propCount: Object.keys(readProps(module)).length,
    };
}

/** `displayName` is a translated getter; a catalogue run has no locale loaded, so it may be empty. */
function safeDisplayName(module: UIWidgetModule): string {
    try {
        return module.displayName || module.type;
    } catch {
        return module.type;
    }
}

export function describeWidget(type: string): WidgetDetail | null {
    const module = findWidgetModule(type);
    if (!module) {
        return null;
    }
    const summary = summariseWidget(module);
    const props = readProps(module);
    const parentType = summary.extends;
    const parentProps = parentType ? readProps(findWidgetModule(parentType) ?? module) : {};
    const logic: WidgetLogicApi | undefined = module.logicApi ?? getWidgetLogicApi(module.type);
    return {
        ...summary,
        acceptsChildren: uiElementTypeAcceptsChildren(module.type),
        props: [
            ...Object.entries(props).map(([key, value]) => ({
                key,
                valueType: describeValue(value),
                defaultValue: value,
                inherited: parentType != null && key in parentProps,
            })),
            ...interactionSoundProps(module.type, props),
        ],
        bindableProps: listBindableValueTargets()
            .filter(target => target.elementType === module.type)
            .map(target => ({ propPath: target.propPath, valueType: target.valueType })),
        events: (logic?.events ?? []).map(event => ({
            id: event.id,
            displayName: event.displayName,
            dispatchKind: event.dispatchKind,
            headNodeTypes: [...(event.headNodeTypes ?? [])],
            description: event.description,
        })),
        commands: (logic?.commands ?? []).map(command => ({
            id: command.id,
            displayName: command.displayName,
            availability: command.availability,
            description: command.description,
        })),
        readableState: (logic?.readableState ?? []).map(state => ({ ...state })),
        writableProps: (logic?.writableProps ?? []).map(prop => ({ ...prop })),
        ownBlueprintNodeCategories: ownBlueprintNodeCategories(module.type),
        parts: readParts(module),
        editorStates: readEditorStates(module),
        notes: [...(WIDGET_NOTES[module.type] ?? []), ...textSiteNotes(module.type)],
    };
}

/**
 * The categories an author finds a widget's own nodes under in the add-node palette of its blueprint:
 * Set Visible, Get Selected Index, Refresh List Items and the rest of the List category on a list, and
 * the Displayable category on anything drawn.
 *
 * Read off the question `blueprint.js nodes --owner widgetMain --widget <type>` asks the palette: the
 * nodes offered on a widget of this type and not on a widget of no particular type. Event heads are
 * left to the `events` section, which names them one by one.
 */
function ownBlueprintNodeCategories(type: string): string[] {
    registerCoreBlueprintNodes();
    const onAnyWidget = new Set(queryNodes({ ownerKind: "widgetMain" }).map(node => node.type));
    const categories = new Set<string>();
    for (const node of queryNodes({ ownerKind: "widgetMain", widgetElementType: type })) {
        const role = blueprintNodeRegistry.get(node.type)?.role;
        if (onAnyWidget.has(node.type) || role === "eventHead" || role === "elementEventHead") {
            continue;
        }
        categories.add(node.category);
    }
    return [...categories];
}

/**
 * The hover and click sound props, which every type but the root reads and no new element carries.
 *
 * Listed so `widget <type>` names them and a file that sets them is not reported as setting a key
 * nothing declares. They are the element's own (`@shared/types/ui-editor/interactionSounds`) rather
 * than any one widget's, so no module's defaults could state them.
 */
function interactionSoundProps(type: string, props: Record<string, unknown>): WidgetDetail["props"] {
    if (!uiElementTypeTakesInteractionSounds(type)) {
        return [];
    }
    return UI_INTERACTION_SOUND_KINDS
        .map(kind => UI_INTERACTION_SOUND_PROP[kind])
        .filter(key => !(key in props))
        .map(key => ({ key, valueType: describeValue(undefined), defaultValue: undefined, inherited: false }));
}

/**
 * The children the widget builds for itself the moment it is inserted.
 *
 * Called with a counter for `generateId` rather than a real minter: this is asking what parts exist,
 * and the ids in the answer are thrown away.
 */
function readParts(module: UIWidgetModule): WidgetPartDoc[] {
    if (!module.createDefaultChildElements) {
        return [];
    }
    try {
        let counter = 0;
        const element = { id: "self", ...module.createDefaultElement() } as UIElement;
        const result = module.createDefaultChildElements({
            element,
            generateId: () => `part-${(counter += 1)}`,
        });
        return result.children.map(child => ({
            name: child.name ?? child.type,
            type: child.type,
            slot: readSlotMarker(child),
        }));
    } catch {
        return [];
    }
}

/** The one `extra` key a structural part carries, whatever the owning widget calls it. */
function readSlotMarker(child: UIElement): string | undefined {
    const extra = (child.extra ?? {}) as Record<string, unknown>;
    for (const value of Object.values(extra)) {
        if (typeof value === "string") {
            return value;
        }
    }
    return undefined;
}

function readEditorStates(module: UIWidgetModule): { id: string | null; name: string }[] {
    if (!module.listEditorStates) {
        return [];
    }
    try {
        const element = { id: "self", ...module.createDefaultElement() } as UIElement;
        return module.listEditorStates(element);
    } catch {
        return [];
    }
}

/** The surface kinds a widget type can be restricted to, which is what `--surface-kind` takes. */
export const WIDGET_SURFACE_KINDS = ["appSurface", "stageSurface"] as const;

/** The player slots a stage surface mounts into, which is what `--slot` takes. */
export const WIDGET_STAGE_SLOTS = UI_STAGE_SLOT_IDS;

/** Widget types spelled close to `type`, for a message that ends the search rather than starting one. */
export function nearestWidgetTypes(type: string, limit = 5): string[] {
    return nearest(type, listWidgetModules().map(module => module.type), limit);
}

export type WidgetQuery = {
    search?: string;
    /** Only types the insert palette offers. */
    insertableOnly?: boolean;
    /** Only types allowed on this surface kind. */
    surfaceKind?: string;
    /** Only types allowed in this stage slot. */
    stageSlot?: string;
};

export function queryWidgets(query: WidgetQuery): WidgetSummary[] {
    const words = (query.search ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
    return listWidgetModules().map(summariseWidget).filter(widget => {
        if (query.insertableOnly && widget.palette === "internal") {
            return false;
        }
        if (query.surfaceKind && widget.surfaceKinds.length > 0 && !widget.surfaceKinds.includes(query.surfaceKind)) {
            return false;
        }
        if (query.stageSlot && widget.stageSlots.length > 0 && !widget.stageSlots.includes(query.stageSlot)) {
            return false;
        }
        if (words.length === 0) {
            return true;
        }
        const haystack = `${widget.type} ${widget.displayName}`.toLowerCase();
        return words.every(word => haystack.includes(word));
    });
}

/**
 * The struct shapes a list may name without declaring anything: the engine's, then those of the
 * plugins this run knows - the bundled ones and any `--plugin`.
 */
export function listBuiltinStructs(): UIStructDef[] {
    return listEngineUIStructIds().flatMap(id => resolveUIStruct(null, id) ?? []);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatWidgetList(widgets: readonly WidgetSummary[]): string {
    if (widgets.length === 0) {
        return "No widget type matched.";
    }
    const width = Math.max(...widgets.map(widget => widget.type.length));
    return widgets
        .map(widget => {
            const where = [
                widget.palette === "internal" ? "internal" : widget.palette,
                ...widget.surfaceKinds,
                ...widget.stageSlots.map(slot => `slot:${slot}`),
            ].join(" ");
            const traits = [
                widget.acceptsUserChildren ? "children" : null,
                widget.operable ? "operable" : null,
                widget.supportsPrivateBlueprint ? "blueprint" : null,
            ].filter(Boolean).join(", ");
            return `${widget.type.padEnd(width)}  ${where}${traits ? `  (${traits})` : ""}`;
        })
        .join("\n");
}

export function formatWidgetDetail(detail: WidgetDetail): string {
    const lines: string[] = [];
    lines.push(detail.type);
    if (detail.displayName && detail.displayName !== detail.type) {
        lines.push(`  name       ${detail.displayName}`);
    }
    const where = detail.palette === "internal"
        ? "not insertable - the editor creates it"
        : [
            detail.palette,
            detail.surfaceKinds.length ? detail.surfaceKinds.join("/") : "any surface",
            detail.stageSlots.length ? `stage slot ${detail.stageSlots.join("/")}` : "",
        ].filter(Boolean).join(", ");
    lines.push(`  palette    ${where}`);
    if (detail.extends) {
        lines.push(`  extends    ${detail.extends}`);
    }
    if (detail.plugin) {
        lines.push(`  plugin     ${detail.plugin} (loaded with --plugin)`);
    }
    lines.push(
        `  children   ${
            detail.acceptsUserChildren
                ? "accepts children"
                : detail.acceptsChildren
                    ? "structural parts only - an author may not add children"
                    : "none"
        }`,
    );
    lines.push(
        `  blueprint  ${
            detail.supportsPrivateBlueprint
                ? "private blueprint supported (owner=widgetMain)"
                : "no private blueprint"
        }${detail.operable ? "; the player operates it, so panel gestures stand down over it" : ""}`,
    );
    if (detail.commands.length + detail.readableState.length + detail.writableProps.length > 0) {
        // Where the commands, state and props listed further down are reached from. No one node
        // reaches them: each widget type has nodes of its own, under the categories named here.
        const own = detail.ownBlueprintNodeCategories;
        const inOwn = own.length > 0 ? `${own.join(", ")} in its own blueprint; ` : "";
        lines.push(`  nodes      ${inOwn}Element in any blueprint`);
    }

    if (detail.parts.length > 0) {
        lines.push("");
        lines.push("  parts (built with the widget; do not delete or re-parent)");
        for (const part of detail.parts) {
            lines.push(`    ${part.name}  [${part.type}]${part.slot ? `  slot=${part.slot}` : ""}`);
        }
    }

    if (detail.props.length > 0) {
        lines.push("");
        lines.push("  props (write these as `key = value` under the element)");
        // Keyed as a `.ui` file writes them, so a prop that needs `props.` is shown with it.
        const keys = detail.props.map(prop => propAssignmentKey(prop.key));
        const width = Math.max(...keys.map(key => key.length));
        for (const [index, prop] of detail.props.entries()) {
            const value = JSON.stringify(prop.defaultValue) ?? "(unset)";
            const shown = value.length > 60 ? `${value.slice(0, 57)}...` : value;
            lines.push(
                `    ${keys[index].padEnd(width)}  ${prop.valueType.padEnd(7)} = ${shown}`
                    + (prop.inherited ? `  (from ${detail.extends})` : ""),
            );
        }
    }

    if (detail.bindableProps.length > 0) {
        lines.push("");
        lines.push("  bindable props (a value blueprint may drive these)");
        for (const target of detail.bindableProps) {
            lines.push(`    bind ${target.propPath} = blueprint <id>      # ${target.valueType}`);
        }
    }

    if (detail.events.length > 0) {
        lines.push("");
        lines.push("  events (head nodes a private blueprint on this widget may carry)");
        const width = Math.max(...detail.events.map(event => event.id.length));
        for (const event of detail.events) {
            lines.push(
                `    ${event.id.padEnd(width)}  ${event.dispatchKind.padEnd(11)} ${event.headNodeTypes.join(", ")}`,
            );
        }
    }

    for (const [title, rows] of [
        ["commands", detail.commands.map(c => `${c.id}  ${c.displayName}${c.availability === "planned" ? "  (planned)" : ""}`)],
        ["readable state", detail.readableState.map(s => `${s.id}  ${s.displayName}`)],
        ["writable props", detail.writableProps.map(p => `${p.propPath}  ${p.displayName}`)],
        ["editor states", detail.editorStates.map(s => `${s.id ?? "(rest)"}  ${s.name}`)],
    ] as const) {
        if (rows.length > 0) {
            lines.push("");
            lines.push(`  ${title}`);
            for (const row of rows) {
                lines.push(`    ${row}`);
            }
        }
    }

    if (detail.notes.length > 0) {
        lines.push("");
        lines.push("  notes");
        for (const note of detail.notes) {
            lines.push(`    - ${wrapNote(note)}`);
        }
    }
    return lines.join("\n");
}

/** Soft-wraps a note at 96 columns, continuing under the bullet. */
function wrapNote(note: string): string {
    const words = note.split(" ");
    const out: string[] = [];
    let current = "";
    for (const word of words) {
        if (current.length + word.length + 1 > 96) {
            out.push(current);
            current = word;
            continue;
        }
        current = current ? `${current} ${word}` : word;
    }
    if (current) {
        out.push(current);
    }
    return out.join("\n      ");
}

export function formatStructs(structs: readonly UIStructDef[]): string {
    return structs
        .map(struct => {
            const fields = struct.fields
                .map(field => `    ${field.key}: ${field.type}${field.label ? `  "${field.label}"` : ""}`)
                .join("\n");
            return `${struct.id}\n${fields}`;
        })
        .join("\n\n");
}
