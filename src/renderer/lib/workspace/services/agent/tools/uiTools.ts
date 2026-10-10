/**
 * The interface tools that are not the `.ui` text format: `ui_selection`, `ui_patch`,
 * `ui_screenshot`, the template store, and the brand palette.
 *
 * Comments in English per project convention.
 */

import { createElement, type ReactElement } from "react";
import { getInterface } from "@/lib/app/bridge";
import type { UIComponentDefinition, UIDocument, UIElement, UISurface } from "@shared/types/ui-editor/document";
import { readUIComponentEditorSurfaceComponentId } from "@shared/types/ui-editor/componentInstanceKey";
import { parseBrandLink } from "@shared/brand/brandLink";
import { normalizeProjectFontStack } from "@shared/types/typography";
import { applyUITemplate } from "@/apps/workspace/modules/ui-editor/panel/templates/applyUITemplate";
import { AssetType } from "../../assets/assetTypes";
import type { Asset, AssetSource } from "../../assets/types";
import { Services, type WorkspaceContext } from "../../services";
import type { UIDocumentService } from "../../ui-editor/UIDocumentService";
import type { UIEditorStateService } from "../../ui-editor/UIEditorStateService";
import type { UIRuntimeBridgeService } from "../../ui-editor/UIRuntimeBridgeService";
import { cssFamilyForAssetId } from "../../ui-editor/UIEditorFontFaceService";
import type { BrandService } from "../../brand/BrandService";
import {
    answerJson,
    readOptionalInteger,
    readOptionalRecord,
    readOptionalString,
    readOptionalStringArray,
    readString,
    refuse,
    type AgentToolHandler,
} from "../agentCall";
import { AGENT_HISTORY_LABEL, assetsService, listAssets, resolveAsset, resolveComponent, resolveSurface, resolveSurfaceOrComponent } from "../agentLookups";
import { applyUiPatch, readUiPatchOps, type UIPatchTarget } from "../uiPatch";
import { listUiSubtree, resolveUiElementRef, uiElementPath, type UIElementPool } from "../uiElementRefs";
import { designRectFromClientRects, planScreenshot, type ScreenshotRect } from "../screenshotGeometry";
import { blobToDataUrl, rasterizeElement } from "../domRaster";
import { OffscreenCapture, waitForOffscreenPage } from "../offscreenCapture";
import { AssetLoadTrackerContext } from "@/lib/ui-editor/runtime/assetLoadTracker";
import { AssetResolutionReporterContext } from "@/lib/ui-editor/runtime/useAssetResolutionReport";

function uiDocumentService(ctx: WorkspaceContext): UIDocumentService {
    return ctx.services.get<UIDocumentService>(Services.UIDocument);
}

function describeElement(pool: UIElementPool, element: UIElement) {
    return {
        id: element.id,
        name: element.name ?? null,
        type: element.type,
        path: uiElementPath(pool, element),
        layout: element.layout,
        props: element.props ?? {},
    };
}

// ── ui_selection ─────────────────────────────────────────────────────────────────────────────────

export const uiSelection: AgentToolHandler = async (_args, { ctx }) => {
    const selection = ctx.services.get<UIEditorStateService>(Services.UIEditorState).getSelection();
    const document = uiDocumentService(ctx).getDocument();
    if (selection.type === "element") {
        const componentId = readUIComponentEditorSurfaceComponentId(selection.data.surfaceId);
        const component = componentId ? resolveComponent(document, componentId) : undefined;
        const surface = componentId ? undefined : document.surfaces.find(item => item.id === selection.data.surfaceId);
        const pool: UIElementPool = component ? component.elements : document.elements;
        return answerJson({
            ...(component ? { component: { id: component.id, name: component.name } } : {}),
            ...(surface ? { surface: { id: surface.id, name: surface.name } } : {}),
            elements: selection.data.elementIds.map(id => pool[id]).filter(Boolean).map(element => describeElement(pool, element)),
        });
    }
    if (selection.type === "scene") {
        const componentId = readUIComponentEditorSurfaceComponentId(selection.data);
        const component = componentId ? resolveComponent(document, componentId) : undefined;
        const surface = componentId ? undefined : document.surfaces.find(item => item.id === selection.data);
        return answerJson({
            ...(component ? { component: { id: component.id, name: component.name } } : {}),
            ...(surface ? { surface: { id: surface.id, name: surface.name } } : {}),
            elements: [],
        }, "A page is selected, with no element in it.");
    }
    return answerJson({ elements: [] }, "Nothing is selected in the interface editor.");
};

