import type { VcsAvailability } from "@shared/types/vcs";
import { isVcsPlatformSupported } from "@shared/types/vcs";

/**
 * The plug in "pluggable version control".
 *
 * Everything Lore-shaped lives behind this module, and nothing above it imports
 * `@lore-vcs/sdk` - directly or transitively - at module scope. That constraint
 * is load-bearing, not stylistic:
 *
 *   `@lore-vcs/sdk`'s entry point calls `koffi.load()` at MODULE LOAD TIME.
 *   A static import on a host with no native build therefore throws while
 *   Studio's main process is still starting up, taking the whole app down
 *   rather than degrading one feature. Verified by removing the platform
 *   package: "Failed to load shared library".
 *
 * So the backend is imported dynamically, once, behind a platform check, and a
 * failure is converted into a reason code the UI can act on. Studio keeps
 * shipping on every platform; version control is simply absent on the ones Epic
 * has no build for (macOS Intel, Windows ARM64 - see docs/version-control.md).
 */

export type VcsBackend = typeof import("./revisionReader") & {
    readonly client: typeof import("./loreClient");
};

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
            // Dynamic on purpose. Both modules reach the native library on load.
            const [reader, client] = await Promise.all([
                import("./revisionReader"),
                import("./loreClient"),
            ]);
            cached = Object.assign(Object.create(null), reader, { client }) as VcsBackend;
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

/** Test seam: forget the cached backend and availability verdict. */
export function __resetVcsBackendForTests(): void {
    cached = null;
    availability = null;
    inFlight = null;
}
