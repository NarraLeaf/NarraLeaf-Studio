/**
 * A macOS bundle held in memory, as the files a zip of it would carry.
 *
 * Keys are `/`-separated paths relative to the tree's root (for example
 * `My Game.app/Contents/Info.plist`), never with a trailing slash. A symbolic link is an entry
 * of its own and is never followed: a bundle's frameworks are held together by relative links,
 * and only an archive, not an NTFS folder, can carry them from a Windows host.
 */
export type BundleEntry =
    | { kind: "directory"; mode: number }
    | { kind: "file"; mode: number; data: Buffer }
    | { kind: "symlink"; mode: number; target: string }
    /**
     * A file too large to hold in memory, left on disk and read only when the archive is written.
     * Never code: whoever builds the tree hashed it already, and the signer seals it by these
     * digests alone.
     */
    | { kind: "diskFile"; mode: number; path: string; size: number; sha1: Buffer; sha256: Buffer };

export type BundleTree = Map<string, BundleEntry>;
