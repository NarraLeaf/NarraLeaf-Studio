import os from "os";
import path from "path";

/**
 * Where the native readers sealed payloads carry are copied to before they are loaded.
 *
 * Studio's own folder rather than the payload's, because loading a module pins the file it came from
 * until the process exits (see the top of `patchPayload.ts`). Under the system temp folder because a
 * copy is only needed by the process that loaded it, and outlives that one only until a later one
 * sweeps it.
 *
 * A module of its own so that the cache inventory, which lists and clears this folder, and the build
 * worker, which must not load Electron, read the one same path.
 */
export function payloadReaderCopiesRoot(tempDir: string = os.tmpdir()): string {
    return path.join(tempDir, "narraleaf-payload-readers");
}
