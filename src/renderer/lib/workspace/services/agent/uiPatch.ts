/**
 * `ui_patch`: small edits to one page or component, as one step of undo.
 *
 * Every operation goes through the interface editor's own fine-grained methods - the ones the
 * canvas, the outline and the properties panel call - rather than writing the document directly, so
 * what an agent does is exactly what the author could have done by hand: the same defaults, the same
 * flow-layout normalisation, the same blueprint reconciliation. The whole call is wrapped in one
 * `runSurfaceHistoryTransaction`, so however many operations it carries, Ctrl+Z takes it back in one
 * press.
 *
 * All or nothing: when an operation fails part way, the document is put back as it was before the
 * call and nothing is recorded, and the refusal names the operation. Operations are applied in order
 * and may refer to elements an earlier operation in the same call created, by the id or name they
 * gave it.
 *
 * "Applied N operations" has to be true. An operation that would change nothing - a prop the widget
 * does not know, a value it already holds, a layout key a placed component does not take - is
 * refused rather than counted, because an agent that is told an edit landed moves on, and the author
 * finds the button that was meant to be hidden still on the title page. A dry run goes through the
 * same checks and puts the document back, so it answers exactly what the real call would.
 *
 * Comments in English per project convention.
 */

import { isLinkedUIComponentElement, type UIDocument, type UIElement, type UILayout } from "@shared/types/ui-editor/document";
import { buildUIComponentEditorSurfaceId } from "@shared/types/ui-editor/componentInstanceKey";
import type { HistoryLabel } from "../history/historyModel";
import type { UIDocumentService } from "../ui-editor/UIDocumentService";
import { cloneUIHistoryDocument } from "../ui-editor/UIEditorHistoryService";
import { refuse } from "./agentCall";
import { widgetKnownPropKeys } from "@/lib/ui-cli/catalog";
import { nearest } from "@/lib/ui-cli/text";
import { describeInvalidEnumProp, findInvalidEnumProps } from "@/lib/ui-cli/propValues";
import { buildUiPropsPatch, resolveUiElementRef, uiElementPath, type UIElementPool } from "./uiElementRefs";

export type UIPatchOpKind = "add" | "set" | "layout" | "move" | "rename" | "delete" | "instantiate";

export type UIPatchOp = {
    op: UIPatchOpKind;
    element?: string;
    parent?: string;
    index?: number;
    type?: string;
    name?: string;
    id?: string;
    component?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    props?: Record<string, unknown>;
};

export type UIPatchTarget =
    | { kind: "surface"; surfaceId: string }
    | { kind: "component"; componentId: string };

export type UIPatchOutcome = {
    /** Elements the call created, in operation order. */
    created: { op: number; id: string; type: string; name: string; path: string }[];
    /** Ids of elements the call deleted. */
    deleted: string[];
    /** Every element the call touched and that still exists - what follow mode highlights. */
    touched: string[];
};

/** The narrow part of `UIDocumentService` a patch needs; the real service satisfies it. */
export type UIPatchService = Pick<
    UIDocumentService,
    | "getDocument"
    | "runSurfaceHistoryTransaction"
    | "restoreDocumentFromHistory"
    | "createElement"
    | "createComponentInstance"
    | "updateElementProps"
    | "updateElementLayout"
    | "moveElementsInSurface"
    | "reorderChildren"
    | "renameElement"
    | "deleteElements"
    | "createComponentElement"
    | "updateComponentElementProps"
    | "updateComponentElementLayout"
    | "moveComponentElements"
    | "reorderComponentChildren"
    | "renameComponentElement"
    | "deleteComponentElements"
    | "updateElementExtra"
    | "updateComponentElementExtra"
    | "updateElementStyle"
    | "updateComponentElementStyle"
>;

export const UI_PATCH_OP_KINDS: readonly UIPatchOpKind[] = ["add", "set", "layout", "move", "rename", "delete", "instantiate"];

