import fs from "fs/promises";
import path from "path";
import type { GameRuntimeAssetManifestEntry, GameRuntimePackV1 } from "@shared/types/gameRuntime";
import type { WebOptimizationConfiguration } from "@shared/types/webOptimization";
import { planWebImageTranscode, webImageWorthKeeping } from "@shared/utils/webImageOptimization";
import { readImageDimensions } from "@shared/utils/imageDimensions";
import type { WebImageCodec, WebImageSourceType } from "./webImageCodec";

/**
 * Re-encode the compiled static site's images in place, and rewrite the pack
 * manifest to match.
 *
 * The manifest is the only thing that has to change, because the web runtime
 * addresses every asset through it (`assetUrl` builds `./{entry.relativePath}`)
 * rather than by guessing a file name from an id. That is what makes renaming
 * `<id>.png` to `<id>.webp` a safe operation here and an unsafe one inside a
 * model bundle, whose files are named by the model's own manifest instead - see
 * `planWebImageTranscode`, which refuses those.
 *
 * Runs on the shared web compile, so a build that also targets Android or iOS
 * ships the same optimized site inside those packages. That is deliberate:
 * there is one compiled site, and producing an unoptimized second copy for the
 * mobile shells would cost a full recompile to make the packages larger.
 *
 * Every step is reversible in the sense that matters: nothing here touches the
 * project. It rewrites a staging directory that the next compile deletes.
 */

export type WebExportOptimizationLog = (level: "info" | "warning", message: string) => void;

export type WebExportOptimizationInput = {
  /** The compiled static site (the artifact compile's `appDir`). */
  appDir: string;
  config: WebOptimizationConfiguration;
  /**
   * Injected rather than opened here so the caller owns the window's lifetime
   * across several passes, and so tests can drive the decision logic without a
   * browser engine.
   */
  codec: WebImageCodec;
  log: WebExportOptimizationLog;
  cancelled?: () => boolean;
};

export type WebExportOptimizationResult = {
  /** Images whose re-encoded form was kept. */
  converted: number;
  /** Images that were tried and whose original was kept anyway. */
  keptOriginal: number;
  /** Total size of the converted images before, and after. */
  beforeBytes: number;
  afterBytes: number;
};

const PACK_FILENAME = "pack.json";

/** How many "verification failed" warnings are worth printing before they stop being news. */
const MAX_VERIFICATION_WARNINGS = 3;

