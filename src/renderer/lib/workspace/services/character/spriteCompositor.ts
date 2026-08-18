/**
 * One picture of a character, from however many layers it takes.
 *
 * `Image.getSrcURL` returns null for a layered sprite — there is no single file — so every place in
 * Studio that used to show "the character's image" (row badges, pickers, thumbnails) has to ask for
 * a composite instead. This is that service.
 *
 * The drawing is injected rather than called directly so the cache, the keys and the eviction can be
 * tested without a canvas, and so a caller that already has bitmaps (the occlusion pass) can share
 * the same decode.
 */

/** Asset ids bottom to top; `null` is a layer that draws nothing under the current selection. */
export type CompositeLayers = readonly (string | null)[];

export type SpriteDecoder = (assetId: string) => Promise<ImageBitmap | null>;

export type SpriteRenderer = (
  bitmaps: readonly ImageBitmap[],
  maxSize: number | undefined
) => Promise<Blob | null>;

/**
 * The identity of a composite: same character, same resolved selection, same picture. Selection keys
 * are sorted because a tag map's insertion order is an accident of which row wrote it, and two rows
 * that pose a character identically must hit one cache entry.
 */
export function spriteCompositeKey(
  characterId: string,
  selection: { poseId?: string | null; tags?: Record<string, string> | null }
): string {
  if (selection.poseId) {
    return `${characterId}|pose:${selection.poseId}`;
  }
  const tags = Object.entries(selection.tags ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([axis, tag]) => `${axis}=${tag}`)
    .join(",");
  return `${characterId}|tags:${tags}`;
}

/** Draw every layer at its own size, centred — the rule the engine renders a stack by. */
export const drawStack: SpriteRenderer = async (bitmaps, maxSize) => {
  if (bitmaps.length === 0) {
    return null;
  }
  const width = Math.max(...bitmaps.map((bitmap) => bitmap.width));
  const height = Math.max(...bitmaps.map((bitmap) => bitmap.height));
  // A 24px badge has no business decoding a 2000px stack twice over, so the whole composite is
  // scaled once at the end rather than each layer being resized on the way in.
  const scale = maxSize ? Math.min(1, maxSize / Math.max(width, height)) : 1;
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(width * scale)),
    Math.max(1, Math.round(height * scale))
  );
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.imageSmoothingQuality = "high";
  for (const bitmap of bitmaps) {
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    ctx.drawImage(bitmap, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  }
  return canvas.convertToBlob({ type: "image/png" });
};

type Entry = { url: string; size: number };

export class SpriteCompositor {
  private cache = new Map<string, Entry>();
  private inFlight = new Map<string, Promise<string | null>>();

  constructor(
    private decode: SpriteDecoder,
    private render: SpriteRenderer = drawStack,
    private limit = 48
  ) {}

  /**
   * An object URL for the composited stack, or null when nothing draws. Repeated calls for the same
   * key and size share one URL — callers must not revoke it; {@link invalidate} and {@link dispose}
   * own its lifetime.
   */
  public composite(key: string, layers: CompositeLayers, maxSize?: number): Promise<string | null> {
    const cacheKey = `${key}@${maxSize ?? 0}`;
    const hit = this.cache.get(cacheKey);
    if (hit) {
      // Refresh recency: re-inserting moves it to the end of the Map's iteration order.
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, hit);
      return Promise.resolve(hit.url);
    }
    const pending = this.inFlight.get(cacheKey);
    if (pending) {
      return pending;
    }

