/**
 * A parsed `.ui` file into the records `uidoc.json` holds, checked against the widget catalogue on
 * the way.
 *
 * What is checked here is "is this written against the widgets that exist": an unknown type, a child
 * under a widget that takes none, a binding on a prop nothing can drive, a root that is not a root.
 * What a widget *means* is not checked here and is not checkable from a file - that is what
 * `ui usage` and the notes in the catalogue are for.
 *
 * Ids are resolved in three steps, in this order: the id the file gave; the id the element already
 * has at the same place in the same surface; a derived one. The middle step is what makes applying an
 * edited `ui show` dump preserve every blueprint that hangs off the surface, and the last is what
 * makes a template reproducible - see `deriveElementId`.
 *
 * Comments in English per project convention.
 */

import type { UIInputActionDef } from "@shared/types/ui-editor/inputAction";
import type { UIStructDef, UIStructFieldType } from "@shared/types/ui-editor/struct";
import { UI_STRUCT_FIELD_TYPES } from "@shared/types/ui-editor/struct";
import { UI_STAGE_SLOT_IDS } from "@shared/types/ui-editor/stageSlots";
import {
    getUIStructuralChildSlot,
    uiElementTypeAcceptsChildren,
    uiElementTypeAcceptsUserChildren,
    type UIComponentDefinition,
    type UIDocument,
    type UIElement,
    type UIElementValueBinding,
    type UILayout,
    type UIStageSlotId,
    type UISurface,
} from "@shared/types/ui-editor/document";
import type { BpDiagnostic } from "../../blueprint-cli/dsl/ast";
import { describeWidget, listWidgetModules, nearestWidgetTypes } from "../catalog";
import { collectTree, deriveElementId, elementPathSegments, findComponent, findSurface } from "../project";
import type { UiAssignment, UiElementNode, UiFile, UiStatement } from "./ast";

export type CompiledSurface = {
    surface: UISurface;
    elements: Record<string, UIElement>;
    /** Elements the surface used to hold and this file does not, which applying would delete. */
    dropped: { id: string; name: string }[];
};

export type CompiledComponent = {
    component: UIComponentDefinition;
    dropped: { id: string; name: string }[];
};

export type UiCompileResult = {
    documentName?: string;
    documentId?: string;
    surfaces: CompiledSurface[];
    components: CompiledComponent[];
    structs: Record<string, UIStructDef>;
    actions: Record<string, UIInputActionDef>;
    diagnostics: BpDiagnostic[];
};

export type UiCompileOptions = {
    /** The document being edited, which is what an unstated id is matched against. */
    existing?: UIDocument | null;
};

export function compileUiFile(file: UiFile, options: UiCompileOptions = {}): UiCompileResult {
    const context = new CompileContext(options.existing ?? null);
    for (const statement of file.statements) {
        context.statement(statement);
    }
    return context.result();
}

class CompileContext {
    private readonly diagnostics: BpDiagnostic[] = [];
    private readonly surfaces: CompiledSurface[] = [];
    private readonly components: CompiledComponent[] = [];
    private readonly structs: Record<string, UIStructDef> = {};
    private readonly actions: Record<string, UIInputActionDef> = {};
    private documentName?: string;
    private documentId?: string;
    private readonly knownTypes: Set<string>;
    private readonly seenUnknownProps = new Set<string>();

    public constructor(private readonly existing: UIDocument | null) {
        this.knownTypes = new Set(listWidgetModules().map(module => module.type));
    }

    public result(): UiCompileResult {
        return {
            documentName: this.documentName,
            documentId: this.documentId,
            surfaces: this.surfaces,
            components: this.components,
            structs: this.structs,
            actions: this.actions,
            diagnostics: this.diagnostics,
        };
    }

    private report(severity: BpDiagnostic["severity"], code: string, message: string, line?: number, hint?: string): void {
        this.diagnostics.push({ severity, code, message, line, hint });
    }

    public statement(statement: UiStatement): void {
        switch (statement.kind) {
            case "document":
                this.documentName = statement.name || undefined;
                this.documentId = statement.id;
                return;
            case "struct":
                this.struct(statement);
                return;
            case "action":
                this.action(statement);
                return;
            case "surface":
                this.surface(statement);
                return;
            case "component":
                this.component(statement);
                return;
        }
    }

