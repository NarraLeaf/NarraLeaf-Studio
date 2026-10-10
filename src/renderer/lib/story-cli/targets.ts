/**
 * What a project holds, spelled as the words a line would name it by.
 *
 * The counterpart of `blueprint targets`, and it exists for the same reason: writing a line means
 * knowing what may go in each slot, and the answer is a project's own vocabulary rather than
 * anything a catalogue can list. A character is named by its name, an asset by its name, a page by
 * its name - never by an id, because an id is not a spelling any line accepts.
 *
 * Read straight off the resolved {@link StoryCommandContext}, which is the very table a typed line
 * resolves against. So a name printed here is a name that resolves, and one that is missing here is
 * one that will not - there is no second list to fall out of step.
 *
 * Comments in English per project convention.
 */

import type { StoryCommandContext } from "@/apps/workspace/modules/story/scene-editor/storyCommandValues";

type Section = { title: string; hint: string; values: readonly string[]; verbatim?: boolean };

/** What one scene opens on (`#background`, `#music` in its header), by name; see `dsl/sceneSettings.ts`. */
export type SceneSettingsEntry = { scene: string; background: string | null; music: string | null };

/**
 * What a character's looks are called - the word after the name on a `/show` or `/char` row. A
 * preset character's poses; a layered character's tags, grouped by the axis each belongs to (a row
 * names the tag alone and changes that axis only); a puppet's looks are named by its model.
 */
export type CharacterLooksEntry = {
    character: string;
    kind: string;
    poses?: readonly string[];
    axes?: readonly { name: string; tags: readonly string[]; default: string | null }[];
};

/** Build the entries from characters as the story command line holds them. */
export function characterLooksOf(characters: readonly {
    profile: {
        getName(): string;
        appearance: {
            getKind(): string;
            getPoses(): readonly { name: string }[];
            getAxes(): readonly { name: string; tags: readonly { id: string; name: string }[]; defaultTagId: string | null }[];
        };
    };
}[]): CharacterLooksEntry[] {
    return characters.map(character => {
        const appearance = character.profile.appearance;
        const kind = appearance.getKind();
        if (kind === "preset") {
            return { character: character.profile.getName(), kind, poses: appearance.getPoses().map(pose => pose.name) };
        }
        if (kind === "layered") {
            return {
                character: character.profile.getName(),
                kind,
                axes: appearance.getAxes().map(axis => ({
                    name: axis.name,
                    tags: axis.tags.map(tag => tag.name),
                    default: axis.tags.find(tag => tag.id === axis.defaultTagId)?.name ?? axis.tags[0]?.name ?? null,
                })),
            };
        }
        return { character: character.profile.getName(), kind };
    });
}

/**
 * The looks section: one line per preset character, one per axis of a layered one. Verbatim lines,
 * because "Mei expression: normal* smile" has to keep its axis beside its tags to mean anything.
 */
function looksSection(entries: readonly CharacterLooksEntry[]): Section {
    const values: string[] = [];
    for (const entry of entries) {
        const who = quoteIfSpaced(entry.character);
        if (entry.poses) {
            if (entry.poses.length > 0) {
                values.push(`${who}: ${entry.poses.map(quoteIfSpaced).join("  ")}`);
            }
        } else if (entry.axes) {
            for (const axis of entry.axes) {
                values.push(`${who} (${axis.name}): ${axis.tags.map(tag => `${quoteIfSpaced(tag)}${tag === axis.default ? "*" : ""}`).join("  ")}`);
            }
        } else {
            values.push(`${who}: named by its ${entry.kind} model (/char, /motion, /skin)`);
        }
    }
    return {
        title: "character looks",
        hint: "the word after the name on /show and /char; a layered character's tag changes its own axis only, * = default",
        values,
        verbatim: true,
    };
}

/**
 * The lists an author picks from, in the order a scene tends to need them.
 *
 * Deliberately not everything the context holds: `stageObjects` and `labels` are scene-scoped and
 * belong to the scene being written rather than to the project, and printing them from a
 * project-wide call would offer names that resolve in one scene and nowhere else.
 */
