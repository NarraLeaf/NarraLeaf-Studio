/**
 * One live model, mounted by the editor rather than by a game.
 *
 * ## Why this is not a game
 *
 * `PuppetInstance.describe()` needs a *mounted* backend, and the obvious reading of that is "so the
 * editor needs a running game". It does not. Read the seam again: a `PuppetBackend` is
 * `{ name, mount(container: HTMLDivElement, ctx: PuppetMountContext) }`, and every member of
 * `PuppetMountContext` — `src`, `options`, `size`, `resolveSrc`, `resolveSibling`, `warn` — is a
 * value or a function the *host* supplies. The engine builds that object when a `Puppet` element
 * mounts; nothing about it is private to the engine. The module's own doc says so outright: the
 * contract is "the whole of what a renderer has to satisfy, so a host can take these types on their
 * own".
 *
 * So Studio hands a backend a `<div>` and a context it built itself. No `Player`, no `Story`, no
 * scene, no UI surface, no `designSize`, no boot sequence, no save adapter — none of which an
 * inspector has, and all of which mounting `GameApp` would have demanded (`mountNlrSession` throws
 * outright when `bundle.ui.uidoc.surfaces` is empty).
 *
 * The one thing the engine is still needed for is *registration*: a backend module's factory is
 * handed a `Game`, and `loadPuppetBackends` is the tested reader of every export shape a module may
 * use. A `Game` that never mounts a `Player` is a configuration holder, so one is constructed as the
 * registration sink and dropped afterwards. That keeps module loading in exactly one place instead
 * of forking a second, quietly-different reader for the editor.
 *
 * ## What a session is for
 *
 * Both of the editor's needs, from one mount:
 *
 * - **Describe** — ask the model what it contains, so controls can be filled from it.
 * - **Show** — the same instance drawn into a visible container is a preview, which the character
 *   editor otherwise has none of. Nothing extra is built for it; a preview is just a session whose
 *   container is on screen.
 *
 * Nothing here names a renderer, and nothing here may. A backend is any ES module that yields the
 * engine's `PuppetBackend`.
 *
 * ## Why it lives under `lib/ui-editor` rather than under `lib/workspace/services`
 *
 * Because the packaged game runtime has to be able to reach it. Nothing in here touches a workspace
 * service, a project, or the DOM beyond the container it is handed — every host-specific decision
 * (which module, which URL, how big) arrives as an argument — so it is shared code, and the runtime
 * bundle's import guard (`runtimeAliasPlugin` in `project/build/build-runtime.js`) only lets the
 * runtime see Studio renderer modules that live here.
 */

import { Game } from "narraleaf-react";
import type { PuppetDescription, PuppetSize, PuppetState } from "narraleaf-react";
import type { PuppetBackendModuleSource } from "./puppetBackendHost";
import { loadPuppetBackends } from "./puppetBackendHost";
import { resolveBundleEntry } from "./storyCompiler";

/** How long a `describe()` may take before the editor gives up and falls back to free text. */
export const PUPPET_DESCRIBE_TIMEOUT_MS = 20_000;

export type PuppetSessionWarning = { level: "warning" | "error"; message: string };

export interface PuppetModelSessionOptions {
    /** Where the backend draws. The backend owns its interior and it is emptied on dispose. */
    container: HTMLDivElement;
    /** The module and its sibling resolver, as `loadPuppetBackends` wants them. */
    source: PuppetBackendModuleSource;
    /** Which registered backend to mount — the name the puppet's config refers to. */
    backend: string;
    /** The resource descriptor, passed through verbatim. Studio hands over the bundle's entry-file URL. */
    src: string;
    /** The author's options for this backend, passed through verbatim. */
    options: Record<string, unknown>;
    /** The logical size of the box. */
    size: PuppetSize;
    onWarn?: (warning: PuppetSessionWarning) => void;
    /**
     * Where loaded backends are registered. Injectable precisely because it is only a registration
     * sink — nothing here mounts a `Player` against it — which is also the claim this module's
     * design rests on, so a test gets to hold it to that.
     */
    gameFactory?: () => Game;
}

export interface PuppetModelSession {
    /** Ask the model what it contains. Rejects when the backend has none, or when it will not answer. */
    describe(): Promise<PuppetDescription>;
    /** Whether the backend implements `describe()` at all. */
    describable: boolean;
    /** Push a complete state. The backend re-poses; the engine's `apply` contract applies unchanged. */
    apply(state: PuppetState): void | Promise<void>;
    /**
     * Settles when the backend has drawn its first frame, per the engine's lifecycle.
     *
     * Exposed rather than swallowed because a host that only knows "mount returned" cannot tell
     * `loading` from `ready`, and those are two different pictures to show an author. Resolves
     * immediately for a backend that implements no `ready()` — the engine checks for it the same way.
     * Call order matches the engine's: `apply()` the complete initial state first, then this.
     */
    ready(): Promise<void>;
    resize(size: PuppetSize): void;
    dispose(): void;
}