    // -----------------------------------------------------------------------
    // Small blocks
    // -----------------------------------------------------------------------

    private struct(statement: Extract<UiStatement, { kind: "struct" }>): void {
        const fields = statement.fields.map(field => {
            if (!(UI_STRUCT_FIELD_TYPES as readonly string[]).includes(field.type)) {
                this.report(
                    "error",
                    "ui.unknown_field_type",
                    `"${field.type}" is not a struct field type.`,
                    field.line,
                    `Types: ${UI_STRUCT_FIELD_TYPES.join(", ")}.`,
                );
            }
            return {
                id: field.id,
                key: field.key,
                ...(field.label ? { label: field.label } : {}),
                type: field.type as UIStructFieldType,
            };
        });
        this.structs[statement.id] = { id: statement.id, fields };
    }

    private action(statement: Extract<UiStatement, { kind: "action" }>): void {
        this.actions[statement.id] = {
            id: statement.id,
            name: statement.name,
            bindings: statement.bindings.map(binding =>
                binding.kind === "pointer"
                    ? { kind: "pointer", gesture: binding.gesture as never }
                    : { kind: "key", key: binding.key },
            ),
        };
    }

    // -----------------------------------------------------------------------
    // Surfaces
    // -----------------------------------------------------------------------

    private surface(statement: Extract<UiStatement, { kind: "surface" }>): void {
        const previous = statement.id
            ? findSurface(this.existing ?? emptyDocument(), statement.id)
            : findSurface(this.existing ?? emptyDocument(), statement.name);
        const surfaceId = statement.id ?? previous?.id ?? deriveElementId("surface", statement.name);
        if (!statement.root) {
            this.report("error", "ui.no_root", `Surface "${statement.name}" has no root element.`, statement.line);
            return;
        }
        if (statement.root.type !== "nl.root") {
            this.report(
                "error",
                "ui.root_type",
                `A surface's root element must be nl.root, got "${statement.root.type}".`,
                statement.root.line,
            );
        }
        if (statement.surfaceKind === "stageSurface" && !UI_STAGE_SLOT_IDS.includes(statement.slotId as UIStageSlotId)) {
            this.report(
                "error",
                "ui.unknown_slot",
                `"${statement.slotId ?? ""}" is not a stage slot.`,
                statement.line,
                `Slots: ${UI_STAGE_SLOT_IDS.join(", ")}.`,
            );
        }

        const previousElements = previous
            ? collectTree(this.existing?.elements ?? {}, previous.rootElementId)
            : [];
        const matcher = new PathMatcher(previousElements, this.existing?.elements ?? {});
        const elements: Record<string, UIElement> = {};
        const rootId = this.element(statement.root, {
            scope: surfaceId,
            parentId: null,
            pathPrefix: [],
            elements,
            matcher,
            surfaceKind: statement.surfaceKind,
            stageSlot: statement.slotId,
            inListTemplate: false,
        });

        const designSize = statement.designSize ?? previous?.designSize ?? { width: 1920, height: 1080 };
        // Assembled in the order the editor writes these keys, so a file this tool applies and a file
        // Studio saves differ by what changed rather than by a reshuffle.
        const settings = statement.settings.length > 0 || previous?.settings
            ? { settings: applyAssignments(previous?.settings ?? {}, statement.settings) }
            : {};
        const actions = statement.answers.length > 0
            ? {
                actions: statement.answers.map(answer => ({
                    actionId: answer.actionId,
                    ...(answer.consume === undefined ? {} : { consume: answer.consume }),
                })),
            }
            : {};
        const surface: UISurface = statement.surfaceKind === "stageSurface"
            ? {
                id: surfaceId,
                name: statement.name,
                host: "player",
                kind: "stageSurface",
                designSize,
                rootElementId: rootId,
                ...settings,
                mount: { kind: "slot", slotId: (statement.slotId ?? "onStage") as UIStageSlotId },
                ...actions,
                ...(statement.slots.length > 0
                    ? {
                        slots: Object.fromEntries(
                            statement.slots.map(slot => [
                                slot.id,
                                { id: slot.id, name: slot.name, ...(slot.rootElementId ? { rootElementId: slot.rootElementId } : {}) },
                            ]),
                        ),
                    }
                    : {}),
            }
            : {
                id: surfaceId,
                name: statement.name,
                host: "app",
                kind: "appSurface",
                designSize,
                rootElementId: rootId,
                ...settings,
                ...actions,
            };

        this.surfaces.push({
            surface,
            elements,
            dropped: previousElements
                .filter(element => !elements[element.id])
                .map(element => ({ id: element.id, name: element.name ?? element.type })),
        });
    }