export async function optimizeWebExportImages(
  input: WebExportOptimizationInput
): Promise<WebExportOptimizationResult> {
  const packPath = path.join(input.appDir, PACK_FILENAME);
  const pack = JSON.parse(await fs.readFile(packPath, "utf-8")) as GameRuntimePackV1;
  const result: WebExportOptimizationResult = {
    converted: 0,
    keptOriginal: 0,
    beforeBytes: 0,
    afterBytes: 0
  };
  let verificationWarnings = 0;
  let changed = false;

  // Sequential on purpose. Each image holds its decoded bitmap plus two full
  // RGBA buffers for the comparison - roughly 24 bytes per pixel at the peak,
  // which for a 4K sprite is already a couple of hundred megabytes. Running
  // several at once would multiply that against a saving measured in seconds,
  // on a step that is already the smaller half of a production build.
  for (const [manifestKey, entry] of Object.entries(pack.assets.items)) {
    if (input.cancelled?.()) {
      break;
    }
    // A path outside `assets/` is not a loose asset file: a sealed pack keeps
    // its items inside the protected store, which the web export never
    // produces, but the manifest shape allows for it.
    if (!entry.relativePath.startsWith("assets/")) {
      continue;
    }
    const filePath = path.join(input.appDir, ...entry.relativePath.split("/"));
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(filePath);
    } catch {
      // The manifest names a file the compile did not write. Not this
      // step's problem to diagnose, and not its place to fail the build.
      continue;
    }
    const plan = planWebImageTranscode({ manifestKey, assetType: entry.type, bytes }, input.config);
    if (plan.action === "skip") {
      continue;
    }
    const sourceType = sourceTypeOf(bytes);
    if (!sourceType) {
      continue;
    }
    const encoded = await input.codec.encode({
      bytes,
      sourceType,
      lossless: plan.action === "lossless",
      ...(plan.action === "lossy" ? { quality: input.config.lossyQuality } : {})
    });
    if (!encoded) {
      result.keptOriginal += 1;
      continue;
    }
    // The guarantee, enforced rather than assumed: a lossless conversion
    // that does not decode back to the source pixels is thrown away. If this
    // ever starts firing the engine's behaviour has changed underneath us,
    // and the right outcome is a bigger export, not an altered one.
    if (plan.action === "lossless" && !encoded.verifiedLossless) {
      result.keptOriginal += 1;
      if (verificationWarnings < MAX_VERIFICATION_WARNINGS) {
        verificationWarnings += 1;
        input.log(
          "warning",
          `"${entry.name}" did not survive a lossless round trip; it ships unchanged`
        );
      }
      continue;
    }
    if (!webImageWorthKeeping(bytes.length, encoded.bytes.length)) {
      result.keptOriginal += 1;
      continue;
    }
    const nextRelativePath = withWebpExtension(entry.relativePath);
    const nextPath = path.join(input.appDir, ...nextRelativePath.split("/"));
    // Two assets can only collide here by differing solely in extension,
    // which their unique ids rule out - but the check costs nothing and the
    // failure it prevents is one asset silently overwriting another.
    if (nextRelativePath !== entry.relativePath && (await exists(nextPath))) {
      result.keptOriginal += 1;
      continue;
    }
    // Written before the original is removed: an interrupted pass then
    // leaves a stray file rather than an asset that exists in the manifest
    // and nowhere on disk.
    await fs.writeFile(nextPath, encoded.bytes);
    if (nextPath !== filePath) {
      await fs.rm(filePath, { force: true });
    }
    pack.assets.items[manifestKey] = webpManifestEntry(entry, nextRelativePath);
    changed = true;
    result.converted += 1;
    result.beforeBytes += bytes.length;
    result.afterBytes += encoded.bytes.length;
  }

  if (changed) {
    await fs.writeFile(packPath, JSON.stringify(pack), "utf-8");
  }
  return result;
}

/**
 * The manifest entry an asset gets once its bytes are WebP.
 *
 * `hash` and `originalRelativePath` deliberately survive untouched: both
 * describe the file in the author's project that this asset came from, which is
 * exactly as true after the conversion as before it. Rewriting them would erase
 * the only trail from a shipped asset back to its source.
 */
function webpManifestEntry(
  entry: GameRuntimeAssetManifestEntry,
  relativePath: string
): GameRuntimeAssetManifestEntry {
  return { ...entry, relativePath, ext: "webp", mimeType: "image/webp" };
}

/** Swap a trailing extension for `.webp`, or add one where there was none. */
function withWebpExtension(relativePath: string): string {
  const lastSlash = relativePath.lastIndexOf("/");
  const lastDot = relativePath.lastIndexOf(".");
  if (lastDot > lastSlash + 1) {
    return `${relativePath.slice(0, lastDot)}.webp`;
  }
  return `${relativePath}.webp`;
}

/**
 * The media type to hand the decoder, read from the bytes.
 *
 * Taken from the content rather than from the manifest's `ext`, for the same
 * reason the transcode plan is: the extension is authored metadata and the
 * bytes are the fact, and telling a decoder that a JPEG is a PNG is a decode
 * failure at best.
 */
function sourceTypeOf(bytes: Buffer): WebImageSourceType | null {
  switch (readImageDimensions(bytes)?.format) {
    case "png":
      return "image/png";
    case "jpeg":
      return "image/jpeg";
    default:
      return null;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