// ── ui_patch ─────────────────────────────────────────────────────────────────────────────────────

/** The revision an agent compares against for a page or component. */
export function uiContentRevision(ctx: WorkspaceContext, target: UIPatchTarget): number {
    const uidoc = uiDocumentService(ctx);
    return target.kind === "surface" ? uidoc.getSurfaceContentRevision(target.surfaceId) : uidoc.getComponentContentRevision(target.componentId);
}

/** Refuse a write against a page or component that changed since the agent read it. */
export function assertUiRevision(ctx: WorkspaceContext, target: UIPatchTarget, baseRevision: number | undefined): void {
    if (baseRevision === undefined) {
        return;
    }
    const current = uiContentRevision(ctx, target);
    if (current !== baseRevision) {
        throw refuse(
            "stale_revision",
            `The page changed since you read it (revision ${baseRevision}, now ${current}).`,
            "Call ui_show again and redo the edit against what it prints.",
        );
    }
}

export const uiPatch: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const ref = readString(args, "surface");
    const ops = readUiPatchOps(args.ops);
    const baseRevision = readOptionalInteger(args, "baseRevision");
    const uidoc = uiDocumentService(ctx);
    const found = resolveSurfaceOrComponent(uidoc.getDocument(), ref);
    const target: UIPatchTarget = found.kind === "surface"
        ? { kind: "surface", surfaceId: found.surface.id }
        : { kind: "component", componentId: found.component.id };
    const name = found.kind === "surface" ? found.surface.name : found.component.name;
    follow.describeCall(request.callId, name);
    assertUiRevision(ctx, target, baseRevision);

    const outcome = applyUiPatch(uidoc, target, ops, AGENT_HISTORY_LABEL);
    follow.noteWrite(target.kind === "surface"
        ? { kind: "surface", surfaceId: target.surfaceId, name, elementIds: outcome.touched }
        : { kind: "component", componentId: target.componentId, name, elementIds: outcome.touched });

    const createdContainer = outcome.created.some(item => item.type === "nl.container" || item.type === "nl.image");
    return answerJson(
        { revision: uiContentRevision(ctx, target), created: outcome.created, deleted: outcome.deleted },
        `Applied ${ops.length} operation(s) to "${name}" as one undo step.`
            + (createdContainer
                ? " New containers and images start with a white fill: set `appearance` props (copy them from a transparent element via ui_show) or the fill will cover what is behind it."
                : ""),
    );
};

// ── ui_screenshot ────────────────────────────────────────────────────────────────────────────────

function componentDesignSize(component: UIComponentDefinition): { width: number; height: number } {
    const root = component.elements[component.rootElementId];
    return {
        width: Math.max(1, Math.round(component.previewMeta?.width ?? root?.layout.width ?? 160)),
        height: Math.max(1, Math.round(component.previewMeta?.height ?? root?.layout.height ?? 88)),
    };
}

/** An element's box from its layout alone, walking up the parents: the fallback when it was not drawn with an id. */
function layoutRect(pool: UIElementPool, element: UIElement): ScreenshotRect {
    let x = 0;
    let y = 0;
    let current: UIElement | undefined = element;
    while (current && current.parentId) {
        x += current.layout.x ?? 0;
        y += current.layout.y ?? 0;
        current = pool[current.parentId];
    }
    return { x, y, width: element.layout.width ?? 0, height: element.layout.height ?? 0 };
}

const FONT_FORMATS: Record<string, string> = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" };