    // -----------------------------------------------------------------------
    // Components
    // -----------------------------------------------------------------------

    private component(statement: Extract<UiStatement, { kind: "component" }>): void {
        const previous = statement.id
            ? findComponent(this.existing ?? emptyDocument(), statement.id)
            : findComponent(this.existing ?? emptyDocument(), statement.name);
        const componentId = statement.id ?? previous?.id ?? deriveElementId("component", statement.name);
        if (!statement.root) {
            this.report("error", "ui.no_root", `Component "${statement.name}" has no root element.`, statement.line);
            return;
        }
        const ownPool = previous?.elements ?? {};
        const previousElements = collectTree(ownPool, previous?.rootElementId);
        const matcher = new PathMatcher(previousElements, ownPool);
        const elements: Record<string, UIElement> = {};
        const rootId = this.element(statement.root, {
            scope: componentId,
            parentId: null,
            pathPrefix: [],
            elements,
            matcher,
            surfaceKind: "appSurface",
            stageSlot: undefined,
            inListTemplate: false,
        });
        this.components.push({
            component: {
                id: componentId,
                name: statement.name,
                rootElementId: rootId,
                elements,
                // Omitted when there are none, which is how the editor stores a component nobody has
                // declared a param on - unless the definition already carries an empty list, in which
                // case that shape is left alone rather than tidied into a difference.
                ...(statement.params.length > 0 || Array.isArray(previous?.params)
                    ? {
                        params: statement.params.map(param => ({
                            id: param.id,
                            name: param.name,
                            type: "string" as const,
                            defaultValue: param.defaultValue,
                        })),
                    }
                    : {}),
                ...(statement.previewMeta ? { previewMeta: statement.previewMeta } : {}),
                // Timestamps are carried through rather than restamped. A `.ui` file does not state
                // when a component was last touched, and rewriting them on every apply would make
                // every apply a change in version control even when nothing about the tree moved.
                ...(previous?.createdAt ? { createdAt: previous.createdAt } : {}),
                ...(previous?.updatedAt ? { updatedAt: previous.updatedAt } : {}),
            },
            dropped: previousElements
                .filter(element => !elements[element.id])
                .map(element => ({ id: element.id, name: element.name ?? element.type })),
        });
    }

    // -----------------------------------------------------------------------
    // Elements
    // -----------------------------------------------------------------------

