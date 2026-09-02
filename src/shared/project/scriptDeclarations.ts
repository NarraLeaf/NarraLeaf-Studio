/**
 * `scripts/.narraleaf/project.d.ts` - this project's own names, as types.
 *
 * The half of a script's declarations that no published package could contain. The other half is
 * the host API, which is the same for every project and is generated once from Studio's source. This
 * half is generated from the project that is open, so `ctx.host.game.getCharacter(` completes with
 * the characters this author actually wrote, and renaming one in Studio makes the script that names
 * the old id a type error with a line number rather than a value that reads as null at runtime.
 *
 * # Why this is not a resource index
 *
 * A table keyed by id that lets a reader reach an unrelated resource from any starting point is a
 * shape this product refuses to ship, whatever it was built for. This is not that, on the only
 * ground that matters: **it never reaches a shipped game**. It is written into `scripts/.narraleaf/`,
 * which version control excludes, which a project export excludes, and which holds nothing but
 * `.d.ts` - types, erased before a single byte is bundled. It is an authoring aid on the author's
 * own machine, the same kind of thing the command-line tools print when they list a project's
 * surfaces.
 *
 * What follows from that: nothing here may ever be emitted into a build, and no runtime may read
 * it. If a future change wants these names at runtime, it needs a different answer - see
 * `asset-set-reference-points` for how that was done elsewhere, by hanging the answer on the record
 * that names the id rather than on an index.
 *
 * # What is named, and what is not
 *
 * Only the names a script can actually pass to the host API: a surface to open, an element to
 * write, a saved variable to read, a scene to ask about. Assets are deliberately absent - no method
 * on the ctx takes an asset id - which also keeps the file as far from the shape above as it can be.
 */

import { SCRIPTS_GENERATED_DIR } from "./scriptsDirectory";

/** Where this file is written, relative to the project root. */
export const PROJECT_DECLARATIONS_PATH = `scripts/${SCRIPTS_GENERATED_DIR}/project.d.ts`;

/** Where the host API declarations are written, beside it. */
export const SCRIPT_API_DECLARATIONS_PATH = `scripts/${SCRIPTS_GENERATED_DIR}/script.d.ts`;

/**
 * One surface and the elements on it.
 *
 * Elements carry their widget type so the generated `Ctx` alias for each one is the right one: a
 * script written against a slider gets the slider's events, and asking a container for
 * `onSliderValueChanged` is a type error where it used to be a handler nothing ever called.
 */
export type ScriptSurfaceFacts = {
    id: string;
    name: string;
    elements: readonly { id: string; name: string; type: string }[];
};

/** What the generator needs to know about the open project. Every list may be empty. */
export type ScriptProjectFacts = {
    surfaces: readonly ScriptSurfaceFacts[];
    /** Component definitions, whose elements a component script addresses. */
    components: readonly ScriptSurfaceFacts[];
    characters: readonly { id: string; name: string }[];
    stories: readonly { id: string; name: string }[];
    scenes: readonly { id: string; name: string }[];
    savedVariables: readonly { id: string; name: string }[];
    persistentVariables: readonly { id: string; name: string }[];
    audioTracks: readonly { id: string; name: string }[];
    inputActions: readonly { id: string; name: string }[];
    locales: readonly string[];
};

const HEADER = [
    "// Written by NarraLeaf Studio from this project. Edits are overwritten.",
    "//",
    "// It names what this project contains, so your editor can complete it and tell you when a",
    "// name no longer exists. Rename something in Studio and the scripts that used the old name",
    "// report it here.",
].join("\n");

/**
 * A TypeScript string-literal union of the given ids, or `never` when there are none.
 *
 * `never` rather than `string` for an empty list, and it is the difference between a type that
 * helps and one that lies: a project with no characters should refuse every argument to
 * `getCharacter`, not accept any string. It also makes the failure legible - "not assignable to
 * never" is a project that declares none, which is exactly what the author needs to know.
 */
function unionOf(ids: readonly string[]): string {
    const unique = [...new Set(ids)].filter(id => id.length > 0).sort();
    return unique.length === 0 ? "never" : unique.map(id => JSON.stringify(id)).join(" | ");
}

