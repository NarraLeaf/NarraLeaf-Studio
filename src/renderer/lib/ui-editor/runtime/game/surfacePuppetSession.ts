/**
 * One Surface puppet widget's live model, in whichever host is drawing the widget.
 *
 * ## The problem this exists for
 *
 * A Surface widget renderer is *literally the same module* in two hosts: the editor canvas (Studio's
 * renderer, with workspace services) and the packaged game (the runtime bundle, with none). Mounting
 * a puppet needs three host-specific answers — which module is the author's runtime, which URL is the
 * model bundle's entry file, and how to serve the files next to each — and every existing path to
 * those answers goes through `Services.PuppetDescription`, which does not exist in a game.
 *
 * So the host-specific part is reduced to one injected function ({@link SurfacePuppetOpener}) and
 * everything else — the lifecycle, the overlap guard, the degradation rules — lives here, compiled
 * once and shared. The two hosts each supply an opener through the shim seam:
 * `@/lib/workspace/hooks/useSurfacePuppetSession` in Studio, and the file that displaces it in the
 * runtime bundle (`src/runtime/renderer/shims/useSurfacePuppetSession.ts`, aliased by
 * `runtimeAliasPlugin` in `project/build/build-runtime.js`).
 *
 * Nothing here names a renderer and nothing here may — see `puppetBackendHost.ts`.
 * The author supplies the drawing code; this decides when to ask it to draw.
 *
 * ## Status vocabulary is the engine's, not a new one
 *
 * {@link SurfacePuppetStatus} *is* the engine's `PuppetStatus`. A widget and a stage puppet that are
 * both "loading" mean the same thing, so an author reading one has learned the other, and the second
 * phase's `Status` blueprint node can answer with one vocabulary for both. The finer "why is there
 * nothing to draw" lives beside it in {@link SurfacePuppetSnapshot.reason} rather than as extra
 * statuses.
 *
 * ## Nothing to draw is not an error
 *
 * The engine's documented contract: a puppet whose backend nobody answers to "keeps its place on the
 * stage, its transform and its saved state, but draws nothing". Most projects carry no puppet runtime
 * at all, and a project written on one machine opens on another that never installed it — so an
 * unconfigured or unresolvable widget reaches `missing-backend` **quietly**: the box stays, nothing is
 * drawn, nothing throws, nothing is logged as a failure. `error` is reserved for a runtime that was
 * found and then misbehaved, which is the case an author can actually act on.
 */

import type { PuppetSize, PuppetState, PuppetStatus } from "narraleaf-react";
import type { PuppetModelSession } from "./puppetModelSession";
import { surfacePuppetSizeEquals, surfacePuppetStateEquals } from "./surfacePuppetIdentity";

/** The engine's vocabulary verbatim: `unmounted | missing-backend | loading | ready | error`. */
export type SurfacePuppetStatus = PuppetStatus;

/**
 * Why there is nothing drawn, when the status is `missing-backend`.
 *
 * Deliberately the same names `PuppetDescriptionUnavailableReason` uses for the same situations, so a
 * host that has one can hand it over unmapped. It is *not* that type: that one lives under
 * `lib/workspace/services`, which the runtime bundle is not allowed to import.
 */
export type SurfacePuppetUnavailableReason =
  /** No model bundle asset selected, or the asset/bundle cannot be resolved. */
  | "no-model"
  /** The widget names no backend. */
  | "no-backend"
  /** The named backend is not installed — no `runtimes/puppet/<name>/index.js` in this project or pack. */
  | "backend-missing";

/**
 * "There is nothing to mount, and that is a normal state."
 *
 * A typed error rather than a message, because the two hosts' openers both fail *before* mounting for
 * reasons a widget must degrade quietly over, and string-matching a flattened message to tell those
 * apart from a runtime that actually broke would be wrong in the direction that hurts: a project with
 * no runtime installed would render as a red error box.
 */
