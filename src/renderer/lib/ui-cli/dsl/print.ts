/**
 * The inverse of the parser and compiler: a document back into `.ui` text.
 *
 * Printing is exact rather than tidy - every id, every prop, every layout key that is on the record
 * is written down - because the way to change something that already exists is to dump it, edit two
 * lines and apply it back, and anything the printer left out would be deleted by that round trip.
 *
 * Comments in English per project convention.
 */

import type {
    UIComponentDefinition,
    UIDocument,
    UIElement,
    UIElementId,
    UISurface,
} from "@shared/types/ui-editor/document";
import { getUIComponentLink } from "@shared/types/ui-editor/document";
import { printValue } from "../../blueprint-cli/dsl/values";

const INDENT = "    ";

export type PrintOptions = {
    /** Only these surfaces, by id; all of them when absent. */
    surfaceIds?: readonly string[];
    /** Only these components, by id; all of them when absent. */
    componentIds?: readonly string[];
    /** Structs and actions are document-wide, so they are printed only for a whole-document dump. */
    includeSharedTables?: boolean;
    /** A note beside each element that a blueprint hangs off, which `ui show` uses. */
    blueprintsByElement?: Map<string, { id: string; name: string }[]>;
    /** Stop at the element itself, for a reference example whose subtree is not the point. */
    withoutChildren?: boolean;
};

export function printUiDocument(document: UIDocument, options: PrintOptions = {}): string {
    const blocks: string[] = [];
    if (options.includeSharedTables !== false) {
        blocks.push(`document ${printValue(document.name ?? "")} id=${printValue(document.id ?? "")}`);
        for (const struct of Object.values(document.structs ?? {})) {
            const lines = [`struct ${struct.id}`];
            for (const field of struct.fields) {
                lines.push(
                    `${INDENT}field ${field.key}: ${field.type}`
                        + (field.id !== field.key ? ` id=${printValue(field.id)}` : "")
                        + (field.label ? ` label=${printValue(field.label)}` : ""),
                );
            }
            blocks.push(lines.join("\n"));
        }
        for (const action of Object.values(document.actions ?? {})) {
            const lines = [`action ${action.id} ${printValue(action.name)}`];
            for (const binding of action.bindings ?? []) {
                lines.push(
                    binding.kind === "pointer"
                        ? `${INDENT}pointer ${binding.gesture}`
                        : `${INDENT}key ${printValue(binding.key)}`,
                );
            }
            blocks.push(lines.join("\n"));
        }
    }
    for (const surface of document.surfaces) {
        if (options.surfaceIds && !options.surfaceIds.includes(surface.id)) {
            continue;
        }
        blocks.push(printSurface(surface, document.elements, options));
    }
    for (const component of document.components ?? []) {
        if (options.componentIds && !options.componentIds.includes(component.id)) {
            continue;
        }
        blocks.push(printComponent(component, options));
    }
    return `${blocks.join("\n\n")}\n`;
}

export function printSurface(
    surface: UISurface,
    pool: Record<UIElementId, UIElement>,
    options: PrintOptions = {},
): string {
    const header = [
        `surface ${printValue(surface.name)}`,
        `id=${printValue(surface.id)}`,
        `kind=${surface.kind}`,
        surface.kind === "stageSurface" ? `slot=${surface.mount.slotId}` : "",
        `size=${surface.designSize.width}x${surface.designSize.height}`,
    ].filter(Boolean).join(" ");
    const lines = [header];
    for (const [key, value] of Object.entries(surface.settings ?? {})) {
        lines.push(`${INDENT}setting ${key} = ${printValue(value)}`);
    }
    for (const answer of surface.actions ?? []) {
        lines.push(
            `${INDENT}answers ${answer.actionId}`
                + (answer.consume === undefined ? "" : ` consume=${answer.consume}`),
        );
    }
    if (surface.kind === "stageSurface") {
        for (const slot of Object.values(surface.slots ?? {})) {
            lines.push(
                `${INDENT}slot ${printValue(slot.id)} ${printValue(slot.name)}`
                    + (slot.rootElementId ? ` root=${printValue(slot.rootElementId)}` : ""),
            );
        }
    }
    lines.push(...printElementTree(pool, surface.rootElementId, 1, options));
    return lines.join("\n");
}