/** `Quick menu` -> `QuickMenu`; a name with nothing usable falls back to its position. */
function typeNameOf(name: string, fallbackIndex: number): string {
    const cleaned = name
        .replace(/[^A-Za-z0-9]+/g, " ")
        .trim()
        .split(" ")
        .filter(part => part.length > 0)
        .map(part => part[0].toUpperCase() + part.slice(1))
        .join("");
    const usable = /^[A-Za-z]/.test(cleaned) ? cleaned : "";
    return usable || `Surface${fallbackIndex + 1}`;
}

/** Names that would collide get their position appended, so every alias is written exactly once. */
function uniqueTypeNames(entries: readonly { name: string }[]): string[] {
    const taken = new Set<string>();
    return entries.map((entry, index) => {
        const base = typeNameOf(entry.name, index);
        let candidate = base;
        for (let n = 2; taken.has(candidate); n += 1) {
            candidate = `${base}${n}`;
        }
        taken.add(candidate);
        return candidate;
    });
}

function surfaceBlock(surface: ScriptSurfaceFacts, typeName: string, componentScoped: boolean): string[] {
    const ctx = componentScoped ? "ComponentWidgetCtx" : "WidgetCtx";
    const lines: string[] = [
        `    /** Elements on ${JSON.stringify(surface.name)}. */`,
        `    type ${typeName}Element = ${unionOf(surface.elements.map(element => element.id))};`,
    ];
    for (const [index, element] of surface.elements.entries()) {
        const elementType = typeNameOf(element.name, index);
        lines.push(
            `    /** ${JSON.stringify(element.name)} - ${element.type}. */`,
            `    type ${typeName}${elementType}Ctx = ${ctx}<${JSON.stringify(element.type)}>;`,
        );
    }
    return lines;
}

/**
 * Render the project half of a script's declarations.
 *
 * Pure, so it can be checked against a project's facts without a filesystem, and so the two callers
 * that need it - the service that writes it when a document changes, and the build that keeps it
 * current - cannot disagree about what it says.
 */
export function renderProjectDeclarations(facts: ScriptProjectFacts): string {
    const surfaceNames = uniqueTypeNames(facts.surfaces);
    const componentNames = uniqueTypeNames(facts.components);

    const lines: string[] = [
        HEADER,
        "",
        'declare module "@narraleaf/script" {',
        "    /** Every page and Game UI surface in this project. */",
        `    type SurfaceId = ${unionOf(facts.surfaces.map(surface => surface.id))};`,
        "    /** Every component definition. */",
        `    type ComponentId = ${unionOf(facts.components.map(component => component.id))};`,
        "    /** Every character, by the id `getCharacter` takes. */",
        `    type CharacterId = ${unionOf(facts.characters.map(character => character.id))};`,
        "    /** Every story. */",
        `    type StoryId = ${unionOf(facts.stories.map(story => story.id))};`,
        "    /** Every scene, by the id `isSceneVisited` takes. */",
        `    type SceneId = ${unionOf(facts.scenes.map(scene => scene.id))};`,
        "    /** Saved variables - one playthrough's own values. */",
        `    type SavedVariableId = ${unionOf(facts.savedVariables.map(variable => variable.id))};`,
        "    /** Persistent variables - shared by every save file. */",
        `    type PersistentVariableId = ${unionOf(facts.persistentVariables.map(variable => variable.id))};`,
        "    /** Audio tracks, by the id the mixer takes. */",
        `    type AudioTrackId = ${unionOf(facts.audioTracks.map(track => track.id))};`,
        "    /** Input actions, by the id `isActionHeld` takes. */",
        `    type InputActionId = ${unionOf(facts.inputActions.map(action => action.id))};`,
        "    /** Languages this project ships. */",
        `    type LocaleCode = ${unionOf(facts.locales)};`,
        "",
    ];

    for (const [index, surface] of facts.surfaces.entries()) {
        lines.push(...surfaceBlock(surface, surfaceNames[index], false), "");
    }
    for (const [index, component] of facts.components.entries()) {
        lines.push(...surfaceBlock(component, componentNames[index], true), "");
    }

    lines.push("}", "");
    return lines.join("\n");
}
