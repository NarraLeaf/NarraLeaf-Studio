import fs from "fs/promises";
import path from "path";
import { gunzip } from "zlib";
import { promisify } from "util";
import {
  SPELLCHECK_CODE_PATTERN,
  SPELLCHECK_MAX_EXPANDED_BYTES
} from "@shared/constants/spellcheckRegistry";
import { CacheNamespace, UserDataNamespace } from "@shared/types/constants";
import type { InstalledSpellcheckDictionary } from "@shared/types/spellcheck";
import type { SpellcheckRegistryEntry } from "@shared/types/spellcheckRegistry";

const gunzipAsync = promisify(gunzip);

/**
 * The downloaded dictionaries on this machine.
 *
 * A cache in the strict sense of `docs/caches.md`: deleting it costs one re-download per language
 * the author checks in and never a word of their own work, which is why it sits under
 * `userData/cache/` and appears in the cache inventory. Dictionaries are never written into a
 * project and therefore never into version control - the project's own vocabulary is a different
 * thing entirely and lives in `editor/dictionary.json`.
 *
 * Two files per language: `<code>.txt.gz` holding the word list as it was downloaded, and
 * `<code>.json` holding where it came from, what it is licensed under, and the sha256 the registry
 * published for it. The digest is the input fingerprint the cache rules ask for - when the registry
 * republishes a language, the stored digest no longer matches and the entry reads as stale rather
 * than needing a migration.
 */

/** What `<code>.json` holds beside the bytes. */
export type DictionaryManifest = {
  code: string;
  name: string;
  license: string;
  /** sha256 of the gzipped bytes, as the registry published it. */
  sha256: string;
  /** Where it came from, so the author can see who they trusted. */
  source: string;
  /** Unix milliseconds. Not used for expiry - a word list does not go off. */
  installedAt: number;
};

export class DictionaryCache {
  private readonly root: string;

  constructor(userDataDir: string) {
    this.root = path.join(
      userDataDir,
      UserDataNamespace.Cache,
      CacheNamespace.SpellcheckDictionaries
    );
  }

  public directory(): string {
    return this.root;
  }

  /**
   * Every dictionary on disk, by code.
   *
   * Reads the manifests rather than the word lists: the list has to be gunzipped to say anything
   * at all, and a settings panel asking "what do I have" must not decompress every language on
   * this machine to find out.
   */
  public async listInstalled(): Promise<InstalledSpellcheckDictionary[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.root);
    } catch {
      // Nothing downloaded yet. Not an error - it is the state every machine starts in.
      return [];
    }
    const installed: InstalledSpellcheckDictionary[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) {
        continue;
      }
      const code = name.slice(0, -".json".length);
      if (!SPELLCHECK_CODE_PATTERN.test(code)) {
        continue;
      }
      const manifest = await this.readManifest(code);
      const bytes = await fs
        .stat(this.wordsPath(code))
        .then((stat) => stat.size)
        .catch(() => -1);
      if (!manifest || bytes < 0) {
        // A manifest with no word list beside it (an interrupted download) describes
        // nothing that can be checked against, so it is not offered as installed.
        continue;
      }
      installed.push({ code, name: manifest.name, bytes });
    }
    return installed.sort((left, right) =>
      left.code < right.code ? -1 : left.code > right.code ? 1 : 0
    );
  }

  /** The word list as text, or `null` when this language is not installed. */
  public async readWords(code: string): Promise<string | null> {
    if (!SPELLCHECK_CODE_PATTERN.test(code)) {
      return null;
    }
    let compressed: Buffer;
    try {
      compressed = await fs.readFile(this.wordsPath(code));
    } catch {
      return null;
    }
    // A gzip stream declares nothing trustworthy about its expanded size, so the ceiling is
    // applied to the output. Without it a 700 KB file of one repeated word - which compresses
    // at better than 1000:1 - would be a way to exhaust main's heap from the registry.
    const expanded = await gunzipAsync(compressed, {
      maxOutputLength: SPELLCHECK_MAX_EXPANDED_BYTES
    });
    return expanded.toString("utf-8");
  }

  /**
   * Store one downloaded dictionary.
   *
   * The word list is written first and the manifest second, because {@link listInstalled} treats
   * a manifest as the claim that both are there: in that order an interrupted write leaves an
   * unclaimed file, and in the other it would leave a language that reads as installed and cannot
   * be loaded.
   */
  public async write(entry: SpellcheckRegistryEntry, compressed: Buffer): Promise<void> {
    if (!SPELLCHECK_CODE_PATTERN.test(entry.code)) {
      throw new Error(`Refusing a dictionary code that cannot be a filename: "${entry.code}"`);
    }
    await fs.mkdir(this.root, { recursive: true });
    await fs.writeFile(this.wordsPath(entry.code), compressed);
    const manifest: DictionaryManifest = {
      code: entry.code,
      name: entry.name,
      license: entry.license,
      sha256: entry.sha256,
      source: entry.download,
      installedAt: Date.now()
    };
    await fs.writeFile(this.manifestPath(entry.code), JSON.stringify(manifest, null, 4), "utf-8");
  }

  /** Delete one dictionary. `false` means there was nothing to delete. */
  public async remove(code: string): Promise<boolean> {
    if (!SPELLCHECK_CODE_PATTERN.test(code)) {
      return false;
    }
    const existed =
      (await this.exists(this.manifestPath(code))) || (await this.exists(this.wordsPath(code)));
    // The manifest goes first, for the same reason it is written last: from the moment it is
    // gone the language is not installed, whatever happens to the bytes afterwards.
    await fs.rm(this.manifestPath(code), { force: true });
    await fs.rm(this.wordsPath(code), { force: true });
    return existed;
  }

  private exists(file: string): Promise<boolean> {
    return fs
      .access(file)
      .then(() => true)
      .catch(() => false);
  }

  public async readManifest(code: string): Promise<DictionaryManifest | null> {
    if (!SPELLCHECK_CODE_PATTERN.test(code)) {
      return null;
    }
    try {
      const raw = JSON.parse(
        await fs.readFile(this.manifestPath(code), "utf-8")
      ) as Partial<DictionaryManifest>;
      if (!raw || typeof raw !== "object" || typeof raw.code !== "string") {
        return null;
      }
      return {
        code: raw.code,
        name: typeof raw.name === "string" && raw.name ? raw.name : raw.code,
        license: typeof raw.license === "string" ? raw.license : "",
        sha256: typeof raw.sha256 === "string" ? raw.sha256 : "",
        source: typeof raw.source === "string" ? raw.source : "",
        installedAt: typeof raw.installedAt === "number" ? raw.installedAt : 0
      };
    } catch {
      return null;
    }
  }

  private wordsPath(code: string): string {
    return path.join(this.root, `${code}.txt.gz`);
  }

  private manifestPath(code: string): string {
    return path.join(this.root, `${code}.json`);
  }
}
