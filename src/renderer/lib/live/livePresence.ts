import type { LiveChat, LiveCursor, LivePresenceMessage } from "@shared/live/presence";
import { LIVE_CHAT_TEXT_LIMIT } from "@shared/live/presence";

/** Where one other window in the room is, as it last said. */
export type LivePeerCursor = {
    /** The window, as the server stamped it. */
    instance: string;
    account: string;
    document: string;
    element?: string;
    /** When this machine heard it, by its own clock. */
    at: number;
};

export type LiveChatLine = {
    id: string;
    instance: string;
    account: string;
    text: string;
    at: number;
    /** Whether this window wrote it. */
    mine: boolean;
};

export type LivePresenceSnapshot = {
    cursors: readonly LivePeerCursor[];
    chat: readonly LiveChatLine[];
};

export const EMPTY_LIVE_PRESENCE: LivePresenceSnapshot = { cursors: [], chat: [] };

/** How many chat lines a window keeps. The room keeps none; this is what scrolls. */
export const LIVE_CHAT_KEPT = 200;

/**
 * One window's view of who is where in a room, and what has been said in it.
 *
 * Keyed by the instance the server stamped on each message, never by anything a payload claims.
 * A cursor replaces the sender's last one; a chat line is kept once however often it arrives.
 *
 * **A newcomer is told where everybody is.** Cursors are only sent when they move, so somebody who
 * joins a quiet room would see nobody; the first cursor heard from a window not seen before is
 * answered with this window's own, once.
 */
export class LivePresence {
    private readonly peers = new Map<string, LivePeerCursor>();
    private readonly lines: LiveChatLine[] = [];
    private readonly seenLines = new Set<string>();
    private mine: LiveCursor = { kind: "cursor", document: null };
    private snapshot: LivePresenceSnapshot = EMPTY_LIVE_PRESENCE;
    private counter = 0;

    constructor(private readonly deps: {
        self: string;
        send: (message: LivePresenceMessage) => void;
        changed: () => void;
        now: () => number;
    }) {}

    /** Say this window is here, so the others answer with where they are. Sent once, on entering. */
    hello(): void {
        this.deps.send(this.mine);
    }

    get(): LivePresenceSnapshot {
        return this.snapshot;
    }

    /** Say where this window is. Sent only when it differs from the last thing said. */
    setCursor(document: string | null, element?: string): void {
        const next: LiveCursor = { kind: "cursor", document, ...(element === undefined || document === null ? {} : { element }) };
        if (next.document === this.mine.document && next.element === this.mine.element) return;
        this.mine = next;
        this.deps.send(next);
    }

    /** Say something to the room. Answers false for an empty or oversized line, which is not sent. */
    say(text: string): boolean {
        const trimmed = text.trim();
        if (trimmed.length === 0 || trimmed.length > LIVE_CHAT_TEXT_LIMIT) return false;
        this.counter += 1;
        const message: LiveChat = { kind: "chat", id: `${this.deps.self.slice(-12)}-${this.deps.now().toString(36)}-${this.counter}`, text: trimmed };
        this.deps.send(message);
        return true;
    }

    receive(message: LivePresenceMessage, from: string, account: string): void {
        if (message.kind === "moving") return; // the session's business, not presence's
        if (message.kind === "chat") {
            if (this.seenLines.has(message.id)) return;
            this.seenLines.add(message.id);
            this.lines.push({ id: message.id, instance: from, account, text: message.text, at: this.deps.now(), mine: from === this.deps.self });
            if (this.lines.length > LIVE_CHAT_KEPT) {
                const dropped = this.lines.splice(0, this.lines.length - LIVE_CHAT_KEPT);
                for (const line of dropped) this.seenLines.delete(line.id);
            }
            this.publish();
            return;
        }
        if (from === this.deps.self) return;
        const known = this.peers.has(from);
        if (message.document === null) {
            this.peers.delete(from);
        } else {
            this.peers.set(from, {
                instance: from,
                account,
                document: message.document,
                ...(message.element === undefined ? {} : { element: message.element }),
                at: this.deps.now(),
            });
        }
        if (!known && this.mine.document !== null) this.deps.send(this.mine);
        this.publish();
    }

    /** Forget windows that are no longer in the room. */
    keepOnly(instances: ReadonlySet<string>): void {
        let changed = false;
        for (const instance of [...this.peers.keys()]) {
            if (!instances.has(instance)) {
                this.peers.delete(instance);
                changed = true;
            }
        }
        if (changed) this.publish();
    }

    private publish(): void {
        this.snapshot = { cursors: [...this.peers.values()], chat: [...this.lines] };
        this.deps.changed();
    }
}
