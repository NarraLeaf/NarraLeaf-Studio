/**
 * Checking, in two layers.
 *
 * The compiler answers "is this written against the widgets that exist". This module adds the layer
 * the compiler cannot see: whether the interface still agrees with the blueprint document beside it.
 * That is where the expensive mistakes are - a value binding that names a blueprint owned by a
 * different element shows nothing at all, and the shipped skeleton contained exactly that bug for a
 * while because every test asked about the blueprint's owner and none asked what the element pointed
 * at.
 *
 * Comments in English per project convention.
 */

import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import type { UIStructDef } from "@shared/types/ui-editor/struct";
import { getUIComponentLink } from "@shared/types/ui-editor/document";
import { resolveUIStruct } from "@shared/types/ui-editor/builtinStructs";
import {
    buildUIFrameGraph,
    getUIFrameWidgetProps,
    listUIFrameSites,
    type UIFrameHost,
    type UIFrameSite,
} from "@shared/types/ui-editor/frame";
import type { BpDiagnostic } from "../blueprint-cli/dsl/ast";
import { applyCompiled } from "./apply";
import { compileUiFile, type UiCompileResult } from "./dsl/compile";
import { parseUiFile, UiParseError } from "./dsl/parse";
import { collectTree, elementPath, MAIN_SURFACE_ID, type BlueprintIndex } from "./project";

export { formatDiagnostics } from "../blueprint-cli/check";

/** Props whose value is the id of another element of the same tree. */
const ELEMENT_ID_PROPS = ["trackElementId", "handleElementId", "thumbElementId"] as const;

export type UiCheckResult = {
    diagnostics: BpDiagnostic[];
    compiled: UiCompileResult | null;
    /** True when nothing at error severity was found, so the result is safe to write. */
    ok: boolean;
};

export type UiCheckOptions = {
    existing?: UIDocument | null;
    blueprints?: BlueprintIndex | null;
};

export function checkUiSource(source: string, options: UiCheckOptions = {}): UiCheckResult {
    let compiled: UiCompileResult;
    try {
        compiled = compileUiFile(parseUiFile(source), { existing: options.existing ?? null });
    } catch (error) {
        if (error instanceof UiParseError) {
            return {
                diagnostics: [{ severity: "error", code: "dsl.parse", message: error.message, line: error.line }],
                compiled: null,
                ok: false,
            };
        }
        throw error;
    }
    const diagnostics = [...compiled.diagnostics];
    diagnostics.push(...checkCompiledAgainstProject(compiled, options));
    return { diagnostics, compiled, ok: !diagnostics.some(item => item.severity === "error") };
}

/** The checks that need the project around the file: blueprints, structs, components. */
function checkCompiledAgainstProject(compiled: UiCompileResult, options: UiCheckOptions): BpDiagnostic[] {
    const out: BpDiagnostic[] = [];
    const blueprints = options.blueprints;
    const structs = { ...(options.existing?.structs ?? {}), ...compiled.structs };

    for (const surface of compiled.surfaces) {
        for (const element of Object.values(surface.elements)) {
            out.push(...checkElement(element, surface.elements, { surfaceId: surface.surface.id }, blueprints, structs));
        }
        out.push(...checkDropped(surface.dropped, surface.surface.name, blueprints));
    }
    for (const component of compiled.components) {
        const pool = component.component.elements ?? {};
        for (const element of Object.values(pool)) {
            out.push(...checkElement(element, pool, { componentId: component.component.id }, blueprints, structs));
        }
        out.push(...checkDropped(component.dropped, component.component.name, blueprints));
    }
    if (options.existing) {
        out.push(...checkFramesAfterApply(compiled, options.existing));
    }
    return out;
}

// ---------------------------------------------------------------------------
// Page widgets
// ---------------------------------------------------------------------------

/** A Page widget finding, keyed so a file check can tell one it introduced from one already there. */
type FrameFinding = {
    key: string;
    hostKey: string;
    diagnostic: BpDiagnostic;
};

function frameHostKey(host: UIFrameHost): string {
    return host.kind === "surface" ? `s:${host.surfaceId}` : `c:${host.componentId}`;
}

/** `"Root / Window" on surface "Title"`, or `"Card / Window" in component "Card"`. */
function describeFrameSite(document: UIDocument, site: UIFrameSite): string | null {
    const { host } = site;
    if (host.kind === "surface") {
        const surface = document.surfaces.find(candidate => candidate.id === host.surfaceId);
        return surface ? `"${elementPath(document.elements, site.element)}" on surface "${surface.name}"` : null;
    }
    const component = (document.components ?? []).find(candidate => candidate.id === host.componentId);
    return component ? `"${elementPath(component.elements, site.element)}" in component "${component.name}"` : null;
}