/** `@font-face` CSS carrying a project font's bytes, for a family the page names. */
async function fontFaceForFamily(ctx: WorkspaceContext, family: string): Promise<string | null> {
    if (!family.startsWith("nlEditorFont_")) {
        return null;
    }
    const asset = listAssets(ctx, [AssetType.Font]).find(item => cssFamilyForAssetId(item.id) === family);
    if (!asset) {
        return null;
    }
    const fetched = await assetsService(ctx).fetch(asset as Asset<AssetType, AssetSource>);
    const bytes = fetched.success ? (fetched.data as { data?: unknown } | undefined)?.data : null;
    if (!(bytes instanceof Uint8Array) && !Array.isArray(bytes)) {
        return null;
    }
    const format = FONT_FORMATS[(asset.ext ?? "").toLowerCase()];
    const dataUrl = await blobToDataUrl(new Blob([new Uint8Array(bytes as ArrayLike<number>)]));
    return `@font-face{font-family:"${family}";src:url(${dataUrl})${format ? ` format("${format}")` : ""};}`;
}

/** The page an un-targeted screenshot means: the one being edited, else the entry page. */
function defaultScreenshotTarget(ctx: WorkspaceContext, document: UIDocument): { surface?: UISurface; component?: UIComponentDefinition } {
    const selection = ctx.services.get<UIEditorStateService>(Services.UIEditorState).getSelection();
    const selectedSurfaceId = selection.type === "element" ? selection.data.surfaceId : selection.type === "scene" ? selection.data : null;
    if (selectedSurfaceId) {
        const componentId = readUIComponentEditorSurfaceComponentId(selectedSurfaceId);
        const component = componentId ? resolveComponent(document, componentId) : undefined;
        if (component) {
            return { component };
        }
        const surface = document.surfaces.find(item => item.id === selectedSurfaceId);
        if (surface) {
            return { surface };
        }
    }
    const entry = document.surfaces.find(item => item.id === document.entrySurfaceId) ?? document.surfaces[0];
    return { surface: entry };
}

