/**
 * When an auto-save takes its picture, and when it keeps the one it took before.
 *
 * Writing the playthrough is cheap - serializing it is a few milliseconds - but picturing the stage
 * is not: the engine clones the whole stage, inlines its images and rasterises it, a few hundred
 * milliseconds of the main thread however small the picture is drawn. A timer that takes the picture
 * the moment it fires lands mid-line as often as not, so the player watched the typewriter stop for
 * a moment every few seconds, and with the skip key held - the story advancing on every frame, so
 * every tick wrote - it stalled the skip on a fixed beat. MEASURED in a 1920x1080 port: 54 frames
 * over 100 ms in a minute and a half of reading and skipping with a five-second ring, none with
 * auto-saving off.
 *
 * So the picture is taken at a quiet moment and reused in between:
 *
 * - **Reading:** the write waits until the play head has stood still for {@link AUTO_SAVE_QUIET_MS}
 *   - the line is out and the player is reading it - and for the browser to be idle, then pictures
 *   the stage and writes. The state is serialized after the wait, so it is the moment pictured.
 * - **Skipping:** no picture is taken. The write keeps the last picture of this playthrough, and the
 *   first quiet write after the skip takes a fresh one. A playthrough with no picture yet takes one
 *   anyway: a row with no thumbnail is worse than one stall.
 * - **Never quiet:** a player who clicks on faster than the quiet window keeps the last picture once
 *   {@link AUTO_SAVE_QUIET_WAIT_MS} has passed, for the same reason.
 *
 * A picture is only reused within the playthrough it was taken in. Loading a save or starting a new
 * game is a new playthrough, and a picture from before it is a picture of somewhere else.
 *
 * The play head is the only signal: the engine says when a line starts, not when its typewriter
 * finishes, so a line still typing after {@link AUTO_SAVE_QUIET_MS} reads as quiet.
 *
 * Kept free of React so it can be driven directly; `GameApp` owns the one instance and feeds it the
 * play head.
 *
 * Comments in English per project convention.
 */

/** How long the play head stands still before a write counts the moment as quiet. */
export const AUTO_SAVE_QUIET_MS = 1200;

/** Longest a scheduled write waits for a quiet moment before keeping the last picture. */
export const AUTO_SAVE_QUIET_WAIT_MS = 4000;

/** How often a waiting write looks again. */
export const AUTO_SAVE_QUIET_POLL_MS = 200;

/** Longest a quiet write waits for the browser to be idle before taking the picture anyway. */
export const AUTO_SAVE_IDLE_TIMEOUT_MS = 500;

export type AutoSavePictureDeps = {
    /** Skip mode is running: the skip key held, or the `skipping` preference on. */
    isSkipping: () => boolean;
    /** Which playthrough is on the stage. A picture is reused only within the one it was taken in. */
    playthrough: () => number;
    /** Picture the stage for the save going into `id`; undefined when no picture could be taken. */
    capture: (id: string) => Promise<string | undefined>;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    /** Resolves when the browser is idle, or after `timeoutMs` whichever comes first. */
    whenIdle?: (timeoutMs: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const defaultWhenIdle = (timeoutMs: number) => new Promise<void>(resolve => {
    if (typeof requestIdleCallback === "function") {
        requestIdleCallback(() => resolve(), { timeout: timeoutMs });
    } else {
        setTimeout(resolve, 0);
    }
});

export class AutoSavePicture {
    private lastMoveAt = Number.NEGATIVE_INFINITY;
    private last: { playthrough: number; picture: string } | null = null;
    private readonly now: () => number;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly whenIdle: (timeoutMs: number) => Promise<void>;

    constructor(private readonly deps: AutoSavePictureDeps) {
        this.now = deps.now ?? (() => performance.now());
        this.sleep = deps.sleep ?? defaultSleep;
        this.whenIdle = deps.whenIdle ?? defaultWhenIdle;
    }

    /** The story play head moved. Called once per action, so it only notes the time. */
    public markPlayHeadMoved(): void {
        this.lastMoveAt = this.now();
    }

    /**
     * The picture a scheduled auto-save into `id` keeps. Waits for a quiet moment when the player is
     * reading; see the module comment for the rest. Undefined only when no picture could be taken.
     */
    public async pictureForWrite(id: string): Promise<string | undefined> {
        const deadline = this.now() + AUTO_SAVE_QUIET_WAIT_MS;
        while (!this.isQuiet()) {
            if (this.deps.isSkipping() || this.now() >= deadline) {
                return this.reusable() ?? this.take(id);
            }
            await this.sleep(AUTO_SAVE_QUIET_POLL_MS);
        }
        if (this.deps.isSkipping()) {
            return this.reusable() ?? this.take(id);
        }
        await this.whenIdle(AUTO_SAVE_IDLE_TIMEOUT_MS);
        return this.take(id);
    }

    private isQuiet(): boolean {
        return this.now() - this.lastMoveAt >= AUTO_SAVE_QUIET_MS;
    }

    private reusable(): string | undefined {
        return this.last !== null && this.last.playthrough === this.deps.playthrough() ? this.last.picture : undefined;
    }

    private async take(id: string): Promise<string | undefined> {
        const playthrough = this.deps.playthrough();
        const picture = await this.deps.capture(id);
        if (picture) {
            this.last = { playthrough, picture };
        }
        return picture;
    }
}