/** Read `ops` out of the call's arguments, refusing anything that is not an operation. */
export function readUiPatchOps(raw: unknown): UIPatchOp[] {
    if (!Array.isArray(raw) || raw.length === 0) {
        throw refuse("invalid_args", "`ops` must be a non-empty array of operations.");
    }
    if (raw.length > 200) {
        throw refuse("invalid_args", "`ops` holds more than 200 operations.", "Split the edit into several calls; the author watches each one land.");
    }
    return raw.map((item, index) => {
        if (typeof item !== "object" || item === null || Array.isArray(item)) {
            throw refuse("invalid_args", `ops[${index}] is not an object.`);
        }
        const op = (item as { op?: unknown }).op;
        if (typeof op !== "string" || !UI_PATCH_OP_KINDS.includes(op as UIPatchOpKind)) {
            throw refuse("invalid_args", `ops[${index}].op must be one of ${UI_PATCH_OP_KINDS.join(", ")}.`);
        }
        return item as UIPatchOp;
    });
}

/**
 * Apply `ops` to the page or component `target` names, as one undo step labelled `label`.
 *
 * Throws an `AgentRefusal` (and leaves the document as it was) when any operation cannot be done.
 */
export function applyUiPatch(
    service: UIPatchService,
    target: UIPatchTarget,
    ops: readonly UIPatchOp[],
    label: HistoryLabel,
    options: { dryRun?: boolean } = {},
): UIPatchOutcome {
    const historySurfaceId = target.kind === "surface" ? target.surfaceId : buildUIComponentEditorSurfaceId(target.componentId);
    const outcome: UIPatchOutcome = { created: [], deleted: [], touched: [] };
    const touched = new Set<string>();
    let failure: unknown = null;

    service.runSurfaceHistoryTransaction(historySurfaceId, () => {
        const before = cloneUIHistoryDocument(service.getDocument());
        try {
            ops.forEach((op, index) => {
                try {
                    const watched = CHANGE_CHECKED_OPS.has(op.op) ? watchElement(service, target, op, index) : null;
                    applyOne(service, target, op, index, outcome, touched);
                    if (watched && watched.before === watched.read()) {
                        throw refuse(
                            "check_failed",
                            `ops[${index}] (${op.op}) changes nothing on ${watched.label}: it already holds those values, or something else decides them (a stack or list parent places its children itself).`,
                            "Leave the operation out, or call ui_show to see what the element holds.",
                        );
                    }
                } catch (error) {
                    if (error instanceof Error && error.name === "AgentRefusal") {
                        throw error;
                    }
                    throw refuse("invalid_args", `ops[${index}] (${op.op}): ${error instanceof Error ? error.message : String(error)}`);
                }
            });
            if (options.dryRun) {
                // Every check passed against the real document; put it back so the transaction's
                // "after" equals its "before" and no step is recorded, exactly as a refusal does.
                const pool = poolOf(service.getDocument(), target);
                outcome.touched = [...touched].filter(id => Boolean(pool[id]));
                service.restoreDocumentFromHistory(before);
            }
        } catch (error) {
            // Put the document back before the transaction takes its "after": the two snapshots are
            // then equal and no step is recorded, so a refused call leaves nothing to undo.
            service.restoreDocumentFromHistory(before);
            failure = error;
        }
    }, { label });

    if (failure) {
        throw failure;
    }
    if (options.dryRun) {
        return outcome;
    }
    const pool = poolOf(service.getDocument(), target);
    outcome.touched = [...touched].filter(id => Boolean(pool[id]));
    return outcome;
}

/** Operations that edit one existing element in place, which must leave it different. */
const CHANGE_CHECKED_OPS = new Set<UIPatchOpKind>(["set", "layout", "move", "rename"]);

/**
 * What an in-place operation's element looks like now, and a way to read it again afterwards: the
 * element's own record (its parent included) and its parent's child order, which is everything
 * set, layout, move and rename can change.
 */
function watchElement(service: UIPatchService, target: UIPatchTarget, op: UIPatchOp, index: number): { label: string; before: string; read: () => string } {
    const element = resolveRef(service, target, requireString(op.element, "element"), index, "element");
    const id = element.id;
    const read = () => {
        const pool = poolOf(service.getDocument(), target);
        const current = pool[id];
        return JSON.stringify([current ?? null, current?.parentId ? pool[current.parentId]?.childrenIds ?? null : null]);
    };
    return { label: `"${element.name ?? element.type}" (${id})`, before: read(), read };
}