    private element(
        node: UiElementNode,
        context: {
            scope: string;
            parentId: string | null;
            pathPrefix: string[];
            elements: Record<string, UIElement>;
            matcher: PathMatcher;
            surfaceKind: "appSurface" | "stageSurface";
            stageSlot?: string;
            inListTemplate: boolean;
        },
    ): string {
        const label = node.name ?? node.type;
        const pathKey = [...context.pathPrefix, label].join("/");
        const id = node.id ?? context.matcher.take(pathKey) ?? deriveElementId(context.scope, pathKey);
        if (context.elements[id]) {
            this.report(
                "error",
                "ui.duplicate_element",
                `Two elements resolve to the id "${id}".`,
                node.line,
                "Give one of them an explicit `id=`, or a different name.",
            );
        }

        const detail = describeWidget(node.type);
        if (!this.knownTypes.has(node.type)) {
            const near = nearestWidgetTypes(node.type);
            this.report(
                "error",
                "ui.unknown_widget_type",
                `No widget type "${node.type}".`,
                node.line,
                near.length > 0 ? `Close by: ${near.join(", ")}.` : "Run `ui widgets` for the catalogue.",
            );
        } else if (detail) {
            this.checkPlacement(node, detail, context);
        }


        const layout = applyAssignments({ x: 0, y: 0, width: 0, height: 0 }, node.assignments.filter(a => a.target === "layout")) as UILayout;
        const props = applyAssignments({}, node.assignments.filter(a => a.target === "props"));
        const style = applyAssignments({}, node.assignments.filter(a => a.target === "style"));
        const extra = applyAssignments({}, node.assignments.filter(a => a.target === "extra"));
        const elementKeys = applyAssignments({}, node.assignments.filter(a => a.target === "element"));

        if (detail && node.type !== "nl.root") {
            const declared = new Set(detail.props.map(prop => prop.key));
            for (const key of Object.keys(props)) {
                // Reported once per type and key rather than once per element: a template that sets a
                // stale prop sets it on all forty of them, and forty copies of one finding buries the
                // rest of the report.
                if (!declared.has(key) && !this.seenUnknownProps.has(`${node.type}.${key}`)) {
                    this.seenUnknownProps.add(`${node.type}.${key}`);
                    this.report(
                        "warning",
                        "ui.unknown_prop",
                        `${node.type} declares no default for "${key}".`,
                        node.line,
                        "A widget may still hold keys its defaults do not name - `localizationKey` is the "
                            + "common one - so this is a note, not a refusal.",
                    );
                }
            }
        }

        if (node.componentLink) {
            const component = this.existing ? findComponent(this.existing, node.componentLink.componentId) : undefined;
            if (this.existing && !component) {
                this.report(
                    "warning",
                    "ui.unknown_component",
                    `No component "${node.componentLink.componentId}" in this project.`,
                    node.componentLink.line,
                );
            }
            (extra as Record<string, unknown>).componentLink = {
                componentId: node.componentLink.componentId,
                linked: true,
                ...(Object.keys(node.componentLink.params).length > 0 ? { params: node.componentLink.params } : {}),
            };
        }

        const valueBindings = this.bindings(node, detail, context.inListTemplate);

        const element: UIElement = {
            id,
            type: node.type,
            ...(node.name ? { name: node.name } : {}),
            parentId: context.parentId,
            childrenIds: [],
            layout,
            ...(Object.keys(style).length > 0 ? { style } : {}),
            ...(Object.keys(props).length > 0 ? { props } : {}),
            ...(Object.keys(valueBindings).length > 0 ? { valueBindings } : {}),
            ...(elementKeys.animation !== undefined ? { animation: elementKeys.animation as never } : {}),
            ...(Object.keys(extra).length > 0 ? { extra } : {}),
            ...(elementKeys.assetVariants !== undefined ? { assetVariants: elementKeys.assetVariants as never } : {}),
        };
        context.elements[id] = element;

        const childPrefix = [...context.pathPrefix, label];
        const isListLike = detail?.extends === "nl.list" || node.type === "nl.list";
        for (const child of node.children) {
            element.childrenIds.push(
                this.element(child, {
                    ...context,
                    parentId: id,
                    pathPrefix: childPrefix,
                    inListTemplate: context.inListTemplate || isListLike,
                }),
            );
        }
        this.checkChildren(node, element, context.elements);
        return id;
    }

    /**
     * Whether these children are allowed to be here.
     *
     * Three answers, not two. A leaf takes nothing. A widget like the slider or the switch builds its
     * own parts and takes nothing else, so a child is allowed exactly when it carries that widget's
     * slot marker - which is checked after the children have compiled, because the marker is in the
     * `extra` bag they build. Everything else takes whatever an author puts in it.
     */
    private checkChildren(node: UiElementNode, element: UIElement, pool: Record<string, UIElement>): void {
        if (node.children.length === 0) {
            return;
        }
        if (!uiElementTypeAcceptsChildren(node.type)) {
            this.report(
                "error",
                "ui.no_children",
                `${node.type} takes no children.`,
                node.children[0].line,
                "Wrap them in an nl.container and put that here instead.",
            );
            return;
        }
        if (uiElementTypeAcceptsUserChildren(node.type)) {
            return;
        }
        for (let i = 0; i < element.childrenIds.length; i += 1) {
            const child = pool[element.childrenIds[i]];
            if (child && getUIStructuralChildSlot(node.type, child.extra) == null) {
                this.report(
                    "error",
                    "ui.not_a_part",
                    `${node.type} holds only the parts it builds for itself, and "${child.name ?? child.type}" `
                        + "carries no slot marker.",
                    node.children[i]?.line,
                    `Run \`ui widget ${node.type}\` for the parts it owns and the slot each one claims; a part `
                        + "written by hand needs the same `extra` key.",
                );
            }
        }
    }

