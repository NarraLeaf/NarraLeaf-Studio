import koffi from "koffi";
import path from "path";
import { createRequire } from "module";
import {
    LORE_ALIASES,
    LORE_CALLBACK_CONFIG,
    LORE_CALLBACK_PROTOTYPE,
    LORE_STRUCTS,
    LORE_STRUCT_ALIASES,
    LORE_VERBS,
    type LoreVerbName,
} from "./abi/definitions";

/**
 * Loading lorelib and binding the verbs Studio uses.
 *
 * The single most important property of this module: **nothing happens at module
 * evaluation.** `koffi.load()` runs inside {@link loadLoreLibrary}, never at import.
 *
 * That is the defect the SDK cannot be talked out of. It calls `koffi.load()` while
 * its entry module is being evaluated, and an ESM module that throws during
 * evaluation is cached as failed by Node for the life of the process - so on a host
 * with no native build, one static import anywhere in the reachable graph takes the
 * whole main process down at startup, and a user who then repairs their install has
 * to restart Studio before it can possibly work. Here a failed load is just a
 * rejected promise, and retrying after a repair actually succeeds.
 *
 * koffi itself is a safe import: it is a normal prebuilt addon with no knowledge of
 * Lore. Only `koffi.load(<lorelib>)` can fail for platform reasons.
 */

/** Which platform package carries the native library, by host. */
const PLATFORM_PACKAGES: Readonly<Record<string, string>> = {
    "win32-x64": "@lore-vcs/sdk-amd64-unknown-windows",
    "darwin-arm64": "@lore-vcs/sdk-arm64-apple-darwin",
    "linux-x64": "@lore-vcs/sdk-amd64-unknown-linux",
    // Built for Graviton/Neoverse (SVE); it will not run on generic ARM64 Linux.
    "linux-arm64": "@lore-vcs/sdk-arm64-graviton-linux",
};

export class LoreLibraryError extends Error {
    constructor(message: string, readonly cause?: unknown) {
        super(message);
        this.name = "LoreLibraryError";
    }
}

/** A verb Studio binds that this build of lorelib does not export. */
export class LoreCapabilityError extends Error {
    constructor(readonly verb: LoreVerbName, readonly symbol: string, cause?: unknown) {
        super(`This build of lorelib does not export ${symbol} (needed for ${verb})`);
        this.name = "LoreCapabilityError";
        this.cause = cause;
    }
}

/**
 * `int32_t f(const LoreGlobalArgs*, const LoreXArgs*, LoreEventCallbackConfig)`,
 * plus koffi's `.async` variant which runs the call on a worker thread.
 */
export interface LoreVerbFunction {
    (globals: object, args: object, callback: object): number;
    async(
        globals: object,
        args: object,
        callback: object,
        done: (error: Error | null, result: number) => void,
    ): void;
}

export interface LoreLibrary {
    /** Absolute path of the loaded shared library. */
    readonly path: string;
    /** Bound verb, or a typed error if this build lacks the symbol. */
    verb(name: LoreVerbName): LoreVerbFunction;
    /** Whether this build exports the symbol behind a verb, without throwing. */
    has(name: LoreVerbName): boolean;
    /** koffi type handle for a registered struct, for callers that decode payloads. */
    type(name: string): koffi.IKoffiCType;
    /** The registered `LoreEventCallbackFunction` pointer type. */
    readonly callbackPrototype: koffi.IKoffiCType;
}

/**
 * Resolve the native library path.
 *
 * `LORE_LIB_PATH` wins and **skips the platform check** on purpose: it exists for
 * hosts Epic ships no build for, where a user who built lorelib themselves should
 * be able to point Studio at it. In practice that means Windows ARM64 - darwin-x64
 * is also unserved by Epic, but Studio is no longer shipped for Intel Macs at all,
 * so a self-built lorelib would have no Studio to load it.
 */
export function resolveLoreLibraryPath(): string {
    const override = process.env.LORE_LIB_PATH;
    if (override) return override;

    const key = `${process.platform}-${process.arch}`;
    const packageName = PLATFORM_PACKAGES[key];
    if (!packageName) {
        throw new LoreLibraryError(`No Lore native build exists for ${key}`);
    }

    try {
        // The platform package's default export IS the absolute library path.
        const require = createRequire(__filename);
        const resolved: unknown = require(packageName);
        const libraryPath = typeof resolved === "string"
            ? resolved
            : (resolved as { default?: string } | null)?.default;
        if (typeof libraryPath !== "string") {
            throw new LoreLibraryError(`${packageName} did not export a library path`);
        }
        return unpackAsarPath(libraryPath);
    } catch (error) {
        if (error instanceof LoreLibraryError) throw error;
        throw new LoreLibraryError(`Cannot find ${packageName}; this installation is incomplete`, error);
    }
}

/**
 * Point at the unpacked copy when the resolved path is inside an asar archive.
 *
 * A native library cannot be dlopen'd from inside asar. electron-builder.yml already
 * sets `asarUnpack: node_modules/**\/*`, so the file is on disk under
 * `app.asar.unpacked` - but `require.resolve` still reports the archive path.
 */
