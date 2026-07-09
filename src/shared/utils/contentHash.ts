/**
 * Small, dependency-free content hashing for change detection (NOT cryptographic).
 * Comments in English per project convention.
 */

/** 32-bit FNV-1a over UTF-16 code units, hex-encoded. */
export function fnv1aHex(input: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}
