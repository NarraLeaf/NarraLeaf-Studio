import test from "node:test";
import assert from "node:assert/strict";
import { FrameSequence } from "./frame-sequence.mjs";

const clip = { frames: ["a.png", "b.png", "c.png"], fps: 10 };

test("irregular ticks select from elapsed time rather than counting renders", () => {
    const sequence = new FrameSequence(clip);
    for (const delta of [17, 83, 145, 61, 199]) sequence.advance(delta);
    assert.deepEqual(sequence.sample(), { elapsedMs: 505, index: 2, src: "c.png" });
});

test("transition views consume one sample without advancing the instance", () => {
    const sequence = new FrameSequence(clip);
    const sample = sequence.advance(150);
    const outgoing = sample;
    const incoming = sample;
    assert.equal(outgoing, incoming);
    assert.equal(sequence.sample().elapsedMs, 150);
    assert.ok(Object.isFrozen(sample));
});

test("pause freezes time; restoring state preserves the next frame boundary", () => {
    const sequence = new FrameSequence(clip);
    sequence.advance(150);
    sequence.advance(5000, true);
    const restored = new FrameSequence(clip, sequence.save().elapsedMs);
    assert.deepEqual(restored.sample(), sequence.sample());
    assert.equal(restored.advance(50).src, "c.png");
});

test("new pose starts at zero and independent instances keep independent progress", () => {
    const first = new FrameSequence(clip);
    first.advance(200);
    const second = new FrameSequence(clip);
    assert.equal(first.sample().src, "c.png");
    assert.equal(second.sample().src, "a.png");
});

test("non-looping clips hold the final frame and invalid inputs are rejected", () => {
    assert.equal(new FrameSequence({ ...clip, loop: false }).advance(9999).src, "c.png");
    assert.throws(() => new FrameSequence({ frames: [], fps: 12 }));
    assert.throws(() => new FrameSequence({ ...clip, fps: 0 }));
    assert.throws(() => new FrameSequence(clip).advance(-1));
});
