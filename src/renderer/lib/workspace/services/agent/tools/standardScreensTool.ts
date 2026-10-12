/**
 * `ui_install_standard_screens`: the starter template's working interface, brought into the open
 * project in one call.
 *
 * A project made from the empty template has one blank page and nothing else - no dialogue box, no
 * save, load, settings or log - and the store's templates are layouts with no logic behind them. The
 * skeleton project template ships all of it wired, so this reads that template's own documents
 * (never a copy kept in code, which would drift from the template authors actually start from), plans
 * what the project can take (`planStandardScreens`), and imports it the way a page copied from
 * another project is imported: files under the ids the template gave them, the palette entries and
 * translation keys it names, then the pages, Game UIs, components and blueprints together through
 * `UIDocumentService.installBundle`, which re-identifies them and records one step of undo.
 *
 * The persistent variable and the save-slot field the save pages read are not interface records, so
 * they are adopted under the template's ids before the import - the blueprints name them by id. Like
 * the files and translations, they stay when the step is undone.
 *
 * Comments in English per project convention.
 */

import { getInterface } from "@/lib/app/bridge";
import { nextUnusedVariableName } from "@shared/variables/variableRegistryModel";
import { normalizeProjectBrandColors } from "@shared/types/brand";
import type { SaveSchema, SaveSchemaField } from "@shared/types/saveSchema";
import type { UIDocument, UISurface } from "@shared/types/ui-editor/document";
import { resolveEntrySurface } from "@shared/types/ui-editor/entrySurface";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import { isBuiltinWidgetLogicType } from "@shared/types/ui-editor/widgetLogic";
import {
    closeSurfaceTabs,
    contentLocale,
    importTemplateFiles,
    readTemplateBlueprints,
    resolveStartTarget,
} from "@/apps/workspace/modules/ui-editor/panel/templates/addStarterTitlePage";
import { planStandardScreens, type StandardScreensPlan } from "@/apps/workspace/modules/ui-editor/panel/templates/standardScreens";
import {
    brandColorsToAdopt,
    findTemplateTitlePage,
    isBlankSurface,
    STARTER_TITLE_PAGE_TEMPLATE_ID,
    templateTextKeys,
} from "@/apps/workspace/modules/ui-editor/panel/templates/starterTitlePage";
import { findWidgetModule } from "@/lib/ui-cli/catalog";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { Services, type WorkspaceContext } from "../../services";
import type { Service } from "../../Service";
import type { AssetsService } from "../../core/AssetsService";
import type { ProjectService } from "../../core/ProjectService";
import type { UIService } from "../../core/UIService";
import type { BrandService } from "../../brand/BrandService";
import type { SaveSchemaService } from "../../saves/SaveSchemaService";
import type { StoryService } from "../../story/StoryService";
import type { BlueprintNodeCatalogService } from "../../ui-editor/BlueprintNodeCatalogService";
import { IMPORT_PLACEMENT_FROM_SOURCE } from "../../ui-editor/UIDocumentService";
import { createCatalogAssetPinResolver } from "../../ui-editor/blueprint/catalogAssetPins";
import type { VariableRegistryService } from "../../variables/VariableRegistryService";
import { answerJson, readOptionalBoolean, refuse, type AgentToolHandler } from "../agentCall";
import { AGENT_HISTORY_LABEL } from "../agentLookups";
import { liveBlueprintDocument, uiDocumentService } from "./textFormat";

function optionalService<T extends Service>(ctx: WorkspaceContext, key: Services): T | null {
    try {
        return ctx.services.get<T>(key);
    } catch {
        return null;
    }
}

const planTexts = new WeakMap<StandardScreensPlan, string>();

/**
 * Whether the arriving interface names `id` anywhere: an element prop, a binding, a node param, or
 * inside another string - a save field is wired by a pin named `field:<id>`. The ids are UUIDs, so
 * finding one inside the text is finding a reference to it.
 */
function planNames(plan: StandardScreensPlan, id: string): boolean {
    let text = planTexts.get(plan);
    if (text === undefined) {
        text = JSON.stringify([plan.document.elements, plan.document.components, plan.blueprints.blueprints]);
        planTexts.set(plan, text);
    }
    return text.includes(id);
}

