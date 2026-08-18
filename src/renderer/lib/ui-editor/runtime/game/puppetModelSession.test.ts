import { describe, expect, it, vi } from "vitest";
import type { Game, PuppetBackend, PuppetMountContext } from "narraleaf-react";
import {
  PuppetBackendUnavailableError,
  createPuppetModelSession,
  type PuppetModelSessionOptions
} from "./puppetModelSession";

/**
 * Enough of a `Game` to register backends into.
 *
 * That this suffices *is* the design claim: describing a model needs a mounted backend, not a
 * running game, and the only thing the engine is still needed for is reading a module's export
 * shape. If this ever has to grow a `Player`, the mechanism was wrong.
 */
function fakeGame(): Game {
  const registered: PuppetBackend[] = [];
  const game = {
    registerPuppetBackend(backend: PuppetBackend) {
      registered.push(backend);
      return game;
    },
    getPuppetBackend: (name: string) => registered.find((backend) => backend.name === name) ?? null,
    listPuppetBackends: () => registered.map((backend) => backend.name)
  };
  return game as unknown as Game;
}

/** A container that records what a backend did to it, with no DOM in sight. */
function fakeContainer() {
  const container = {
    children: [] as unknown[],
    replaceChildren: vi.fn(() => {
      container.children = [];
    })
  };
  return container as unknown as HTMLDivElement & { replaceChildren: ReturnType<typeof vi.fn> };
}

function moduleUrl(source: string): string {
  return `data:text/javascript;base64,${Buffer.from(source, "utf-8").toString("base64")}`;
}

function options(
  source: string,
  patch: Partial<PuppetModelSessionOptions> = {}
): PuppetModelSessionOptions {
  return {
    container: fakeContainer(),
    source: {
      id: "runtime-a",
      url: moduleUrl(source),
      resolveFile: (relativePath) => Promise.resolve(`resolved:${relativePath}`)
    },
    backend: "renderer-a",
    src: "app://fs/grant/models/alice/alice.model.json",
    options: { atlas: "alice.atlas" },
    size: { width: 320, height: 480 },
    gameFactory: fakeGame,
    ...patch
  };
}

/**
 * A backend that reports the mount context it was handed. This is what proves the editor can build
 * a `PuppetMountContext` itself — every member of it is a host-supplied value.
 */
const REPORTING_BACKEND = `
globalThis.__seen = null;
export default {
    name: "renderer-a",
    mount(container, ctx) {
        globalThis.__seen = ctx;
        container.children.push("canvas");
        return {
            ready: () => Promise.resolve(),
            apply(state) { globalThis.__applied = state; },
            command() {},
            resize(size) { globalThis.__resized = size; },
            describe: () => Promise.resolve({
                motions: ["walk", "run"],
                expressions: [],
                skins: ["default"],
                params: [{ id: "timeScale", min: 0, max: 4, default: 1 }],
                size: { width: 470, height: 700 },
            }),
            dispose() { globalThis.__disposed = true; },
        };
    },
};
`;

describe("createPuppetModelSession", () => {
  it("mounts a model and describes it with no game running", async () => {
    const session = await createPuppetModelSession(options(REPORTING_BACKEND));

    expect(session.describable).toBe(true);
    await expect(session.describe()).resolves.toMatchObject({
      motions: ["walk", "run"],
      skins: ["default"]
    });
  });

  it("hands the backend the mount context the engine would have", async () => {
    await createPuppetModelSession(options(REPORTING_BACKEND));
    const seen = (globalThis as unknown as { __seen: PuppetMountContext }).__seen;

    expect(seen.src).toBe("app://fs/grant/models/alice/alice.model.json");
    expect(seen.options).toEqual({ atlas: "alice.atlas" });
    expect(seen.size).toEqual({ width: 320, height: 480 });
    // Studio's sources are already URLs this window can fetch; there is no preload cache to
    // consult, so the identity is the right answer rather than a stub.
    expect(seen.resolveSrc("whatever")).toBe("whatever");
  });

  it("resolves siblings against the bundle root, the way the engine does", async () => {
    await createPuppetModelSession(options(REPORTING_BACKEND));
    const seen = (globalThis as unknown as { __seen: PuppetMountContext }).__seen;

    expect(seen.resolveSibling("alice.atlas")).toBe("app://fs/grant/models/alice/alice.atlas");
    expect(seen.resolveSibling("textures/page-0.png")).toBe(
      "app://fs/grant/models/alice/textures/page-0.png"
    );
    expect(seen.resolveSibling("../shared/eyes.png")).toBe("app://fs/grant/models/shared/eyes.png");
    expect(seen.resolveSibling("https://cdn/x.png")).toBe("https://cdn/x.png");
  });

  it("empties the container on dispose even when the backend throws on the way out", async () => {
    const container = fakeContainer();
    const warnings: string[] = [];
    const session = await createPuppetModelSession(
      options(
        `
            export default {
                name: "renderer-a",
                mount() {
                    return { ready: () => Promise.resolve(), apply() {}, command() {}, resize() {},
                        dispose() { throw new Error("backend blew up"); } };
                },
            };
        `,
        { container, onWarn: (warning) => warnings.push(warning.message) }
      )
    );

    expect(() => session.dispose()).not.toThrow();
    expect(container.replaceChildren).toHaveBeenCalled();
    expect(warnings).toContain("backend blew up");
    // Disposing twice must not run the backend's dispose again.
    session.dispose();
    expect(warnings).toHaveLength(1);
  });

  it("reports a backend that does not describe its models, rather than pretending", async () => {
    const session = await createPuppetModelSession(
      options(`
            export default {
                name: "renderer-a",
                mount() { return { ready: () => Promise.resolve(), apply() {}, command() {}, resize() {}, dispose() {} }; },
            };
        `)
    );

    expect(session.describable).toBe(false);
    await expect(session.describe()).rejects.toThrow(/does not describe/);
  });

  it("fails loudly when the module registers nothing under the requested name", async () => {
    await expect(
      createPuppetModelSession(
        options(`
            export default { name: "some-other-renderer", mount() { return {}; } };
        `)
      )
    ).rejects.toBeInstanceOf(PuppetBackendUnavailableError);
  });

  it("fails loudly when the module itself is broken", async () => {
    // `loadPuppetBackends` swallows this so a running game still starts; an editor lookup has
    // somewhere better to put it than the stage does.
    await expect(
      createPuppetModelSession(options("throw new Error('nope');"))
    ).rejects.toBeInstanceOf(PuppetBackendUnavailableError);
  });

  it("gives up on a backend that never answers", async () => {
    vi.useFakeTimers();
    try {
      const session = await createPuppetModelSession(
        options(`
                export default {
                    name: "renderer-a",
                    mount() {
                        return { ready: () => new Promise(() => {}), apply() {}, command() {}, resize() {},
                            describe: () => new Promise(() => {}), dispose() {} };
                    },
                };
            `)
      );
      // The expectation is attached before the clock moves: a rejection with no handler at
      // the tick it settles is reported as unhandled even though it is awaited a line later.
      const pending = expect(session.describe()).rejects.toThrow(/did not describe/);
      await vi.advanceTimersByTimeAsync(21_000);
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });

  it("pushes a complete state through to the backend", async () => {
    const session = await createPuppetModelSession(options(REPORTING_BACKEND));
    await session.apply({
      motion: "walk",
      expression: null,
      skin: "default",
      params: {},
      slots: {}
    });

    expect((globalThis as unknown as { __applied: unknown }).__applied).toEqual({
      motion: "walk",
      expression: null,
      skin: "default",
      params: {},
      slots: {}
    });
  });
});
