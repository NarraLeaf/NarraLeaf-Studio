/**
 * Writing the three files that make `<project>/scripts/` an editable folder.
 *
 * An author opens that directory in their own editor and expects completion and errors, with
 * nothing installed. Three files are what it takes:
 *
 *  - `tsconfig.json`, so the editor compiles the folder the way Studio does;
 *  - `.narraleaf/script.d.ts`, the host API and the three context tiers, generated from Studio's
 *    source at build time and shipped as a resource (`scripts/gen-script-api-dts.mjs`);
 *  - `.narraleaf/project.d.ts`, this project's own names, rendered here from what is open.
 *
 * All three are Studio's to write, and they are the only things in that directory that are - see
 * `@shared/project/scriptsDirectory` for the boundary and why it exists.
 *
 * # Written on open, and after a rename
 *
 * The point of the project half is that renaming a character in Studio turns the script that used
 * the old id into a type error the author can see. That only holds if the file is rewritten when
 * the project changes, so this runs when the workspace comes up and whenever a script blueprint is
 * created. It is a whole-file write of derived content, so running it twice costs a write and
 * changes nothing.
 *
 * A failure here is reported and swallowed: a project whose declarations could not be written is
 * still a project the author can edit, and the game still builds - the type check is a lint, never
 * a build step. What they lose is completion, which is worth a log line and not a blocked open.
 */

import {
    PROJECT_DECLARATIONS_PATH,
    SCRIPT_API_DECLARATIONS_PATH,
    renderProjectDeclarations,
    type ScriptPluginEventFieldKind,
    type ScriptPluginWidgetFacts,
    type ScriptProjectFacts,
    type ScriptSurfaceFacts,
} from "@shared/project/scriptDeclarations";
import { getContributedWidget, listContributedWidgets } from "@shared/types/ui-editor/contributedWidgets";
import { SCRIPT_WIDGET_TYPES } from "@/lib/ui-editor/blueprint-runtime/script/scriptContext";
import { scriptEventsOfContributedLogicApi } from "@/lib/ui-editor/blueprint-runtime/script/scriptEventDispatch";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import { SCRIPT_API_DECLARATIONS } from "@shared/project/scriptApiDeclarations.generated";
import {
    SCRIPTS_DIR,
    SCRIPTS_GENERATED_DIR,
    SCRIPTS_TSCONFIG_FILE,
    renderScriptsTsconfig,
} from "@shared/project/scriptsDirectory";
import type { UIDocument, UIElementId } from "@shared/types/ui-editor/document";
import { UIDocumentService } from "../UIDocumentService";
import { Services, type WorkspaceContext } from "../../services";
import type { FileSystemService } from "../../core/FileSystem";
import { AudioTrackService } from "../../audio/AudioTrackService";
import { CharacterService } from "../../core/CharacterService";
import { LocalizationService } from "../../localization/LocalizationService";
import { StoryService } from "../../story/StoryService";
import { VariableRegistryService } from "../../variables/VariableRegistryService";
import { storeWrite } from "../../autosave/writeReport";

const BUILTIN_SCRIPT_WIDGET_TYPES: ReadonlySet<string> = new Set(SCRIPT_WIDGET_TYPES);

/**
 * Whether a script can sit on an element of this type and the declarations can name it: one of
 * Studio's scriptable widgets, or a loaded plugin's widget with a blueprint of its own.
 */
function isScriptableElementType(type: string): boolean {
    return BUILTIN_SCRIPT_WIDGET_TYPES.has(type) || getContributedWidget(type)?.logicApi?.supportsPrivateBlueprint === true;
}

/** Elements of one surface or component, in document order, each with the type its ctx is built from. */
function elementsOf(document: UIDocument, ids: readonly UIElementId[]): ScriptSurfaceFacts["elements"] {
    const out: { id: string; name: string; type: string; scriptable: boolean }[] = [];
    const walk = (elementId: UIElementId): void => {
        const element = document.elements[elementId];
        if (!element) {
            return;
        }
        // `nl.root` is the tree's own handle rather than a widget an author writes against.
        if (element.type !== "nl.root") {
            out.push({
                id: element.id,
                name: element.name ?? element.type,
                type: element.type,
                scriptable: isScriptableElementType(element.type),
            });
        }
        for (const childId of element.childrenIds ?? []) {
            walk(childId);
        }
    };
    for (const id of ids) {
        walk(id);
    }
    return out;
}

/** A plugin head's data output pin, as the kind of field it puts in the event argument. */
function fieldKindOf(valueType: string | undefined): ScriptPluginEventFieldKind {
    switch (valueType) {
        case "float":
        case "integer":
            return "number";
        case "string":
            return "string";
        case "boolean":
            return "boolean";
        default:
            return "unknown";
    }
}

/**
 * The widgets loaded plugins contribute that a script can sit on, with the events it may export.
 *
 * The events come from the same function the dispatcher and the Dev Mode check read, so what the
 * types offer is what the runtime calls. A plugin event's fields are its heads' data output pins -
 * the fields of the payload a graph on the same event reads - looked up in the node registry the
 * plugin registered them in.
 */
