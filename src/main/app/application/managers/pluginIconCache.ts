import fs from "fs/promises";
import path from "path";
import { UserDataNamespace } from "@shared/types/constants";
import { inspectPluginIconBytes, pluginIconMimeType } from "@shared/utils/pluginIcon";
import type { ImageFormat } from "@shared/utils/imageDimensions";
import { downloadIcon, fetchRegistryIndex } from "./pluginRegistryClient";

/**
 * The store's thumbnails, fetched by the main process and kept on disk.
 *
 * Studio's renderers do not talk to the network — every remote byte comes in
 * through main, and a store thumbnail is no exception. So the renderer never
 * sees the registry's icon URL; it asks for a plugin id and gets back a
 * `data:` URL, which also means a hostile index cannot aim an `<img>` anywhere
 * or use one as a per-user beacon.
 *
 * The cache is keyed by `<pluginId>@<version>`, so a plugin's next version
 * fetches once and every render after that is free — including across
 * restarts. Writing a new version's icon sweeps that plugin's older ones, which
 * is what keeps the directory bounded without a separate eviction pass.
 */
export class PluginIconCache {
  private readonly cacheDir: string;
  /**
   * Ids whose icon is known bad or unreachable this session. Memory-only on
   * purpose: a transient 502 should not be a permanent monogram, and a
   * restart is a cheap enough retry.
   */
  private readonly failures = new Set<string>();
  /** In-flight fetches, so twenty rows appearing at once make one request. */
  private readonly inFlight = new Map<string, Promise<string | null>>();

  constructor(userDataDir: string) {
    this.cacheDir = path.join(userDataDir, UserDataNamespace.PluginIcons);
  }

  /**
   * The plugin's thumbnail as a `data:` URL, or `null` when it has none, the
   * registry does not list it, or its icon fails the icon rules.
   *
   * `null` is not an error: the caller draws the name monogram instead, which
   * is also what a plugin that never shipped an icon gets.
   */
  public async resolve(registryUrl: string, pluginId: string): Promise<string | null> {
    // A minute is long enough that a screen full of rows shares one read and
    // short enough that Refresh -> icons follows the index the user just saw.
    const index = await fetchRegistryIndex(registryUrl, { maxAgeMs: 60_000 });
    const entry = index.plugins.find((plugin) => plugin.id === pluginId);
    if (!entry?.icon) {
      return null;
    }

    const key = `${entry.id}@${entry.version}`;
    if (this.failures.has(key)) {
      return null;
    }
    const cached = await this.read(key);
    if (cached) {
      return cached;
    }
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }

    const pending = this.fetchAndStore(key, entry.id, entry.icon)
      .catch((error) => {
        console.warn(
          `[PluginIconCache] ${key}: ${error instanceof Error ? error.message : String(error)}`
        );
        this.failures.add(key);
        return null;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, pending);
    return pending;
  }

  /**
   * Forget which icons could not be fetched, without touching the ones on
   * disk. Pressing Refresh means "go and look again", and an icon that was
   * missing an hour ago is exactly the kind of thing that changes.
   */
  public clearFailures(): void {
    this.failures.clear();
  }

  /**
   * Forget everything cached for a plugin, so the next look at it re-fetches.
   *
   * Called after an install or update: that is the moment the store entry the
   * icon came from is known to have moved, and it is also when a previously
   * unreachable icon is worth one more try.
   */
  public async invalidate(pluginId: string): Promise<void> {
    for (const key of [...this.failures]) {
      if (key.startsWith(`${pluginId}@`)) {
        this.failures.delete(key);
      }
    }
    await this.sweep(pluginId, null);
  }

  private async fetchAndStore(key: string, pluginId: string, url: string): Promise<string | null> {
    const bytes = await downloadIcon(url);
    const inspected = inspectPluginIconBytes(bytes);
    if ("error" in inspected) {
      // The registry is not the author's package, and Studio cannot refuse
      // to install over it, so a bad store icon degrades to the monogram
      // rather than becoming an error the user can do nothing about.
      this.failures.add(key);
      console.warn(`[PluginIconCache] ${key}: ${inspected.error}`);
      return null;
    }
    const fileName = `${encodeURIComponent(key)}.${inspected.format}`;
    await fs.mkdir(this.cacheDir, { recursive: true });
    await fs.writeFile(path.join(this.cacheDir, fileName), bytes);
    await this.sweep(pluginId, fileName);
    return dataUrl(bytes, inspected.format);
  }

  private async read(key: string): Promise<string | null> {
    const prefix = `${encodeURIComponent(key)}.`;
    for (const entry of await this.list()) {
      if (!entry.startsWith(prefix)) {
        continue;
      }
      const format = entry.slice(prefix.length) as ImageFormat;
      // Only the formats this cache writes; a stray file in the directory
      // must not decide what media type the renderer is handed.
      if (format !== "png" && format !== "webp" && format !== "jpeg") {
        continue;
      }
      try {
        return dataUrl(await fs.readFile(path.join(this.cacheDir, entry)), format);
      } catch {
        return null;
      }
    }
    return null;
  }

  /** Drop every cached icon for this plugin except `keep`. */
  private async sweep(pluginId: string, keep: string | null): Promise<void> {
    const prefix = `${encodeURIComponent(pluginId)}%40`;
    for (const entry of await this.list()) {
      if (entry === keep || !entry.startsWith(prefix)) {
        continue;
      }
      await fs.rm(path.join(this.cacheDir, entry), { force: true }).catch(() => undefined);
    }
  }

  private async list(): Promise<string[]> {
    return fs.readdir(this.cacheDir).catch(() => []);
  }
}

function dataUrl(bytes: Buffer, format: ImageFormat): string {
  return `data:${pluginIconMimeType(format)};base64,${bytes.toString("base64")}`;
}
