import fs from "fs/promises";
import os from "os";
import path from "path";
import { flipFuses, FuseV1Options, FuseVersion, type FuseV1Config } from "@electron/fuses";
import type { GameBuildWorkerFuses } from "../protocol";

/**
 * Electron's fuses, flipped in a binary held in memory.
 *
 * The flip itself is @electron/fuses, the same code electron-builder runs, so the wire a package
 * gets does not depend on which path packaged it. That package works on files, so the binary takes a
 * short trip through a temporary one. What it never does here is re-sign: on macOS the caller signs
 * the whole bundle afterwards (`resetAdHocDarwinSignature` would shell out to Apple's `codesign`,
 * which is exactly the tool this path exists to do without).
 */

/** Studio's fuse settings in @electron/fuses' terms; the same mapping electron-builder's generateFuseConfig makes. */
export function fuseConfigFor(fuses: GameBuildWorkerFuses): FuseV1Config {
    return {
        version: FuseVersion.V1,
        resetAdHocDarwinSignature: false,
        [FuseV1Options.RunAsNode]: fuses.runAsNode,
        [FuseV1Options.EnableCookieEncryption]: fuses.enableCookieEncryption,
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: fuses.enableNodeOptionsEnvironmentVariable,
        [FuseV1Options.EnableNodeCliInspectArguments]: fuses.enableNodeCliInspectArguments,
        [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: fuses.enableEmbeddedAsarIntegrityValidation,
        [FuseV1Options.OnlyLoadAppFromAsar]: fuses.onlyLoadAppFromAsar,
        [FuseV1Options.GrantFileProtocolExtraPrivileges]: fuses.grantFileProtocolExtraPrivileges,
    };
}

/** The binary with its fuse wire set to `fuses`. Throws when it carries no fuse wire. */
export async function flipFusesInBinary(binary: Buffer, fuses: GameBuildWorkerFuses): Promise<Buffer> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nl-fuses-"));
    // Named like the binary it stands in for: @electron/fuses works out the platform from the path,
    // and a name with no ".app" in it is read as the executable itself.
    const file = path.join(dir, "electron-binary");
    try {
        await fs.writeFile(file, binary);
        const flipped = await flipFuses(file, fuseConfigFor(fuses));
        if (flipped === 0) {
            throw new Error("The Electron binary has no fuse wire to set.");
        }
        return await fs.readFile(file);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}
