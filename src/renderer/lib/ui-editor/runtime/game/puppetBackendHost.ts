/**
 * Host side of the engine's puppet seam.
 *
 * The engine draws a puppet by handing its box to a *backend* the host registered
 * (`Game.registerPuppetBackend`). It ships none and understands none: `src`, `options`, command
 * names and payloads are opaque values it stores and forwards. Studio ships none either — and
 * that is deliberate rather than incidental. The renderers authors want for animated characters
 * are distributed under licences that a source-available, freely modifiable application cannot
 * carry — see the licensing survey in `docs/plans/`, card 2026-07-27-002. So the author supplies
 * the runtime, exactly as they do under Ren'Py or TyranoScript, and this module is the whole of
 * what Studio contributes: find what the author put in their project, load it, hand it the game.
 *
 * Nothing here names a renderer, and nothing here is allowed to. A backend module is any ES module
 * the host can import; the only thing Studio asks of it is that it yields objects satisfying the
 * engine's `PuppetBackend`.
 *
 * ## What a backend module looks like from the author's side
 *
 * ```js
 * // <project>/runtimes/puppet/<name>/index.js
 * export default function createBackends({ game, resolveFile, log }) {
 *     return {
 *         name: "my-renderer",
 *         mount(container, ctx) { ... }   // engine's PuppetBackend
 *     };
 * }
 * ```
 *
 * The default export may equally be a backend object, an array of them, or a promise of either;
 * `puppetBackend` / `puppetBackends` / `createPuppetBackends` are accepted as named alternatives so
 * a module that also exports other things does not have to give up its default slot.
 *
 * A module is loaded once per `Game` — Studio mints a new one per session and per relaunch — so a
 * backend never has to reason about which game it is drawing for.
 */

import { DevTools, Puppet } from "narraleaf-react";
import type { Game, GameState, IPuppetUserConfig, PuppetBackend, PuppetState, PuppetStatus } from "narraleaf-react";

export type PuppetBackendLogLevel = "info" | "warning" | "error";

/**
 * One backend module the host found. Discovery is the host's job (a Dev Mode window scans the
 * project; a packaged game reads what was published with it), so this is deliberately a plain
 * description of "a module and where it came from" rather than a filesystem path.
 */
export type PuppetBackendModuleSource = {
    /** Stable identifier for diagnostics — conventionally the directory the module came from. */
    id: string;
    /** A URL the renderer can `import()`. */
    url: string;
    /**
     * Resolve a file that lives next to the module into a URL the renderer can fetch.
     *
     * This exists because the engine cannot provide it. `PuppetMountContext.resolveSrc` resolves a
     * single source through the image preload cache, which is the right answer for a one-file
     * asset and no answer at all for the multi-file bundles these runtimes actually consume — a
     * skeleton plus an atlas plus its texture pages, a model plus its motions and physics. The
     * backend knows which siblings it needs only after it has parsed the first one, so it needs to
     * ask, and this is what it asks.
     *
     * Rejects when the path escapes the module's own directory or the host cannot serve it.
     */
    resolveFile: (relativePath: string) => Promise<string>;
};

/** What a backend module's factory is handed. */
export type PuppetBackendHostContext = {
    /** The game these backends are being registered into. */
    game: Game;
    /** See {@link PuppetBackendModuleSource.resolveFile}. */
    resolveFile: (relativePath: string) => Promise<string>;
    /** Report progress or trouble to the host's console. */
    log: (level: PuppetBackendLogLevel, message: string) => void;
};

export type PuppetBackendFactory = (
    context: PuppetBackendHostContext,
) => PuppetBackend | PuppetBackend[] | Promise<PuppetBackend | PuppetBackend[] | void> | void;

export type PuppetBackendLoadResult =
    | { moduleId: string; ok: true; backends: string[] }
    | { moduleId: string; ok: false; error: string };

type PuppetBackendModule = {
    default?: unknown;
    puppetBackend?: unknown;
    puppetBackends?: unknown;
    createPuppetBackends?: unknown;
};

/**
 * Duck-typed rather than `instanceof`: a backend module is compiled separately from Studio and
 * from the engine, so it shares no class identity with either. `mount` and a non-empty `name` are
 * the whole of the engine's contract.
 */
export function isPuppetBackend(value: unknown): value is PuppetBackend {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const candidate = value as { name?: unknown; mount?: unknown };
    return typeof candidate.name === "string"
        && candidate.name.trim().length > 0
        && typeof candidate.mount === "function";
}

/**
 * Turn whatever a module exported into a list of backends.
 *
 * Functions are treated as factories and called with the host context; everything else is taken as
 * a value. A factory that returns nothing has registered by other means (or decided this game is
 * not for it), which is not an error.
 */
async function resolveModuleExport(
    value: unknown,
    context: PuppetBackendHostContext,
): Promise<PuppetBackend[]> {
    const produced = typeof value === "function"
        ? await (value as PuppetBackendFactory)(context)
        : await value;
    if (produced === undefined || produced === null) {
        return [];
    }
    const candidates = Array.isArray(produced) ? produced : [produced];
    const backends: PuppetBackend[] = [];
    for (const candidate of candidates) {
        if (!isPuppetBackend(candidate)) {
            throw new Error(
                "A puppet backend must be an object with a non-empty `name` and a `mount(container, ctx)` method",
            );
        }
        backends.push(candidate);
    }
    return backends;
}

