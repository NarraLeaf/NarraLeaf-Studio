import { describe, expect, it } from "vitest";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import {
    filterBlueprintDebugEventsByLogLevel,
    getBlueprintDebugEventLogLevel,
} from "./BlueprintRuntimeDebugPanel";

describe("BlueprintRuntimeDebugPanel output levels", () => {
    it("classifies output events by user-facing log level", () => {
        expect(
            getBlueprintDebugEventLogLevel({
                type: "execution.error",
                executionId: "exec",
                message: "boom",
            }),
        ).toBe("error");
        expect(getBlueprintDebugEventLogLevel({ type: "devtools.log", level: "warn", message: "careful" })).toBe(
            "warning",
        );
        expect(getBlueprintDebugEventLogLevel({ type: "devtools.log", level: "info", message: "hello" })).toBe(
            "log",
        );
        expect(getBlueprintDebugEventLogLevel({ type: "function.call", functionId: "devtools.log" })).toBe(
            "verbose",
        );
        expect(getBlueprintDebugEventLogLevel({ type: "node.enter", executionId: "exec", nodeId: "node" })).toBe(
            "verbose",
        );
    });

    it("filters output events by selected levels", () => {
        const events: BlueprintDebugEvent[] = [
            { type: "devtools.log", level: "info", message: "hello" },
            { type: "function.call", functionId: "devtools.log" },
            { type: "execution.error", executionId: "exec", message: "boom" },
        ];

        expect(filterBlueprintDebugEventsByLogLevel(events, new Set(["error", "log"]))).toEqual([
            events[0],
            events[2],
        ]);
    });
});
