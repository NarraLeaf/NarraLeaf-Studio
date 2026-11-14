/**
 * What people in a live session say about themselves rather than about the documents: where each of
 * them is, and what they type to each other.
 *
 * **Not part of {@link LiveMessage}, on purpose.** Everything in that union goes through the host,
 * which applies intents in one order and answers each; none of this needs an order or an answer.
 * A cursor is the sender's own latest word on where it is, and a chat line is shown as it arrives.
 * Each machine sends these straight to the room, and the server's own stamp on every message says
 * who sent it - nothing here names its sender, so nothing here can name somebody else.
 *
 * An older Studio in the same room reads neither kind as a message it understands and drops it,
 * which is the whole of the compatibility story: it sees no cursors and no chat, and nothing else
 * changes for it.
 *
 * The addresses are the anchor terms the Team server and the web console share: `document` is
 * `story:<storyId>` or `ui:<blueprintId>`, `element` is `<sceneId>/<blockId>` or `<graphId>/<nodeId>`.
 */

/** Where the sender is now. `document: null` says it has nothing open that others could follow. */
export type LiveCursor = {
    kind: "cursor";
    document: string | null;
    element?: string;
};

/** One line of chat. `id` is the sender's own, so the line it receives back is not shown twice. */
export type LiveChat = {
    kind: "chat";
    id: string;
    text: string;
};

export type LivePresenceMessage = LiveCursor | LiveChat;

/** The most one chat line may be. A sentence or a pasted line of dialogue, not a document. */
export const LIVE_CHAT_TEXT_LIMIT = 2000;
/** The most an address field may be: generous for an id pair, short of anything else. */
const ADDRESS_LIMIT = 512;

function shortText(value: unknown, limit: number): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= limit;
}

/** Whether a payload is one of these, well enough formed to show. Anything else is dropped. */
export function isLivePresenceMessage(value: unknown): value is LivePresenceMessage {
    if (value === null || typeof value !== "object") return false;
    const message = value as Record<string, unknown>;
    if (message.kind === "cursor") {
        return (message.document === null || shortText(message.document, ADDRESS_LIMIT))
            && (message.element === undefined || shortText(message.element, ADDRESS_LIMIT));
    }
    if (message.kind === "chat") {
        return shortText(message.id, 64) && shortText(message.text, LIVE_CHAT_TEXT_LIMIT);
    }
    return false;
}
