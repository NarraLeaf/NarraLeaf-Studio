import type { PaletteActionCommand } from "../storyActionCommands";
import {
    STORY_COMMAND_GROUPS,
    subjectGroupId,
    type StoryCommandCategoryId,
    type StoryCommandGroup,
    type StoryCommandGroupId,
} from "../storyCommandCategories";
import type { StoryCommandContext } from "../storyCommandValues";
import { listCommandSpecs, type AnyStoryCommandSpec } from "./registry";
import { availableSpecCommands, specPaletteCommands } from "./specPalette";

/**
 * The subject × verb menu, derived from the spec registry.
 *
 * The sidebar cannot be "one spec, one entry": `/show` is a generic verb spanning five subjects, and a
 * single `category` field can only put it in one place, so an author browsing 图片 would not find
 * "显示". The data that fixes it was already on the spec - `targetParam(accepts)` literally says which
 * subjects a verb can act on - so the two-dimensional menu is a projection, not a second catalogue:
 *
 *   - a spec WITH a target param → filed under EVERY subject its `accepts` names;
 *   - a spec WITHOUT one → filed under its `category`.
 *
 * That is what closes D1: `/show` is one spec reaching five subjects instead of ten sidebar entries
 * teaching an "object type × verb" matrix, and D4 closes for free - `layer` gains show/hide/transform/fx
 * entries the moment those specs accept `layer`, with nothing layer-specific written anywhere.
 */

/** Which subject each reserved target word browses under. */
const RESERVED_GROUPS: Partial<Record<string, StoryCommandGroupId>> = {
    camera: "camera",
    background: "image",
    backgroundLayer: "layer",
    displayableLayer: "layer",
};

export type StoryCommandSidebarGroup = {
    group: StoryCommandGroup;
    commands: readonly PaletteActionCommand[];
};

/**
 * One stop the highlight can land on while browsing - a single rendered row. A generic verb files
 * under several subjects, so it yields several stops; each carries a `group:id` key that is unique
 * even when the command id is not (`/show` appears six times, six distinct keys).
 *
 * This is what keeps interaction-model rule 2 ("the highlight is Enter's pointer") true once the `/`
 * browse became the sidebar's projection: the walk moves one stop per keypress, exactly one row is
 * `active` at a time, and Enter takes `stop.command` - the row the eye is on, not the first row that
 * happens to share its id. Keying the walk by id alone would light up all six `/show` rows and jump
 * the caret to the wrong one; keying it by `group:id` cannot.
 */
export type StoryCommandMenuStop = {
    key: string;
    group: StoryCommandGroup;
    command: PaletteActionCommand;
};

/** Flatten the browse groups into the highlight's walk order: one stop per rendered row, top to bottom. */
export function browseMenuStops(groups: readonly StoryCommandSidebarGroup[]): readonly StoryCommandMenuStop[] {
    return groups.flatMap(entry =>
        entry.commands.map(command => ({ key: `${entry.group.id}:${command.id}`, group: entry.group, command })),
    );
}

/** Every target kind a spec's params accept, in `accepts` order; empty when the spec takes no target. */
export function specTargetKinds(spec: AnyStoryCommandSpec): readonly string[] {
    const kinds: string[] = [];
    for (const param of Object.values(spec.params)) {
        const types = Array.isArray(param.type) ? param.type : [param.type];
        for (const type of types) {
            if (type.kind === "target") {
                // `accepts` and `reserved`, never `refuses`: a kind resolved only in order to be
                // refused is not a subject this command acts on, and filing it under one would put
                // `/transform` in the 视频 menu next to the verbs that actually work there.
                for (const accepted of [...type.accepts, ...(type.reserved ?? [])]) {
                    if (!kinds.includes(accepted)) {
                        kinds.push(accepted);
                    }
                }
            }
        }
    }
    return kinds;
}

/** The groups a spec appears under - its subjects when it has a target, otherwise its own category. */
export function specGroupIds(spec: AnyStoryCommandSpec): readonly StoryCommandGroupId[] {
    const kinds = specTargetKinds(spec);
    if (kinds.length === 0) {
        return [spec.category];
    }
    const groups: StoryCommandGroupId[] = [];
    for (const kind of kinds) {
        // A reserved word names a stage singleton rather than a kind - there is nothing in
        // `stageObjects` for it to be a kind of - but it is still a subject an author browses by, so
        // it files under the group its singleton belongs to. Without this, `/transform` and `/reset`
        // would reach the camera on the line and be invisible in the menu that teaches the line.
        const group = RESERVED_GROUPS[kind] ?? subjectGroupId(kind as Parameters<typeof subjectGroupId>[0]);
        if (!groups.includes(group)) {
            groups.push(group);
        }
    }
    // A verb whose subject is a VARIABLE has no target kind at all (the slot is a `variable` type), so
    // its own category is what files it - `/reset` reaches both worlds and belongs in both menus.
    if (specHasVariableParam(spec) && !groups.includes(spec.category)) {
        groups.push(spec.category);
    }
    return groups;
}

