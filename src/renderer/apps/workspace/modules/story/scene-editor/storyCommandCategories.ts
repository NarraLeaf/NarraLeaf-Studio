import {
    Aperture,
    Database,
    Image,
    Images,
    Layers,
    MonitorPlay,
    Music,
    Settings2,
    StickyNote,
    Type,
    UserRound,
    Video,
    Wind,
} from "lucide-react";
import type { TranslationKey } from "@shared/i18n";
import type { StoryCommandTargetKind } from "./storyCommandValues";

/**
 * The one taxonomy every command surface reads: eight categories cut by a single criterion - the
 * SUBJECT a line acts on.
 *
 * What it replaced: thirteen categories that mixed three criteria at once - object type
 * (character/image/text/layer/video), material domain (media/effects) and purpose
 * (scene/control/data/utils/plugin). "Fade the portrait out" could argue for character, image or
 * effects, so the classification itself was unreasonable. Now every category answers one question,
 * and `effects` is dissolved: the displayable-scoped effects (`/transform` `/fx`) act on stage
 * objects and file under 舞台, the full-screen ones (`/blink` `/vignette`) act on the scene.
 *
 * 舞台 is the only category with a second level, because it is the only one whose subject splits
 * further (image · text · layer · video). Those subjects are {@link StoryCommandGroup}s, and a group -
 * not a category - is the colour/icon unit: a row's left-edge bar and its {@link getBlockBadgeInfo}
 * badge read `iconColor` from here, and collapsing four stage subjects onto one hue would have thrown
 * away distinctions the reading layer already earns (总计划 M1). The category level exists for
 * browsing; the group level exists for looking.
 */

/** The eight top-level categories, in browse order. */
export type StoryCommandCategoryId =
    | "character"
    | "stage"
    | "camera"
    | "scene"
    | "sound"
    | "data"
    | "flow"
    | "utils";

/** 舞台's second-level subjects - the only category that has one. */
export type StoryStageSubjectId = "image" | "text" | "layer" | "video" | "vfx";

/**
 * Where a command files itself, and the unit that carries an icon and a colour: every category except
 * 舞台 (which is a pure parent), plus 舞台's four subjects.
 */
export type StoryCommandGroupId = Exclude<StoryCommandCategoryId, "stage"> | StoryStageSubjectId;

export type StoryCommandCategory = {
    id: StoryCommandCategoryId;
    icon: typeof Settings2;
    iconColor: string;
};

export type StoryCommandGroup = {
    id: StoryCommandGroupId;
    category: StoryCommandCategoryId;
    icon: typeof Settings2;
    iconColor: string;
};

/**
 * The eight chips, in the order of §4.1's table.
 *
 * Only 舞台 needs a colour of its own here (every other category has a same-named group below): it
 * takes its most representative subject's sage, with the plural `Images` icon so the chip still reads
 * as "the stage" rather than "an image". 镜头 keeps the warm tone `/camera` rows already wear - the
 * hue freed by dissolving `effects`, which no longer competes for it.
 */
export const STORY_COMMAND_CATEGORIES: readonly StoryCommandCategory[] = [
    { id: "character", icon: UserRound, iconColor: "var(--narraleaf-accent, #40a8c4)" },
    { id: "stage", icon: Images, iconColor: "#96b8a0" },
    { id: "camera", icon: Aperture, iconColor: "#d1a176" },
    { id: "scene", icon: MonitorPlay, iconColor: "#8fa9c7" },
    { id: "sound", icon: Music, iconColor: "#bd97a3" },
    { id: "data", icon: Database, iconColor: "#b8aa86" },
    { id: "flow", icon: Settings2, iconColor: "#b2a6c9" },
    { id: "utils", icon: StickyNote, iconColor: "#a8adb5" },
];

/**
 * The eleven groups, in category order. Every colour here is the one that hue already meant before
 * the 13→8 rearrangement, so no committed row changes colour except the two that changed category on
 * purpose (`/blink` `/vignette` → 场景, `/blueprint` → 工具).
 */
export const STORY_COMMAND_GROUPS: readonly StoryCommandGroup[] = [
    { id: "character", category: "character", icon: UserRound, iconColor: "var(--narraleaf-accent, #40a8c4)" },
    { id: "image", category: "stage", icon: Image, iconColor: "#96b8a0" },
    { id: "text", category: "stage", icon: Type, iconColor: "#9bb7d8" },
    { id: "layer", category: "stage", icon: Layers, iconColor: "#92b9b0" },
    { id: "video", category: "stage", icon: Video, iconColor: "#b59dcc" },
    // The one hue nothing else claimed, for the one subject that is pure light: 氛围特效 sits under
    // 舞台 because a vfx IS a stage object - just not a Displayable one (it takes no /transform).
    { id: "vfx", category: "stage", icon: Wind, iconColor: "#d3c07c" },
    { id: "camera", category: "camera", icon: Aperture, iconColor: "#d1a176" },
    { id: "scene", category: "scene", icon: MonitorPlay, iconColor: "#8fa9c7" },
    { id: "sound", category: "sound", icon: Music, iconColor: "#bd97a3" },
    { id: "data", category: "data", icon: Database, iconColor: "#b8aa86" },
    { id: "flow", category: "flow", icon: Settings2, iconColor: "#b2a6c9" },
    { id: "utils", category: "utils", icon: StickyNote, iconColor: "#a8adb5" },
];

const GROUP_BY_ID = new Map<string, StoryCommandGroup>(STORY_COMMAND_GROUPS.map(group => [group.id, group]));
const CATEGORY_BY_ID = new Map<string, StoryCommandCategory>(STORY_COMMAND_CATEGORIES.map(category => [category.id, category]));

/**
 * A group by id. Falls back to 工具 rather than to a colourless placeholder: an unknown id can only
 * come from a plugin, and a plugin action IS a tool - a grey-holed row would read as broken.
 */
export function getCommandGroup(groupId: StoryCommandGroupId): StoryCommandGroup {
    return GROUP_BY_ID.get(groupId) ?? GROUP_BY_ID.get("utils")!;
}

export function getCommandCategory(categoryId: StoryCommandCategoryId): StoryCommandCategory {
    return CATEGORY_BY_ID.get(categoryId) ?? CATEGORY_BY_ID.get("utils")!;
}

/** The groups under a category, in table order. Only 舞台 returns more than one. */
export function groupsOfCategory(categoryId: StoryCommandCategoryId): readonly StoryCommandGroup[] {
    return STORY_COMMAND_GROUPS.filter(group => group.category === categoryId);
}

/**
 * The group a generic verb's accepted target kind names - the whole of §4.2's derivation. `accepts`
 * already spells "which subjects can this verb act on" in exactly this vocabulary, so the subject×verb
 * menu needs no second catalogue: `/show` accepting five kinds IS `/show` appearing under five subjects.
 */
export function subjectGroupId(targetKind: StoryCommandTargetKind): StoryCommandGroupId {
    return targetKind === "audio" ? "sound" : targetKind;
}

/** Localized name of a category or a group - one key space, since group ids never collide with category ids. */
export function commandCategoryLabelKey(id: StoryCommandCategoryId | StoryCommandGroupId): TranslationKey {
    return `story.actionCategory.${id}` as TranslationKey;
}
