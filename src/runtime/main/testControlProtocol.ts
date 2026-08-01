/**
 * The frame vocabulary of the game's control socket, split out from the socket itself so it can be
 * tested without a listening port.
 *
 * The socket predates the test pipeline: Studio opened it for the milliseconds of a Stop and sent
 * exactly one command, `shutdown`. It is now also how a test-owned game reports what happened to
 * it, which adds a second command and a direction of travel the socket never had - unsolicited
 * pushes from the game.
 *
 *   Studio -> game  `{type:"shutdown", token}`        -> `{ok:true}`, then quit
 *   Studio -> game  `{type:"test:subscribe", token}`  -> `{ok:true}`, socket becomes a subscriber
 *   game   -> Studio `{type:"test:event", event}`     unsolicited, subscribed sockets only
 *
 * An unrecognised `type` still answers `{ok:false,error:"Unknown command"}` rather than dropping
 * the frame, which is what lets an older game paired with a newer Studio degrade instead of hanging
 * the caller on a reply that never comes.
 */

import type { GameTestEvent } from "@shared/types/gameTest";

export type ControlFrameReply = { ok: true } | { ok: false; error: string };

/**
 * What the socket must do once the reply is sent. Separated from the reply because both commands
 * have side effects that must happen *after* Studio has been answered - a shutdown that quit before
 * replying would look like a dropped connection.
 */
export type ControlFrameEffect = "none" | "shutdown" | "subscribe";

export type ControlFrameOutcome = {
    reply: ControlFrameReply;
    effect: ControlFrameEffect;
};

/**
 * Test events carry no token. The socket was authenticated when Studio subscribed on it, and
 * echoing the token back on every push would put the secret on the wire once per log line.
 */
export function encodeTestEventFrame(event: GameTestEvent): string {
    return JSON.stringify({ type: "test:event", event });
}

/**
 * Classify one inbound frame. Pure: no socket, no app, no clock.
 *
 * Token before type, as it always was - an unauthenticated caller learns nothing about which
 * commands this build understands.
 */
export function dispatchControlFrame(raw: string, expectedToken: string): ControlFrameOutcome {
    let payload: { type?: unknown; token?: unknown };
    try {
        payload = JSON.parse(raw) as { type?: unknown; token?: unknown };
    } catch {
        return { reply: { ok: false, error: "Invalid JSON" }, effect: "none" };
    }
    // Valid JSON is not necessarily a frame: `null`, `5` and `[]` all parse. Reading `.token` off
    // them would compare `undefined` against the token, which is the right answer only by accident.
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return { reply: { ok: false, error: "Invalid token" }, effect: "none" };
    }
    if (payload.token !== expectedToken) {
        return { reply: { ok: false, error: "Invalid token" }, effect: "none" };
    }
    if (payload.type === "shutdown") {
        return { reply: { ok: true }, effect: "shutdown" };
    }
    if (payload.type === "test:subscribe") {
        return { reply: { ok: true }, effect: "subscribe" };
    }
    return { reply: { ok: false, error: "Unknown command" }, effect: "none" };
}