function poolOf(document: UIDocument, target: UIPatchTarget): UIElementPool {
    if (target.kind === "surface") {
        return document.elements;
    }
    return (document.components ?? []).find(component => component.id === target.componentId)?.elements ?? {};
}

function rootOf(document: UIDocument, target: UIPatchTarget): string {
    if (target.kind === "surface") {
        const surface = document.surfaces.find(item => item.id === target.surfaceId);
        if (!surface) {
            throw refuse("not_found", `No page with id ${target.surfaceId}.`);
        }
        return surface.rootElementId;
    }
    const component = (document.components ?? []).find(item => item.id === target.componentId);
    if (!component) {
        throw refuse("not_found", `No component with id ${target.componentId}.`);
    }
    return component.rootElementId;
}

function resolveRef(service: UIPatchService, target: UIPatchTarget, ref: string, index: number, field: string): UIElement {
    const document = service.getDocument();
    const pool = poolOf(document, target);
    const found = resolveUiElementRef(pool, rootOf(document, target), ref);
    if (found.kind === "found") {
        return found.element;
    }
    if (found.kind === "ambiguous") {
        const paths = found.candidates.slice(0, 6).map(candidate => `${uiElementPath(pool, candidate)} (${candidate.id})`).join("; ");
        throw refuse("invalid_args", `ops[${index}].${field} "${ref}" matches ${found.candidates.length} elements: ${paths}.`, "Name the element by id or by its full path.");
    }
    throw refuse("not_found", `ops[${index}].${field}: no element "${ref}" on this page.`, "Call ui_show or ui_surfaces for the element ids and paths.");
}

function layoutPatchOf(op: UIPatchOp): Partial<UILayout> {
    const patch: Partial<UILayout> = {};
    for (const key of ["x", "y", "width", "height"] as const) {
        const value = op[key];
        if (value === undefined) {
            continue;
        }
        if (typeof value !== "number" || !Number.isFinite(value)) {
            throw new Error(`${key} must be a number`);
        }
        if ((key === "width" || key === "height") && value < 0) {
            throw new Error(`${key} cannot be negative`);
        }
        patch[key] = value;
    }
    return patch;
}

function requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`\`${field}\` is required`);
    }
    return value.trim();
}

function requireProps(value: unknown): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("`props` must be an object");
    }
    return value as Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What a `set` writes, bag by bag, once the first segment of each key has said which bag. */
export type RoutedUiProps = {
    props: Record<string, unknown>;
    layout: Partial<UILayout>;
    style: Record<string, unknown>;
    extra: Record<string, unknown>;
};

/** Every key an element's layout holds, with the type a value for it must have. */
const LAYOUT_KEY_TYPES: Readonly<Record<keyof UILayout, "number" | "boolean">> = {
    x: "number",
    y: "number",
    width: "number",
    height: "number",
    rotation: "number",
    opacity: "number",
    visible: "boolean",
    lockAspectRatio: "boolean",
};

/** The layout keys a placed component takes on the page; the rest come from its definition. */
const LINKED_LAYOUT_KEYS = new Set<string>(["x", "y", "width", "height", "rotation"]);

function readLayoutValue(key: string, value: unknown): unknown {
    const expected = (LAYOUT_KEY_TYPES as Record<string, "number" | "boolean" | undefined>)[key];
    if (!expected) {
        throw new Error(`an element's layout has no "${key}" (it holds ${Object.keys(LAYOUT_KEY_TYPES).join(", ")})`);
    }
    if (expected === "boolean" && typeof value !== "boolean") {
        throw new Error(`layout.${key} must be true or false`);
    }
    if (expected === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
        throw new Error(`layout.${key} must be a number`);
    }
    if ((key === "width" || key === "height") && (value as number) < 0) {
        throw new Error(`layout.${key} cannot be negative`);
    }
    if (key === "opacity" && ((value as number) < 0 || (value as number) > 1)) {
        throw new Error("layout.opacity runs from 0 to 1");
    }
    return value;
}

