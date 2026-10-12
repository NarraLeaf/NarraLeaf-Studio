/**
 * Node families: node types that are one question asked a few ways, shown in the editor as one.
 *
 * `Greater Than` and `Less Than` are the same comparison with a different operator, and `On Key
 * Down` and `Any Key Down` are the same event with or without a key named. Listed one by one they
 * made the add-node palette several hundred rows long, and an author had to know the exact one to
 * look for. So the palette shows each family as one row, and a placed card's title carries a menu
 * of the other members that turns the card into any of them where it stands.
 *
 * A family is a presentation of node types, never a node type of its own. Every member keeps its
 * type id, its title, its pins and its runtime, which is what a graph stores, what `.bp` files and
 * the blueprint CLI name, what a diagnostic calls the card, and what a project built before
 * families existed already holds. So nothing a family does reaches a saved graph except the one
 * thing an author asks for: switching a card writes the other member's type onto it
 * (`retypeBlueprintNodeInIr`).
 *
 * Members of one family share their category, role and scope, so that switching never asks a node
 * to be somewhere it cannot be; `blueprintNodeFamilies.test.ts` holds every family to that.
 */
import type { TranslationKey } from "@shared/i18n";
import {
    BLUEPRINT_NODE_TYPE_COMPARE_EQUAL,
    BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN,
    BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN_OR_EQUAL,
    BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN,
    BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN_OR_EQUAL,
    BLUEPRINT_NODE_TYPE_COMPARE_NOT_EQUAL,
    BLUEPRINT_NODE_TYPE_DATA_IS_ARRAY,
    BLUEPRINT_NODE_TYPE_DATA_IS_BOOLEAN,
    BLUEPRINT_NODE_TYPE_DATA_IS_NULL,
    BLUEPRINT_NODE_TYPE_DATA_IS_NUMBER,
    BLUEPRINT_NODE_TYPE_DATA_IS_OBJECT,
    BLUEPRINT_NODE_TYPE_DATA_IS_STRING,
    BLUEPRINT_NODE_TYPE_DATA_TO_BOOLEAN,
    BLUEPRINT_NODE_TYPE_DATA_TO_FLOAT,
    BLUEPRINT_NODE_TYPE_DATA_TO_INTEGER,
    BLUEPRINT_NODE_TYPE_DATA_TO_JSON,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_GAMEPAD_BUTTON_DOWN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_GAMEPAD_BUTTON_UP,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAMEPAD_BUTTON_DOWN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAMEPAD_BUTTON_UP,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP,
    BLUEPRINT_NODE_TYPE_MATH_CEIL,
    BLUEPRINT_NODE_TYPE_MATH_FLOOR,
    BLUEPRINT_NODE_TYPE_MATH_RANDOM_FLOAT,
    BLUEPRINT_NODE_TYPE_MATH_RANDOM_INTEGER,
    BLUEPRINT_NODE_TYPE_MATH_ROUND,
    BLUEPRINT_NODE_TYPE_STRING_CAPITALIZE,
    BLUEPRINT_NODE_TYPE_STRING_PAD_END,
    BLUEPRINT_NODE_TYPE_STRING_PAD_START,
    BLUEPRINT_NODE_TYPE_STRING_REPLACE,
    BLUEPRINT_NODE_TYPE_STRING_REPLACE_ALL,
    BLUEPRINT_NODE_TYPE_STRING_TO_LOWER,
    BLUEPRINT_NODE_TYPE_STRING_TO_STRING,
    BLUEPRINT_NODE_TYPE_STRING_TO_UPPER,
    BLUEPRINT_NODE_TYPE_STRING_TRIM,
    BLUEPRINT_NODE_TYPE_STRING_TRIM_END,
    BLUEPRINT_NODE_TYPE_STRING_TRIM_START,
} from "@shared/types/blueprint/graph";
import { GAME_PREFERENCE_NODE_TYPES } from "./built-in/gameNodes";

export type BlueprintNodeFamily = {
    id: string;
    /** What the palette calls the family while it is browsed rather than searched. */
    title: TranslationKey;
    /** In the order a card's menu lists them; the first one present is what picking the family places. */
    members: readonly string[];
};

const PREFERENCE_ROWS = GAME_PREFERENCE_NODE_TYPES
    // The dialog's shown state is a preference to the engine, and to an author it is the dialog:
    // it has Show Dialog and Hide Dialog of its own rather than a setter here.
    .filter(row => row.setterType);