export function unpackAsarPath(libraryPath: string): string {
    return libraryPath.replace(/([/\\])app\.asar([/\\])/, "$1app.asar.unpacked$2");
}

/**
 * koffi's type registry is process-global and rejects duplicate names, so types are
 * registered exactly once even if loading the library is retried.
 */
let registered: { types: Map<string, koffi.IKoffiCType>; callbackPrototype: koffi.IKoffiCType } | null = null;

function registerTypes() {
    if (registered) return registered;

    const types = new Map<string, koffi.IKoffiCType>();

    for (const [name, target] of Object.entries(LORE_ALIASES)) {
        types.set(name, koffi.alias(name, target));
    }
    for (const [name, fields] of Object.entries(LORE_STRUCTS)) {
        types.set(name, koffi.struct(name, { ...fields }));
        // Struct aliases must follow the struct they point at. Declaring them inline
        // keeps that ordering a property of the data rather than of this loop.
        for (const [alias, target] of Object.entries(LORE_STRUCT_ALIASES)) {
            if (target === name) types.set(alias, koffi.alias(alias, target));
        }
    }

    const callbackPrototype = koffi.proto(
        LORE_CALLBACK_PROTOTYPE.name,
        LORE_CALLBACK_PROTOTYPE.returns,
        [...LORE_CALLBACK_PROTOTYPE.args],
    );
    types.set("LoreEventCallbackConfig", koffi.struct("LoreEventCallbackConfig", { ...LORE_CALLBACK_CONFIG }));

    registered = { types, callbackPrototype };
    return registered;
}

/**
 * koffi's global configuration is settable only while NO library is loaded, and this
 * module never unloads lorelib. So a SECOND {@link loadLoreLibrary} - which is exactly
 * what {@link resetLoreLibraryForRetry} exists to cause - throws
 * `Cannot change Koffi configuration once a library has been loaded`, and because the
 * throw happens before the load, every later Lore call in the process throws the same
 * thing. Measured: the first reset took the whole process's version control down.
 *
 * Same shape as the type registry above: process-global, applied exactly once.
 */
let configured = false;

function configureKoffiOnce(): void {
    if (configured) return;
    // Async calls run on koffi's worker pool. The defaults are small; a clone or a
    // large stage can have many in flight, and Lore's own threads need stack room.
    koffi.config({ max_async_calls: 1024, async_stack_size: 2 * 1024 * 1024 });
    configured = true;
}

let library: LoreLibrary | null = null;

/**
 * Load lorelib and bind Studio's verbs.
 *
 * Verbs are bound lazily and cached: `lib.func` throws when a symbol is absent, and
 * v0.8.5 ships TypeScript declarations for three functions the library does not
 * actually export. Binding on demand turns "this build cannot do X" into a typed
 * error at the call site instead of a failure to load anything at all.
 *
 * A failed load is NOT latched. Callers above decide how often to retry.
 */
export function loadLoreLibrary(): LoreLibrary {
    if (library) return library;

    const libraryPath = resolveLoreLibraryPath();
    const { types, callbackPrototype } = registerTypes();

    configureKoffiOnce();

    let loaded: koffi.IKoffiLib;
    try {
        loaded = koffi.load(libraryPath);
    } catch (error) {
        throw new LoreLibraryError(
            `Failed to load the version control library at ${libraryPath}`,
            error,
        );
    }

    const bound = new Map<LoreVerbName, LoreVerbFunction | LoreCapabilityError>();

    const bind = (name: LoreVerbName): LoreVerbFunction | LoreCapabilityError => {
        const cached = bound.get(name);
        if (cached) return cached;

        const { symbol, args } = LORE_VERBS[name];
        let result: LoreVerbFunction | LoreCapabilityError;
        try {
            result = loaded.func(symbol, "int32_t", [
                koffi.pointer("LoreGlobalArgs"),
                koffi.pointer(args),
                "LoreEventCallbackConfig",
            ]) as unknown as LoreVerbFunction;
        } catch (error) {
            result = new LoreCapabilityError(name, symbol, error);
        }
        bound.set(name, result);
        return result;
    };

    library = {
        path: libraryPath,
        verb(name) {
            const result = bind(name);
            if (result instanceof LoreCapabilityError) throw result;
            return result;
        },
        has(name) {
            return !(bind(name) instanceof LoreCapabilityError);
        },
        type(name) {
            const type = types.get(name);
            if (!type) throw new LoreLibraryError(`Type ${name} is not registered`);
            return type;
        },
        callbackPrototype,
    };
    return library;
}

/**
 * Forget the loaded library so the next call retries.
 *
 * Registered koffi types are deliberately kept - they are process-global and
 * re-registering throws. Used by tests, and by any future "retry after the user
 * repaired their install" path.
 */
export function resetLoreLibraryForRetry(): void {
    library = null;
}