/**
 * Split a props patch by bag, the way the `.ui` format reads an assignment: the first segment of a
 * key decides. `layout.visible` and `{"layout": {"visible": false}}` both reach the element's layout,
 * `style.*` its CSS overrides, `extra.*` its extra record; `props.<key>` names a prop whose own name
 * is one of those words, and every other key is a prop. Dotted keys under a bag merge into what the
 * element already holds there (`imageFill.assetId` keeps the fit), as `buildUiPropsPatch` does.
 */
export function routeUiPropsPatch(element: UIElement, patch: Readonly<Record<string, unknown>>): RoutedUiProps {
    const layout: Record<string, unknown> = {};
    const bagged: Record<"props" | "style" | "extra", Record<string, unknown>> = { props: {}, style: {}, extra: {} };
    const objectOf = (head: string, value: unknown): Record<string, unknown> => {
        if (!isPlainObject(value)) {
            throw new Error(`\`${head}\` takes an object (or write \`${head}.<key>\`)`);
        }
        return value;
    };
    for (const [key, value] of Object.entries(patch)) {
        const segments = key.split(".").filter(Boolean);
        if (segments.length === 0) {
            throw new Error("a prop key cannot be empty");
        }
        const [head, ...rest] = segments;
        if (head === "layout") {
            const entries = rest.length === 0 ? Object.entries(objectOf(head, value)) : [[rest.join("."), value] as const];
            for (const [layoutKey, layoutValue] of entries) {
                layout[layoutKey] = readLayoutValue(layoutKey, layoutValue);
            }
            continue;
        }
        if (head === "props" || head === "style" || head === "extra") {
            if (rest.length === 0) {
                Object.assign(bagged[head], objectOf(head, value));
            } else {
                bagged[head][rest.join(".")] = value;
            }
            continue;
        }
        bagged.props[key] = value;
    }
    return {
        props: buildUiPropsPatch(element.props ?? {}, bagged.props),
        layout: layout as Partial<UILayout>,
        style: buildUiPropsPatch(element.style ?? {}, bagged.style),
        extra: buildUiPropsPatch(element.extra ?? {}, bagged.extra),
    };
}

/**
 * Write a `set` (or an `add`'s props) to `element`, refusing what would land nowhere: a prop the
 * widget does not know, a bag a placed component does not take, a record the editor manages itself.
 * Whether the write changed anything at all is checked by the caller, which sees the element after.
 */