export class SurfacePuppetUnavailableError extends Error {
  constructor(
    public readonly reason: SurfacePuppetUnavailableReason,
    message?: string
  ) {
    super(message ?? reason);
    this.name = "SurfacePuppetUnavailableError";
  }
}

/** Which model, drawn by which of the author's runtimes. Host-independent; the opener resolves it. */
export interface SurfacePuppetRequest {
  /** The model bundle asset (`AssetType.Model`). */
  assetId: string | null;
  /** Backend name — a directory under the project's (or pack's) `runtimes/puppet/`. */
  backend: string;
  /** Entry override within the bundle; null/omitted uses the bundle's own declared entry. */
  entry?: string | null;
  /** The author's backend options, forwarded verbatim. */
  options?: Record<string, unknown>;
}

/**
 * The whole of what a host contributes.
 *
 * Rejects with {@link SurfacePuppetUnavailableError} for "nothing to mount", and with anything else
 * for "it broke". The container it is handed is already a fresh child of the widget's box — see
 * {@link SurfacePuppetMountOptions.createSurface}.
 */
export type SurfacePuppetOpener = (input: {
  request: SurfacePuppetRequest;
  container: HTMLDivElement;
  size: PuppetSize;
  onWarn: (message: string) => void;
}) => Promise<PuppetModelSession>;

export interface SurfacePuppetSnapshot {
  status: SurfacePuppetStatus;
  /** Set only when `status === "error"`. */
  error: string | null;
  /** Set only when `status === "missing-backend"`. */
  reason: SurfacePuppetUnavailableReason | null;
}

export const UNMOUNTED_SURFACE_PUPPET: SurfacePuppetSnapshot = {
  status: "unmounted",
  error: null,
  reason: null
};

export interface SurfacePuppetMountOptions {
  /** The widget's box. Attempts draw into children of it; its own other children are never touched. */
  host: HTMLElement;
  /**
   * Null means no host in this window can look a runtime up at all — see the chain in
   * `surfacePuppetHosts.ts`. Reported as `missing-backend`, quietly, because a host with no lookup
   * has not failed at anything, and it is the state every Surface is in before one of the arms
   * arrives.
   */
  open: SurfacePuppetOpener | null;
  /**
   * How an attempt's drawing surface is made. Injected for two reasons: a test drives this machine
   * with no DOM at all, and a host that wants a differently-styled surface does not have to fork
   * the state machine to get one.
   */
  createSurface?: () => HTMLDivElement;
  onChange?: (snapshot: SurfacePuppetSnapshot) => void;
  /** Backend `warn()` output and dispose trouble. Advisory: none of it changes the status. */
  onWarn?: (message: string) => void;
}

