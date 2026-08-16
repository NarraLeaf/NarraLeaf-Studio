/**
 * Moving the player's real mouse cursor, as executed by a main process.
 *
 * Shared by Studio's main process (Dev Mode) and the packaged game's main process, for the reason
 * `blueprintNetworkFetch` is shared: a node that behaves one way while the author is testing and
 * another in the shipped game is worse than a node that does not exist. The web export has no main
 * process and reports the capability as unavailable rather than emulating it.
 *
 * ## Why the real cursor, and whose decision it is
 *
 * A game that moves the player's pointer is doing something players notice, and the honest place
 * for that judgement is the game's author - the same author who decided the game opens fullscreen
 * or grabs the keyboard. Studio's job is to make the act possible and to make it visible in the
 * editor, not to talk anyone out of it. A drawn in-game pointer is a different feature and is not
 * what this is.
 *
 * ## Why FFI into the operating system rather than an addon of our own
 *
 * Every platform already exposes a cursor-positioning call in a library that ships with it, and
 * `koffi` - which this application already depends on and already signs, for the version-control
 * SDK - can call it. Compiling a bespoke native module to do the same thing would add an unsigned
 * binary to every game build, which is the shape endpoint protection reacts to, and would have to
 * be built for six targets to say what `user32.dll` already says in one line.
 *
 * ## Nothing happens at module evaluation
 *
 * The same discipline the Lore library loader documents: `koffi.load()` runs inside the call, never
 * at import. A host where the library is missing (a Linux session with no X11, a stripped
 * container) then degrades to `unsupported` instead of taking the process down at startup.
 *
 * koffi arrives through `await import()` rather than a top-level import, and that is load-bearing
 * rather than stylistic: `pluggability.test.ts` walks the main entry point's static import graph and
 * fails on any startup-reachable module with a static edge to koffi, because such an edge is the
 * reliable symptom of one into the version-control binding. A dynamic edge is the honest spelling of
 * what this module does, and it is why every function here answers a promise.
 *
 * Comments in English per project convention.
 */

export type SystemCursorMoveOutcome =
    /** The cursor is now at the requested point, as far as the platform reported. */
    | "moved"
    /** This host cannot move the cursor: no library, an unknown platform, a Wayland session. */
    | "unsupported"
    /** The library is here and the call failed. */
    | "failed";

export type SystemCursorMoveResult = {
    outcome: SystemCursorMoveOutcome;
    error?: string;
};

/** A bound platform mover, or the reason there is none. */
type CursorBinding =
    | { kind: "ready"; move: (x: number, y: number) => void }
    | { kind: "unsupported"; error: string };

/**
 * The binding, cached as the promise rather than as its result, so two moves racing on the first
 * frame of a smooth travel load the library once between them.
 */
let cached: Promise<CursorBinding> | null = null;

async function loadKoffi(): Promise<typeof import("koffi")> {
    const loaded = await import("koffi");
    // Both main bundles keep koffi external - it resolves its own addon by path, and bundling it
    // breaks that - so what comes back may be the CommonJS namespace rather than the module itself.
    return ((loaded as unknown as { default?: typeof import("koffi") }).default ?? loaded);
}

async function bindWindows(): Promise<CursorBinding> {
    const koffi = await loadKoffi();
    const user32 = koffi.load("user32.dll");
    const setCursorPos = user32.func("int __stdcall SetCursorPos(int X, int Y)");
    return {
        kind: "ready",
        move: (x, y) => {
            // SetCursorPos answers zero when the calling process is not allowed to move the
            // pointer - a session on the lock screen, a UAC prompt in front. That is a refusal
            // rather than a fault, and it reads as one to the caller.
            if (setCursorPos(x, y) === 0) {
                throw new Error("SetCursorPos was refused by the system");
            }
        },
    };
}

async function bindMacOS(): Promise<CursorBinding> {
    const koffi = await loadKoffi();
    const lib = koffi.load("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices");
    const CGPoint = koffi.struct("NLCGPoint", { x: "double", y: "double" });
    const warp = lib.func("int CGWarpMouseCursorPosition(NLCGPoint newCursorPosition)");
    const associate = lib.func("int CGAssociateMouseAndMouseCursorPosition(bool connected)");
    return {
        kind: "ready",
        move: (x, y) => {
            const status = warp({ x, y }) as number;
            if (status !== 0) {
                throw new Error(`CGWarpMouseCursorPosition failed with CGError ${status}`);
            }
            // Warping starts a short interval during which macOS ignores the physical mouse, so a
            // player who was already moving their hand would find it dead for a quarter second.
            // Re-associating ends the interval immediately, which is what makes a scripted move
            // feel like a nudge instead of a seizure of the pointer.
            associate(true);
        },
    };
}

async function bindLinux(): Promise<CursorBinding> {
    const koffi = await loadKoffi();
    const x11 = koffi.load("libX11.so.6");
    const openDisplay = x11.func("void *XOpenDisplay(const char *display_name)");
    const defaultRootWindow = x11.func("unsigned long XDefaultRootWindow(void *display)");
    const warpPointer = x11.func(
        "int XWarpPointer(void *display, unsigned long src_w, unsigned long dest_w, int src_x, int src_y,"
        + " unsigned int src_width, unsigned int src_height, int dest_x, int dest_y)",
    );
    const flush = x11.func("int XFlush(void *display)");
    // One connection for the life of the process. Opening one per move would be a round trip to the
    // X server on every animation frame of a smooth move.
    const display = openDisplay(null) as unknown;
    if (!display) {
        // No DISPLAY, or a Wayland session with no XWayland. Both mean the same thing here.
        return { kind: "unsupported", error: "No X display available" };
    }
    const root = defaultRootWindow(display) as number;
    return {
        kind: "ready",
        move: (x, y) => {
            warpPointer(display, 0, root, 0, 0, 0, 0, x, y);
            flush(display);
        },
    };
}

async function bind(): Promise<CursorBinding> {
    try {
        switch (process.platform) {
            case "win32":
                return await bindWindows();
            case "darwin":
                return await bindMacOS();
            case "linux":
                return await bindLinux();
            default:
                return { kind: "unsupported", error: `No cursor support on ${process.platform}` };
        }
    } catch (error) {
        return { kind: "unsupported", error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Whether this host can move the cursor at all, without moving it.
 *
 * Callers use it to answer the capability question once rather than by attempting a move and
 * reading the failure, which would put the pointer somewhere on the way to finding out.
 */
export async function isSystemCursorAvailable(): Promise<boolean> {
    cached ??= bind();
    return (await cached).kind === "ready";
}

/** Reset the cached binding. Tests only; a real host's answer does not change while it runs. */
export function resetSystemCursorBindingForTests(): void {
    cached = null;
}

/**
 * Put the cursor at a point in physical screen pixels.
 *
 * Physical rather than device-independent because that is what every one of the three platform
 * calls takes. Converting from the window's own coordinates is the caller's job, and it is the
 * caller who knows the window - see `pointerMove.ts`.
 */
export async function moveSystemCursorTo(x: number, y: number): Promise<SystemCursorMoveResult> {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { outcome: "failed", error: "Cursor target is not a finite point" };
    }
    cached ??= bind();
    const binding = await cached;
    if (binding.kind !== "ready") {
        return { outcome: "unsupported", error: binding.error };
    }
    try {
        binding.move(Math.round(x), Math.round(y));
        return { outcome: "moved" };
    } catch (error) {
        return { outcome: "failed", error: error instanceof Error ? error.message : String(error) };
    }
}
