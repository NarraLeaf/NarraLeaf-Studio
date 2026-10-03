/**
 * The unix permission bits a file needs, read from what it is.
 *
 * A package laid out on Windows has no permission bits to copy: NTFS keeps none, so every file
 * would arrive non-executable and a Linux game would not start. What has to be executable is
 * exactly what the system will run - machine code and scripts - and both say so in their first
 * bytes, so the rule needs no list of names that could fall behind a new Electron release.
 */

/** Whether a file starting with these bytes is something a system runs: ELF, Mach-O or a `#!` script. */
export function isExecutableContent(head: Buffer): boolean {
    if (head.length >= 2 && head[0] === 0x23 && head[1] === 0x21) {
        return true;
    }
    if (head.length < 4) {
        return false;
    }
    if (head.readUInt32BE(0) === 0x7f454c46) {
        return true;
    }
    const little = head.readUInt32LE(0);
    const big = head.readUInt32BE(0);
    // Thin Mach-O (64- and 32-bit) and the universal container. `0xcafebabe` also starts a Java class
    // file, which no Electron app ships; a class file marked executable would be harmless anyway.
    return little === 0xfeedfacf || little === 0xfeedface || big === 0xcafebabe || big === 0xcafebabf;
}

/** 0755 for something a system runs, 0644 for everything else. */
export function unixModeForContent(head: Buffer): number {
    return isExecutableContent(head) ? 0o755 : 0o644;
}
