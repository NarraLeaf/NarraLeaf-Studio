import { describe, expect, it, afterEach } from "vitest";
import {
    mountCompiledScripts,
    resolveScriptDefault,
    resolveScriptHandler,
    unmountCompiledScripts,
} from "./script/scriptRuntime";

/**
 * Mounting the author's scripts, and what a dispatch then finds.
 *
 * This file used to assert the opposite: that a bundle's scripts were never evaluated. That was
 * true and it was the whole defect - nothing mounted them, so every script blueprint an author
 * made did nothing at all. What decides whether a project's code may run is the trust gate, which
 * runs before any of this; once it has, a script gets the same host API a visual graph on the same
 * slot gets.
 *
 * The loader is injected here because the real one makes a blob URL and imports it, and this suite
 * runs in Node. What is under test is the wiring either way: which module a blueprint id resolves
 * to, and which export an event name reaches.
 */

afterEach(() => {
    unmountCompiledScripts();
});

function fakeLoader(modules: Record<string, Record<string, unknown>>) {
    return async (code: string) => {
        const module = modules[code];
        if (!module) {
            throw new Error(`no module for ${code}`);
        }
        return module;
    };
}

describe("mounting compiled scripts", () => {
    it("reaches the export whose name follows from the event id", async () => {
        const onMouseClick = () => undefined;
        await mountCompiledScripts(
            { "bp-1": { scriptRef: "scripts/title.ts", code: "MODULE_A" } },
            undefined,
            fakeLoader({ MODULE_A: { onMouseClick } }),
        );

        // `mouseClick` -> `onMouseClick`, by the one rule both sides ask for.
        expect(resolveScriptHandler("bp-1", "mouseClick")).toBe(onMouseClick);
        // An event the module does not export is not a handler, and the dispatcher treats that as
        // "nothing listened" rather than as an error.
        expect(resolveScriptHandler("bp-1", "mouseUp")).toBeNull();
        expect(resolveScriptHandler("bp-unknown", "mouseClick")).toBeNull();
    });

    it("reaches the default export, which is how a story row is entered", async () => {
        const handler = () => undefined;
        await mountCompiledScripts(
            { "bp-story": { scriptRef: "scripts/intro.ts", code: "MODULE_B" } },
            undefined,
            fakeLoader({ MODULE_B: { default: handler } }),
        );
        expect(resolveScriptDefault("bp-story")).toBe(handler);
    });

    it("mounts nothing for a script that did not compile, and says nothing about it here", async () => {
        // The compile failure was already reported as a diagnostic where it happened. Its blueprint
        // simply listens to nothing, and the rest of the game runs.
        await mountCompiledScripts(
            { "bp-broken": { scriptRef: "scripts/broken.ts" } },
            undefined,
            fakeLoader({}),
        );
        expect(resolveScriptHandler("bp-broken", "mouseClick")).toBeNull();
    });

    it("reports a module that throws while it loads, naming the author's file", async () => {
        const reported: string[] = [];
        await mountCompiledScripts(
            { "bp-throws": { scriptRef: "scripts/boom.ts", code: "MISSING" } },
            (blueprintId, scriptRef, message) => reported.push(`${blueprintId} ${scriptRef} ${message}`),
            fakeLoader({}),
        );
        expect(reported).toHaveLength(1);
        expect(reported[0]).toContain("scripts/boom.ts");
        expect(resolveScriptHandler("bp-throws", "mouseClick")).toBeNull();
    });

    it("replaces what was mounted before, so a reload does not stack copies", async () => {
        const first = () => undefined;
        const second = () => undefined;
        await mountCompiledScripts(
            { "bp-1": { scriptRef: "scripts/a.ts", code: "A" } },
            undefined,
            fakeLoader({ A: { onInit: first } }),
        );
        await mountCompiledScripts(
            { "bp-2": { scriptRef: "scripts/b.ts", code: "B" } },
            undefined,
            fakeLoader({ B: { onInit: second } }),
        );

        // Dev Mode reloads on every save; a mount that added rather than replaced would leave the
        // previous revision's handlers reachable.
        expect(resolveScriptHandler("bp-1", "init")).toBeNull();
        expect(resolveScriptHandler("bp-2", "init")).toBe(second);
    });
});