export function collectScriptPluginWidgetFacts(): ScriptPluginWidgetFacts[] {
    const out: ScriptPluginWidgetFacts[] = [];
    for (const declared of listContributedWidgets()) {
        if (declared.logicApi?.supportsPrivateBlueprint !== true) {
            continue;
        }
        const events: ScriptPluginWidgetFacts["events"][number][] = [];
        for (const event of scriptEventsOfContributedLogicApi(declared.logicApi).events) {
            if (!event.pluginHeadTypes) {
                events.push({ id: event.eventId, builtin: true });
                continue;
            }
            const fields: Record<string, ScriptPluginEventFieldKind> = {};
            for (const head of event.pluginHeadTypes) {
                for (const pin of blueprintNodeRegistry.get(head)?.pins ?? []) {
                    if (pin.kind === "output" && pin.semantic === "data" && !(pin.id in fields)) {
                        fields[pin.id] = fieldKindOf(pin.valueType);
                    }
                }
            }
            events.push({ id: event.eventId, builtin: false, fields });
        }
        let displayName = declared.type;
        try {
            displayName = widgetModuleRegistry.get(declared.type)?.displayName || declared.type;
        } catch {
            // A plugin's display name is its own getter; a throwing one names the widget by its type.
        }
        out.push({ type: declared.type, displayName, pluginId: declared.ownerPluginId, events });
    }
    return out;
}

/**
 * What this project holds, as the declarations need it.
 *
 * Every service is read through the context at call time rather than depended on at init: this runs
 * once when the workspace is up, and making the blueprint service wait on six more services to
 * write a convenience file would put them all on the critical path of opening a project.
 */
export function collectScriptProjectFacts(context: WorkspaceContext): ScriptProjectFacts {
    const document = context.services.get<UIDocumentService>(Services.UIDocument).getDocument();
    const characters = context.services.get<CharacterService>(Services.Character);
    const stories = context.services.get<StoryService>(Services.Story);
    const variables = context.services.get<VariableRegistryService>(Services.VariableRegistry);
    const audio = context.services.get<AudioTrackService>(Services.AudioTracks);
    const localization = context.services.get<LocalizationService>(Services.Localization);

    const config = localization.getConfiguration();

    return {
        surfaces: document.surfaces.map(surface => ({
            id: surface.id,
            name: surface.name,
            elements: elementsOf(document, [surface.rootElementId]),
        })),
        components: (document.components ?? []).map(component => ({
            id: component.id,
            name: component.name,
            elements: elementsOf(document, [component.rootElementId]),
        })),
        characters: characters
            .listCharacter()
            .map(character => ({ id: character.profile.getId(), name: character.profile.getName() })),
        stories: stories.listStories().map(story => ({ id: story.id, name: story.name })),
        // Not gathered: a scene is inside its story's document, and this runs when a project opens.
        // `null` rather than an empty list, which would tell an author with forty scenes that their
        // project declares none - see `unionOfKnown`.
        scenes: null,
        savedVariables: variables.listEntriesInScope("saved").map(entry => ({ id: entry.id, name: entry.name })),
        persistentVariables: variables
            .listEntriesInScope("persistent")
            .map(entry => ({ id: entry.id, name: entry.name })),
        audioTracks: (audio.tracksOrNull() ?? []).map(track => ({ id: track.id, name: track.name })),
        // One project-level table, keyed by id, since the input rework: a surface stores which of
        // them it answers, not the actions themselves. `input.isActionHeld` takes one of these ids
        // from a script, which is the host method this list was waiting on.
        inputActions: Object.entries(document.actions ?? {}).map(([id, action]) => ({
            id,
            name: action.name,
        })),
        locales: config.locales.map(locale => locale.code),
        pluginWidgets: collectScriptPluginWidgetFacts(),
    };
}

/** Write all three, reporting rather than throwing. Answers whether every file landed. */
export async function writeScriptDeclarations(context: WorkspaceContext): Promise<boolean> {
    const fs = context.services.get<FileSystemService>(Services.FileSystem);
    const files: [string, string][] = [
        [`${SCRIPTS_DIR}/${SCRIPTS_TSCONFIG_FILE}`, renderScriptsTsconfig()],
        [SCRIPT_API_DECLARATIONS_PATH, SCRIPT_API_DECLARATIONS],
        [PROJECT_DECLARATIONS_PATH, renderProjectDeclarations(collectScriptProjectFacts(context))],
    ];

    // The generated directory, before anything is written into it: the write path creates a file
    // but not the folders above it, so without this the tsconfig lands (its folder exists) and the
    // two declarations silently do not.
    await fs.createDir(context.project.resolve([SCRIPTS_DIR, SCRIPTS_GENERATED_DIR]));

    let allWritten = true;
    for (const [relative, content] of files) {
        // Generated, and written again whenever a project with scripts opens: a failure costs the
        // script editor its completion until then, which the caller already tolerates by design.
        const result = await fs.writeFileNoFollowOrCreate(
            context.project.resolve(relative.split("/")),
            content,
            "utf-8",
            storeWrite("workspace.shell.save.stores.uiGraph", "handledByWriter"),
        );
        // A refusal is reported as success by the write gate - a frozen workspace turns writes into
        // no-ops - so it counts as not written here, which is what the caller is asking about.
        if (!result.ok || result.refused) {
            allWritten = false;
        }
    }
    return allWritten;
}