export function printComponent(component: UIComponentDefinition, options: PrintOptions = {}): string {
    const header = [
        `component ${printValue(component.name)}`,
        `id=${printValue(component.id)}`,
        component.previewMeta?.width != null && component.previewMeta?.height != null
            ? `size=${component.previewMeta.width}x${component.previewMeta.height}`
            : "",
    ].filter(Boolean).join(" ");
    const lines = [header];
    for (const param of component.params ?? []) {
        lines.push(`${INDENT}param ${param.id} ${printValue(param.name)} = ${printValue(param.defaultValue)}`);
    }
    lines.push(...printElementTree(component.elements ?? {}, component.rootElementId, 1, options));
    return lines.join("\n");
}

export function printElementTree(
    pool: Record<UIElementId, UIElement>,
    elementId: string | undefined,
    depth: number,
    options: PrintOptions,
    seen = new Set<string>(),
): string[] {
    if (!elementId || seen.has(elementId)) {
        return [];
    }
    seen.add(elementId);
    const element = pool[elementId];
    if (!element) {
        return [`${INDENT.repeat(depth)}# missing element ${elementId}`];
    }
    const pad = INDENT.repeat(depth);
    const inner = INDENT.repeat(depth + 1);
    const layout = element.layout ?? { x: 0, y: 0, width: 0, height: 0 };
    const header = [
        element.name ? `${printValue(element.name)}: ${element.type}` : element.type,
        `id=${printValue(element.id)}`,
        `@${layout.x ?? 0},${layout.y ?? 0}`,
        `${layout.width ?? 0}x${layout.height ?? 0}`,
    ].join(" ");
    const attached = options.blueprintsByElement?.get(element.id) ?? [];
    const lines = [
        pad + header + (attached.length > 0 ? `  # blueprint: ${attached.map(item => item.name).join(", ")}` : ""),
    ];
    for (const [key, value] of Object.entries(layout)) {
        if (key === "x" || key === "y" || key === "width" || key === "height") {
            continue;
        }
        lines.push(`${inner}layout.${key} = ${printValue(value)}`);
    }
    for (const [key, value] of Object.entries(element.style ?? {})) {
        lines.push(`${inner}style.${key} = ${printValue(value)}`);
    }
    for (const [key, value] of Object.entries(element.props ?? {})) {
        lines.push(`${inner}${key} = ${printValue(value)}`);
    }
    for (const [propPath, binding] of Object.entries(element.valueBindings ?? {})) {
        lines.push(
            binding.kind === "blueprintValue"
                ? `${inner}bind ${propPath} = blueprint ${printValue(binding.blueprintId)} valueType=${binding.valueType}`
                : `${inner}bind ${propPath} = field ${printValue(binding.fieldId)}`,
        );
    }
    if (element.animation !== undefined) {
        lines.push(`${inner}animation = ${printValue(element.animation)}`);
    }
    const link = getUIComponentLink(element);
    if (link) {
        const params = Object.entries(link.params ?? {}).map(([key, value]) => `${key}=${printValue(value)}`);
        lines.push(`${inner}component ${printValue(link.componentId)}${params.length > 0 ? ` ${params.join(" ")}` : ""}`);
    }
    for (const [key, value] of Object.entries(element.extra ?? {})) {
        if (key === "componentLink" && link) {
            continue;
        }
        lines.push(`${inner}extra.${key} = ${printValue(value)}`);
    }
    if (element.assetVariants !== undefined) {
        lines.push(`${inner}assetVariants = ${printValue(element.assetVariants)}`);
    }
    if (options.withoutChildren) {
        if ((element.childrenIds ?? []).length > 0) {
            lines.push(`${inner}# ${element.childrenIds.length} child element(s) not shown`);
        }
        return lines;
    }
    for (const childId of element.childrenIds ?? []) {
        lines.push(...printElementTree(pool, childId, depth + 1, options, seen));
    }
    return lines;
}
