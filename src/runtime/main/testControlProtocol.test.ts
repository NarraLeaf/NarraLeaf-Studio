import { describe, expect, it } from "vitest";
import { dispatchControlFrame, encodeTestEventFrame } from "./testControlProtocol";

const TOKEN = "control-token";

function frame(value: unknown): string {
    return JSON.stringify(value);
}

describe("dispatchControlFrame", () => {
    it("keeps shutdown working exactly as before the test channel existed", () => {
        expect(dispatchControlFrame(frame({ type: "shutdown", token: TOKEN }), TOKEN)).toEqual({
            reply: { ok: true },
            effect: "shutdown",
        });
    });

    it("promotes a socket to a subscriber and acknowledges it", () => {
        expect(dispatchControlFrame(frame({ type: "test:subscribe", token: TOKEN }), TOKEN)).toEqual({
            reply: { ok: true },
            effect: "subscribe",
        });
    });

    it("hands a drive command over, validated, once the token checks out", () => {
        expect(dispatchControlFrame(
            frame({ type: "test:command", token: TOKEN, command: { kind: "choose", index: 2 } }),
            TOKEN,
        )).toEqual({
            reply: { ok: true },
            effect: "command",
            command: { kind: "choose", index: 2 },
        });
    });

    it("refuses a command it cannot read rather than forwarding half of one", () => {
        for (const command of [
            { kind: "start", storyId: "story-1" },
            { kind: "choose", index: -1 },
            { kind: "teleport" },
            undefined,
        ]) {
            expect(dispatchControlFrame(frame({ type: "test:command", token: TOKEN, command }), TOKEN)).toEqual({
                reply: { ok: false, error: "Unknown command" },
                effect: "none",
            });
        }
    });

    it("answers an unknown command instead of dropping it, so an older game degrades", () => {
        expect(dispatchControlFrame(frame({ type: "test:teleport", token: TOKEN }), TOKEN)).toEqual({
            reply: { ok: false, error: "Unknown command" },
            effect: "none",
        });
    });

    it("rejects a frame with no type at all", () => {
        expect(dispatchControlFrame(frame({ token: TOKEN }), TOKEN)).toEqual({
            reply: { ok: false, error: "Unknown command" },
            effect: "none",
        });
    });

    it("checks the token before the type, so a bad caller learns no vocabulary", () => {
        for (const type of ["shutdown", "test:subscribe", "test:command", "test:teleport"]) {
            expect(dispatchControlFrame(
                frame({ type, token: "wrong", command: { kind: "advance" } }),
                TOKEN,
            )).toEqual({
                reply: { ok: false, error: "Invalid token" },
                effect: "none",
            });
        }
    });

    it("rejects a missing token rather than matching undefined against it", () => {
        expect(dispatchControlFrame(frame({ type: "shutdown" }), TOKEN)).toEqual({
            reply: { ok: false, error: "Invalid token" },
            effect: "none",
        });
    });

    it("rejects JSON that parses but is not a frame", () => {
        for (const raw of ["null", "5", "[]", '"shutdown"']) {
            expect(dispatchControlFrame(raw, TOKEN)).toEqual({
                reply: { ok: false, error: "Invalid token" },
                effect: "none",
            });
        }
    });

    it("rejects unparseable input without throwing", () => {
        expect(dispatchControlFrame("{not json", TOKEN)).toEqual({
            reply: { ok: false, error: "Invalid JSON" },
            effect: "none",
        });
    });
});

describe("encodeTestEventFrame", () => {
    it("wraps the event and carries no token", () => {
        const encoded = JSON.parse(encodeTestEventFrame({ kind: "game-end" })) as Record<string, unknown>;
        expect(encoded).toEqual({ type: "test:event", event: { kind: "game-end" } });
        expect(encoded).not.toHaveProperty("token");
    });
});