function writeRoutedProps(
    service: UIPatchService,
    componentId: string | null,
    element: UIElement,
    patch: Record<string, unknown>,
    index: number,
): void {
    if (Object.keys(patch).length === 0) {
        throw new Error("`props` is empty");
    }
    const routed = routeUiPropsPatch(element, patch);
    const label = element.name ?? element.id;

    if (!componentId && isLinkedUIComponentElement(element)) {
        const notLayout = [...Object.keys(routed.props), ...Object.keys(routed.style).map(key => `style.${key}`), ...Object.keys(routed.extra).map(key => `extra.${key}`)];
        if (notLayout.length > 0) {
            throw new Error(`${label} is a placed component, whose props come from its definition (${notLayout.join(", ")}); edit the component instead`);
        }
        const fromDefinition = Object.keys(routed.layout).filter(key => !LINKED_LAYOUT_KEYS.has(key));
        if (fromDefinition.length > 0) {
            throw new Error(
                `${label} is a placed component: on the page it takes only ${[...LINKED_LAYOUT_KEYS].join(", ")}, and its ${fromDefinition.map(key => `layout.${key}`).join(", ")} come from its definition; `
                + "edit the component, or hide this placement from a blueprint (setVisible)",
            );
        }
    }

    const known = widgetKnownPropKeys(element.type);
    if (known) {
        const current = element.props ?? {};
        for (const key of Object.keys(routed.props)) {
            if (known.has(key) || key in current) {
                continue;
            }
            const asLayout = key in LAYOUT_KEY_TYPES ? ` - did you mean \`layout.${key}\`?` : "";
            const close = asLayout ? [] : nearest(key, [...known], 3);
            throw refuse(
                "invalid_args",
                `ops[${index}] (set): ${element.type} has no prop "${key}"${asLayout}${close.length > 0 ? ` - did you mean ${close.map(item => `"${item}"`).join(", ")}?` : ""}`,
                "ui_widget lists the type's props; layout keys (visible, opacity, rotation, x, y, width, height) are written `layout.<key>`.",
            );
        }
    }
    // A word outside the prop's list would be stored and then drawn as the browser's default with
    // nothing said - see `@/lib/ui-cli/propValues`.
    const [badValue] = findInvalidEnumProps(routed.props);
    if (badValue) {
        throw refuse(
            "invalid_args",
            `ops[${index}] (set): ${element.name ?? element.id}: ${describeInvalidEnumProp(badValue)}.`,
            "Write one of the listed words; ui_widget shows the widget's default.",
        );
    }
    if ("componentLink" in routed.extra) {
        throw new Error("`extra.componentLink` is how a placed component names its definition; place one with the instantiate op instead");
    }

    if (Object.keys(routed.props).length > 0) {
        if (componentId) {
            service.updateComponentElementProps(componentId, element.id, routed.props);
        } else {
            service.updateElementProps(element.id, routed.props);
        }
    }
    if (Object.keys(routed.layout).length > 0) {
        if (componentId) {
            service.updateComponentElementLayout(componentId, element.id, routed.layout);
        } else {
            service.updateElementLayout(element.id, routed.layout);
        }
    }
    if (Object.keys(routed.style).length > 0) {
        if (componentId) {
            service.updateComponentElementStyle(componentId, element.id, routed.style);
        } else {
            service.updateElementStyle(element.id, routed.style);
        }
    }
    if (Object.keys(routed.extra).length > 0) {
        if (componentId) {
            service.updateComponentElementExtra(componentId, element.id, routed.extra);
        } else {
            service.updateElementExtra(element.id, routed.extra);
        }
    }
}

/** The order of `parent`'s children with `childId` moved to `index` (clamped), or null when unchanged. */
function reordered(children: readonly string[], childId: string, index: number): string[] | null {
    const rest = children.filter(id => id !== childId);
    const at = Math.max(0, Math.min(Math.trunc(index), rest.length));
    rest.splice(at, 0, childId);
    return rest.every((id, position) => children[position] === id) ? null : rest;
}