export const BLUEPRINT_NODE_FAMILIES: readonly BlueprintNodeFamily[] = [
    {
        id: "compare",
        title: "blueprint.family.compare",
        members: [
            BLUEPRINT_NODE_TYPE_COMPARE_EQUAL,
            BLUEPRINT_NODE_TYPE_COMPARE_NOT_EQUAL,
            BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN,
            BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN_OR_EQUAL,
            BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN,
            BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN_OR_EQUAL,
        ],
    },
    {
        id: "key",
        title: "blueprint.family.key",
        members: [
            BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN,
            BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP,
            BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN,
            BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP,
        ],
    },
    {
        id: "gamepadButton",
        title: "blueprint.family.gamepadButton",
        members: [
            BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAMEPAD_BUTTON_DOWN,
            BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAMEPAD_BUTTON_UP,
            BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_GAMEPAD_BUTTON_DOWN,
            BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_GAMEPAD_BUTTON_UP,
        ],
    },
    {
        id: "getPreference",
        title: "blueprint.family.getPreference",
        members: PREFERENCE_ROWS.map(row => row.getterType),
    },
    {
        id: "setPreference",
        title: "blueprint.family.setPreference",
        members: PREFERENCE_ROWS.map(row => row.setterType!),
    },
    {
        id: "trim",
        title: "blueprint.family.trim",
        members: [BLUEPRINT_NODE_TYPE_STRING_TRIM, BLUEPRINT_NODE_TYPE_STRING_TRIM_START, BLUEPRINT_NODE_TYPE_STRING_TRIM_END],
    },
    {
        id: "changeCase",
        title: "blueprint.family.changeCase",
        members: [BLUEPRINT_NODE_TYPE_STRING_TO_LOWER, BLUEPRINT_NODE_TYPE_STRING_TO_UPPER, BLUEPRINT_NODE_TYPE_STRING_CAPITALIZE],
    },
    {
        id: "pad",
        title: "blueprint.family.pad",
        members: [BLUEPRINT_NODE_TYPE_STRING_PAD_START, BLUEPRINT_NODE_TYPE_STRING_PAD_END],
    },
    {
        id: "replace",
        title: "blueprint.family.replace",
        members: [BLUEPRINT_NODE_TYPE_STRING_REPLACE, BLUEPRINT_NODE_TYPE_STRING_REPLACE_ALL],
    },
    {
        id: "checkType",
        title: "blueprint.family.checkType",
        members: [
            BLUEPRINT_NODE_TYPE_DATA_IS_STRING,
            BLUEPRINT_NODE_TYPE_DATA_IS_NUMBER,
            BLUEPRINT_NODE_TYPE_DATA_IS_BOOLEAN,
            BLUEPRINT_NODE_TYPE_DATA_IS_ARRAY,
            BLUEPRINT_NODE_TYPE_DATA_IS_OBJECT,
            BLUEPRINT_NODE_TYPE_DATA_IS_NULL,
        ],
    },
    {
        id: "convert",
        title: "blueprint.family.convert",
        members: [
            BLUEPRINT_NODE_TYPE_STRING_TO_STRING,
            BLUEPRINT_NODE_TYPE_DATA_TO_INTEGER,
            BLUEPRINT_NODE_TYPE_DATA_TO_FLOAT,
            BLUEPRINT_NODE_TYPE_DATA_TO_BOOLEAN,
            BLUEPRINT_NODE_TYPE_DATA_TO_JSON,
        ],
    },
    {
        id: "rounding",
        title: "blueprint.family.rounding",
        members: [BLUEPRINT_NODE_TYPE_MATH_ROUND, BLUEPRINT_NODE_TYPE_MATH_FLOOR, BLUEPRINT_NODE_TYPE_MATH_CEIL],
    },
    {
        id: "random",
        title: "blueprint.family.random",
        members: [BLUEPRINT_NODE_TYPE_MATH_RANDOM_INTEGER, BLUEPRINT_NODE_TYPE_MATH_RANDOM_FLOAT],
    },
];

const FAMILY_BY_MEMBER_TYPE: ReadonlyMap<string, BlueprintNodeFamily> = new Map(
    BLUEPRINT_NODE_FAMILIES.flatMap(family => family.members.map(type => [type, family] as const)),
);

/** The family a node type belongs to, if any. */
export function blueprintNodeFamilyOf(type: string): BlueprintNodeFamily | undefined {
    return FAMILY_BY_MEMBER_TYPE.get(type);
}

/**
 * The members a placed card of `type` can be switched between, given which node types its graph
 * may hold - the card's own type always among them. Undefined when there is nothing to switch to:
 * the type is in no family, or no other member may be placed here.
 */
export function resolveBlueprintNodeFamilySwitches(
    type: string,
    isAllowed: (type: string) => boolean,
): readonly string[] | undefined {
    const family = blueprintNodeFamilyOf(type);
    if (!family) {
        return undefined;
    }
    const members = family.members.filter(member => member === type || isAllowed(member));
    return members.length >= 2 ? members : undefined;
}
