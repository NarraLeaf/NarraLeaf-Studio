/**
 * SHA-1, synchronous and in plain JavaScript.
 *
 * The interface tool derives the ids of elements a `.ui` file does not name from a SHA-1 of where
 * they sit (`deriveElementId` in `model.ts`). That used to be `node:crypto`, which kept the whole
 * compiler out of the renderer: Studio's agent bridge runs the same compile against the live
 * document, and the browser offers SHA-1 only through `crypto.subtle`, which is asynchronous while
 * every caller of the compiler is not. The ids have to stay byte-identical across the two - a
 * template written by the command line and the same file applied through the bridge must produce
 * the same elements - so this is the textbook algorithm (FIPS 180-4) over the UTF-8 bytes of the
 * input, checked against `node:crypto` in `sha1.test.ts`.
 *
 * Not for anything security-related: it is a naming function here, nothing more.
 *
 * Comments in English per project convention.
 */

/** The UTF-8 bytes of `text`, as `Buffer.from(text, "utf8")` would produce them. */
export function utf8Bytes(text: string): Uint8Array {
    return new TextEncoder().encode(text);
}

/** The 20-byte SHA-1 digest of `input` (a string is hashed as its UTF-8 bytes). */
export function sha1(input: string | Uint8Array): Uint8Array {
    const message = typeof input === "string" ? utf8Bytes(input) : input;
    const bitLength = message.length * 8;
    // Message, the 0x80 terminator, zero padding, and the 64-bit big-endian length: a multiple of 64.
    const paddedLength = (((message.length + 8) >> 6) + 1) << 6;
    const padded = new Uint8Array(paddedLength);
    padded.set(message);
    padded[message.length] = 0x80;
    const view = new DataView(padded.buffer);
    // The high word of the length: lengths past 2^32 bits are out of scope for a naming function,
    // but the split is written out so the layout is plainly the standard one.
    view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
    view.setUint32(paddedLength - 4, bitLength >>> 0, false);

    let h0 = 0x67452301;
    let h1 = 0xefcdab89;
    let h2 = 0x98badcfe;
    let h3 = 0x10325476;
    let h4 = 0xc3d2e1f0;
    const w = new Uint32Array(80);

    for (let offset = 0; offset < paddedLength; offset += 64) {
        for (let i = 0; i < 16; i += 1) {
            w[i] = view.getUint32(offset + i * 4, false);
        }
        for (let i = 16; i < 80; i += 1) {
            const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
            w[i] = (x << 1) | (x >>> 31);
        }
        let a = h0;
        let b = h1;
        let c = h2;
        let d = h3;
        let e = h4;
        for (let i = 0; i < 80; i += 1) {
            let f: number;
            let k: number;
            if (i < 20) {
                f = (b & c) | (~b & d);
                k = 0x5a827999;
            } else if (i < 40) {
                f = b ^ c ^ d;
                k = 0x6ed9eba1;
            } else if (i < 60) {
                f = (b & c) | (b & d) | (c & d);
                k = 0x8f1bbcdc;
            } else {
                f = b ^ c ^ d;
                k = 0xca62c1d6;
            }
            const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
            e = d;
            d = c;
            c = (b << 30) | (b >>> 2);
            b = a;
            a = temp;
        }
        h0 = (h0 + a) >>> 0;
        h1 = (h1 + b) >>> 0;
        h2 = (h2 + c) >>> 0;
        h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0;
    }

    const digest = new Uint8Array(20);
    const out = new DataView(digest.buffer);
    out.setUint32(0, h0, false);
    out.setUint32(4, h1, false);
    out.setUint32(8, h2, false);
    out.setUint32(12, h3, false);
    out.setUint32(16, h4, false);
    return digest;
}

/** Lower-case hex, as `Buffer#toString("hex")` writes it. */
export function toHex(bytes: Uint8Array): string {
    let hex = "";
    for (const byte of bytes) {
        hex += byte.toString(16).padStart(2, "0");
    }
    return hex;
}
