import { describe, expect, it } from "vitest";
import { BUILTIN_WIDGET_LOGIC_APIS, getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import type { BlueprintHostApiRuntime } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import type { StoryVariableRuntimeAccess } from "@/lib/ui-editor/runtime/types";
import {
    SCRIPT_WIDGET_TYPES,
    type GameScriptContext,
    type StoryScriptContext,
    type StorySyncScriptContext,
} from "./scriptContext";

/**
 * The script contexts are held to the adapters they are drawn from.
 *
 * Nothing in `scriptContext.ts` is designed; every member is the type of something an adapter
 * already hands a graph. These tests are what keeps that true once the file and the adapters are
 * edited apart: a story member that stops being the adapter's own, a widget type that gains a
 * blueprint without gaining a script. The type-level half runs under `tsc` over this file; the
 * runtime half under vitest.
 */

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type Host = BlueprintHostApiRuntime;

type StoryTierChecks = [
    // The story tier's variable access *is* the adapter's, not a restatement of it.
    Expect<Equal<StorySyncScriptContext["scene"], StoryVariableRuntimeAccess>>,
    Expect<Equal<StorySyncScriptContext["saved"], StoryVariableRuntimeAccess>>,
    Expect<Equal<StoryScriptContext["persistent"], Host["persistence"]>>,
    // The one host family a row may reach, and it is the host's own rather than a copy of it.
    Expect<Equal<StorySyncScriptContext["devtools"], Host["devtools"]>>,
    // And it has none of the four families a story row is denied.
    Expect<Equal<Extract<keyof StoryScriptContext, "host" | "navigation" | "game" | "widget" | "sound">, never>>,
];

type GameTierChecks = [
    // The game tier's host is the host API itself - every family, unchanged.
    Expect<Equal<GameScriptContext["host"], Host>>,
    // Surface-bound members vanish for a project script and stay for an element's.
    Expect<Equal<GameScriptContext<{ kind: "project" }>["broadcast"], undefined>>,
    Expect<Equal<GameScriptContext<{ kind: "surface"; surfaceId: string }>["surface"] extends undefined ? never : true, true>>,
];

// `tsc` is the assertion; vitest only has to see the file compile.
const typeChecks: [StoryTierChecks, GameTierChecks] | null = null;

describe("script contexts are drawn from the adapters", () => {
    it("compiles the type-level checks", () => {
        expect(typeChecks).toBeNull();
    });

    it("offers a script for every widget type that supports a private blueprint, and no other", () => {
        for (const type of SCRIPT_WIDGET_TYPES) {
            expect(getWidgetLogicApi(type)?.supportsPrivateBlueprint, type).toBe(true);
        }
        const scriptable = Object.entries(BUILTIN_WIDGET_LOGIC_APIS)
            .filter(([, api]) => api.supportsPrivateBlueprint)
            .map(([type]) => type)
            .sort();
        const declared = [...SCRIPT_WIDGET_TYPES].filter(type => type in BUILTIN_WIDGET_LOGIC_APIS).sort();
        expect(declared).toEqual(scriptable);
    });

});
