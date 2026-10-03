/**
 * The unix permission bits a Linux package gives a file whose own bits are unknown.
 *
 * A Windows host stages a Linux package on NTFS, which has no execute bit to carry. Whatever writes
 * the package afterwards - a squashfs for an AppImage, a zip - has to decide every mode itself, and
 * the decision has to come from the file rather than from its name: Electron's Linux build is full
 * of executables with no extension (`chrome-sandbox`, `chrome_crashpad_handler`, the app itself) and
 * of shared objects whose names end in a version number (`libvulkan.so.1`).
 *
 * The rule is the one a Linux build host ends up with for everything Studio ships: machine code and
 * scripts are executable, everything else is not. Measured against a package electron-builder made
 * on a POSIX host, it agrees on every file but one native addon (`koffi.node`), which arrives there
 * as 0644 only because npm unpacked it that way; 0755 on a shared object is what the linker itself
 * writes and changes nothing about how it loads.
 *
 * Deliberately not here: setuid. `chrome-sandbox` would need root:4755 to be used, and no archive a
 * player unpacks as themselves can give it that - see the AppImage launcher, which detects a
 * missing sandbox at start instead.
 */

/** `rwxr-xr-x`: directories, and files {@link unixModeForContent} judges executable. */
export const EXECUTABLE_MODE = 0o755;

/** `rw-r--r--`: everything else. */
export const REGULAR_FILE_MODE = 0o644;

/** Every directory, whatever it holds. A directory without its execute bit cannot be entered. */
export const DIRECTORY_MODE = EXECUTABLE_MODE;

/** How many leading bytes {@link unixModeForContent} looks at; read at least this many. */
export const MODE_SNIFF_BYTES = 4;

/**
 * The mode for a regular file, judged by its first bytes.
 *
 * ELF (`7f 45 4c 46`) covers executables and shared objects alike; `#!` covers every script. Given
 * fewer than {@link MODE_SNIFF_BYTES} bytes - an empty file, a two-byte one - only what is there is
 * compared, so an empty file is a regular one and a file that is exactly `#!` is a script.
 */
export function unixModeForContent(head: Uint8Array): number {
    if (head.length >= 2 && head[0] === 0x23 && head[1] === 0x21) {
        return EXECUTABLE_MODE;
    }
    if (head.length >= 4 && head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) {
        return EXECUTABLE_MODE;
    }
    return REGULAR_FILE_MODE;
}
