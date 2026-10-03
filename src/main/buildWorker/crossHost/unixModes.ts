/**
 * The unix permission bits a file in a macOS bundle needs, read from what it is.
 *
 * The game's payload reaches the macOS packager from a folder laid out on the host, and a Windows
 * folder keeps no permission bits. What has to be executable in a bundle is what macOS runs -
 * machine code and scripts - and both say so in their first bytes. The Linux counterpart, which
 * leaves Mach-O alone because Linux does not run it, is linuxPackage/unixModes.ts.
 */

/** Whether a file starting with these bytes is something macOS runs: Mach-O, thin or universal, or a `#!` script. */
export function isMacExecutableContent(head: Buffer): boolean {
    if (head.length >= 2 && head[0] === 0x23 && head[1] === 0x21) {
        return true;
    }
    if (head.length < 4) {
        return false;
    }
    const little = head.readUInt32LE(0);
    const big = head.readUInt32BE(0);
    // `0xcafebabe` also starts a Java class file, which no game ships; marking one executable is harmless.
    return little === 0xfeedfacf || little === 0xfeedface || big === 0xcafebabe || big === 0xcafebabf;
}

/** 0755 for something macOS runs, 0644 for everything else. */
export function macModeForContent(head: Buffer): number {
    return isMacExecutableContent(head) ? 0o755 : 0o644;
}
