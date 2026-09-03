/**
 * How far a game has got in starting up, said once for everyone who asks.
 *
 * A game does a measurable amount of work before it can paint anything: it reads its own bundle,
 * compiles the story, and warms the pictures and fonts the first frame needs. Until this existed
 * none of that was observable from outside. The shell had no way to tell a player that anything
 * was happening - so a shipped game opened on a black window and stayed there - and a profiler had
 * nothing to attribute the wait to, because the only boundary the engine publishes is "the preload
 * finished".
 *
 * So there is one seam and two consumers. Every phase boundary is written to the page's own
 * performance timeline under a stable name, which is what a profiler and the performance-inspector
 * plugin read, and the same boundary is handed to whoever asked for it - {@link GameAppHost} calls
 * that `onBootProgress` - which is what a shell draws a loading state from. One call site produces
 * both, so a phase cannot appear in the timeline and be missing from the screen.
 *
 * ## The phases
 *
 * Three of them are spans and the fourth is a moment:
 *
 * - `bundle` - getting the game's own data. The pack read in a packaged shell; the bundle payload
 *   arriving in a Dev Mode window.
 * - `story` - compiling the story the game opens with.
 * - `preload` - warming what the first frame needs. **A run can have more than one of these.** A
 *   packaged shell warms its first screen's pictures and fonts itself, and the engine then warms
 *   the opening scene; they are the same kind of work, they never overlap, and calling the second
 *   one something else would mean two names for one question ("what was it loading?"). Dev Mode has
 *   only the second, because that window has no first-screen pass of its own.
 * - `firstFrame` - the first painted frame. The end of the boot, and the point a loading state goes
 *   away.
 *
 * The counts are optional and come in pairs. The engine's preload API reports its boundaries and
 * not its progress, so a scene warm-up is indeterminate; a shell warming a list of assets it
 * assembled itself knows both numbers and says so. A consumer draws a bar when it has the pair and
 * something indeterminate when it does not, and never has to guess which case it is in.
 *
 * Comments in English per project convention.
 */

/** A stretch of the boot with a start and an end. */
export type GameBootSpan = "bundle" | "story" | "preload";

/** What the boot is doing. `firstFrame` is the end of it rather than a stretch. */
export type GameBootPhase = GameBootSpan | "firstFrame";

export type GameBootProgress = {
    phase: GameBootPhase;
    /**
     * Assets warmed, and assets to warm. Present together or not at all: a consumer that has the
     * pair can draw a real bar, and one that does not knows to draw something indeterminate rather
     * than a bar stuck at zero.
     */
    loaded?: number;
    total?: number;
    /** `performance.now()` when this was reported - milliseconds since the page began. */
    at: number;
};

/**
 * The prefix every name in this timeline carries, and the name of the whole boot.
 *
 * A profiler filters on the prefix; `nl.boot` itself is the measure from the page's time origin to
 * the first painted frame, which is the one number "did the boot get slower" is answered with.
 */
export const GAME_BOOT_MEASURE = "nl.boot";

/** `nl.boot.bundle.start`, `nl.boot.preload.end`, and so on. */
export function gameBootSpanMark(span: GameBootSpan, edge: "start" | "end"): string {
    return `${GAME_BOOT_MEASURE}.${span}.${edge}`;
}

/** `nl.boot.story` - the measure spanning one run of that phase. */
export function gameBootSpanMeasure(span: GameBootSpan): string {
    return `${GAME_BOOT_MEASURE}.${span}`;
}

/** `nl.boot.firstFrame` - a mark, because the first frame is a moment and not a stretch. */
export const GAME_BOOT_FIRST_FRAME_MARK = `${GAME_BOOT_MEASURE}.firstFrame`;

/**
 * The timeline this module writes to, or null where there is not one.
 *
 * Every browser and every test environment this runs in has `performance`, but a node context
 * without `performance.mark` is reachable (a unit test importing a module that boots), and a
 * missing timeline must cost the boot nothing rather than throw inside it.
 */
