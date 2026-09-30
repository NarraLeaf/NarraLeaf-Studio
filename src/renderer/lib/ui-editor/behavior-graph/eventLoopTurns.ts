/**
 * Whether the event loop has turned since some earlier moment.
 *
 * A graph executor awaits every node, but an `await` on work that finishes without waiting for
 * anything - a node that returns at once, a `Delay` of zero, a host call answered from memory - only
 * lets other microtasks run. Nothing else does: no input is taken, no frame is painted, no timer
 * fires. A graph whose exec wires go round in a circle through nodes like that never gives the
 * window back, and that is the one failure the executor's step budget is there to stop.
 *
 * A node that does wait - a `Delay` of a tenth of a second, an animation, a file read - hands the
 * window back for as long as it waits, so a circle through one is a loop the author wrote on
 * purpose, not a freeze. Telling the two apart by the node's declaration does not work: `Delay`
 * with a duration of zero is latent on paper and returns without waiting. So it is measured instead.
 *
 * {@link readEventLoopTurn} posts one message on a message channel, unless one is already on its
 * way, and answers how many have been delivered so far. A message is a task, and a task only runs
 * once the microtask queue is empty - so if the count has moved by the time a node settles, the
 * window was given back while that node ran. A channel rather than a timer, because Chromium
 * throttles timers in a window another window covers (once a second, and once a minute after five
 * minutes), which would make a graph that waits a tenth of a second look like one that never waits.
 *
 * Comments in English per project convention.
 */

let deliveredTurns = 0;
let turnPending = false;

function postTurnMarker(): void {
    if (typeof MessageChannel !== "function") {
        // Realms without a channel (some test environments) have no throttled timers either.
        setTimeout(() => {
            turnPending = false;
            deliveredTurns += 1;
        }, 0);
        return;
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        turnPending = false;
        deliveredTurns += 1;
    };
    channel.port2.postMessage(undefined);
}

/**
 * A mark to compare against later with {@link eventLoopTurnedSince}.
 *
 * Makes sure a marker is on its way, so that the next time the event loop turns the answer moves.
 * At most one marker is outstanding for the whole window, however many graphs are asking.
 */
export function readEventLoopTurn(): number {
    if (!turnPending) {
        turnPending = true;
        postTurnMarker();
    }
    return deliveredTurns;
}

/** Whether a task has run since `mark` was read - that is, whether the window was given back. */
export function eventLoopTurnedSince(mark: number): boolean {
    return deliveredTurns !== mark;
}