export class PuppetBackendUnavailableError extends Error {
    constructor(public readonly backend: string) {
        super(`No puppet backend named "${backend}" was registered by the module`);
        this.name = "PuppetBackendUnavailableError";
    }
}

/**
 * The context the engine would have built, built by the editor instead.
 *
 * `resolveSrc` is the identity here, and that is the correct answer rather than a stub: the engine's
 * version looks a source up in the *preload cache* before handing it back untouched, and an editor
 * has no preload cache — every source Studio puts in `src` is already a URL this window can fetch.
 *
 * `resolveSibling` is the same arithmetic the story compiler applies to an entry override, reused
 * rather than re-derived so the two can never disagree about where a bundle's root is.
 */
function createMountContext(
    options: PuppetModelSessionOptions,
    warn: (message: string, detail?: unknown) => void,
) {
    return {
        src: options.src,
        options: options.options,
        size: options.size,
        resolveSrc: (src: string) => src,
        resolveSibling: (relativePath: string) => resolveBundleEntry(options.src, relativePath),
        warn,
    };
}

/**
 * Load a backend module, mount one model from it, and hand back the handle.
 *
 * Rejects rather than degrading: every caller here has somewhere better to put the failure than the
 * stage does. `loadPuppetBackends` still swallows a broken module the way a running game needs it
 * to, so a rejection from this function is either "the module registered nothing under that name"
 * or "mount threw".
 */
export async function createPuppetModelSession(
    options: PuppetModelSessionOptions,
): Promise<PuppetModelSession> {
    const report = (level: PuppetSessionWarning["level"], message: string) =>
        options.onWarn?.({ level, message });

    // A registration sink, not a running game: no Player is ever mounted against it, so it stays a
    // configuration object holding the backend table `loadPuppetBackends` writes into.
    const game = options.gameFactory ? options.gameFactory() : new Game({ app: { debug: false } });
    await loadPuppetBackends(game, [options.source], {
        log: (level, message) => {
            if (level !== "info") {
                report(level, message);
            }
        },
    });

    const backend = game.getPuppetBackend(options.backend);
    if (!backend) {
        throw new PuppetBackendUnavailableError(options.backend);
    }

    const instance = backend.mount(options.container, createMountContext(options, (message, detail) => {
        report("warning", detail === undefined ? message : `${message} (${String(detail)})`);
    }));

    let disposed = false;
    return {
        describable: typeof instance.describe === "function",
        describe: async (): Promise<PuppetDescription> => {
            if (typeof instance.describe !== "function") {
                throw new Error("This runtime does not describe its models");
            }
            // Nothing gates `describe()` on status by design - a backend that can only answer for a
            // loaded model awaits its own load inside it. Which means a backend whose load never
            // settles would hang the editor's lookup forever, so the wait is bounded here.
            let timer: ReturnType<typeof setTimeout> | undefined;
            const answer = Promise.resolve(instance.describe());
            // The loser of the race is abandoned, not cancelled - a backend that rejects a second
            // after the deadline would otherwise surface as an unhandled rejection with no owner.
            answer.catch(() => undefined);
            try {
                const settled = await Promise.race([
                    answer.then(value => ({ described: value })),
                    new Promise<{ timedOut: true }>(resolve => {
                        timer = setTimeout(() => resolve({ timedOut: true }), PUPPET_DESCRIBE_TIMEOUT_MS);
                    }),
                ]);
                if ("timedOut" in settled) {
                    throw new Error(`The runtime did not describe the model within ${PUPPET_DESCRIBE_TIMEOUT_MS}ms`);
                }
                return settled.described;
            } finally {
                if (timer !== undefined) {
                    clearTimeout(timer);
                }
            }
        },
        apply: (state: PuppetState) => instance.apply(state),
        ready: () => Promise.resolve(instance.ready?.()),
        resize: (size: PuppetSize) => instance.resize?.(size),
        dispose: () => {
            if (disposed) {
                return;
            }
            disposed = true;
            try {
                instance.dispose();
            } catch (error) {
                // A backend that throws on the way out has already been abandoned; the container is
                // cleared regardless so a half-disposed WebGL canvas cannot outlive the editor panel.
                report("warning", error instanceof Error ? error.message : String(error));
            }
            options.container.replaceChildren();
        },
    };
}
