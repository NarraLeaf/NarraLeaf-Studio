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
import { BUILTIN_UI_STRUCTS } from "@shared/types/ui-editor/builtinStructs";
import { UI_STAGE_SLOT_IDS } from "@shared/types/ui-editor/stageSlots";
import type { UIStructDef } from "@shared/types/ui-editor/struct";
import { getWidgetLogicApi, type WidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { getWidgetTypeParent } from "@shared/types/ui-editor/widgetInheritance";
import { BuiltinWidgetModules } from "@/lib/ui-editor/widget-modules/builtin";
import { DEFAULT_INSERT_PALETTE_CONFIG, type InsertPaletteConfigEntry } from "@/lib/ui-editor/widget-modules/insertPalette";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";
import { listBindableValueTargets } from "@/lib/ui-editor/blueprint-runtime/BlueprintValueRuntimeStore";
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
    /** Parts the widget builds for itself when inserted, which an author must not delete. */
    parts: WidgetPartDoc[];
    /** States the widget's own state bar offers, for widgets whose states are not appearance variants. */
    editorStates: { id: string | null; name: string }[];
    notes: string[];
};

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
    return config.find(entry => entry.type === type);
}

export function listWidgetModules(): UIWidgetModule[] {
    return BuiltinWidgetModules;
}

export function findWidgetModule(type: string): UIWidgetModule | undefined {
    return BuiltinWidgetModules.find(module => module.type === type);
}

/**
 * The props a freshly inserted widget of this type carries.
 *
 * Read from the element the module builds rather than from a type declaration, because the defaults
 * are the only machine-readable statement of what a widget's prop bag holds - the types are erased
 * before anything can ask. A widget may also carry keys no default declares (`localizationKey` is
 * the common one), so this is the shape of a new widget, not a closed set.
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
        props: Object.entries(props).map(([key, value]) => ({
            key,
            valueType: describeValue(value),
            defaultValue: value,
            inherited: parentType != null && key in parentProps,
        })),
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
        parts: readParts(module),
        editorStates: readEditorStates(module),
        notes: [...(WIDGET_NOTES[module.type] ?? [])],
    };
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
    return nearest(type, BuiltinWidgetModules.map(module => module.type), limit);
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
    return BuiltinWidgetModules.map(summariseWidget).filter(widget => {
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

/** The struct shapes that ship with Studio, which a list may name without declaring anything. */
export function listBuiltinStructs(): UIStructDef[] {
    return Object.values(BUILTIN_UI_STRUCTS);
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
        const width = Math.max(...detail.props.map(prop => prop.key.length));
        for (const prop of detail.props) {
            const value = JSON.stringify(prop.defaultValue) ?? "(unset)";
            const shown = value.length > 60 ? `${value.slice(0, 57)}...` : value;
            lines.push(
                `    ${prop.key.padEnd(width)}  ${prop.valueType.padEnd(7)} = ${shown}`
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
        ["commands (Call Widget Command)", detail.commands.map(c => `${c.id}  ${c.displayName}${c.availability === "planned" ? "  (planned)" : ""}`)],
        ["readable state (Get Widget State)", detail.readableState.map(s => `${s.id}  ${s.displayName}`)],
        ["writable props (Set Widget Prop)", detail.writableProps.map(p => `${p.propPath}  ${p.displayName}`)],
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