function readModuleExport(module: PuppetBackendModule): unknown {
    if (module.createPuppetBackends !== undefined) {
        return module.createPuppetBackends;
    }
    if (module.puppetBackends !== undefined) {
        return module.puppetBackends;
    }
    if (module.puppetBackend !== undefined) {
        return module.puppetBackend;
    }
    return module.default;
}

/**
 * Load every discovered backend module and register what it yields with `game`.
 *
 * Never throws: a project whose author-supplied runtime is broken or missing must still start. The
 * engine already degrades a puppet with no backend to an empty box that keeps its place, its
 * transform and its saved state, so the cost of a failed load is a warning and a character that
 * does not draw — not a stage that does not come up. Failures come back in the results so a host
 * can surface them where the author will see them.
 *
 * Must be awaited before the game's `Player` mounts: a puppet resolves its backend once, when its
 * component mounts, and a backend that arrives afterwards is not picked up.
 */
export async function loadPuppetBackends(
    game: Game,
    sources: readonly PuppetBackendModuleSource[],
    options: { log: (level: PuppetBackendLogLevel, message: string) => void },
): Promise<PuppetBackendLoadResult[]> {
    const results: PuppetBackendLoadResult[] = [];
    for (const source of sources) {
        try {
            const module = await import(/* @vite-ignore */ source.url) as PuppetBackendModule;
            const context: PuppetBackendHostContext = {
                game,
                resolveFile: source.resolveFile,
                log: (level, message) => options.log(level, `[puppet:${source.id}] ${message}`),
            };
            const backends = await resolveModuleExport(readModuleExport(module), context);
            const registered: string[] = [];
            for (const backend of backends) {
                if (game.getPuppetBackend(backend.name)) {
                    options.log(
                        "warning",
                        `[puppet:${source.id}] a backend named "${backend.name}" is already registered; `
                        + "the later one replaces it",
                    );
                }
                game.registerPuppetBackend(backend);
                registered.push(backend.name);
            }
            if (registered.length === 0) {
                options.log(
                    "warning",
                    `[puppet:${source.id}] module exported no puppet backend`,
                );
            } else {
                options.log("info", `[puppet:${source.id}] registered: ${registered.join(", ")}`);
            }
            results.push({ moduleId: source.id, ok: true, backends: registered });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            options.log("error", `[puppet:${source.id}] failed to load: ${message}`);
            results.push({ moduleId: source.id, ok: false, error: message });
        }
    }
    return results;
}

/**
 * A running stage's puppets, as a host console can reach them.
 *
 * Studio has no authoring surface for puppets yet — a character's appearance cannot be declared as
 * one, so nothing the story compiler emits ever puts a `Puppet` in the action tree. Until that
 * lands, this is how anyone (a developer bringing up a backend, this module's own tests) gets one
 * onto a live stage and drives it: the engine's editor seam, `DevTools`, which exists for exactly
 * this — registering an element outside the tree and pushing state to it without going through an
 * action.
 *
 * Everything here is a thin pass-through. When the authoring surface arrives, the story compiler
 * takes over placing puppets and only {@link PuppetStageHandle.describe} is likely to outlive this
 * type, as the thing an inspector fills its dropdowns from.
 */
export type PuppetStageHandle = {
    /** Backend names registered on this game. */
    backends: () => string[];
    /**
     * Put a puppet on the stage at once, in the current scene, on the default layer.
     *
     * `id` must be unique: elements registered this way are outside the story's action tree, so
     * they never receive a generated id and would otherwise collide as React keys.
     */
    spawn: (id: string, config: Partial<IPuppetUserConfig> & { backend: string; src: string }) => Puppet;
    /** Merge a patch into a puppet's state and push it to the backend immediately. */
    setState: (puppet: Puppet, patch: Partial<PuppetState>) => void;
    /** Run a backend command and wait for it. */
    command: (puppet: Puppet, name: string, payload?: unknown) => Promise<void>;
    /** What the backend says about the model — motions, skins, parameters. Null when it cannot say. */
    describe: (puppet: Puppet) => Promise<unknown>;
    status: (puppet: Puppet) => PuppetStatus;
};

export function createPuppetStageHandle(game: Game, gameState: GameState): PuppetStageHandle {
    return {
        backends: () => game.listPuppetBackends(),
        spawn: (id, config) => {
            const puppet = new Puppet(config);
            DevTools.setElementId(puppet, id);
            DevTools.registerDisplayable(gameState, puppet);
            return puppet;
        },
        setState: (puppet, patch) => DevTools.setPuppetState(gameState, puppet, patch),
        command: (puppet, name, payload) => DevTools.runPuppetCommand(gameState, puppet, name, payload),
        describe: puppet => DevTools.describePuppet(gameState, puppet),
        status: puppet => DevTools.getPuppetStatus(puppet),
    };
}
