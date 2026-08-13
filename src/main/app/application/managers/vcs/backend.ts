import type { VcsAvailability } from "@shared/types/vcs";
import { isVcsPlatformSupported } from "@shared/types/vcs";

/**
 * The plug in "pluggable version control".
 *
 * Everything Lore-shaped lives behind this module. Version control is simply absent
 * on hosts Epic has no native build for, and such a host loses one feature rather
 * than failing to start.
 *
 * The list of those hosts has shrunk to one that Studio actually ships on: **Windows
 * ARM64**. macOS Intel was the other, and Studio is no longer shipped for it at all -
 * this missing backend was the deciding reason, version control being a core feature
 * rather than an optional convenience (see .github/workflows/release.yml, and
 * docs/version-control.md §7 for the platform table). So the darwin-x64 branch below
 * is now unreachable in a shipped build; it stays because the gate is keyed on
 * platform/arch and LORE_LIB_PATH lets anyone run anywhere.
 *
 * Two things changed when Studio replaced the generated SDK with its own binding
 * (`lore/`), and both relax constraints that used to be absolute:
 *
 *  - **Loading is lazy.** The SDK called `koffi.load()` while its entry module was
 *    being evaluated, so a single static import anywhere in the reachable graph
 *    crashed main-process startup on an unsupported host. Studio's binding loads
 *    inside a function, so the dynamic import below is now defence in depth rather
 *    than the only thing standing between an unserved host and a dead app.
 *  - **Failure is no longer permanent.** A module that throws during ESM evaluation
 *    is cached as failed by Node for the life of the process; a failed
 *    `koffi.load()` inside a function is just an exception. A user who repairs a
 *    broken install can now recover without restarting - see
 *    {@link refreshVcsAvailability}.
 *
 * The verdict is still cached by default, because probing costs a 29MB dlopen and
 * the answer does not change on its own.
 */

/**
 * The whole Lore-facing surface, as one object.
 *
 * Four modules rather than one because reading history, creating a repository, talking
 * to a server and settling a merge are genuinely different jobs, but they share a
 * single plug: adding a second dynamic import elsewhere would give the "never reach the
 * binding at startup" rule a second place to be broken.
 */
export type VcsBackend =
    & typeof import("./revisionReader")
    & typeof import("./repository")
    & typeof import("./remote")
    /**
     * Signing in to a server that verifies who is calling. Behind the same plug as the
     * rest: it reaches the binding for the login itself, and it is meaningless on a host
     * with no backend to sign anything in.
     */
    & typeof import("./serverSession")
    & typeof import("./merge")
    /**
     * Per-change resolution. Reaches no native code at all - it is `fs` plus the document
     * registry - and is behind the plug anyway because it is only ever called on a repository
     * whose merge the modules above opened, and because a second way into `vcs/` would give the
     * "never reach the binding at startup" rule a second place to be broken.
     */
    & typeof import("./mergeDocument");

let cached: VcsBackend | null = null;
let availability: VcsAvailability | null = null;
let inFlight: Promise<VcsBackend | null> | null = null;

/**
 * Escape hatch for hosts that have a self-built library: point LORE_LIB_PATH at
 * it and the SDK will load that instead of its bundled platform package. The
 * platform gate is skipped when it is set, because the whole point is running
 * somewhere Epic does not ship.
 */
function platformGateSatisfied(): boolean {
    return Boolean(process.env.LORE_LIB_PATH) || isVcsPlatformSupported();
}

/**
 * Load the Lore backend, or return null if this host cannot run it.
 * Never throws - inspect `getAvailability()` for the reason.
 */
export async function loadVcsBackend(): Promise<VcsBackend | null> {
    if (cached) return cached;
    if (availability && !availability.available) return null;
    if (inFlight) return inFlight;

    inFlight = (async (): Promise<VcsBackend | null> => {
        if (!platformGateSatisfied()) {
            availability = {
                available: false,
                reason: "unsupported-platform",
                detail: `No Lore native build for ${process.platform}/${process.arch}`,
            };
            return null;
        }
        try {
            // Dynamic on purpose: these imports are what reach the native library, and
            // a static one would run `koffi.load()` during main-process startup.
            const [reader, repository, remote, serverSession, merge, mergeDocument] = await Promise.all([
                import("./revisionReader"),
                import("./repository"),
                import("./remote"),
                import("./serverSession"),
                import("./merge"),
                import("./mergeDocument"),
            ]);
            // Force the load now rather than at first use, so availability reflects
            // whether the library actually opened rather than merely whether the
            // module resolved.
            const { loadLoreLibrary } = await import("./lore");
            loadLoreLibrary();
            cached = { ...reader, ...repository, ...remote, ...serverSession, ...merge, ...mergeDocument };
            availability = { available: true };
            return cached;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // A missing platform subpackage and a broken library surface the same
            // way through koffi; separate them so the UI can say something useful.
            const missing = /Cannot find (module|package)|MODULE_NOT_FOUND/i.test(message);
            availability = {
                available: false,
                reason: missing ? "backend-missing" : "backend-load-failed",
                detail: message.split("\n")[0],
            };
            return null;
        } finally {
            inFlight = null;
        }
    })();

    return inFlight;
}

/** Availability of the VCS backend on this host, resolving it on first call. */
export async function getVcsAvailability(): Promise<VcsAvailability> {
    if (!availability) await loadVcsBackend();
    return availability ?? { available: false, reason: "backend-load-failed" };
}

/** Thrown by every VCS operation on a host without a usable backend. */
export class VcsUnavailableError extends Error {
    constructor(readonly availability: Extract<VcsAvailability, { available: false }>) {
        super(
            availability.reason === "unsupported-platform"
                ? `Version control is not available on ${process.platform}/${process.arch}`
                : `Version control backend failed to load: ${availability.detail ?? availability.reason}`,
        );
        this.name = "VcsUnavailableError";
    }
}

/** Load the backend or throw a typed, user-presentable error. */
export async function requireVcsBackend(): Promise<VcsBackend> {
    const backend = await loadVcsBackend();
    if (backend) return backend;
    const current = await getVcsAvailability();
    throw new VcsUnavailableError(
        current.available ? { available: false, reason: "backend-load-failed" } : current,
    );
}

/**
 * Re-probe after a host-side repair (a reinstall, or `LORE_LIB_PATH` being set).
 *
 * Possible only because Studio's binding loads the library inside a function; with
 * the generated SDK a first failure was permanent for the process and this would
 * have been a lie. Nothing calls it automatically - retrying on a schedule would
 * re-dlopen 29MB to learn what the user has not changed.
 */
export async function refreshVcsAvailability(): Promise<VcsAvailability> {
    cached = null;
    availability = null;
    inFlight = null;
    const { resetLoreLibraryForRetry } = await import("./lore");
    resetLoreLibraryForRetry();
    return getVcsAvailability();
}

/** Test seam: forget the cached backend and availability verdict. */
export function __resetVcsBackendForTests(): void {
    cached = null;
    availability = null;
    inFlight = null;
}