    const work = this.build(layers, maxSize)
      .then((url) => {
        if (url) {
          this.cache.set(cacheKey, { url, size: 1 });
          this.evict();
        }
        return url;
      })
      .finally(() => {
        this.inFlight.delete(cacheKey);
      });
    this.inFlight.set(cacheKey, work);
    return work;
  }

  private async build(layers: CompositeLayers, maxSize?: number): Promise<string | null> {
    const ids = layers.filter((assetId): assetId is string => Boolean(assetId));
    if (ids.length === 0) {
      return null;
    }
    const bitmaps = (await Promise.all(ids.map((id) => this.decode(id)))).filter(
      Boolean
    ) as ImageBitmap[];
    if (bitmaps.length === 0) {
      return null;
    }
    const blob = await this.render(bitmaps, maxSize);
    return blob ? URL.createObjectURL(blob) : null;
  }

  /**
   * Which layers are completely hidden by the ones above them.
   *
   * Answered on a coarse grid rather than per pixel: a layer counts as covered when every cell it
   * paints is fully opaque in some layer above it. The grid is what makes this cheap enough to run
   * on every edit, and a warning that is one cell off is still the right warning.
   */
  public async occlusion(layers: CompositeLayers, grid = 48): Promise<boolean[]> {
    const bitmaps = await Promise.all(
      layers.map((id) => (id ? this.decode(id) : Promise.resolve(null)))
    );
    const present = bitmaps.filter(Boolean) as ImageBitmap[];
    if (present.length === 0) {
      return new Array(layers.length).fill(false);
    }
    // Sample in *canvas* space, not per layer: a small accessory centred on a tall body covers a
    // few cells, and stretching each layer to fill the grid would say it covers all of them.
    const canvas = {
      width: Math.max(...present.map((bitmap) => bitmap.width)),
      height: Math.max(...present.map((bitmap) => bitmap.height))
    };
    const drawn = bitmaps.map((bitmap) => (bitmap ? sampleAlpha(bitmap, canvas, grid) : null));
    const covered = new Array(grid * grid).fill(false);
    const result = new Array(layers.length).fill(false);
    // Walk top-down accumulating opaque coverage, so each layer is asked about what is already
    // above it rather than about the whole stack.
    for (let index = layers.length - 1; index >= 0; index--) {
      const sample = drawn[index];
      if (!sample) {
        continue;
      }
      result[index] = sample.visible.every((visible, cell) => !visible || covered[cell]);
      for (let cell = 0; cell < covered.length; cell++) {
        if (sample.opaque[cell]) {
          covered[cell] = true;
        }
      }
    }
    return result;
  }

  /** Drop every composite of one character — its stack or one of its assets changed. */
  public invalidate(prefix: string): void {
    for (const [key, entry] of [...this.cache]) {
      if (key.startsWith(prefix)) {
        URL.revokeObjectURL(entry.url);
        this.cache.delete(key);
      }
    }
  }

  public dispose(): void {
    for (const entry of this.cache.values()) {
      URL.revokeObjectURL(entry.url);
    }
    this.cache.clear();
  }

  private evict(): void {
    while (this.cache.size > this.limit) {
      const oldest = this.cache.keys().next();
      if (oldest.done) {
        return;
      }
      const entry = this.cache.get(oldest.value);
      if (entry) {
        URL.revokeObjectURL(entry.url);
      }
      this.cache.delete(oldest.value);
    }
  }
}

/**
 * Per-cell "this layer paints here" / "this layer is solid here" masks, on a `grid`×`grid` lattice
 * laid over the whole canvas — the layer is placed inside it centred and to scale, the way the stack
 * draws it.
 */
function sampleAlpha(
  bitmap: ImageBitmap,
  canvasSize: { width: number; height: number },
  grid: number
): { visible: boolean[]; opaque: boolean[] } {
  const canvas = new OffscreenCanvas(grid, grid);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const visible = new Array(grid * grid).fill(false);
  const opaque = new Array(grid * grid).fill(false);
  if (!ctx) {
    return { visible, opaque };
  }
  const w = (bitmap.width / canvasSize.width) * grid;
  const h = (bitmap.height / canvasSize.height) * grid;
  ctx.drawImage(bitmap, (grid - w) / 2, (grid - h) / 2, w, h);
  const { data } = ctx.getImageData(0, 0, grid, grid);
  for (let cell = 0; cell < grid * grid; cell++) {
    const alpha = data[cell * 4 + 3];
    visible[cell] = alpha > 8;
    opaque[cell] = alpha > 250;
  }
  return { visible, opaque };
}
