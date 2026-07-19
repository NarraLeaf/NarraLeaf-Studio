import { describe, expect, it } from "vitest";
import {
    DebugBridge,
    MAX_DEBUG_EVENT_BUFFER_LENGTH,
    MAX_DEBUG_EVENT_MESSAGE_CHARS,
    truncateDebugEventMessage,
} from "./DebugBridge";

describe("DebugBridge", () => {
    it("truncates oversized devtools log messages before buffering", () => {
        const debug = new DebugBridge();
        const message = "x".repeat(MAX_DEBUG_EVENT_MESSAGE_CHARS + 100);

        debug.emit({ type: "devtools.log", level: "info", message });

        const [event] = debug.snapshot();
        expect(event).toEqual({
            type: "devtools.log",
            level: "info",
            message: truncateDebugEventMessage(message),
        });
        expect(event.type === "devtools.log" ? event.message.length : 0).toBeLessThan(message.length);
    });

    it("preserves messages that are already within the debug event size limit", () => {
        const debug = new DebugBridge();
        const message = "short message";

        debug.emit({ type: "devtools.log", level: "info", message });

        expect(debug.snapshot()).toEqual([{ type: "devtools.log", level: "info", message }]);
    });

    it("keeps the most recent events up to the debug buffer limit", () => {
        const debug = new DebugBridge();

        for (let i = 0; i < MAX_DEBUG_EVENT_BUFFER_LENGTH + 5; i += 1) {
            debug.emit({ type: "devtools.log", level: "info", message: `message-${i}` });
        }

        const snapshot = debug.snapshot();
        expect(snapshot).toHaveLength(MAX_DEBUG_EVENT_BUFFER_LENGTH);
        expect(snapshot[0]).toMatchObject({ message: "message-5" });
        expect(snapshot.at(-1)).toMatchObject({ message: `message-${MAX_DEBUG_EVENT_BUFFER_LENGTH + 4}` });
    });

    it("drops verbose tracing events by default without notifying observers", () => {
        const debug = new DebugBridge();
        const observed: string[] = [];
        debug.subscribeEvents(event => observed.push(event.type));

        debug.emit({ type: "node.enter", executionId: "e1", nodeId: "n1" });
        debug.emit({ type: "node.exit", executionId: "e1", nodeId: "n1" });
        debug.emit({ type: "state.read", scope: "surface", key: "k" });
        debug.emit({ type: "function.call", functionId: "game.writeSave" });
        debug.emit({ type: "execution.started", executionId: "e1", blueprintId: "bp" });

        expect(debug.snapshot()).toEqual([]);
        expect(observed).toEqual([]);
    });

    it("keeps errors and devtools logs while verbose capture is off", () => {
        const debug = new DebugBridge();

        debug.emit({ type: "node.enter", executionId: "e1", nodeId: "n1" });
        debug.emit({ type: "devtools.log", level: "warn", message: "capture failed" });
        debug.emit({ type: "execution.error", executionId: "e1", message: "boom" });

        expect(debug.snapshot().map(event => event.type)).toEqual(["devtools.log", "execution.error"]);
    });

    it("captures verbose events once enabled, and stops again when disabled", () => {
        const debug = new DebugBridge();
        expect(debug.isVerboseCaptureEnabled()).toBe(false);

        debug.setVerboseCaptureEnabled(true);
        debug.emit({ type: "node.enter", executionId: "e1", nodeId: "n1" });
        debug.setVerboseCaptureEnabled(false);
        debug.emit({ type: "node.exit", executionId: "e1", nodeId: "n1" });

        expect(debug.snapshot().map(event => event.type)).toEqual(["node.enter"]);
    });
});
