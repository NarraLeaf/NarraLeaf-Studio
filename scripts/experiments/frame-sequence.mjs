/** Feasibility prototype only: no renderer, game clock, or project schema integration. */
export class FrameSequence {
    constructor({ frames, fps = 12, loop = true }, elapsedMs = 0) {
        if (!Array.isArray(frames) || frames.length === 0 || frames.some(frame => typeof frame !== "string" || !frame)) {
            throw new TypeError("A sequence needs non-empty frame resource identifiers");
        }
        if (!Number.isFinite(fps) || fps <= 0 || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
            throw new RangeError("Frame rate must be positive and elapsed time non-negative");
        }
        this.frames = [...frames];
        this.fps = fps;
        this.loop = loop;
        this.elapsedMs = elapsedMs;
    }

    /** Called once per engine tick, never once per mounted view. */
    advance(deltaMs, paused = false) {
        if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new RangeError("Invalid clock delta");
        if (!paused) this.elapsedMs += deltaMs;
        return this.sample();
    }

    /** All views of one instance consume this single immutable tick sample. */
    sample() {
        const absoluteFrame = Math.floor(this.elapsedMs * this.fps / 1000);
        const index = this.loop ? absoluteFrame % this.frames.length : Math.min(absoluteFrame, this.frames.length - 1);
        return Object.freeze({ elapsedMs: this.elapsedMs, index, src: this.frames[index] });
    }

    save() {
        return { elapsedMs: this.elapsedMs };
    }
}
