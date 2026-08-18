import { describe, expect, it, vi } from "vitest";
import type { Game, PuppetBackend } from "narraleaf-react";
import {
  isPuppetBackend,
  loadPuppetBackends,
  type PuppetBackendModuleSource
} from "./puppetBackendHost";

/** Enough of a `Game` to register backends into; the real one needs a DOM and a React tree. */
function fakeGame(): Game & { registered: PuppetBackend[] } {
  const registered: PuppetBackend[] = [];
  const game = {
    registered,
    registerPuppetBackend(backend: PuppetBackend) {
      registered.push(backend);
      return game;
    },
    getPuppetBackend(name: string) {
      return registered.find((backend) => backend.name === name) ?? null;
    },
    listPuppetBackends() {
      return registered.map((backend) => backend.name);
    }
  };
  return game as unknown as Game & { registered: PuppetBackend[] };
}

/**
 * A backend module as a `data:` URL. The loader's only requirement of a module is that the runtime
 * can import it, so this exercises the real `import()` rather than a stubbed one.
 */
function moduleSource(id: string, source: string): PuppetBackendModuleSource {
  return {
    id,
    url: `data:text/javascript;base64,${Buffer.from(source, "utf-8").toString("base64")}`,
    resolveFile: (relativePath) => Promise.resolve(`resolved:${relativePath}`)
  };
}

const silent = { log: () => undefined };

describe("isPuppetBackend", () => {
  it("accepts anything with a name and a mount, and nothing else", () => {
    expect(isPuppetBackend({ name: "x", mount: () => undefined })).toBe(true);
    expect(isPuppetBackend({ name: "", mount: () => undefined })).toBe(false);
    expect(isPuppetBackend({ name: "x" })).toBe(false);
    expect(isPuppetBackend(null)).toBe(false);
  });
});

describe("loadPuppetBackends", () => {
  it("registers a default-exported backend object", async () => {
    const game = fakeGame();
    const results = await loadPuppetBackends(
      game,
      [moduleSource("plain", "export default { name: 'renderer-a', mount() { return {}; } };")],
      silent
    );

    expect(results).toEqual([{ moduleId: "plain", ok: true, backends: ["renderer-a"] }]);
    expect(game.listPuppetBackends()).toEqual(["renderer-a"]);
  });

  it("calls a factory with the game and the module's file resolver", async () => {
    const game = fakeGame();
    await loadPuppetBackends(
      game,
      [
        moduleSource(
          "factory",
          `export default async ({ game, resolveFile }) => [{
                name: 'renderer-b',
                mount() { return {}; },
                probe: { sawGame: typeof game.registerPuppetBackend === 'function', file: await resolveFile('atlas') },
            }];`
        )
      ],
      silent
    );

    const backend = game.getPuppetBackend("renderer-b") as PuppetBackend & {
      probe: { sawGame: boolean; file: string };
    };
    expect(backend.probe).toEqual({ sawGame: true, file: "resolved:atlas" });
  });

  it("reports a module that exports nothing usable without throwing", async () => {
    const game = fakeGame();
    const results = await loadPuppetBackends(
      game,
      [moduleSource("broken", "export default { name: 'no-mount' };")],
      silent
    );

    expect(results[0]!.ok).toBe(false);
    expect(game.listPuppetBackends()).toEqual([]);
  });

  it("keeps loading after a module fails, so one bad runtime cannot cost the others", async () => {
    const game = fakeGame();
    const log = vi.fn();
    const results = await loadPuppetBackends(
      game,
      [
        {
          id: "missing",
          url: "data:text/javascript;base64,***not-base64***",
          resolveFile: () => Promise.reject(new Error("no"))
        },
        moduleSource("good", "export default { name: 'renderer-c', mount() { return {}; } };")
      ],
      { log }
    );

    expect(results[0]!.ok).toBe(false);
    expect(results[1]!.ok).toBe(true);
    expect(game.listPuppetBackends()).toEqual(["renderer-c"]);
    expect(log).toHaveBeenCalledWith("error", expect.stringContaining("[puppet:missing]"));
  });
});
