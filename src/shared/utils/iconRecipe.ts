import {
  resolveIconBackground,
  type ProjectIconOutput,
  type ProjectIconSpec
} from "@shared/types/projectIcons";

/**
 * Where a source image lands inside a baked icon.
 *
 * This is the whole of "what the recipe means", and it lives in shared on
 * purpose: the panel draws its previews with a canvas and the build downscales
 * with nativeImage, so the two rasterizers must at least agree on the geometry.
 * If they did not, the tiles would be a picture of something Studio never ships.
 */
export type IconDrawPlan = {
  /** Edge length of the square output, in pixels. */
  canvas: number;
  /** Painted first, or null to leave the output transparent. */
  background: string | null;
  /** The artwork's rect inside the canvas, in pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Fit `source` into `output` under `spec`: inset from every edge by the spec's
 * fraction, then scaled to fit that box while preserving aspect and centred in
 * it. Preserving aspect is not cosmetic - the previous pipeline handed both a
 * width and a height to nativeImage.resize, which silently squashed any source
 * that was not already square.
 */
export function planIconDraw(input: {
  sourceWidth: number;
  sourceHeight: number;
  spec: ProjectIconSpec;
  output: ProjectIconOutput;
}): IconDrawPlan {
  const { spec, output } = input;
  const canvas = output.size;
  const background = resolveIconBackground(spec, output);

  const inset = Math.min(Math.max(spec.inset, 0), 0.49);
  const box = canvas * (1 - inset * 2);

  // A source whose dimensions could not be read is treated as square: filling
  // the box is a better guess than refusing to draw.
  const sourceWidth = input.sourceWidth > 0 ? input.sourceWidth : 1;
  const sourceHeight = input.sourceHeight > 0 ? input.sourceHeight : 1;
  const scale = box / Math.max(sourceWidth, sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  return {
    canvas,
    background,
    x: (canvas - width) / 2,
    y: (canvas - height) / 2,
    width,
    height
  };
}

/**
 * The edge below which a master cannot fill the biggest output cleanly. Matches
 * the packager's own floor for converting a PNG into .icns/.ico, so a source
 * that passes here passes there too.
 */
export const MIN_ICON_SOURCE_EDGE = 512;

/** Whether a source has to be upscaled to fill the outputs it feeds. */
export function iconSourceIsLowResolution(sourceWidth: number, sourceHeight: number): boolean {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return true;
  }
  return Math.max(sourceWidth, sourceHeight) < MIN_ICON_SOURCE_EDGE;
}

/**
 * The intermediate edge lengths a halving downscale walks through on its way to
 * `target`, largest first and excluding both ends.
 *
 * Browsers resample in a single bilinear step, which drops most of the source's
 * pixels when the ratio is large - a 1024 master straight to a 32 favicon reads
 * as noise. Halving repeatedly keeps every pixel contributing.
 */
export function halvingSteps(sourceEdge: number, targetEdge: number): number[] {
  const steps: number[] = [];
  let edge = Math.floor(sourceEdge / 2);
  while (edge > targetEdge) {
    steps.push(edge);
    edge = Math.floor(edge / 2);
  }
  return steps;
}
