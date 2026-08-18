import { beforeEach, describe, expect, it, vi } from "vitest";
import { SpriteCompositor, spriteCompositeKey } from "./spriteCompositor";

/** The drawing is injected, so the cache and keys can be exercised without a canvas. */
function build(options?: { limit?: number }) {
  const revoked: string[] = [];
  let created = 0;
  // Node has no object-URL support; the compositor only ever calls these two.
  globalThis.URL.createObjectURL = () => `blob:${++created}`;
  globalThis.URL.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };

  const decode = vi.fn(
    async (assetId: string) => ({ width: 10, height: 10, id: assetId }) as unknown as ImageBitmap
  );
  const render = vi.fn(async () => new Blob());
  const compositor = new SpriteCompositor(decode, render, options?.limit ?? 48);
  return { compositor, decode, render, revoked };
}

describe("spriteCompositeKey", () => {
  it("gives one key to two selections that pose a character identically", () => {
    const a = spriteCompositeKey("c1", { tags: { outfit: "casual", mood: "angry" } });
    const b = spriteCompositeKey("c1", { tags: { mood: "angry", outfit: "casual" } });
    expect(a).toBe(b);
  });

  it("separates poses from tags and characters from each other", () => {
    expect(spriteCompositeKey("c1", { poseId: "p1" })).not.toBe(
      spriteCompositeKey("c2", { poseId: "p1" })
    );
    expect(spriteCompositeKey("c1", { poseId: "p1" })).not.toBe(
      spriteCompositeKey("c1", { tags: { a: "p1" } })
    );
  });
});

describe("SpriteCompositor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("draws once per key and size, and hands the same url back", async () => {
    const { compositor, render } = build();
    const first = await compositor.composite("c1|tags:a=b", ["one", "two"]);
    const second = await compositor.composite("c1|tags:a=b", ["one", "two"]);
    expect(first).toBe(second);
    expect(render).toHaveBeenCalledTimes(1);

    // A different size is a different picture.
    await compositor.composite("c1|tags:a=b", ["one", "two"], 32);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("collapses concurrent requests for the same picture into one draw", async () => {
    const { compositor, render } = build();
    const [a, b] = await Promise.all([
      compositor.composite("c1|pose:p", ["one"]),
      compositor.composite("c1|pose:p", ["one"])
    ]);
    expect(a).toBe(b);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("returns null when nothing draws, without touching the renderer", async () => {
    const { compositor, render, decode } = build();
    expect(await compositor.composite("c1|tags:", [null, null])).toBeNull();
    expect(render).not.toHaveBeenCalled();
    expect(decode).not.toHaveBeenCalled();
  });

  it("revokes what it evicts, oldest use first", async () => {
    const { compositor, revoked } = build({ limit: 2 });
    const first = await compositor.composite("c1|pose:a", ["x"]);
    await compositor.composite("c1|pose:b", ["x"]);
    // Touching the first entry makes the second the least recently used.
    await compositor.composite("c1|pose:a", ["x"]);
    await compositor.composite("c1|pose:c", ["x"]);
    expect(revoked).toHaveLength(1);
    expect(revoked[0]).not.toBe(first);
  });

  it("invalidates one character without disturbing another", async () => {
    const { compositor, render } = build();
    const kept = await compositor.composite("c2|pose:a", ["x"]);
    await compositor.composite("c1|pose:a", ["x"]);
    compositor.invalidate("c1|");

    expect(await compositor.composite("c2|pose:a", ["x"])).toBe(kept);
    expect(render).toHaveBeenCalledTimes(2);
    await compositor.composite("c1|pose:a", ["x"]);
    expect(render).toHaveBeenCalledTimes(3);
  });
});
