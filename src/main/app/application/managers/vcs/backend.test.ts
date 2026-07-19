import { afterEach, describe, expect, it, vi } from "vitest";
import { isVcsPlatformSupported, VCS_SUPPORTED_PLATFORMS } from "@shared/types/vcs";

/**
 * Degradation tests for the optional VCS backend.
 *
 * The contract these defend: Studio ships on every platform, and a host with no
 * Lore native build loses version control WITHOUT losing the app. The failure
 * being guarded against is not subtle - `@lore-vcs/sdk` calls `koffi.load()` at
 * module scope, so a static import on such a host throws during main-process
 * startup and takes Studio down entirely.
 */

afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
});

/** Re-import the module graph with process.platform/arch stubbed. */
async function withHost<T>(platform: string, arch: string, fn: (mod: typeof import("./backend")) => Promise<T>): Promise<T> {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    const originalArch = Object.getOwnPropertyDescriptor(process, "arch");
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
    Object.defineProperty(process, "arch", { value: arch, configurable: true });
    vi.resetModules();
    try {
        return await fn(await import("./backend"));
    } finally {
        if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
        if (originalArch) Object.defineProperty(process, "arch", originalArch);
        vi.resetModules();
    }
}

describe("platform support table", () => {
    it("matches the builds Epic actually ships", () => {
        expect(isVcsPlatformSupported("win32", "x64")).toBe(true);
        expect(isVcsPlatformSupported("darwin", "arm64")).toBe(true);
        expect(isVcsPlatformSupported("linux", "x64")).toBe(true);
    });

    it("excludes the two platforms with no native build", () => {
        // These are the reason VCS has to be optional at all.
        expect(isVcsPlatformSupported("darwin", "x64")).toBe(false); // Intel Mac
        expect(isVcsPlatformSupported("win32", "arm64")).toBe(false); // Windows on ARM
    });

    it("does not claim support for arbitrary hosts", () => {
        expect(isVcsPlatformSupported("freebsd", "x64")).toBe(false);
        expect(isVcsPlatformSupported("linux", "ia32")).toBe(false);
        expect(VCS_SUPPORTED_PLATFORMS.length).toBe(4);
    });
});

describe("backend loading", () => {
    it("reports unavailable on an unsupported host instead of throwing", async () => {
        await withHost("darwin", "x64", async (mod) => {
            // Must not throw: this is the Intel Mac path.
            await expect(mod.loadVcsBackend()).resolves.toBeNull();

            const availability = await mod.getVcsAvailability();
            expect(availability.available).toBe(false);
            if (!availability.available) {
                expect(availability.reason).toBe("unsupported-platform");
                expect(availability.detail).toContain("darwin/x64");
            }
        });
    });

    it("surfaces a typed error when a caller demands the backend anyway", async () => {
        await withHost("win32", "arm64", async (mod) => {
            await expect(mod.requireVcsBackend()).rejects.toBeInstanceOf(mod.VcsUnavailableError);
            await expect(mod.requireVcsBackend()).rejects.toThrow(/not available on win32\/arm64/);
        });
    });

    it("honours LORE_LIB_PATH so a self-built library can override the platform gate", async () => {
        vi.stubEnv("LORE_LIB_PATH", "/opt/lore/liblore.dylib");
        await withHost("darwin", "x64", async (mod) => {
            // The gate is bypassed, so this now attempts a real load and fails on
            // the bogus path - a *load* failure, not a platform refusal. That
            // distinction is what tells a user "your override is wrong" instead
            // of "your machine is unsupported".
            await expect(mod.loadVcsBackend()).resolves.toBeNull();
            const availability = await mod.getVcsAvailability();
            expect(availability.available).toBe(false);
            if (!availability.available) {
                expect(availability.reason).not.toBe("unsupported-platform");
            }
        });
    });

    // NOTE: the happy path (backend actually loads and caches) is asserted in
    // revisionReader.test.ts, deliberately in a DIFFERENT FILE.
    //
    // A failed load is permanent for the process: `@lore-vcs/sdk` runs
    // `koffi.load()` during module evaluation, and once an ESM module throws
    // while evaluating, Node caches that failure forever - `vi.resetModules()`
    // does not reach it, because the SDK lives in node_modules and is owned by
    // Node's own loader. So the LORE_LIB_PATH test above poisons the SDK for
    // every later test in this file. Vitest isolates files into separate
    // workers, which is what keeps the two concerns apart.
    //
    // This is not merely a test artifact: it means a Studio process that fails
    // to load the backend once cannot recover without a restart. `backend.ts`
    // caches the negative verdict for exactly that reason - retrying would be
    // pointless, and callers should treat unavailability as fixed for the run.
});
