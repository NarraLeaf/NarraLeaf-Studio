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

/**
 * 64-bit FNV-1a over raw bytes, hex-encoded. Held as four 16-bit limbs because
 * JS has no 64-bit integer arithmetic outside BigInt, which costs an allocation
 * per byte and is far too slow over a multi-megabyte image.
 *
 * 64 bits rather than {@link fnv1aHex}'s 32 because this one guards writes: a
 * collision means Studio decides a baked file is current when its source has in
 * fact changed, and ships the stale icon. At 32 bits that is a coin-flip over a
 * few tens of thousands of edits; at 64 it never happens.
 */
export function fnv1a64BytesHex(bytes: Uint8Array): string {
  // Offset basis 0xcbf29ce484222325, least-significant limb first.
  let w0 = 0x2325,
    w1 = 0x8422,
    w2 = 0x9ce4,
    w3 = 0xcbf2;
  for (let i = 0; i < bytes.length; i++) {
    w0 ^= bytes[i];
    // Multiply by the prime 0x00000100000001b3, whose only non-zero limbs
    // are p0 = 0x01b3 and p2 = 0x0100 - so most partial products vanish.
    const c0 = w0 * 0x01b3;
    const c1 = w1 * 0x01b3;
    const c2 = w0 * 0x0100 + w2 * 0x01b3;
    const c3 = w1 * 0x0100 + w3 * 0x01b3;
    let acc = c0;
    w0 = acc % 0x10000;
    acc = Math.floor(acc / 0x10000) + c1;
    w1 = acc % 0x10000;
    acc = Math.floor(acc / 0x10000) + c2;
    w2 = acc % 0x10000;
    acc = Math.floor(acc / 0x10000) + c3;
    w3 = acc % 0x10000;
  }
  return [w3, w2, w1, w0].map((limb) => limb.toString(16).padStart(4, "0")).join("");
}