/** The template's variables the arriving blueprints read and the project does not have. */
function variablesToAdopt(raw: unknown, plan: StandardScreensPlan, project: VariableRegistryService | null): VariableRegistryEntry[] {
    const entries = (raw as { entries?: Record<string, VariableRegistryEntry> } | null)?.entries;
    if (!entries || !project) {
        return [];
    }
    const have = project.getRegistry().entries;
    const keys = new Set(Object.values(have).map(entry => entry.storageKey));
    const names = Object.values(have).map(entry => entry.name);
    const out: VariableRegistryEntry[] = [];
    for (const [id, entry] of Object.entries(entries)) {
        if (have[id] || !entry || typeof entry.name !== "string" || keys.has(entry.storageKey ?? id) || !planNames(plan, id)) {
            continue;
        }
        const name = nextUnusedVariableName(entry.name, names);
        names.push(name);
        out.push({ ...entry, id, name, storageKey: entry.storageKey ?? id });
    }
    return out;
}

/** The template's save-slot fields the arriving blueprints read and write and the project does not have. */
function saveFieldsToAdopt(raw: unknown, plan: StandardScreensPlan, project: SaveSchemaService | null): SaveSchemaField[] {
    const fields = (raw as { fields?: Record<string, SaveSchemaField> } | null)?.fields;
    if (!fields || !project) {
        return [];
    }
    let schema: SaveSchema;
    try {
        schema = project.getSchema();
    } catch {
        return [];
    }
    const keys = new Set(Object.values(schema.fields).map(field => field.storageKey));
    let order = Math.max(-1, ...Object.values(schema.fields).map(field => field.order ?? 0));
    const out: SaveSchemaField[] = [];
    for (const [id, field] of Object.entries(fields)) {
        if (schema.fields[id] || !field || keys.has(field.storageKey) || !planNames(plan, id)) {
            continue;
        }
        order += 1;
        out.push({ ...field, id, order });
    }
    return out;
}

/** What the workspace can run: the node catalogue (plugins included) and the widget registry. */
function projectCapabilities(ctx: WorkspaceContext) {
    const catalog = optionalService<BlueprintNodeCatalogService>(ctx, Services.BlueprintNodeCatalog);
    return {
        catalog,
        knowsNode: (type: string) => Boolean(catalog?.get(type) ?? blueprintNodeRegistry.get(type)),
        knowsWidget: (type: string) => isBuiltinWidgetLogicType(type) || Boolean(findWidgetModule(type)),
    };
}

