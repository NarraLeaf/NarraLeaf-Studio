import type { LucideIcon } from "lucide-react";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { WidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { getWidgetTypeParent } from "@shared/types/ui-editor/widgetInheritance";
import type {
    FieldDefinition,
    PropertyEditorSchema,
    PropertyEditorTab,
    SectionFieldDefinition,
} from "@/apps/workspace/modules/properties/framework/types";
import type { InspectorContext, UIInspectorData, UIWidgetModule } from "./types";

/**
 * Where an inserted field goes among its new siblings.
 * `{ after }` / `{ before }` name an inherited field id; an id that is not there appends, so a
 * renamed parent field costs the child its position rather than its field.
 */
export type InspectorInsertPosition = "start" | "end" | { after: string } | { before: string };

export type InspectorInsertion = {
    /** Section id to insert into, or tab id when `into` is `"tab"`. */
    target: string;
    into?: "section" | "tab";
    position?: InspectorInsertPosition;
    fields: FieldDefinition<UIInspectorData>[];
};

/**
 * Declarative edits a specialisation makes to the inspector it inherits.
 *
 * Declarative rather than a callback over the schema, because the point is that the child does not
 * restate the parent: a field the parent gains appears in the child's inspector with no edit here,
 * and a field this spec names but the parent has dropped is reported instead of silently doing
 * nothing (see {@link applyInspectorOverrides}).
 */
export type WidgetInspectorOverrides = {
    /** Ids of inherited fields or sections to drop. */
    remove?: string[];
    /** Shallow patches merged onto inherited fields, keyed by field id. */
    patch?: Record<string, Partial<FieldDefinition<UIInspectorData>>>;
    /** New fields placed inside an inherited section or tab. */
    insert?: InspectorInsertion[];
    /** Tabs appended after the inherited ones. */
    addTabs?: PropertyEditorTab<UIInspectorData>[];
};

/** The parts of a widget module a specialisation may restate; anything omitted is inherited. */
export type WidgetModuleExtension = {
    /** Widget type id of the specialisation. */
    type: string;
    /** Display name, as a getter so a locale change is picked up like the built-ins do. */
    displayName: () => string;
    icon?: LucideIcon;
    /** Defaults to the specialisation's own entry in the shared logic API table. */
    logicApi?: WidgetLogicApi;
    /**
     * Rewrites the inherited default element. Receives the parent's, already retyped to this
     * widget type, so a specialisation that only changes a size or a colour patches one field.
     */
    defaultElement?: (inherited: Partial<UIElement>) => Partial<UIElement>;
    /** Declarative edits to the inherited inspector. Ignored when `createInspector` is given. */
    inspector?: (context: InspectorContext) => WidgetInspectorOverrides | undefined;
} & Partial<
    Pick<
        UIWidgetModule,
        | "render"
        | "createDefaultChildElements"
        | "createInspector"
        | "createDockerBarItems"
        | "createMultiSelectDockerBarItems"
        | "createContextMenuItems"
        | "createFloatingToolbarItems"
        | "createLayoutSizeField"
        | "registerBlueprintNodes"
    >
>;

function isSection(field: FieldDefinition<UIInspectorData>): field is SectionFieldDefinition<UIInspectorData> {
    return field.type === "section";
}

function insertAt(
    fields: FieldDefinition<UIInspectorData>[],
    added: FieldDefinition<UIInspectorData>[],
    position: InspectorInsertPosition | undefined,
): FieldDefinition<UIInspectorData>[] {
    if (position === "start") {
        return [...added, ...fields];
    }
    if (position && typeof position === "object") {
        const anchor = "after" in position ? position.after : position.before;
        const index = fields.findIndex(field => field.id === anchor);
        if (index >= 0) {
            const at = "after" in position ? index + 1 : index;
            return [...fields.slice(0, at), ...added, ...fields.slice(at)];
        }
    }
    return [...fields, ...added];
}

function mapFields(
    fields: FieldDefinition<UIInspectorData>[],
    visit: (field: FieldDefinition<UIInspectorData>) => FieldDefinition<UIInspectorData> | null,
): FieldDefinition<UIInspectorData>[] {
    const next: FieldDefinition<UIInspectorData>[] = [];
    for (const field of fields) {
        const visited = visit(field);
        if (!visited) {
            continue;
        }
        if (isSection(visited)) {
            next.push({ ...visited, fields: mapFields(visited.fields, visit) });
            continue;
        }
        next.push(visited);
    }
    return next;
}

/**
 * Applies a specialisation's edits to the schema it inherited.
 *
 * Ids the parent no longer has are collected and warned about once per build rather than dropped:
 * the failure this guards against is a parent field renamed in one place while a child still
 * believes it is hiding it, which otherwise shows up as a control reappearing in a game UI panel
 * that had deliberately hidden it.
 */
export function applyInspectorOverrides(
    schema: PropertyEditorSchema<UIInspectorData>,
    overrides: WidgetInspectorOverrides,
    options: { id: string; title?: string; label?: string },
): PropertyEditorSchema<UIInspectorData> {
    const removed = new Set(overrides.remove ?? []);
    const patches = overrides.patch ?? {};
    const unresolved = new Set([...removed, ...Object.keys(patches)]);
    const insertionsById = new Map<string, InspectorInsertion[]>();
    for (const insertion of overrides.insert ?? []) {
        if ((insertion.into ?? "section") !== "section") {
            continue;
        }
        insertionsById.set(insertion.target, [...(insertionsById.get(insertion.target) ?? []), insertion]);
    }

    const visit = (field: FieldDefinition<UIInspectorData>): FieldDefinition<UIInspectorData> | null => {
        unresolved.delete(field.id);
        if (removed.has(field.id)) {
            return null;
        }
        const patch = patches[field.id];
        let next = patch ? ({ ...field, ...patch } as FieldDefinition<UIInspectorData>) : field;
        const insertions = insertionsById.get(field.id);
        if (insertions && isSection(next)) {
            let sectionFields = next.fields;
            for (const insertion of insertions) {
                sectionFields = insertAt(sectionFields, insertion.fields, insertion.position);
            }
            next = { ...next, fields: sectionFields };
            insertionsById.delete(field.id);
        }
        return next;
    };

    const tabs = (schema.tabs ?? []).map(tab => {
        const fields = mapFields(tab.fields, visit);
        const tabInsertions = (overrides.insert ?? []).filter(
            insertion => insertion.into === "tab" && insertion.target === tab.id,
        );
        let nextFields = fields;
        for (const insertion of tabInsertions) {
            nextFields = insertAt(nextFields, insertion.fields, insertion.position);
        }
        return { ...tab, fields: nextFields };
    });

    if (unresolved.size > 0) {
        console.warn(
            `[widget-modules] ${options.label ?? options.id}: inherited inspector has no field ${[...unresolved]
                .sort()
                .join(", ")}`,
        );
    }
    const unresolvedInserts = [...insertionsById.keys()];
    if (unresolvedInserts.length > 0) {
        console.warn(
            `[widget-modules] ${options.label ?? options.id}: inherited inspector has no section ${unresolvedInserts
                .sort()
                .join(", ")}`,
        );
    }

    return {
        ...schema,
        id: options.id,
        ...(options.title !== undefined ? { title: options.title } : {}),
        fields: mapFields(schema.fields, visit),
        tabs: [...tabs, ...(overrides.addTabs ?? [])],
    };
}

function mergeDefaultElement(inherited: Partial<UIElement>, type: string, name: string): Partial<UIElement> {
    return {
        ...inherited,
        type,
        name,
    };
}

/**
 * Builds a widget module that specialises another one.
 *
 * Everything the extension does not restate is the parent's: the canvas renderer, the docker bar,
 * the inspector, and the default element's props. That is the whole point - a Dialog Sentence is a
 * Text with a different renderer for the live dialog slot, and before this it was a hand-kept copy
 * of the text module that had to be edited again for every text feature.
 *
 * The parent link is also declared in `WIDGET_TYPE_PARENTS`, which is what the shared capability
 * tables read; the two are cross-checked here so a module cannot claim a parent the shared table
 * does not know about.
 */
export function extendWidgetModule(parent: UIWidgetModule, extension: WidgetModuleExtension): UIWidgetModule {
    const declaredParent = getWidgetTypeParent(extension.type);
    if (declaredParent !== parent.type) {
        console.warn(
            `[widget-modules] ${extension.type} extends ${parent.type} but WIDGET_TYPE_PARENTS says ${
                declaredParent ?? "nothing"
            }`,
        );
    }

    const createDefaultElement = (): Partial<UIElement> => {
        const inherited = mergeDefaultElement(parent.createDefaultElement(), extension.type, extension.displayName());
        return extension.defaultElement ? extension.defaultElement(inherited) : inherited;
    };

    const createInspector = extension.createInspector
        ? extension.createInspector
        : (context: InspectorContext) => {
              const base = parent.createInspector?.(context);
              if (!base) {
                  return undefined;
              }
              const overrides = extension.inspector?.(context);
              const id = `ui-inspector:${extension.type}:${context.element.id}`;
              if (!overrides) {
                  return { ...base, id };
              }
              return applyInspectorOverrides(base, overrides, {
                  id,
                  label: extension.type,
              });
          };

    return {
        type: extension.type,
        extends: parent.type,
        logicApi: extension.logicApi ?? getWidgetLogicApi(extension.type),
        get displayName() {
            return extension.displayName();
        },
        icon: extension.icon ?? parent.icon,
        createDefaultElement,
        createDefaultChildElements: extension.createDefaultChildElements ?? parent.createDefaultChildElements,
        render: extension.render ?? parent.render,
        createInspector,
        createDockerBarItems: extension.createDockerBarItems ?? parent.createDockerBarItems,
        createMultiSelectDockerBarItems:
            extension.createMultiSelectDockerBarItems ?? parent.createMultiSelectDockerBarItems,
        createContextMenuItems: extension.createContextMenuItems ?? parent.createContextMenuItems,
        createFloatingToolbarItems: extension.createFloatingToolbarItems ?? parent.createFloatingToolbarItems,
        createLayoutSizeField: extension.createLayoutSizeField ?? parent.createLayoutSizeField,
        // Deliberately not inherited: node registration is global and idempotent per module, so
        // running the parent's again from every specialisation would re-register the same types.
        registerBlueprintNodes: extension.registerBlueprintNodes,
    };
}