export const uiScreenshot: AgentToolHandler = async (args, tool) => {
    const { ctx, request, follow, offscreen } = tool;
    const surfaceRef = readOptionalString(args, "surface");
    const componentRef = readOptionalString(args, "component");
    const elementRef = readOptionalString(args, "element");
    const maxSize = readOptionalInteger(args, "maxSize", { min: 64, max: 4096 }) ?? 1280;
    const document = uiDocumentService(ctx).getDocument();

    let surface: UISurface | undefined;
    let component: UIComponentDefinition | undefined;
    if (componentRef) {
        component = resolveComponent(document, componentRef);
        if (!component) {
            throw refuse("not_found", `No component "${componentRef}".`, "Call ui_surfaces for the component names.");
        }
    } else if (surfaceRef) {
        surface = resolveSurface(document, surfaceRef);
        if (!surface) {
            throw refuse("not_found", `No page "${surfaceRef}".`, "Call ui_surfaces for the page names.");
        }
    } else {
        ({ surface, component } = defaultScreenshotTarget(ctx, document));
    }
    if (!surface && !component) {
        throw refuse("not_found", "This project has no pages to look at.");
    }
    const name = surface?.name ?? component!.name;
    follow.describeCall(request.callId, name);

    const bridge = ctx.services.get<UIRuntimeBridgeService>(Services.RuntimeBridge);
    const design = surface ? { width: surface.designSize.width, height: surface.designSize.height } : componentDesignSize(component!);
    const rendered: ReactElement | null = surface
        ? bridge.renderSurface({ surfaceId: surface.id, hostAdapter: { host: surface.host }, editorChrome: false })
        : bridge.renderComponent({ componentId: component!.id, hostAdapter: { host: "app" }, editorChrome: false });
    if (!rendered) {
        throw refuse("unavailable", `"${name}" could not be rendered.`);
    }

    const pool: UIElementPool = surface ? document.elements : component!.elements;
    const rootId = surface ? surface.rootElementId : component!.rootElementId;
    let targetElement: UIElement | null = null;
    if (elementRef) {
        const found = resolveUiElementRef(pool, rootId, elementRef);
        if (found.kind !== "found") {
            throw refuse(found.kind === "ambiguous" ? "invalid_args" : "not_found", `Element "${elementRef}" ${found.kind === "ambiguous" ? "is ambiguous" : "is not on this page"}.`, "Name it by id (ui_show).");
        }
        targetElement = found.element;
    }

    // The page is drawn under a capture that hears every asset lookup start and end and every slot's
    // outcome, so the photograph waits for pictures still on their way and names the ones that failed.
    const capture = new OffscreenCapture(() => {
        const names: Record<string, string> = {};
        for (const asset of listAssets(ctx, [AssetType.Image, AssetType.Video])) {
            names[asset.id] = asset.name;
        }
        return names;
    });
    const tracked = createElement(
        AssetLoadTrackerContext.Provider,
        { value: capture },
        createElement(AssetResolutionReporterContext.Provider, { value: capture.report }, rendered),
    );
    // The nearest element of this page's own pool: an element inside a placed component carries the
    // definition's id, which the page does not have, so the walk goes on up to the placement.
    const describe = (node: Element): string | null => {
        for (let at = node.closest("[data-ui-element-id]"); at; at = at.parentElement?.closest("[data-ui-element-id]") ?? null) {
            const element = pool[at.getAttribute("data-ui-element-id") ?? ""];
            if (element) {
                return uiElementPath(pool, element);
            }
        }
        return null;
    };

    let mounted;
    try {
        mounted = await offscreen.render(tracked, design.width, design.height);
    } catch (error) {
        throw refuse("unavailable", error instanceof Error ? error.message : String(error));
    }
    try {
        const readiness = await waitForOffscreenPage(mounted.box, capture, { describe });
        const page = mounted.box.firstElementChild as HTMLElement | null;
        if (!page) {
            throw refuse("unavailable", `"${name}" rendered nothing.`);
        }
        let crop: ScreenshotRect | null = null;
        if (targetElement) {
            const node = page.querySelector<HTMLElement>(`[data-ui-element-id="${CSS.escape(targetElement.id)}"]`);
            crop = node
                ? designRectFromClientRects(page.getBoundingClientRect(), node.getBoundingClientRect(), design)
                : layoutRect(pool, targetElement);
        }
        const plan = planScreenshot(design, crop, maxSize);
        if (!plan) {
            throw refuse("unavailable", `Element "${elementRef}" is outside the page, so there is nothing to show.`);
        }
        const raster = await rasterizeElement({ node: page, design, plan, describe, resolveFontFace: family => fontFaceForFamily(ctx, family) });
        const elementCount = listUiSubtree(pool, rootId).length;
        const notDrawn = [...new Set([...capture.failedSlots(), ...raster.missing])];
        const summary = [
            `"${name}"${targetElement ? `, cropped to ${uiElementPath(pool, targetElement)}` : ""}: ${plan.width}x${plan.height} px`
                + ` (design ${design.width}x${design.height}, ${elementCount} elements).`,
            surface?.kind === "stageSurface" ? "Transparent areas are where the game stage shows through." : "",
            readiness.outstanding.length > 0
                ? `Photographed after ${Math.round(readiness.elapsedMs / 1000)}s with these still arriving, so they may be absent or half-drawn: ${listForSummary(readiness.outstanding)}.`
                : "",
            notDrawn.length > 0 ? `Not drawn: ${listForSummary(notDrawn)}.` : "",
        ].filter(Boolean).join(" ");
        return {
            ok: true,
            content: [
                { type: "image", mimeType: "image/png", data: raster.png },
                { type: "text", text: summary },
            ],
            structured: {
                surface: surface ? { id: surface.id, name: surface.name } : undefined,
                component: component ? { id: component.id, name: component.name } : undefined,
                element: targetElement ? { id: targetElement.id, path: uiElementPath(pool, targetElement) } : undefined,
                width: plan.width,
                height: plan.height,
                source: plan.source,
                ...(notDrawn.length > 0 ? { notDrawn } : {}),
                ...(readiness.outstanding.length > 0 ? { stillArriving: readiness.outstanding } : {}),
            },
        };
    } finally {
        mounted.release();
    }
};

/** A list for one line of the summary: the first dozen, then a count. */
function listForSummary(items: readonly string[]): string {
    const shown = items.slice(0, 12).join("; ");
    return items.length > 12 ? `${shown}; and ${items.length - 12} more` : shown;
}

// ── Templates ────────────────────────────────────────────────────────────────────────────────────

