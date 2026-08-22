/**
 * The frame vocabulary of the game's control socket, split out from the socket itself so it can be
 * tested without a listening port.
 *
 * The socket predates the test pipeline: Studio opened it for the milliseconds of a Stop and sent
 * exactly one command, `shutdown`. It is now also how a test-owned game reports what happened to
 * it, and how Studio drives one - which adds commands and a direction of travel the socket never
 * had, unsolicited pushes from the game.
 *
 *   Studio -> game  `{type:"shutdown", token}`             -> `{ok:true}`, then quit
 *   Studio -> game  `{type:"test:subscribe", token}`       -> `{ok:true}`, socket becomes a subscriber
 *   Studio -> game  `{type:"test:command", token, command}` -> `{ok:true}`, command goes to the renderer
 *   game   -> Studio `{type:"test:event", event}`          unsolicited, subscribed sockets only
 *
 * An unrecognised `type` still answers `{ok:false,error:"Unknown command"}` rather than dropping
 * the frame, which is what lets an older game paired with a newer Studio degrade instead of hanging
 * the caller on a reply that never comes. A `test:command` whose payload this build cannot read is
 * refused the same way, and for the same reason.
 *
 * `{ok:true}` on a command says the frame was understood, never that the game carried it out: the
 * renderer may have no story on screen yet, and what actually happened comes back as an event.
 */

import type { GameTestCommand, GameTestEvent } from "@shared/types/gameTest";
import { parseGameTestCommand } from "../gameTestSignal";

export type ControlFrameReply = { ok: true } | { ok: false; error: string };

/**
 * What the socket must do once the reply is sent. Separated from the reply because every command
 * has side effects that must happen *after* Studio has been answered - a shutdown that quit before
 * replying would look like a dropped connection.
 */
export type ControlFrameEffect = "none" | "shutdown" | "subscribe" | "command";

export type ControlFrameOutcome = {
    reply: ControlFrameReply;
    effect: ControlFrameEffect;
    /** Present exactly when `effect` is `"command"`: the validated command to hand to the renderer. */
    command?: GameTestCommand;
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
    if (payload.type === "test:command") {
        const command = parseGameTestCommand((payload as { command?: unknown }).command);
        // A command this build cannot read is refused rather than silently dropped, so a newer
        // Studio driving an older game learns that it is talking past it instead of waiting out its
        // own step timeout on every move.
        return command
            ? { reply: { ok: true }, effect: "command", command }
            : { reply: { ok: false, error: "Unknown command" }, effect: "none" };
    }
    return { reply: { ok: false, error: "Unknown command" }, effect: "none" };
}