/**
 * Page widgets that do not draw the page they name: the page is not in the document, or it leads
 * back to the widget.
 *
 * The questions Studio's project lint asks as `ui/frame-target-missing` and `ui/frame-loop`, answered
 * by the same shared model (`listUIFrameSites`, `buildUIFrameGraph`) - so a Page widget inside a
 * component is checked where it is written, and a loop that runs through a component placement (a
 * card whose Page widget names the page the card is placed on) is caught here as it is there.
 */
function frameFindings(document: UIDocument): FrameFinding[] {
    const graph = buildUIFrameGraph(document);
    const out: FrameFinding[] = [];
    for (const site of listUIFrameSites(document)) {
        const targetSurfaceId = getUIFrameWidgetProps(site.element).targetSurfaceId;
        const reason = graph.targetInvalidReason({ host: site.host, frameElementId: site.element.id, targetSurfaceId });
        if (reason !== "missing" && reason !== "self" && reason !== "cycle") {
            continue;
        }
        const where = describeFrameSite(document, site);
        if (!where) {
            continue;
        }
        const hostKey = frameHostKey(site.host);
        if (reason === "missing") {
            out.push({
                key: `missing|${hostKey}|${site.element.id}`,
                hostKey,
                diagnostic: {
                    severity: "error",
                    code: "ui.frame_target_missing",
                    message: `${where} embeds page "${targetSurfaceId}", which this document does not have.`,
                    hint: "A Page widget draws the page it names and nothing else, so this one draws an empty frame. "
                        + "Point targetSurfaceId at a page this project has.",
                },
            });
            continue;
        }
        const page = document.surfaces.find(surface => surface.id === targetSurfaceId);
        out.push({
            key: `loop|${hostKey}|${site.element.id}`,
            hostKey,
            diagnostic: {
                severity: "error",
                code: "ui.frame_loop",
                message: `${where} embeds page "${page?.name ?? targetSurfaceId}", which leads back to it.`,
                hint: "Drawing that page would draw this Page widget again inside it, so the game shows \"Page loop "
                    + "blocked\" there instead. A page leads back when it is the widget's own page, when it places the "
                    + "component the widget is in, or when a Page widget or a component placed on it does - at any depth.",
            },
        });
    }
    return out;
}

/**
 * The Page widget findings of the document as it would be after this file is applied.
 *
 * Reported when the widget is in a block the file writes, and also when the file creates a finding
 * elsewhere: placing a card on a page is written on the page, while the Page widget that now leads
 * back sits in the card's definition, which the file may never mention.
 */
function checkFramesAfterApply(compiled: UiCompileResult, existing: UIDocument): BpDiagnostic[] {
    const after = structuredClone(existing);
    // A copy of the compiled blocks too: applying normalizes flow children's layouts in place, and
    // the caller may still apply these very records to the real document.
    applyCompiled(after, structuredClone(compiled));
    const before = new Set(frameFindings(existing).map(finding => finding.key));
    const written = new Set([
        ...compiled.surfaces.map(surface => frameHostKey({ kind: "surface", surfaceId: surface.surface.id })),
        ...compiled.components.map(component => frameHostKey({ kind: "component", componentId: component.component.id })),
    ]);
    return frameFindings(after)
        .filter(finding => written.has(finding.hostKey) || !before.has(finding.key))
        .map(finding => finding.diagnostic);
}

function checkDropped(
    dropped: readonly { id: string; name: string }[],
    ownerName: string,
    blueprints: BlueprintIndex | null | undefined,
): BpDiagnostic[] {
    const out: BpDiagnostic[] = [];
    for (const element of dropped) {
        const attached = blueprints?.byElement.get(element.id) ?? [];
        if (attached.length > 0) {
            out.push({
                severity: "warning",
                code: "ui.orphaned_blueprint",
                message: `Applying this drops "${element.name}" from "${ownerName}", and `
                    + `${attached.map(item => `"${item.name}"`).join(", ")} hangs off it.`,
                hint: "The blueprint stays in uigraphs.json with an owner nothing points at. Keep the element, "
                    + "or take the blueprint away first: `blueprint remove --blueprint <id> --project <dir> --write`.",
            });
            continue;
        }
        out.push({
            severity: "info",
            code: "ui.element_dropped",
            message: `Applying this drops "${element.name}" from "${ownerName}".`,
        });
    }
    return out;
}