/** The default surface: fills the widget box and takes no clicks the widget did not ask for. */
function defaultCreateSurface(): HTMLDivElement {
  const surface = document.createElement("div");
  surface.style.cssText = "position:absolute;inset:0";
  return surface;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface MountAttempt {
  generation: number;
  surface: HTMLDivElement;
  cancelled: boolean;
  session: PuppetModelSession | null;
}

/**
 * The lifecycle of one widget's model: mount, re-pose, resize, tear down.
 *
 * Plain object rather than a hook so both hosts' hooks are thin wrappers over one tested
 * implementation, and so the overlap guard below can be driven deterministically by a test instead of
 * being reasoned about.
 */
export class SurfacePuppetMount {
  private readonly options: SurfacePuppetMountOptions;
  private readonly createSurface: () => HTMLDivElement;
  private generation = 0;
  private current: MountAttempt | null = null;
  private snapshotValue: SurfacePuppetSnapshot = UNMOUNTED_SURFACE_PUPPET;
  private lastState: PuppetState | null = null;
  private lastSize: PuppetSize | null = null;
  private disposed = false;

  constructor(options: SurfacePuppetMountOptions) {
    this.options = options;
    this.createSurface = options.createSurface ?? defaultCreateSurface;
  }

  public get snapshot(): SurfacePuppetSnapshot {
    return this.snapshotValue;
  }

  /** The mounted session, or null while there is none. For imperative one-shots (phase two's commands). */
  public get session(): PuppetModelSession | null {
    return this.current?.session ?? null;
  }

  /**
   * (Re)mount this widget's model.
   *
   * `request === null` — no asset, no backend, or a host that has decided this widget should not
   * hold a WebGL context right now — tears down and reports `unmounted` rather than an error.
   *
   * The complete initial state is an argument rather than something to `apply()` afterwards because
   * the engine's lifecycle puts it before `ready()`: a backend loads its pose *at* load time, and a
   * model that comes up in its bind pose and snaps a frame later is the visible cost of getting
   * this order wrong.
   */
  public mount(request: SurfacePuppetRequest | null, state: PuppetState, size: PuppetSize): void {
    if (this.disposed) {
      return;
    }
    this.teardown();
    this.lastState = state;
    this.lastSize = size;
    if (!request) {
      this.publish(UNMOUNTED_SURFACE_PUPPET);
      return;
    }
    // Checked here rather than left to each host's opener: "the author has not finished
    // configuring this widget" is the overwhelmingly common case and must cost no round trip, no
    // module load, and no WebGL context.
    if (!request.assetId?.trim()) {
      this.publishUnavailable("no-model");
      return;
    }
    if (!request.backend.trim()) {
      this.publishUnavailable("no-backend");
      return;
    }
    // No arm of the chain answered. Checked before a surface is made rather than left to an opener
    // that does not exist: nothing is drawn, nothing is loaded, and nothing throws.
    if (!this.options.open) {
      this.publishUnavailable("backend-missing");
      return;
    }
    const open = this.options.open;

    // Each attempt draws into a surface of its own rather than into the host directly. Disposing
    // a backend empties the container it was handed, and mounting is asynchronous - so two
    // overlapping attempts (React's development double-invoke is one, an edit while a load is in
    // flight is another) would have the loser wipe the winner's canvas out of a shared container,
    // leaving a blank box and no error to explain it.
    const surface = this.createSurface();
    this.options.host.appendChild(surface);
    const attempt: MountAttempt = {
      generation: ++this.generation,
      surface,
      cancelled: false,
      session: null
    };
    this.current = attempt;
    this.publish({ status: "loading", error: null, reason: null });

    void open({
      request,
      container: surface,
      size,
      onWarn: (message) => this.options.onWarn?.(message)
    })
      .then(async (session) => {
        // A stale attempt disposes its *own* session and removes its *own* surface. It must never
        // publish, and it must never touch the winner's.
        if (attempt.cancelled) {
          session.dispose();
          surface.remove();
          return;
        }
        attempt.session = session;
        // The engine's order, and the engine's contract on what a state is: whole, with `null`
        // meaning "cleared" rather than "leave as it was".
        await session.apply(this.lastState ?? state);
        if (attempt.cancelled) {
          return;
        }
        // A box that changed while the model was still loading. The mount was handed the old size,
        // so without this the model comes up at it and only corrects on the next layout change.
        if (this.lastSize && !surfacePuppetSizeEquals(this.lastSize, size)) {
          session.resize(this.lastSize);
        }
        await session.ready();
        if (attempt.cancelled) {
          return;
        }
        this.publish({ status: "ready", error: null, reason: null });
      })
      .catch((error: unknown) => {
        // Cleanup comes before the cancelled check, not after it. `apply()` or `ready()` can be
        // what threw, and in that case the backend is up and owns a WebGL context. Dropping the
        // surface without disposing it would leak that context for the lifetime of the window -
        // and the browser's ~16-context ceiling is exactly the budget the widget has to live
        // inside.
        //
        // A cancelled attempt has to run this too. It is the arm that rejects *without* ever
        // having a session - the author renamed the backend, or changed the model, while
        // `open()` was in flight and then `open()` failed - and returning early left its surface
        // attached to the box forever, one more orphan per edit, each of them a node the next
        // attempt stacks on top of. `teardown()` cannot do it instead: it skips the removal
        // precisely because an attempt that is still mid-mount owns the node.
        const mounted = attempt.session;
        attempt.session = null;
        try {
          mounted?.dispose();
        } catch {
          // Already being abandoned; the surface goes either way.
        }
        surface.remove();
        if (attempt.cancelled) {
          return;
        }
        if (error instanceof SurfacePuppetUnavailableError) {
          this.publishUnavailable(error.reason);
          return;
        }
        this.publish({ status: "error", error: messageOf(error), reason: null });
      });
  }

  /**
   * Re-pose the mounted model.
   *
   * The state is sent whole, never as a patch of what changed: the engine's contract is that `null`
   * clears rather than "leave as-is", so a half-apply would make a saved game or an undo fail to
   * reproduce what it recorded. Remembered either way, so a state pushed while a load is still in
   * flight lands as that load's initial pose instead of being dropped.
   */
  public apply(state: PuppetState): void {
    // Value comparison, because a React caller hands over a freshly built object on every render
    // and re-posing a live model per render is how an inspector keystroke turns into a stutter.
    if (this.lastState && surfacePuppetStateEquals(this.lastState, state)) {
      return;
    }
    this.lastState = state;
    const session = this.current?.session;
    if (!session) {
      return;
    }
    void Promise.resolve(session.apply(state)).catch((error: unknown) => {
      // A backend that throws out of `apply` has usually been handed one bad name, which the
      // engine treats as a warning rather than as a dead element. Same here.
      this.options.onWarn?.(messageOf(error));
    });
  }

  public resize(size: PuppetSize): void {
    if (this.lastSize && surfacePuppetSizeEquals(this.lastSize, size)) {
      return;
    }
    this.lastSize = size;
    try {
      this.current?.session?.resize(size);
    } catch (error) {
      this.options.onWarn?.(messageOf(error));
    }
  }

  /** Tear the model down and forget it. Idempotent; safe from a React cleanup. */
  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.teardown();
    this.snapshotValue = UNMOUNTED_SURFACE_PUPPET;
  }

  private teardown(): void {
    const attempt = this.current;
    this.current = null;
    if (!attempt) {
      return;
    }
    attempt.cancelled = true;
    const mounted = attempt.session;
    // Claimed before disposing, so the attempt's own arms cannot dispose it a second time when
    // they notice they were cancelled.
    attempt.session = null;
    try {
      mounted?.dispose();
    } catch (error) {
      this.options.onWarn?.(messageOf(error));
    }
    // Only when the session was already up: an in-flight attempt still owns this node, and pulling
    // it out from under a backend that is mid-mount is how a half-built WebGL canvas ends up
    // detached and leaked. That attempt removes it itself once it notices it was cancelled -
    // which both of its arms now do, including the rejecting one.
    if (mounted) {
      attempt.surface.remove();
    }
  }

  private publishUnavailable(reason: SurfacePuppetUnavailableReason): void {
    this.publish({ status: "missing-backend", error: null, reason });
  }

  private publish(snapshot: SurfacePuppetSnapshot): void {
    if (this.disposed) {
      return;
    }
    const previous = this.snapshotValue;
    if (
      previous.status === snapshot.status &&
      previous.error === snapshot.error &&
      previous.reason === snapshot.reason
    ) {
      return;
    }
    this.snapshotValue = snapshot;
    this.options.onChange?.(snapshot);
  }
}

/**
 * What both hosts' hooks return, so a widget renderer written against one works in the other.
 *
 * Named here rather than in either hook so the two cannot drift into two shapes that happen to
 * satisfy the same renderer today.
 */
export interface SurfacePuppetSessionState extends SurfacePuppetSnapshot {
  /** True only while a model is actually drawing. What a "needs a runtime" placeholder hides behind. */
  mounted: boolean;
}
