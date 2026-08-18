import fs from "fs/promises";
import path from "path";
import zlib from "zlib";
import { promisify } from "util";

/**
 * Precompressed `.br` and `.gz` siblings for the exported site's text files.
 *
 * This is the one optimization here that the *server* has to cooperate with:
 * nginx's `brotli_static`/`gzip_static`, Caddy's `precompressed`, and the
 * equivalents elsewhere answer a request for `renderer.js` with `renderer.js.br`
 * when the browser said it accepts it. A host that has none of that serves the
 * originals and never opens these files, which is why writing them is safe to do
 * by default: the worst case is some unread bytes in the upload, and the best
 * case is the story bundle arriving several times smaller.
 *
 * Only text is worth it. Images, audio and video are already entropy-coded, and
 * running deflate over them buys a percent or two in exchange for a second copy
 * of a very large file - so the extension list below is an allowlist, not a
 * denylist.
 *
 * The output goes to a directory of its own rather than into the compiled site,
 * because that site is shared with the Android and iOS packages, which serve
 * their files directly out of the package and would only be made larger by
 * variants nothing will ever ask for.
 */

const brotliCompress = promisify(zlib.brotliCompress);
const gzipCompress = promisify(zlib.gzip);

/**
 * Extensions whose contents are text (or, for fonts, uncompressed binary that
 * deflates well). `.woff2` is deliberately absent: it is Brotli-compressed
 * already, by specification.
 */
const PRECOMPRESSIBLE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".js",
  ".mjs",
  ".css",
  ".html",
  ".json",
  ".svg",
  ".txt",
  ".xml",
  ".map",
  ".wasm",
  ".ttf",
  ".otf"
]);

/**
 * Below this, a second request's worth of headers costs more than the body ever
 * could, and a static-file server that has to stat two files to save 200 bytes
 * is losing.
 */
const MIN_PRECOMPRESS_BYTES = 1024;

/**
 * A variant that saves less than this fraction is not worth the file. Text
 * routinely reaches 0.2 or better, so this only rejects things that are not
 * really text - a `.json` holding base64 image data, say.
 */
const MAX_USEFUL_RATIO = 0.95;

/**
 * How many files are compressed at once. Brotli at maximum quality is seconds of
 * CPU on a large bundle, and `zlib`'s async API runs on the libuv thread pool -
 * whose default size is four. Asking for more than the pool has would queue
 * behind itself while starving this process's own file reads.
 */
const CONCURRENCY = 4;

export type PrecompressResult = {
  /** How many source files got at least one variant. */
  files: number;
  /** Total size of those sources, and of every variant written for them. */
  sourceBytes: number;
  variantBytes: number;
};

/**
 * Write variants for everything under `sourceDir` into `targetDir`, mirroring
 * the relative layout so the result can be copied over a deployed site.
 */
export async function precompressWebSite(
  sourceDir: string,
  targetDir: string
): Promise<PrecompressResult> {
  const candidates = (await listFiles(sourceDir)).filter((relativePath) =>
    PRECOMPRESSIBLE_EXTENSIONS.has(path.extname(relativePath).toLowerCase())
  );
  const result: PrecompressResult = { files: 0, sourceBytes: 0, variantBytes: 0 };

  let cursor = 0;
  const workers = new Array(Math.min(CONCURRENCY, candidates.length)).fill(null).map(async () => {
    for (let index = cursor++; index < candidates.length; index = cursor++) {
      const relativePath = candidates[index];
      const source = await fs.readFile(path.join(sourceDir, ...relativePath.split("/")));
      if (source.length < MIN_PRECOMPRESS_BYTES) {
        continue;
      }
      const variants = await compressVariants(source);
      if (variants.length === 0) {
        continue;
      }
      const destination = path.join(targetDir, ...relativePath.split("/"));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      for (const variant of variants) {
        await fs.writeFile(`${destination}${variant.suffix}`, variant.bytes);
        result.variantBytes += variant.bytes.length;
      }
      result.files += 1;
      result.sourceBytes += source.length;
    }
  });
  await Promise.all(workers);
  return result;
}

async function compressVariants(source: Buffer): Promise<{ suffix: string; bytes: Buffer }[]> {
  const [brotli, gzip] = await Promise.all([
    brotliCompress(source, {
      params: {
        // Maximum quality: this runs once, at build time, and every byte
        // it finds is paid back on every player's first load.
        [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: source.length
      }
    }),
    // Kept alongside Brotli rather than replaced by it: `gzip_static` is
    // built into stock nginx and `brotli_static` is a third-party module, so
    // gzip is the variant a self-hosted site is most likely to actually
    // serve.
    gzipCompress(source, { level: zlib.constants.Z_BEST_COMPRESSION })
  ]);
  const variants: { suffix: string; bytes: Buffer }[] = [];
  if (brotli.length < source.length * MAX_USEFUL_RATIO) {
    variants.push({ suffix: ".br", bytes: brotli });
  }
  if (gzip.length < source.length * MAX_USEFUL_RATIO) {
    variants.push({ suffix: ".gz", bytes: gzip });
  }
  return variants;
}

/** Every regular file under `root`, relative and `/`-separated. */
async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const collected: string[] = [];
  for (const dirent of await fs.readdir(root, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${dirent.name}` : dirent.name;
    if (dirent.isDirectory()) {
      collected.push(...(await listFiles(path.join(root, dirent.name), relative)));
    } else if (dirent.isFile()) {
      collected.push(relative);
    }
  }
  return collected;
}