function checkElement(
    element: UIElement,
    pool: Record<string, UIElement>,
    owner: { surfaceId?: string; componentId?: string },
    blueprints: BlueprintIndex | null | undefined,
    structs: Record<string, UIStructDef>,
): BpDiagnostic[] {
    const out: BpDiagnostic[] = [];
    const where = `"${elementPath(pool, element)}"`;

    for (const [propPath, binding] of Object.entries(element.valueBindings ?? {})) {
        if (binding.kind !== "blueprintValue") {
            continue;
        }
        if (!blueprints) {
            continue;
        }
        const blueprint = blueprints.byId.get(binding.blueprintId);
        if (!blueprint) {
            out.push({
                severity: "warning",
                code: "ui.binding_blueprint_missing",
                message: `${where} binds ${propPath} to blueprint "${binding.blueprintId}", which this project `
                    + "does not hold.",
                hint: `Write it with: blueprint apply <file> --project <dir>, owner=widgetValue `
                    + `surface=${owner.surfaceId ?? "<surface>"} element=${element.id} prop=${propPath}.`,
            });
            continue;
        }
        const bpOwner = blueprint.owner as { kind: string; surfaceId?: string; elementId?: string; propPath?: string };
        const matches = bpOwner.kind === "widgetValue"
            && bpOwner.elementId === element.id
            && bpOwner.propPath === propPath
            && (owner.surfaceId == null || bpOwner.surfaceId === owner.surfaceId);
        if (!matches) {
            out.push({
                severity: "error",
                code: "ui.binding_owner_mismatch",
                message: `${where} binds ${propPath} to blueprint "${blueprint.name}", but that blueprint is owned `
                    + `by ${describeOwner(bpOwner)}.`,
                hint: "A value blueprint is evaluated for the element that owns it, so this prop would show "
                    + "nothing. Point the binding at the blueprint owned by this element and this prop.",
            });
        }
    }

    const props = (element.props ?? {}) as Record<string, unknown>;
    for (const key of ELEMENT_ID_PROPS) {
        const value = props[key];
        if (typeof value === "string" && value.length > 0 && !pool[value]) {
            out.push({
                severity: "warning",
                code: "ui.missing_part",
                message: `${where} points ${key} at "${value}", which is not an element of this tree.`,
                hint: "The widget draws its own parts through these, so it renders without one.",
            });
        }
    }

    const structId = props.itemStructId;
    if (typeof structId === "string" && structId.length > 0 && !resolveUIStruct({ structs }, structId)) {
        out.push({
            severity: "warning",
            code: "ui.unknown_struct",
            message: `${where} names item struct "${structId}", which is neither built in nor declared here.`,
            hint: "Run `ui structs` for the shipped shapes, or declare one with a `struct` block.",
        });
    }

    return out;
}

function describeOwner(owner: { kind: string; surfaceId?: string; elementId?: string; propPath?: string }): string {
    if (owner.kind === "widgetValue") {
        return `element ${owner.elementId ?? "?"} prop "${owner.propPath ?? "?"}"`;
    }
    return `a ${owner.kind} blueprint`;
}

// ---------------------------------------------------------------------------
// Checking what a project already holds
// ---------------------------------------------------------------------------

/** Every finding about the interface document as it stands, with no text file involved. */
export function checkProjectDocument(document: UIDocument, blueprints: BlueprintIndex | null): BpDiagnostic[] {
    const out: BpDiagnostic[] = [];
    const reachable = new Set<string>();

    if (!document.surfaces.some(surface => surface.id === MAIN_SURFACE_ID)) {
        out.push({
            severity: "warning",
            code: "ui.no_main_surface",
            message: `No surface carries the id "${MAIN_SURFACE_ID}".`,
            hint: "A shipped game always boots into that surface id, and no other surface can be given it, so "
                + "the title page has to be the one that has it.",
        });
    }

    for (const surface of document.surfaces) {
        const tree = collectTree(document.elements, surface.rootElementId);
        if (tree.length === 0) {
            out.push({
                severity: "error",
                code: "ui.missing_root",
                message: `Surface "${surface.name}" names root element "${surface.rootElementId}", which is not in `
                    + "the document.",
            });
            continue;
        }
        for (const element of tree) {
            reachable.add(element.id);
            out.push(...checkElement(element, document.elements, { surfaceId: surface.id }, blueprints, document.structs ?? {}));
            const link = getUIComponentLink(element);
            if (link && !(document.components ?? []).some(component => component.id === link.componentId)) {
                out.push({
                    severity: "error",
                    code: "ui.unknown_component",
                    message: `"${elementPath(document.elements, element)}" is an instance of component `
                        + `"${link.componentId}", which this document does not define.`,
                });
            }
        }
    }

    for (const component of document.components ?? []) {
        const pool = component.elements ?? {};
        const tree = collectTree(pool, component.rootElementId);
        if (tree.length === 0) {
            out.push({
                severity: "error",
                code: "ui.missing_root",
                message: `Component "${component.name}" names root element "${component.rootElementId}", which is `
                    + "not in its element table.",
            });
        }
        for (const element of tree) {
            out.push(...checkElement(element, pool, { componentId: component.id }, blueprints, document.structs ?? {}));
        }
    }

    out.push(...frameFindings(document).map(finding => finding.diagnostic));

    for (const id of Object.keys(document.elements)) {
        if (!reachable.has(id)) {
            out.push({
                severity: "warning",
                code: "ui.unreachable_element",
                message: `Element "${document.elements[id].name ?? id}" (${id}) is in the document but no surface `
                    + "reaches it.",
                hint: "Nothing draws it. It is usually the remains of a deleted surface.",
            });
        }
    }

    return out;
}