function applyOne(
    service: UIPatchService,
    target: UIPatchTarget,
    op: UIPatchOp,
    index: number,
    outcome: UIPatchOutcome,
    touched: Set<string>,
): void {
    const componentId = target.kind === "component" ? target.componentId : null;
    const document = () => service.getDocument();
    const pool = () => poolOf(document(), target);

    switch (op.op) {
        case "add":
        case "instantiate": {
            const parent = op.parent ? resolveRef(service, target, op.parent, index, "parent") : pool()[rootOf(document(), target)];
            if (!parent) {
                throw new Error("the page has no root element");
            }
            const layout = layoutPatchOf(op);
            const explicitId = typeof op.id === "string" && op.id.trim() ? op.id.trim() : undefined;
            let created: UIElement | null;
            if (op.op === "add") {
                const type = requireString(op.type, "type");
                created = componentId
                    ? service.createComponentElement(componentId, parent.id, type, layout, { id: explicitId })
                    : service.createElement(parent.id, type, layout, { id: explicitId });
            } else {
                if (componentId) {
                    throw refuse("unavailable", `ops[${index}]: a component cannot be placed inside another component's definition here.`, "Place the component on a page instead.");
                }
                const ref = requireString(op.component, "component");
                const components = document().components ?? [];
                const component = components.find(item => item.id === ref) ?? components.find(item => item.name === ref);
                if (!component) {
                    throw refuse("not_found", `ops[${index}].component: no component "${ref}".`, "Call ui_surfaces for the component names.");
                }
                created = service.createComponentInstance(parent.id, component.id, layout, { id: explicitId });
            }
            if (!created) {
                throw new Error(`${parent.name ?? parent.type} cannot hold child elements`);
            }
            const id = created.id;
            if (op.name !== undefined) {
                const name = requireString(op.name, "name");
                if (componentId) {
                    service.renameComponentElement(componentId, id, name);
                } else {
                    service.renameElement(id, name);
                }
            }
            if (op.props !== undefined && op.op === "add") {
                const element = pool()[id];
                if (element) {
                    writeRoutedProps(service, componentId, element, requireProps(op.props), index);
                }
            }
            if (op.index !== undefined) {
                const children = pool()[parent.id]?.childrenIds ?? [];
                const order = reordered(children, id, op.index);
                if (order) {
                    if (componentId) {
                        service.reorderComponentChildren(componentId, parent.id, order);
                    } else {
                        service.reorderChildren(parent.id, order);
                    }
                }
            }
            const element = pool()[id];
            touched.add(id);
            outcome.created.push({
                op: index,
                id,
                type: element?.type ?? created.type,
                name: element?.name ?? created.name ?? created.type,
                path: element ? uiElementPath(pool(), element) : "",
            });
            return;
        }
        case "set": {
            const element = resolveRef(service, target, requireString(op.element, "element"), index, "element");
            writeRoutedProps(service, componentId, element, requireProps(op.props), index);
            touched.add(element.id);
            return;
        }
        case "layout": {
            const element = resolveRef(service, target, requireString(op.element, "element"), index, "element");
            const patch = layoutPatchOf(op);
            if (Object.keys(patch).length === 0) {
                throw new Error("give at least one of x, y, width, height");
            }
            if (componentId) {
                service.updateComponentElementLayout(componentId, element.id, patch);
            } else {
                service.updateElementLayout(element.id, patch);
            }
            touched.add(element.id);
            return;
        }
        case "move": {
            const element = resolveRef(service, target, requireString(op.element, "element"), index, "element");
            const parent = op.parent ? resolveRef(service, target, op.parent, index, "parent") : element.parentId ? pool()[element.parentId] : undefined;
            if (!parent) {
                throw new Error("the root element cannot be moved");
            }
            const siblings = (pool()[parent.id]?.childrenIds ?? []).filter(id => id !== element.id);
            const at = op.index === undefined ? siblings.length : Math.max(0, Math.min(Math.trunc(op.index), siblings.length));
            const beforeChildId = siblings[at] ?? null;
            if (parent.id !== element.parentId || op.index !== undefined) {
                const moved = componentId
                    ? service.moveComponentElements(componentId, [element.id], parent.id, beforeChildId)
                    : target.kind === "surface"
                      ? service.moveElementsInSurface(target.surfaceId, [element.id], parent.id, beforeChildId)
                      : { ok: false as const, reason: "invalid_target" };
                if (!moved.ok) {
                    throw new Error(`cannot move ${element.name ?? element.id} there (${"reason" in moved ? moved.reason : "refused"})`);
                }
            }
            const patch = layoutPatchOf(op);
            if (Object.keys(patch).length > 0) {
                if (componentId) {
                    service.updateComponentElementLayout(componentId, element.id, patch);
                } else {
                    service.updateElementLayout(element.id, patch);
                }
            }
            touched.add(element.id);
            return;
        }
        case "rename": {
            const element = resolveRef(service, target, requireString(op.element, "element"), index, "element");
            const name = requireString(op.name, "name");
            if (componentId) {
                service.renameComponentElement(componentId, element.id, name);
            } else {
                service.renameElement(element.id, name);
            }
            touched.add(element.id);
            return;
        }
        case "delete": {
            const element = resolveRef(service, target, requireString(op.element, "element"), index, "element");
            if (element.id === rootOf(document(), target)) {
                throw new Error("the root element cannot be deleted");
            }
            if (componentId) {
                service.deleteComponentElements(componentId, [element.id]);
            } else {
                service.deleteElements([element.id]);
            }
            outcome.deleted.push(element.id);
            touched.delete(element.id);
            return;
        }
    }
}