function sectionsOf(context: StoryCommandContext): Section[] {
    const names = (entries: readonly { name: string }[]): string[] => entries.map(entry => entry.name).filter(Boolean);
    return [
        { title: "characters", hint: "/say, /show, /char, /hide", values: names(context.characters) },
        { title: "one-off speakers", hint: "already used in this story", values: [...context.tempSpeakers] },
        { title: "images", hint: "/bg, /image, /show, /swap, #background", values: names(context.images) },
        { title: "audio", hint: "/bgm, /sound, #music", values: names(context.audio) },
        { title: "videos", hint: "/play", values: names(context.videos) },
        { title: "audio tracks", hint: "track= on a sound command", values: names(context.audioTracks) },
        { title: "variables", hint: "/set, /inc, /if", values: names(context.variables) },
        { title: "scenes", hint: "/jump", values: names(context.scenes) },
        { title: "pages", hint: "/quit, an ending's page", values: names(context.surfaces) },
        { title: "input actions", hint: "/waitinput, /hold, /mash", values: names(context.inputActions) },
        { title: "build variants", hint: "/cut", values: names(context.appTags) },
        { title: "value blueprints", hint: "callable from an expression", values: names(context.valueBlueprints) },
        { title: "choice options", hint: "picked(...) in an expression", values: names(context.choiceOptions) },
    ];
}

/**
 * The scenes that open on a background or music of their own. Listed because those are references
 * no row makes: an image only a scene header names is in use - the linter counts it - and without
 * this a search for it found the image and nothing that used it.
 */
function sceneSettingsSection(entries: readonly SceneSettingsEntry[]): Section {
    const values: string[] = [];
    for (const entry of entries) {
        if (entry.background !== null) {
            values.push(`${entry.scene}: #background ${entry.background}`);
        }
        if (entry.music !== null) {
            values.push(`${entry.scene}: #music ${entry.music}`);
        }
    }
    return { title: "scene settings", hint: "what a scene opens on before its first row; story show prints them in the header", values, verbatim: true };
}

export function formatTargets(
    context: StoryCommandContext,
    search: string,
    sceneSettings: readonly SceneSettingsEntry[] = [],
    looks: readonly CharacterLooksEntry[] = [],
): string {
    const folded = search.trim().toLowerCase();
    const lines: string[] = [];
    let hidden = 0;
    const [characters, ...rest] = sectionsOf(context);
    for (const section of [characters, looksSection(looks), ...rest, sceneSettingsSection(sceneSettings)]) {
        const matching = folded ? section.values.filter(value => value.toLowerCase().includes(folded)) : section.values;
        if (matching.length === 0) {
            hidden += section.values.length;
            continue;
        }
        lines.push(lines.length > 0 ? `\n${section.title}  (${section.hint})` : `${section.title}  (${section.hint})`);
        // Wrapped rather than one per line: these are words to pick from, and a project with two
        // hundred images should not be two hundred lines of terminal.
        lines.push(...(section.verbatim ? matching.map(value => `  ${value}`) : wrap(matching.map(quoteIfSpaced), 96)));
    }
    if (lines.length === 0) {
        return folded ? `Nothing in this project matches "${search}".` : "This project names nothing a line could use.";
    }
    if (hidden > 0) {
        lines.push(`\n${hidden} more not matching "${search}".`);
    }
    return lines.join("\n");
}

/**
 * A name with spaces in it, as a line would have to write it.
 *
 * Single quotes, because that is what the command line reads as an entity reference - double quotes
 * are a string literal, and the two are not interchangeable in an expression slot.
 */
function quoteIfSpaced(name: string): string {
    return /\s/.test(name) ? `'${name}'` : name;
}

function wrap(values: readonly string[], width: number): string[] {
    const lines: string[] = [];
    let current = "";
    for (const value of values) {
        const next = current ? `${current}  ${value}` : `  ${value}`;
        if (next.length > width && current) {
            lines.push(current);
            current = `  ${value}`;
            continue;
        }
        current = next;
    }
    if (current) {
        lines.push(current);
    }
    return lines;
}