export const uiTemplates: AgentToolHandler = async () => {
    const result = await getInterface().uiTemplates.registryFetch();
    if (!result.success) {
        throw refuse("unavailable", `The template store could not be reached: ${result.error ?? "unknown error"}.`, "Check the network, or build the page with ui_patch instead.");
    }
    const index = result.data.index;
    return answerJson({
        templates: index.templates.map(template => ({
            id: template.id,
            name: template.name,
            description: template.description,
            categories: template.categories,
            theme: template.theme ?? null,
            placement: template.surface,
        })),
    });
};

export const uiTemplateApply: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const templateId = readString(args, "template");
    follow.describeCall(request.callId, templateId);
    const result = await applyUITemplate(templateId, uiDocumentService(ctx));
    if (!result.ok) {
        throw refuse("unavailable", `The template could not be applied: ${result.error}.`);
    }
    const first = result.surfaces[0];
    if (first) {
        follow.noteWrite({ kind: "surface", surfaceId: first.id, name: first.name });
    }
    return answerJson({
        surfaces: result.surfaces.map(surface => ({ id: surface.id, name: surface.name, kind: surface.kind })),
        components: result.components.map(component => ({ id: component.id, name: component.name })),
        skippedSlots: result.skippedSlots,
        assetsSkipped: result.assetsSkipped,
    }, `Added ${result.surfaces.length} page(s) and ${result.components.length} component(s) from the template.`);
};

// ── Brand ────────────────────────────────────────────────────────────────────────────────────────

function describeBrand(brand: BrandService, ctx: WorkspaceContext) {
    const palette = brand.getPalette();
    const fonts = assetsService(ctx).getAssets()[AssetType.Font] ?? {};
    return {
        colors: brand.listColors().map(color => ({
            id: color.id,
            name: color.name ?? null,
            value: color.value,
            resolved: palette.resolveCss(color.id),
            builtin: color.builtin === true,
            link: `nlbrand:${color.id}`,
        })),
        fonts: brand.listFonts().map(font => ({ assetId: font.assetId, name: fonts[font.assetId]?.name ?? null, locales: font.locales ?? [] })),
    };
}

export const brandGet: AgentToolHandler = async (_args, { ctx }) => {
    return answerJson(describeBrand(ctx.services.get<BrandService>(Services.Brand), ctx));
};

export const brandSet: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const colors = readOptionalRecord(args, "colors");
    const fonts = readOptionalStringArray(args, "fonts");
    if (!colors && !fonts) {
        throw refuse("invalid_args", "Give `colors`, `fonts` or both.");
    }
    follow.describeCall(request.callId, "brand");
    const brand = ctx.services.get<BrandService>(Services.Brand);

    // Checked whole before anything is written.
    const colorEntries = Object.entries(colors ?? {});
    for (const [id, value] of colorEntries) {
        if (typeof value !== "string" || !value.trim()) {
            throw refuse("invalid_args", `colors.${id} must be a CSS colour or an nlbrand: link.`);
        }
        if (parseBrandLink(`nlbrand:${id}`)?.id !== id) {
            throw refuse("invalid_args", `"${id}" is not a palette id: use lower-case words, at most one dot (e.g. \`accent\` or \`title.shadow\`).`);
        }
        const trimmed = value.trim();
        if (!parseBrandLink(trimmed) && typeof CSS !== "undefined" && !CSS.supports("color", trimmed)) {
            throw refuse("invalid_args", `colors.${id}: "${trimmed}" is not a CSS colour.`);
        }
    }
    const fontIds = (fonts ?? []).map(ref => resolveAsset(ctx, ref, AssetType.Font).id);

    const added: string[] = [];
    const updated: string[] = [];
    for (const [id, value] of colorEntries) {
        const trimmed = (value as string).trim();
        if (brand.getColor(id)) {
            brand.updateColor(id, { value: trimmed });
            updated.push(id);
        } else if (brand.adoptColors([{ id, value: trimmed }]) > 0) {
            added.push(id);
        }
    }
    if (fonts) {
        const document = brand.getDocument();
        brand.replaceDocument({ ...document, fonts: normalizeProjectFontStack(fontIds.map(assetId => ({ assetId }))) });
    }
    return answerJson(
        { added, updated, ...describeBrand(brand, ctx) },
        `Palette: ${added.length} added, ${updated.length} changed${fonts ? `; font stack set to ${fontIds.length} font(s)` : ""}.`,
    );
};

