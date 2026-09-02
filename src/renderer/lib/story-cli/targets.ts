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

type Section = { title: string; hint: string; values: readonly string[] };

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
        { title: "images", hint: "/bg, /image, /swap", values: names(context.images) },
        { title: "audio", hint: "/bgm, /sound", values: names(context.audio) },
        { title: "videos", hint: "/video", values: names(context.videos) },
        { title: "audio tracks", hint: "track= on a sound command", values: names(context.audioTracks) },
        { title: "variables", hint: "/set, /inc, /if", values: names(context.variables) },
        { title: "scenes", hint: "/jump", values: names(context.scenes) },
        { title: "pages", hint: "/quit, an ending's page", values: names(context.surfaces) },
        { title: "build variants", hint: "/cut", values: names(context.appTags) },
        { title: "value blueprints", hint: "callable from an expression", values: names(context.valueBlueprints) },
        { title: "choice options", hint: "picked(...) in an expression", values: names(context.choiceOptions) },
    ];
}

export function formatTargets(context: StoryCommandContext, search: string): string {
    const folded = search.trim().toLowerCase();
    const lines: string[] = [];
    let hidden = 0;
    for (const section of sectionsOf(context)) {
        const matching = folded ? section.values.filter(value => value.toLowerCase().includes(folded)) : section.values;
        if (matching.length === 0) {
            hidden += section.values.length;
            continue;
        }
        lines.push(lines.length > 0 ? `\n${section.title}  (${section.hint})` : `${section.title}  (${section.hint})`);
        // Wrapped rather than one per line: these are words to pick from, and a project with two
        // hundred images should not be two hundred lines of terminal.
        lines.push(...wrap(matching.map(quoteIfSpaced), 96));
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
