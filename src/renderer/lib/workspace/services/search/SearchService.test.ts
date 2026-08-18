import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchIndexEngine } from "./SearchService";
import type { SearchInvalidation, SearchSource } from "./searchSource";
import type { SearchIndexEntry } from "./searchIndexModel";
import type { WorkspaceContext } from "../services";

/**
 * The acceptance criterion of the refactor, written as a test.
 *
 * Every source below is invented on the spot. None of them is registered anywhere, none of them
 * required a line of {@link SearchIndexEngine} to change, and all of them are searchable, deduped and
 * incrementally rebuilt by the same machinery the six real ones go through. If this file passes, then
 * "make a new kind of thing searchable" is one descriptor plus one line in `searchSources.ts`.
 */

/** Sources here never touch the workspace, so the context is never read. */
const ctx = {} as WorkspaceContext;

function entry(id: string, text: string, detail?: string): SearchIndexEntry {
  return { id, group: "asset", text, detail, target: { kind: "localizationKey", keyName: id } };
}

/** Let every pending microtask settle; the timer callbacks that start a rebuild are not awaited. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

function titlesOf(engine: SearchIndexEngine, query: string): string[] {
  return engine.search(query).flatMap((group) => group.hits.map((hit) => hit.entry.text));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("registering a new kind of searchable thing", () => {
  it("indexes a source that nothing in the engine knows about", async () => {
    const pluginManifestSource: SearchSource = {
      id: "pluginManifest",
      groups: ["asset"],
      extract: () => [
        entry("plugin:steam", "Steam Achievements", "narraleaf-steam"),
        entry("plugin:live2d", "Live2D Adapter", "narraleaf-live2d")
      ],
      watch: () => () => {}
    };

    const engine = new SearchIndexEngine(ctx, [pluginManifestSource]);
    await engine.ensureReady();

    expect(engine.isReady()).toBe(true);
    expect(engine.size()).toBe(2);
    expect(titlesOf(engine, "steam")).toEqual(["Steam Achievements"]);
    // The context line is searched too, at the framework's own weighting.
    expect(titlesOf(engine, "narraleaf")).toHaveLength(2);
  });

  it("applies the dedup rule a source declares, across the whole source", async () => {
    const source: SearchSource<string> = {
      id: "widget",
      groups: ["asset"],
      // Two slices, and the duplicate pair straddles them - which is exactly what per-slice
      // dedup could not see.
      partition: () => ["layer-1", "layer-2"],
      extract: (_ctx, key) =>
        key === "layer-1"
          ? [entry("w1", "Image", "Main Menu"), entry("w2", "Image", "Main Menu")]
          : [entry("w3", "Image", "Main Menu"), entry("w4", "Image", "Pause Menu")],
      watch: () => () => {},
      dedupKey: (e) => `${e.text}|${e.detail}`
    };

    const engine = new SearchIndexEngine(ctx, [source]);
    await engine.ensureReady();

    const hits = engine.search("image")[0].hits;
    expect(hits.map((hit) => hit.entry.detail)).toEqual(["Main Menu", "Pause Menu"]);
    const collapsed = hits.find((hit) => hit.entry.detail === "Main Menu")!.entry;
    expect(collapsed.count).toBe(3);
    // First wins: the jump goes to the first of the collapsed things.
    expect(collapsed.id).toBe("w1");
    expect(hits.find((hit) => hit.entry.detail === "Pause Menu")!.entry.count).toBeUndefined();
  });

  it("keeps a source's failure to itself", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken: SearchSource = {
      id: "broken",
      groups: ["asset"],
      extract: () => {
        throw new Error("unreadable");
      },
      watch: () => () => {}
    };
    const fine: SearchSource = {
      id: "fine",
      groups: ["asset"],
      extract: () => [entry("ok", "Still Here")],
      watch: () => () => {}
    };

    const engine = new SearchIndexEngine(ctx, [broken, fine]);
    await engine.ensureReady();

    expect(titlesOf(engine, "still")).toEqual(["Still Here"]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[SearchService]"),
      expect.any(Error)
    );
  });

  it("lets a partition failure fail the build, and does not poison the retry", async () => {
    let attempt = 0;
    const source: SearchSource<string> = {
      id: "flaky",
      groups: ["asset"],
      partition: () => {
        attempt += 1;
        if (attempt === 1) {
          throw new Error("library unreadable");
        }
        return ["only"];
      },
      extract: () => [entry("a", "Recovered")],
      watch: () => () => {}
    };

    const engine = new SearchIndexEngine(ctx, [source]);
    await expect(engine.ensureReady()).rejects.toThrow("library unreadable");
    expect(engine.isReady()).toBe(false);

    await engine.ensureReady();
    expect(titlesOf(engine, "recovered")).toEqual(["Recovered"]);
  });
});

describe("incremental rebuilds", () => {
  /** A source whose slices are read out of a mutable table, with a call log. */
  function tableSource(id: string, table: Record<string, string>, log: string[]) {
    let signal: SearchInvalidation<string> | null = null;
    const source: SearchSource<string> = {
      id,
      groups: ["asset"],
      partition: () => Object.keys(table),
      extract: (_ctx, key) => {
        log.push(`${id}:${key}`);
        return table[key] ? [entry(`${id}:${key}`, table[key])] : [];
      },
      watch: (_ctx, incoming) => {
        signal = incoming;
        return () => {
          signal = null;
        };
      }
    };
    return { source, signal: () => signal! };
  }

  it("rebuilds one slice of one source and nothing else", async () => {
    const log: string[] = [];
    const stories = { s1: "Chapter One", s2: "Chapter Two" };
    const assets = { a1: "background.webp" };
    const a = tableSource("story", stories, log);
    const b = tableSource("asset", assets, log);

    const engine = new SearchIndexEngine(ctx, [a.source, b.source]);
    await engine.ensureReady();
    expect(log.sort()).toEqual(["asset:a1", "story:s1", "story:s2"]);
    log.length = 0;

    stories.s1 = "Chapter One, revised";
    a.signal().invalidate("s1");
    await vi.advanceTimersByTimeAsync(300);
    await flush();

    expect(log).toEqual(["story:s1"]);
    expect(titlesOf(engine, "revised")).toEqual(["Chapter One, revised"]);
    expect(titlesOf(engine, "chapter two")).toEqual(["Chapter Two"]);
  });

  it("coalesces a burst of invalidations into one rebuild", async () => {
    const log: string[] = [];
    const a = tableSource("story", { s1: "Chapter One" }, log);
    const engine = new SearchIndexEngine(ctx, [a.source]);
    await engine.ensureReady();
    log.length = 0;

    a.signal().invalidate("s1");
    await vi.advanceTimersByTimeAsync(100);
    a.signal().invalidate("s1");
    await vi.advanceTimersByTimeAsync(100);
    a.signal().invalidate("s1");
    await vi.advanceTimersByTimeAsync(300);
    await flush();

    expect(log).toEqual(["story:s1"]);
  });

  it("re-partitions on invalidateAll, adding and dropping slices", async () => {
    const log: string[] = [];
    const table: Record<string, string> = { s1: "Chapter One", s2: "Chapter Two" };
    const a = tableSource("story", table, log);
    const engine = new SearchIndexEngine(ctx, [a.source]);
    await engine.ensureReady();
    expect(engine.size()).toBe(2);

    delete table.s2;
    table.s3 = "Chapter Three";
    a.signal().invalidateAll();
    await vi.advanceTimersByTimeAsync(300);
    await flush();

    expect(engine.size()).toBe(2);
    expect(titlesOf(engine, "chapter")).toEqual(["Chapter One", "Chapter Three"]);
  });

  it("notifies listeners on every rebuild, and drops the flat cache with them", async () => {
    const log: string[] = [];
    const table: Record<string, string> = { s1: "Chapter One" };
    const a = tableSource("story", table, log);
    const engine = new SearchIndexEngine(ctx, [a.source]);

    const seen: number[] = [];
    engine.onIndexChanged(() => seen.push(engine.size()));
    await engine.ensureReady();
    expect(seen).toEqual([1]);

    table.s1 = "";
    a.signal().invalidate("s1");
    await vi.advanceTimersByTimeAsync(300);
    await flush();
    expect(seen).toEqual([1, 0]);
  });

  it("drops a slow rebuild that a newer one overtook", async () => {
    const resolvers: Array<(entries: SearchIndexEntry[]) => void> = [];
    let signal: SearchInvalidation | null = null;
    const source: SearchSource = {
      id: "slow",
      groups: ["asset"],
      extract: () => new Promise<SearchIndexEntry[]>((resolve) => resolvers.push(resolve)),
      watch: (_ctx, incoming) => {
        signal = incoming;
        return () => {};
      }
    };

    const engine = new SearchIndexEngine(ctx, [source]);
    const ready = engine.ensureReady();
    resolvers[0]([entry("v0", "Original")]);
    await ready;

    // Two rebuilds in flight at once, the second started after the first.
    signal!.invalidate();
    await vi.advanceTimersByTimeAsync(300);
    signal!.invalidate();
    await vi.advanceTimersByTimeAsync(300);
    expect(resolvers).toHaveLength(3);

    // The newer one lands first; the older one must not overwrite it when it finally arrives.
    resolvers[2]([entry("v2", "Newest")]);
    await flush();
    resolvers[1]([entry("v1", "Stale")]);
    await flush();

    expect(titlesOf(engine, "e")).toEqual(["Newest"]);
  });

  it("stops watching and forgets everything on dispose", async () => {
    const log: string[] = [];
    const table: Record<string, string> = { s1: "Chapter One" };
    const a = tableSource("story", table, log);
    const engine = new SearchIndexEngine(ctx, [a.source]);
    await engine.ensureReady();
    const signal = a.signal();

    engine.dispose();
    expect(engine.size()).toBe(0);
    expect(engine.isReady()).toBe(false);

    log.length = 0;
    signal.invalidate("s1");
    await vi.advanceTimersByTimeAsync(300);
    await flush();
    expect(log).toEqual([]);
  });
});