function specHasVariableParam(spec: AnyStoryCommandSpec): boolean {
    return Object.values(spec.params).some(param => {
        const types = Array.isArray(param.type) ? param.type : [param.type];
        return types.some(type => type.kind === "variable");
    });
}

/**
 * The sidebar's whole content: every group that has commands, in table order, each holding the palette
 * entries filed under it. Plugin actions ride the same list under 工具 - they are entries like any
 * other, and giving them a category of their own would have re-introduced a cut by origin.
 *
 * A command appears in several groups on purpose, so callers must key rows by group **and** id.
 */
export function buildSpecSidebarGroups(
    pluginCommands: readonly PaletteActionCommand[],
    localize: (command: PaletteActionCommand) => PaletteActionCommand,
): readonly StoryCommandSidebarGroup[] {
    const paletteById = new Map(specPaletteCommands().map(command => [command.id, command]));
    const byGroup = new Map<StoryCommandGroupId, PaletteActionCommand[]>();
    const push = (groupId: StoryCommandGroupId, command: PaletteActionCommand) => {
        const bucket = byGroup.get(groupId);
        bucket ? bucket.push(command) : byGroup.set(groupId, [command]);
    };

    for (const spec of listCommandSpecs()) {
        const palette = paletteById.get(spec.id);
        if (!palette) {
            continue;
        }
        const localized = localize(palette);
        for (const groupId of specGroupIds(spec)) {
            push(groupId, localized);
        }
    }
    // Not localized: a plugin action's label comes from its own registration, already resolved.
    for (const command of pluginCommands) {
        push(command.group, command);
    }

    return STORY_COMMAND_GROUPS
        .map(group => ({ group, commands: byGroup.get(group.id) ?? [] }))
        .filter(entry => entry.commands.length > 0);
}

/**
 * Collapse the subject filing to one row per command, for the surfaces that show everything at once.
 *
 * A generic verb files under every subject its `accepts` names, which is the right answer when the
 * author has *chosen* a subject — "everything I can do to an Image" has to list `/show`. It is the
 * wrong answer in a single list of the whole vocabulary, where the same verb with the same sentence
 * under it six times reads as six commands that happen to share a name.
 *
 * The rule: keep a command under its own `category` when it is filed there, and otherwise under the
 * first subject it reached. The fallback matters — a spec whose category is not among the subjects it
 * accepts would otherwise vanish from the list entirely, which is a far worse failure than a repeat.
 */
export function dedupeToPrimarySubject(
    groups: readonly StoryCommandSidebarGroup[],
): readonly StoryCommandSidebarGroup[] {
    const home = new Map<string, StoryCommandGroupId>();
    for (const entry of groups) {
        for (const command of entry.commands) {
            const current = home.get(command.id);
            if (current === undefined || (current !== command.group && entry.group.id === command.group)) {
                home.set(command.id, entry.group.id);
            }
        }
    }
    return groups
        .map(entry => ({ ...entry, commands: entry.commands.filter(command => home.get(command.id) === entry.group.id) }))
        .filter(entry => entry.commands.length > 0);
}

/**
 * The same gate {@link availableSpecCommands} applies to a flat list, applied to the browse groups: a
 * command with nothing to name in this project is dropped, and a group left empty by that goes with
 * it rather than showing as a heading over nothing.
 */
export function availableSidebarGroups(
    groups: readonly StoryCommandSidebarGroup[],
    context: StoryCommandContext,
): readonly StoryCommandSidebarGroup[] {
    return groups
        .map(entry => ({ ...entry, commands: availableSpecCommands(entry.commands, context) }))
        .filter(entry => entry.commands.length > 0);
}

/** The sidebar groups a category chip shows; `null` means "no filter" and returns all of them. */
export function filterSidebarGroups(
    groups: readonly StoryCommandSidebarGroup[],
    categoryId: StoryCommandCategoryId | null,
): readonly StoryCommandSidebarGroup[] {
    return categoryId === null ? groups : groups.filter(entry => entry.group.category === categoryId);
}
