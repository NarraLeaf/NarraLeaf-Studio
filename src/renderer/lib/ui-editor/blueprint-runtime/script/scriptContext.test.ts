import { describe, expect, it } from "vitest";
import { BLUEPRINT_HOST_API_M1_CAPABILITIES } from "@shared/types/blueprint/hostApi";
import { BUILTIN_WIDGET_LOGIC_APIS, getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import type { BlueprintHostApiRuntime } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import type { StoryVariableRuntimeAccess } from "@/lib/ui-editor/runtime/types";
import {
    SCRIPT_WIDGET_TYPES,
    VALUE_SCRIPT_READS,
    type GameScriptContext,
    type StoryScriptContext,
    type StorySyncScriptContext,
    type ValueScriptContext,
} from "./scriptContext";

/**
 * The script contexts are held to the adapters they are drawn from.
 *
 * Nothing in `scriptContext.ts` is designed; every member is the type of something an adapter
 * already hands a graph. These tests are what keeps that true once the file and the adapters are
 * edited apart: a read the host API grows that nobody classified, a widget type that gains a
 * blueprint without gaining a script, a member of the value tier the frozen contract says a binding
 * may not call. The type-level half runs under `tsc` over this file; the runtime half under vitest.
 */

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type Host = BlueprintHostApiRuntime;
type Reads = typeof VALUE_SCRIPT_READS;

/**
 * A host API member that reads: named like one, and answering without waiting.
 *
 * The prefix rule is what the value tier's review would say out loud - a `get`, an `is`, a `list`,
 * a `can` - and the sync rule is the binding runtime's own limit. Anything matching both that the
 * value tier neither picks nor names as excluded is unclassified, and that is the compile error.
 */
type ReadName = `get${string}` | `is${string}` | `list${string}` | `can${string}`;
type SyncReadNames<T> = {
    [K in keyof T]: K extends ReadName
        ? T[K] extends (...args: never[]) => infer R
            ? R extends Promise<unknown>
                ? never
                : K
            : never
        : never;
}[keyof T];

/**
 * Reads the value tier leaves out on purpose.
 *
 * `sound.isPlaying` asks after a handle that only a `play` could have produced, and the frozen
 * contract marks it effectful and not callable from a binding.
 */
type ValueReadExclusions = { sound: "isPlaying" };

type Picked<F extends keyof Host> = F extends keyof Reads ? Reads[F][number] : never;
type Excluded<F extends keyof Host> = F extends keyof ValueReadExclusions ? ValueReadExclusions[F] : never;
type UnclassifiedValueReads = {
    [F in keyof Host]: Exclude<SyncReadNames<Host[F]>, Picked<F> | Excluded<F>>;
}[keyof Host];

/** A picked member that waits would make the value tier asynchronous by the back door. */
type AsyncPickedReads = {
    [F in keyof Reads]: {
        [M in Reads[F][number]]: Host[F][M & keyof Host[F]] extends (...args: never[]) => infer R
            ? R extends Promise<unknown>
                ? `${F}.${M & string}`
                : never
            : never;
    }[Reads[F][number]];
}[keyof Reads];

type ValueTierChecks = [
    Expect<Equal<UnclassifiedValueReads, never>>,
    Expect<Equal<AsyncPickedReads, never>>,
    // The value tier is the game tier's `host` with the writes removed - not a second host.
    Expect<Equal<keyof ValueScriptContext["host"], keyof Reads>>,
];

type StoryTierChecks = [
    // The story tier's variable access *is* the adapter's, not a restatement of it.
    Expect<Equal<StorySyncScriptContext["scene"], StoryVariableRuntimeAccess>>,
    Expect<Equal<StorySyncScriptContext["saved"], StoryVariableRuntimeAccess>>,
    Expect<Equal<StoryScriptContext["persistent"], Host["persistence"]>>,
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
const typeChecks: [ValueTierChecks, StoryTierChecks, GameTierChecks] | null = null;

/**
 * Contract capabilities marked callable from a binding that the value tier still leaves out.
 *
 * Each needs a reason of this shape - something about the runtime the contract cannot see - and
 * not "no script needs it yet".
 */
const CONTRACT_EXCEPTIONS: Record<string, string> = {
    // The contract predates the bridge making persistence asynchronous; `Get Persistent` is a
    // latent node and is refused from a value graph for the same reason.
    "persistence.get": "asynchronous at runtime",
    // A subscription is not a read. It exists for the `nl.video` widget's own volume, and no node
    // calls it.
    "sound.subscribeMixerChanges": "a subscription, not a read",
};

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

    it("picks for the value tier only what the frozen contract lets a binding call", () => {
        for (const [family, members] of Object.entries(VALUE_SCRIPT_READS)) {
            const contractFamily = (BLUEPRINT_HOST_API_M1_CAPABILITIES as Record<string, Record<string, { callableFromBinding: boolean; async: boolean }>>)[family];
            for (const member of members) {
                const entry = contractFamily?.[member];
                if (!entry) {
                    continue; // A family or member the contract stopped tracking; the sync rule admits it alone.
                }
                expect(entry.callableFromBinding, `${family}.${member}`).toBe(true);
                expect(entry.async, `${family}.${member}`).toBe(false);
            }
        }
    });

    it("leaves out a contract read only with a reason", () => {
        const picked = new Set(
            Object.entries(VALUE_SCRIPT_READS).flatMap(([family, members]) => members.map(member => `${family}.${member}`)),
        );
        const unexplained: string[] = [];
        for (const [family, capabilities] of Object.entries(BLUEPRINT_HOST_API_M1_CAPABILITIES)) {
            for (const [member, entry] of Object.entries(capabilities)) {
                if (!entry.callableFromBinding) {
                    continue;
                }
                const id = `${family}.${member}`;
                if (!picked.has(id) && !(id in CONTRACT_EXCEPTIONS)) {
                    unexplained.push(id);
                }
            }
        }
        // Failing here means the contract lets a binding call something the value tier does not
        // offer. Either pick it in `VALUE_SCRIPT_READS` or say in `CONTRACT_EXCEPTIONS` why not.
        expect(unexplained).toEqual([]);
        for (const id of Object.keys(CONTRACT_EXCEPTIONS)) {
            expect(picked.has(id), `${id} is both picked and excepted`).toBe(false);
        }
    });
});