export const uiInstallStandardScreens: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const replace = readOptionalBoolean(args, "replace") ?? false;
    const dryRun = readOptionalBoolean(args, "dryRun") ?? false;
    follow.describeCall(request.callId, "standard screens");
    const uidoc = uiDocumentService(ctx);
    const project = ctx.services.get<ProjectService>(Services.Project);
    const stories = ctx.services.get<StoryService>(Services.Story);

    const locale = contentLocale(project);
    const read = await getInterface().projectTemplates.readInterface(STARTER_TITLE_PAGE_TEMPLATE_ID, locale);
    if (!read.success) {
        throw refuse("unavailable", `The skeleton template could not be read: ${read.error ?? "unknown error"}.`);
    }
    const content = read.data;
    const templateDocument = uidoc.prepareTemplateDocumentForPreview(content.uiDocument);
    let templateBlueprints;
    try {
        templateBlueprints = readTemplateBlueprints(content.uiGraphs);
    } catch (error) {
        throw refuse("internal", `The skeleton template's blueprints could not be read: ${error instanceof Error ? error.message : String(error)}.`);
    }
    if (!templateDocument || !templateBlueprints) {
        throw refuse("internal", "The skeleton template has no interface to install.");
    }

    // A dry run must not give the project a story, which finding Start's target does when it has none.
    const hasStory = Boolean(stories.getDefaultStoryId() ?? stories.listStories()[0]?.id);
    const startTarget = dryRun && !hasStory ? null : await resolveStartTarget({ stories, project });
    const capabilities = projectCapabilities(ctx);
    const plan = planStandardScreens({
        document: templateDocument,
        blueprints: templateBlueprints,
        startTarget,
        knowsNode: capabilities.knowsNode,
        knowsWidget: capabilities.knowsWidget,
        resolveAssetPins: createCatalogAssetPinResolver(capabilities.catalog),
    });

    // What the project holds now, and what makes room.
    const document: UIDocument = uidoc.getDocument();
    const blueprints = liveBlueprintDocument(ctx);
    // A second set beside a working one is two title pages and two save screens, and nothing here
    // replaces pages that have something on them.
    const workingTitle = findTemplateTitlePage(document, blueprints);
    if (workingTitle) {
        throw refuse(
            "unavailable",
            `This project already has working screens: page "${workingTitle.name}" starts the story and loads saves.`,
            "Restyle what is there (ui_show, ui_patch). To start over, delete those pages first (ui_page_delete), then install.",
        );
    }
    const occupied = document.surfaces.filter((surface): surface is Extract<UISurface, { kind: "stageSurface" }> =>
        surface.kind === "stageSurface" && plan.stageSlots.includes(surface.mount.slotId));
    const blankPages = document.surfaces.filter(surface => surface.kind === "appSurface" && isBlankSurface(document, blueprints, surface));
    const currentEntry = resolveEntrySurface(document);
    const entryIsBlank = !currentEntry || blankPages.some(page => page.id === currentEntry.id);
    const entryMoves = Boolean(plan.entrySurfaceId) && (replace || entryIsBlank);
    const removeSurfaces: UISurface[] = replace
        ? [...occupied, ...blankPages]
        : entryMoves && currentEntry && entryIsBlank ? [currentEntry] : [];
    const skippedSlots: string[] = replace ? [] : occupied.map(surface => surface.mount.slotId);

    const variables = variablesToAdopt(content.variables, plan, optionalService<VariableRegistryService>(ctx, Services.VariableRegistry));
    const saveFields = saveFieldsToAdopt(content.saveSchema, plan, optionalService<SaveSchemaService>(ctx, Services.SaveSchema));
    const arriving = plan.document.surfaces.filter(surface => !(surface.kind === "stageSurface" && skippedSlots.includes(surface.mount.slotId)));
    const summary = {
        pages: arriving.filter(surface => surface.kind === "appSurface").map(surface => surface.name),
        gameUis: arriving.filter(surface => surface.kind === "stageSurface").map(surface => surface.name),
        components: (plan.document.components ?? []).map(component => component.name),
        leftOut: plan.leftOut,
        cutControls: plan.cutControls,
        skippedSlots,
        removed: removeSurfaces.map(surface => ({ id: surface.id, name: surface.name, kind: surface.kind })),
        variables: variables.map(entry => ({ name: entry.name, scope: entry.scope })),
        saveFields: saveFields.map(field => field.name),
    };

    const notes: string[] = [];
    if (plan.leftOut.length > 0) {
        notes.push(
            `Left out, because this project does not run what their logic needs: ${plan.leftOut.map(item => `"${item.name}" (${item.needs.join(", ")})`).join("; ")}.`
                + (plan.cutControls.length > 0 ? ` The controls that only opened them were left out too: ${plan.cutControls.map(item => `"${item.element}" on "${item.surface}"`).join(", ")}.` : ""),
        );
    }
    if (skippedSlots.length > 0) {
        notes.push(`The project already fills these Game UI slots, so the standard ones were not added: ${skippedSlots.join(", ")}. Pass replace: true to put them in place of the project's (one undo step takes it back).`);
    }

    if (dryRun) {
        return answerJson(
            { dryRun: true, written: false, ...summary, entryWouldMove: entryMoves },
            [`Would add ${summary.pages.length} page(s), ${summary.gameUis.length} Game UI(s) and ${summary.components.length} component(s) (dry run: nothing written).`, ...notes].join("\n"),
        );
    }

    // Everything the interface names that is not an interface record goes in first, under the ids
    // the template gave it, so the import finds each one already resolving.
    const assets = ctx.services.get<AssetsService>(Services.Assets);
    await importTemplateFiles({ assets }, content, plan.assetIds, content.contentLocale ?? locale);
    const brand = optionalService<BrandService>(ctx, Services.Brand);
    if (brand) {
        brand.adoptColors(brandColorsToAdopt(
            plan.brandColorIds,
            normalizeProjectBrandColors((content.brand as { colors?: unknown } | null)?.colors),
            id => Boolean(brand.getColor(id)),
        ));
    }
    if (variables.length > 0) {
        ctx.services.get<VariableRegistryService>(Services.VariableRegistry).applyRegistryMutation(registry => {
            for (const entry of variables) {
                registry.entries[entry.id] = entry;
            }
        });
    }
    if (saveFields.length > 0) {
        const saves = ctx.services.get<SaveSchemaService>(Services.SaveSchema);
        const schema = saves.getSchema();
        saves.replaceSchema({ ...schema, fields: { ...schema.fields, ...Object.fromEntries(saveFields.map(field => [field.id, field])) } });
    }

    const result = uidoc.installBundle({
        document: plan.document,
        graphs: { blueprintDocument: plan.blueprints },
        placement: IMPORT_PLACEMENT_FROM_SOURCE,
        textKeys: templateTextKeys(content.localizationKeys),
        removeSurfaceIds: removeSurfaces.map(surface => surface.id),
        entrySourceSurfaceId: entryMoves ? plan.entrySurfaceId ?? undefined : undefined,
        label: AGENT_HISTORY_LABEL,
    });
    const ui = optionalService<UIService>(ctx, Services.UI);
    if (ui) {
        for (const surface of result.removedSurfaces) {
            closeSurfaceTabs(ui, surface.id);
        }
    }
    const title = plan.titleSurfaceId ? result.surfaceIdMap[plan.titleSurfaceId] : undefined;
    const titleSurface = result.importedSurfaces.find(surface => surface.id === title) ?? result.importedSurfaces[0];
    if (titleSurface) {
        follow.noteWrite({ kind: "surface", surfaceId: titleSurface.id, name: titleSurface.name });
    }
    const entry = resolveEntrySurface(uidoc.getDocument());
    const lines = [
        `Installed ${result.importedSurfaces.filter(surface => surface.kind === "appSurface").length} page(s), `
            + `${result.importedSurfaces.filter(surface => surface.kind === "stageSurface").length} Game UI(s) and `
            + `${result.importedComponents.length} component(s) with their blueprints, as one step of undo.`,
        entry ? `The game opens on "${entry.name}".${entryMoves ? "" : " The entry page did not move, because it is not empty: make the new splash or title the entry with ui_page_set_entry if it should be."}` : "",
        startTarget ? "Start begins the project's default story at its entry scene; move it with scene_set_entry." : "The project has no scene yet, so Start names none: create a scene, then check the title's Start blueprint (blueprint_show).",
        result.removedSurfaces.length > 0 ? `Removed: ${result.removedSurfaces.map(surface => `"${surface.name}"`).join(", ")}.` : "",
        variables.length > 0 ? `Added the variable(s) the save pages read: ${variables.map(entry => `"${entry.name}" (${entry.scope})`).join(", ")}. Set them from the story (\`/set\`) to show the place on a save slot.` : "",
        saveFields.length > 0 ? `Added the save-slot field(s): ${saveFields.map(field => `"${field.name}"`).join(", ")}.` : "",
        ...notes,
        "Check with ui_surfaces and ui_screenshot, then restyle as the ui-design chapter says; lint finds anything left dangling.",
    ].filter(Boolean);
    return answerJson(
        {
            dryRun: false,
            written: true,
            ...summary,
            surfaces: result.importedSurfaces.map(surface => ({ id: surface.id, name: surface.name, kind: surface.kind })),
            components: result.importedComponents.map(component => ({ id: component.id, name: component.name })),
            entry: entry ? { id: entry.id, name: entry.name } : null,
            adoptedActions: result.adoptedActionIds,
        },
        lines.join("\n"),
    );
};
