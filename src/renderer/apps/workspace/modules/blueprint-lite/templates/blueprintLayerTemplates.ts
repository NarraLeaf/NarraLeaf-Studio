/**
 * The blueprint template library: layers an author can start from instead of a blank canvas.
 *
 * Each template is written in the blueprint text format (`.bp`) and goes through the same parser and
 * compiler the blueprint CLI uses, which check every node type, pin and field against the live node
 * registry. So there is no second catalogue here to fall behind: a node renamed in the registry is a
 * template that fails `blueprintLayerTemplates.test.ts`, not one that quietly builds a broken graph.
 *
 * A template says which owner kinds it is for. A widget's templates are narrowed again by the widget
 * itself - a click template on a list, which has no click, is not offered, and a slider template is
 * offered on a slider only - and that narrowing is the compiler's own scope check rather than a list
 * kept beside it (see `buildBlueprintLayerTemplate`).
 *
 * The templates ship with Studio rather than being fetched like the interface templates are. A
 * template is a graph over this build's node catalogue, and the test that compiles every one of them
 * is what keeps the two in step; a template fetched from elsewhere could name a node this build does
 * not have, or one whose pins have since changed. Each template carries its own title and
 * description in every built-in language, as the interface and project templates do, so adding one
 * is one entry in one file.
 *
 * Comments in English per project convention.
 */

import type { LucideIcon } from "lucide-react";
import {
    AppWindow,
    ArrowRightLeft,
    Gamepad2,
    Keyboard,
    LockOpen,
    MonitorPlay,
    Presentation,
    SlidersHorizontal,
    Sparkles,
    Volume2,
} from "lucide-react";
import type { Locale } from "@shared/i18n/locales";
import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { PAGE_FLOW_TEMPLATES } from "./library/pageFlow";
import { NAVIGATION_TEMPLATES } from "./library/navigation";
import { GAME_TEMPLATES } from "./library/game";
import { SETTINGS_TEMPLATES } from "./library/settings";
import { AUDIO_TEMPLATES } from "./library/audio";
import { MOTION_TEMPLATES } from "./library/motion";
import { KEY_TEMPLATES } from "./library/keys";
import { WINDOW_TEMPLATES } from "./library/window";
import { DISPLAY_TEMPLATES } from "./library/display";
import { CONDITION_TEMPLATES } from "./library/conditions";

/**
 * The shelves of the library, in the order its rail lists them.
 *
 * A shelf's icon is also the icon of every template on it. A template card names its shelf beside
 * its icon, so an icon of the template's own read as the shelf's and disagreed with the rail; one
 * icon per shelf lets the eye find a kind of template across the grid as well as down the rail.
 */
export const BLUEPRINT_TEMPLATE_CATEGORIES = [
    { id: "pageFlow", icon: MonitorPlay },
    { id: "navigation", icon: ArrowRightLeft },
    { id: "game", icon: Gamepad2 },
    { id: "settings", icon: SlidersHorizontal },
    { id: "audio", icon: Volume2 },
    { id: "motion", icon: Sparkles },
    { id: "keys", icon: Keyboard },
    { id: "window", icon: AppWindow },
    { id: "display", icon: Presentation },
    { id: "conditions", icon: LockOpen },
] as const satisfies readonly { id: string; icon: LucideIcon }[];

export type BlueprintTemplateCategory = (typeof BLUEPRINT_TEMPLATE_CATEGORIES)[number]["id"];

const CATEGORY_ICONS = new Map<BlueprintTemplateCategory, LucideIcon>(
    BLUEPRINT_TEMPLATE_CATEGORIES.map(category => [category.id, category.icon]),
);

/** The icon a template is drawn with: its shelf's. */
export function blueprintTemplateIcon(template: Pick<BlueprintLayerTemplate, "category">): LucideIcon {
    return CATEGORY_ICONS.get(template.category)!;
}

export type BlueprintTemplateText = {
    /** Also the name the layer it creates starts with, so it reads as a name: no full stop. */
    title: string;
    /** One or two sentences saying what the layer does once it runs, from the player's side. */
    description: string;
};

/**
 * What the project already says that a template can start from, instead of leaving a picker empty.
 *
 * Every one of these is read off the project, never guessed: absent means the project does not
 * answer it, and the node is left for the author to fill in.
 */
export type BlueprintLayerTemplateFacts = {
    /**
     * The one element on this page, when the page holds exactly one - fading it is fading everything
     * the page shows. A page holding several has no single answer.
     */
    pageContent?: { surfaceId: string; elementId: string };
    /** The page the project's other confirmations already ask through. */
    confirmPage?: string;
    /** Where the game begins: the default story and the scene it opens on. */
    gameStart?: { storyId: string; sceneId: string };
    /**
     * Keys this blueprint already answers through an input action - a page's own actions, or for the
     * game's blueprint any action at all - spelled as the key picker writes them. A template whose
     * key head names one of them is not offered: the press would do the action's job and the
     * template's both, and Escape on a page that already closes on Escape would step back twice.
     */
    takenKeys?: readonly string[];
    /** The editor's language, for the few templates that write text the player reads. */
    locale: Locale;
};

export type BlueprintLayerTemplate = {
    /** Stable and unique across the library. */
    id: string;
    category: BlueprintTemplateCategory;
    owners: readonly BlueprintOwnerRef["kind"][];
    text: Readonly<Record<Locale, BlueprintTemplateText>>;
    /** The layer's nodes and edges, in the blueprint text format, without the `event` line. */
    graph: (facts: BlueprintLayerTemplateFacts) => string;
    /**
     * Whether the template can go into this project at all, for the one whose graph would trap the
     * player while a choice is still empty. Absent means always.
     */
    available?: (facts: BlueprintLayerTemplateFacts) => boolean;
    /**
     * The fields the author is expected to choose, by node. A node any of these is still empty on is
     * selected once the layer exists, so the canvas opens on what is left to do.
     */
    choices?: Readonly<Record<string, readonly string[]>>;
    /**
     * Rank among the few a blueprint with no layers shows before the library, lower first. Ranks are
     * only ever compared among the templates one blueprint can take, so a template for one kind of
     * widget - a slider, a switch, a text - ranks below 10 and comes ahead of the click templates
     * every clickable widget takes, which rank from 11. Absent means the template is found in the
     * library, and fills the grid only when an owner has too few ranked ones to fill it.
     */
    featured?: number;
};

/** Every template, shelf by shelf, in the order the library lists them. */
export const BLUEPRINT_LAYER_TEMPLATES: readonly BlueprintLayerTemplate[] = [
    ...PAGE_FLOW_TEMPLATES,
    ...NAVIGATION_TEMPLATES,
    ...GAME_TEMPLATES,
    ...SETTINGS_TEMPLATES,
    ...AUDIO_TEMPLATES,
    ...MOTION_TEMPLATES,
    ...KEY_TEMPLATES,
    ...WINDOW_TEMPLATES,
    ...DISPLAY_TEMPLATES,
    ...CONDITION_TEMPLATES,
];

/** A template's words in `locale`, or in English for a language the library is not written in. */
export function blueprintTemplateText(template: BlueprintLayerTemplate, locale: string): BlueprintTemplateText {
    const base = locale.split("-")[0] as Locale;
    return template.text[locale as Locale] ?? template.text[base] ?? template.text.en;
}