    /** Where the insert palette says this widget type may go, which is the only placement rule stated. */
    private checkPlacement(
        node: UiElementNode,
        detail: NonNullable<ReturnType<typeof describeWidget>>,
        context: { surfaceKind: "appSurface" | "stageSurface"; stageSlot?: string },
    ): void {
        if (detail.surfaceKinds.length > 0 && !detail.surfaceKinds.includes(context.surfaceKind)) {
            this.report(
                "warning",
                "ui.palette_scope",
                `${node.type} is offered only on ${detail.surfaceKinds.join("/")}, and this is a ${context.surfaceKind}.`,
                node.line,
            );
        }
        if (detail.stageSlots.length > 0 && context.stageSlot && !detail.stageSlots.includes(context.stageSlot)) {
            this.report(
                "warning",
                "ui.palette_scope",
                `${node.type} belongs in the ${detail.stageSlots.join("/")} slot, and this surface mounts into `
                    + `${context.stageSlot}.`,
                node.line,
            );
        }
    }

    private bindings(
        node: UiElementNode,
        detail: ReturnType<typeof describeWidget>,
        inListTemplate: boolean,
    ): Record<string, UIElementValueBinding> {
        const out: Record<string, UIElementValueBinding> = {};
        for (const binding of node.bindings) {
            const target = detail?.bindableProps.find(prop => prop.propPath === binding.propPath);
            if (detail && !target) {
                this.report(
                    "error",
                    "ui.prop_not_bindable",
                    `Nothing can drive "${binding.propPath}" on ${node.type}.`,
                    binding.line,
                    detail.bindableProps.length > 0
                        ? `Bindable here: ${detail.bindableProps.map(prop => prop.propPath).join(", ")}.`
                        : "This widget type has no bindable props.",
                );
                continue;
            }
            if (binding.source.kind === "listItemField") {
                if (!inListTemplate) {
                    this.report(
                        "warning",
                        "ui.list_field_outside_item",
                        `"${binding.propPath}" is bound to a list item field, but this element is not inside a list.`,
                        binding.line,
                        "An element outside an item template has no row to read, so the binding reads as nothing.",
                    );
                }
                out[binding.propPath] = { kind: "listItemField", fieldId: binding.source.fieldId };
                continue;
            }
            out[binding.propPath] = {
                kind: "blueprintValue",
                blueprintId: binding.source.blueprintId,
                valueType: (binding.source.valueType ?? target?.valueType ?? "string") as never,
            };
        }
        return out;
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Matches an element the file did not give an id for to the one that was at the same place before.
 *
 * By path, and each id is handed out once: two siblings with the same name are matched in the order
 * they were written, which is the order they were in. Without this, editing one line of a `ui show`
 * dump would re-mint every id under it and every blueprint pointing at them would be orphaned.
 */
class PathMatcher {
    private readonly byPath = new Map<string, string[]>();

    public constructor(previous: readonly UIElement[], pool: Record<string, UIElement>) {
        for (const element of previous) {
            const key = pathKeyOf(pool, element);
            const list = this.byPath.get(key) ?? [];
            list.push(element.id);
            this.byPath.set(key, list);
        }
    }

    public take(pathKey: string): string | undefined {
        const list = this.byPath.get(pathKey);
        return list && list.length > 0 ? list.shift() : undefined;
    }
}

/** The same key the compiler builds from the file: names from the root down, joined by "/". */
function pathKeyOf(pool: Record<string, UIElement>, element: UIElement): string {
    return elementPathSegments(pool, element).join("/");
}

/** Writes dotted assignments onto a copy of `base`, creating the objects on the way down. */
function applyAssignments(base: Record<string, unknown>, assignments: readonly UiAssignment[]): Record<string, unknown> {
    const out: Record<string, unknown> = structuredCloneish(base);
    for (const assignment of assignments) {
        let cursor = out;
        for (let i = 0; i < assignment.path.length - 1; i += 1) {
            const key = assignment.path[i];
            const next = cursor[key];
            if (next == null || typeof next !== "object" || Array.isArray(next)) {
                cursor[key] = {};
            }
            cursor = cursor[key] as Record<string, unknown>;
        }
        cursor[assignment.path[assignment.path.length - 1]] = assignment.value;
    }
    return out;
}

function structuredCloneish<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function emptyDocument(): UIDocument {
    return { schemaVersion: 0, id: "", name: "", surfaces: [], elements: {} };
}