function timeline(): Performance | null {
    const candidate = typeof performance === "undefined" ? null : performance;
    return candidate && typeof candidate.mark === "function" && typeof candidate.now === "function"
        ? candidate
        : null;
}

function now(): number {
    return timeline()?.now() ?? 0;
}

function mark(name: string): void {
    try {
        timeline()?.mark(name);
    } catch {
        // A timeline that refuses a mark is not a reason for a game not to start.
    }
}

function measure(name: string, startMark: string, endMark: string): void {
    try {
        timeline()?.measure(name, startMark, endMark);
    } catch {
        // Same: a measure whose start mark was dropped (a buffer cleared by a profiler between the
        // two calls) is a gap in the timeline, not a failure of the boot.
    }
}

export type GameBootReporter = {
    /** This phase has started. Marks it, and reports it with whatever counts are known. */
    begin(span: GameBootSpan, counts?: { loaded: number; total: number }): void;
    /** How far this phase has got. No mark: progress is a value, not a boundary. */
    progress(span: GameBootSpan, loaded: number, total: number): void;
    /** This phase is over. Marks it and measures the span; a phase never begun is ignored. */
    end(span: GameBootSpan): void;
    /** The game has painted. Marks it, measures the whole boot, and reports it once. */
    firstFrame(): void;
};

/**
 * A reporter, optionally wired to whoever wants to be told.
 *
 * The report function is where a shell's loading state and a Dev Mode window's log hang off; the
 * timeline is written whether or not anyone is listening, because a profiler attaching to a running
 * game is exactly the case where nobody registered a callback.
 *
 * Each reporter tracks its own open spans. Two reporters in one page (a packaged shell has one for
 * its own steps and the game app has another) therefore cannot close each other's spans, which is
 * what keeps the two `preload` passes from measuring across the gap between them.
 */
export function createGameBootReporter(
    report?: ((progress: GameBootProgress) => void) | undefined,
): GameBootReporter {
    const open = new Set<GameBootSpan>();
    let firstFrameReported = false;

    const publish = (progress: GameBootProgress): void => {
        try {
            report?.(progress);
        } catch {
            // A listener that throws must not take the boot down with it: this is a notification,
            // and the game starting is the thing that matters.
        }
    };

    return {
        begin(span, counts) {
            if (open.has(span)) {
                return;
            }
            open.add(span);
            mark(gameBootSpanMark(span, "start"));
            publish({
                phase: span,
                ...(counts ? { loaded: counts.loaded, total: counts.total } : {}),
                at: now(),
            });
        },
        progress(span, loaded, total) {
            if (!open.has(span)) {
                return;
            }
            publish({ phase: span, loaded, total, at: now() });
        },
        end(span) {
            if (!open.delete(span)) {
                return;
            }
            const endMark = gameBootSpanMark(span, "end");
            mark(endMark);
            measure(gameBootSpanMeasure(span), gameBootSpanMark(span, "start"), endMark);
        },
        firstFrame() {
            if (firstFrameReported) {
                return;
            }
            firstFrameReported = true;
            // Anything still open ends here. A boot that reached its first frame with a span still
            // running is a span whose own end was never reached (a preload that timed out, a story
            // that superseded itself), and leaving it open would lose the phase from the timeline
            // entirely rather than recording that it ran until the frame.
            for (const span of [...open]) {
                this.end(span);
            }
            mark(GAME_BOOT_FIRST_FRAME_MARK);
            // From the page's time origin, which is the only start every shell shares. The process
            // began earlier than that on a desktop shell; what happened in between is the main
            // process's own to report, and it writes it to the game log.
            try {
                timeline()?.measure(GAME_BOOT_MEASURE, { start: 0, end: GAME_BOOT_FIRST_FRAME_MARK });
            } catch {
                // Older timelines take marks by name only; the phase measures still stand.
            }
            publish({ phase: "firstFrame", at: now() });
        },
    };
}
