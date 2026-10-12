import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP,
    BLUEPRINT_NODE_TYPE_GAME_GET_BGM_VOLUME,
    BLUEPRINT_NODE_TYPE_GAME_SET_SENTENCE_SPEED,
} from "@shared/types/blueprint/graph";
import { blueprintNodeRegistry } from "./BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "./registerCoreBlueprintNodes";
import {
    BLUEPRINT_NODE_FAMILIES,
    blueprintNodeFamilyOf,
    resolveBlueprintNodeFamilySwitches,
} from "./blueprintNodeFamilies";
import { GAME_PREFERENCE_NODE_TYPES } from "./built-in/gameNodes";

function registered() {
    registerCoreBlueprintNodes();
    return blueprintNodeRegistry;
}

describe("blueprint node families", () => {
    it("names only registered node types the palette offers, each in one family", () => {
        const registry = registered();
        const seen = new Set<string>();
        for (const family of BLUEPRINT_NODE_FAMILIES) {
            expect(family.members.length, family.id).toBeGreaterThanOrEqual(2);
            for (const type of family.members) {
                const def = registry.get(type);
                expect(def, type).toBeDefined();
                expect(def?.hideInPalette, type).not.toBe(true);
                expect(seen.has(type), type).toBe(false);
                seen.add(type);
            }
        }
    });

    it("keeps a family's members in one category, with one role and one scope", () => {
        const registry = registered();
        for (const family of BLUEPRINT_NODE_FAMILIES) {
            const shapes = family.members.map(type => {
                const def = registry.get(type)!;
                return JSON.stringify([def.category, def.role ?? null, def.scope ?? null, [...def.graphKinds].sort()]);
            });
            expect(new Set(shapes).size, family.id).toBe(1);
        }
    });

    it("folds every preference that has both a getter and a setter", () => {
        const paired = GAME_PREFERENCE_NODE_TYPES.filter(row => row.setterType);
        expect(blueprintNodeFamilyOf(BLUEPRINT_NODE_TYPE_GAME_GET_BGM_VOLUME)?.members).toEqual(paired.map(row => row.getterType));
        expect(blueprintNodeFamilyOf(BLUEPRINT_NODE_TYPE_GAME_SET_SENTENCE_SPEED)?.members).toEqual(paired.map(row => row.setterType));
    });

    it("puts a named key and any key in one family, both press and release", () => {
        expect(blueprintNodeFamilyOf(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN)?.members).toEqual([
            BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN,
            BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP,
            BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN,
            BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP,
        ]);
    });

    it("offers on a card only the members its graph may hold, its own type always among them", () => {
        expect(resolveBlueprintNodeFamilySwitches(
            BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN,
            type => type !== BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP,
        )).toEqual([
            BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN,
            BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN,
            BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP,
        ]);
    });

    it("offers nothing where nothing else in the family may be placed, or for a node in no family", () => {
        expect(resolveBlueprintNodeFamilySwitches(BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN, () => false)).toBeUndefined();
        expect(resolveBlueprintNodeFamilySwitches("blueprint.log", () => true)).toBeUndefined();
    });
});
