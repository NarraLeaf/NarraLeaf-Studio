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
    type ScriptProjectFacts,
    type ScriptSurfaceFacts,
} from "@shared/project/scriptDeclarations";
import { SCRIPT_API_DECLARATIONS } from "@shared/project/scriptApiDeclarations.generated";
import { SCRIPTS_DIR, SCRIPTS_TSCONFIG_FILE, renderScriptsTsconfig } from "@shared/project/scriptsDirectory";
import type { UIDocument, UIElementId } from "@shared/types/ui-editor/document";
import { UIDocumentService } from "../UIDocumentService";
import { Services, type WorkspaceContext } from "../../services";
import type { FileSystemService } from "../../core/FileSystem";
import { AudioTrackService } from "../../audio/AudioTrackService";
import { CharacterService } from "../../core/CharacterService";
import { LocalizationService } from "../../localization/LocalizationService";
import { StoryService } from "../../story/StoryService";
import { VariableRegistryService } from "../../variables/VariableRegistryService";

/** Elements of one surface or component, in document order, each with the type its ctx is built from. */
function elementsOf(document: UIDocument, ids: readonly UIElementId[]): ScriptSurfaceFacts["elements"] {
    const out: { id: string; name: string; type: string }[] = [];
    const walk = (elementId: UIElementId): void => {
        const element = document.elements[elementId];
        if (!element) {
            return;
        }
        // `nl.root` is the tree's own handle rather than a widget an author writes against.
        if (element.type !== "nl.root") {
            out.push({ id: element.id, name: element.name ?? element.type, type: element.type });
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
        // Scenes are per story document and are not loaded with the library, so they are named only
        // where the story that holds them is open. An empty list is honest here; a wrong one is not.
        scenes: [],
        savedVariables: variables.listEntriesInScope("saved").map(entry => ({ id: entry.id, name: entry.name })),
        persistentVariables: variables
            .listEntriesInScope("persistent")
            .map(entry => ({ id: entry.id, name: entry.name })),
        audioTracks: (audio.tracksOrNull() ?? []).map(track => ({ id: track.id, name: track.name })),
        // Input actions live on the surfaces that declare them; not gathered until there is a host
        // method that takes one from a script by name.
        inputActions: [],
        locales: config.locales.map(locale => locale.code),
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

    let allWritten = true;
    for (const [relative, content] of files) {
        const result = await fs.writeFileNoFollowOrCreate(
            context.project.resolve(relative.split("/")),
            content,
            "utf-8",
        );
        // A refusal is reported as success by the write gate - a frozen workspace turns writes into
        // no-ops - so it counts as not written here, which is what the caller is asking about.
        if (!result.ok || result.refused) {
            allWritten = false;
        }
    }
    return allWritten;
}
