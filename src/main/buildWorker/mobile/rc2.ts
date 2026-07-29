/**
 * RC2 (RFC 2268), just enough of it to open a legacy PKCS#12 keystore.
 *
 * Why hand-rolled: PKCS#12 files written by older keytool / OpenSSL protect
 * their certificate bags with `pbeWithSHAAnd40BitRC2-CBC`, and RC2 was moved
 * out of OpenSSL 3's default provider - `crypto.createDecipheriv("rc2-40-cbc")`
 * throws on every modern Node build. The repo already hand-rolls its crypto
 * formats (see `x509.ts`, `apkSigningV2.ts`) rather than take a dependency, so
 * the cipher lives here too. It is ~150 lines and is pinned by the RFC 2268
 * section 5 test vectors.
 *
 * Only what a keystore reader needs is implemented: block encrypt (so the test
 * vectors can be checked directly) and CBC decrypt. No streaming, no padding
 * policy - the caller strips PKCS#7 padding, because the caller is the one who
 * knows that bad padding means "wrong password".
 */

/** The pi table from RFC 2268 section 2 - a fixed permutation of 0..255. */
const PITABLE = Uint8Array.from([
    0xd9, 0x78, 0xf9, 0xc4, 0x19, 0xdd, 0xb5, 0xed, 0x28, 0xe9, 0xfd, 0x79, 0x4a, 0xa0, 0xd8, 0x9d,
    0xc6, 0x7e, 0x37, 0x83, 0x2b, 0x76, 0x53, 0x8e, 0x62, 0x4c, 0x64, 0x88, 0x44, 0x8b, 0xfb, 0xa2,
    0x17, 0x9a, 0x59, 0xf5, 0x87, 0xb3, 0x4f, 0x13, 0x61, 0x45, 0x6d, 0x8d, 0x09, 0x81, 0x7d, 0x32,
    0xbd, 0x8f, 0x40, 0xeb, 0x86, 0xb7, 0x7b, 0x0b, 0xf0, 0x95, 0x21, 0x22, 0x5c, 0x6b, 0x4e, 0x82,
    0x54, 0xd6, 0x65, 0x93, 0xce, 0x60, 0xb2, 0x1c, 0x73, 0x56, 0xc0, 0x14, 0xa7, 0x8c, 0xf1, 0xdc,
    0x12, 0x75, 0xca, 0x1f, 0x3b, 0xbe, 0xe4, 0xd1, 0x42, 0x3d, 0xd4, 0x30, 0xa3, 0x3c, 0xb6, 0x26,
    0x6f, 0xbf, 0x0e, 0xda, 0x46, 0x69, 0x07, 0x57, 0x27, 0xf2, 0x1d, 0x9b, 0xbc, 0x94, 0x43, 0x03,
    0xf8, 0x11, 0xc7, 0xf6, 0x90, 0xef, 0x3e, 0xe7, 0x06, 0xc3, 0xd5, 0x2f, 0xc8, 0x66, 0x1e, 0xd7,
    0x08, 0xe8, 0xea, 0xde, 0x80, 0x52, 0xee, 0xf7, 0x84, 0xaa, 0x72, 0xac, 0x35, 0x4d, 0x6a, 0x2a,
    0x96, 0x1a, 0xd2, 0x71, 0x5a, 0x15, 0x49, 0x74, 0x4b, 0x9f, 0xd0, 0x5e, 0x04, 0x18, 0xa4, 0xec,
    0xc2, 0xe0, 0x41, 0x6e, 0x0f, 0x51, 0xcb, 0xcc, 0x24, 0x91, 0xaf, 0x50, 0xa1, 0xf4, 0x70, 0x39,
    0x99, 0x7c, 0x3a, 0x85, 0x23, 0xb8, 0xb4, 0x7a, 0xfc, 0x02, 0x36, 0x5b, 0x25, 0x55, 0x97, 0x31,
    0x2d, 0x5d, 0xfa, 0x98, 0xe3, 0x8a, 0x92, 0xae, 0x05, 0xdf, 0x29, 0x10, 0x67, 0x6c, 0xba, 0xc9,
    0xd3, 0x00, 0xe6, 0xcf, 0xe1, 0x9e, 0xa8, 0x2c, 0x63, 0x16, 0x01, 0x3f, 0x58, 0xe2, 0x89, 0xa9,
    0x0d, 0x38, 0x34, 0x1b, 0xab, 0x33, 0xff, 0xb0, 0xbb, 0x48, 0x0c, 0x5f, 0xb9, 0xb1, 0xcd, 0x2e,
    0xc5, 0xf3, 0xdb, 0x47, 0xe5, 0xa5, 0x9c, 0x77, 0x0a, 0xa6, 0x20, 0x68, 0xfe, 0x7f, 0xc1, 0xad,
]);

/** Left rotation amounts for the four sub-steps of a mixing round. */
const ROTATIONS = [1, 2, 3, 5];

export const RC2_BLOCK_SIZE = 8;

function rotl16(value: number, bits: number): number {
    return ((value << bits) | (value >>> (16 - bits))) & 0xffff;
}

function rotr16(value: number, bits: number): number {
    return ((value >>> bits) | (value << (16 - bits))) & 0xffff;
}

/**
 * RFC 2268 section 2 key expansion: `key` bytes plus an effective key length in
 * bits become the 64 sixteen-bit round keys. `effectiveBits` is what actually
 * limits the strength - a 40-bit RC2 key is 5 bytes expanded with
 * `effectiveBits = 40`.
 */
export function expandRc2Key(key: Buffer, effectiveBits: number): Uint16Array {
    if (key.length < 1 || key.length > 128) {
        throw new RangeError("RC2 key must be 1 to 128 bytes");
    }
    if (effectiveBits < 1 || effectiveBits > 1024) {
        throw new RangeError("RC2 effective key length must be 1 to 1024 bits");
    }

    const L = new Uint8Array(128);
    L.set(key);
    const T = key.length;
    for (let i = T; i < 128; i++) {
        L[i] = PITABLE[(L[i - 1] + L[i - T]) & 0xff];
    }

    const T8 = Math.ceil(effectiveBits / 8);
    // 2^(8 + T1 - 8*T8) is at most 256, so plain arithmetic is exact here.
    const TM = 255 % Math.pow(2, 8 + effectiveBits - 8 * T8);
    L[128 - T8] = PITABLE[L[128 - T8] & TM];
    for (let i = 127 - T8; i >= 0; i--) {
        L[i] = PITABLE[L[i + 1] ^ L[i + T8]];
    }

    const K = new Uint16Array(64);
    for (let i = 0; i < 64; i++) {
        K[i] = L[2 * i] + (L[2 * i + 1] << 8);
    }
    return K;
}

function loadBlock(block: Buffer, offset: number): Uint16Array {
    // RC2 words are little-endian.
    const R = new Uint16Array(4);
    for (let i = 0; i < 4; i++) {
        R[i] = block[offset + 2 * i] | (block[offset + 2 * i + 1] << 8);
    }
    return R;
}

function storeBlock(R: Uint16Array, out: Buffer, offset: number): void {
    for (let i = 0; i < 4; i++) {
        out[offset + 2 * i] = R[i] & 0xff;
        out[offset + 2 * i + 1] = (R[i] >>> 8) & 0xff;
    }
}

/** One 8-byte block, encrypted in place. Exported so the RFC vectors can pin it. */
export function rc2EncryptBlock(K: Uint16Array, block: Buffer, offset = 0): void {
    const R = loadBlock(block, offset);
    let j = 0;

    const mix = (): void => {
        for (let i = 0; i < 4; i++) {
            const a = R[(i + 3) & 3];
            const b = R[(i + 2) & 3];
            const c = R[(i + 1) & 3];
            R[i] = (R[i] + K[j] + (a & b) + (~a & c)) & 0xffff;
            j++;
            R[i] = rotl16(R[i], ROTATIONS[i]);
        }
    };
    const mash = (): void => {
        for (let i = 0; i < 4; i++) {
            R[i] = (R[i] + K[R[(i + 3) & 3] & 63]) & 0xffff;
        }
    };

    for (let round = 0; round < 5; round++) mix();
    mash();
    for (let round = 0; round < 6; round++) mix();
    mash();
    for (let round = 0; round < 5; round++) mix();

    storeBlock(R, block, offset);
}

/** One 8-byte block, decrypted in place - the exact inverse of the above. */
export function rc2DecryptBlock(K: Uint16Array, block: Buffer, offset = 0): void {
    const R = loadBlock(block, offset);
    let j = 63;

    const rMix = (): void => {
        for (let i = 3; i >= 0; i--) {
            R[i] = rotr16(R[i], ROTATIONS[i]);
            const a = R[(i + 3) & 3];
            const b = R[(i + 2) & 3];
            const c = R[(i + 1) & 3];
            R[i] = (R[i] - K[j] - (a & b) - (~a & c)) & 0xffff;
            j--;
        }
    };
    const rMash = (): void => {
        for (let i = 3; i >= 0; i--) {
            R[i] = (R[i] - K[R[(i + 3) & 3] & 63]) & 0xffff;
        }
    };

    for (let round = 0; round < 5; round++) rMix();
    rMash();
    for (let round = 0; round < 6; round++) rMix();
    rMash();
    for (let round = 0; round < 5; round++) rMix();

    storeBlock(R, block, offset);
}

/** RC2-CBC decrypt. Padding is the caller's business. */
export function rc2CbcDecrypt(
    key: Buffer,
    effectiveBits: number,
    iv: Buffer,
    ciphertext: Buffer,
): Buffer {
    if (iv.length !== RC2_BLOCK_SIZE) {
        throw new RangeError("RC2-CBC needs an 8-byte initialisation vector");
    }
    if (ciphertext.length === 0 || ciphertext.length % RC2_BLOCK_SIZE !== 0) {
        throw new RangeError("RC2-CBC ciphertext length must be a non-zero multiple of 8");
    }
    const K = expandRc2Key(key, effectiveBits);
    const out = Buffer.allocUnsafe(ciphertext.length);
    let previous = iv;
    for (let offset = 0; offset < ciphertext.length; offset += RC2_BLOCK_SIZE) {
        const block = Buffer.from(ciphertext.subarray(offset, offset + RC2_BLOCK_SIZE));
        rc2DecryptBlock(K, block);
        for (let i = 0; i < RC2_BLOCK_SIZE; i++) {
            block[i] ^= previous[i];
        }
        block.copy(out, offset);
        previous = ciphertext.subarray(offset, offset + RC2_BLOCK_SIZE);
    }
    return out;
}

/** RC2-CBC encrypt. Only the tests need it, but it keeps the CBC pair honest. */
export function rc2CbcEncrypt(
    key: Buffer,
    effectiveBits: number,
    iv: Buffer,
    plaintext: Buffer,
): Buffer {
    if (iv.length !== RC2_BLOCK_SIZE) {
        throw new RangeError("RC2-CBC needs an 8-byte initialisation vector");
    }
    if (plaintext.length === 0 || plaintext.length % RC2_BLOCK_SIZE !== 0) {
        throw new RangeError("RC2-CBC plaintext length must be a non-zero multiple of 8");
    }
    const K = expandRc2Key(key, effectiveBits);
    const out = Buffer.allocUnsafe(plaintext.length);
    let previous = iv;
    for (let offset = 0; offset < plaintext.length; offset += RC2_BLOCK_SIZE) {
        const block = Buffer.from(plaintext.subarray(offset, offset + RC2_BLOCK_SIZE));
        for (let i = 0; i < RC2_BLOCK_SIZE; i++) {
            block[i] ^= previous[i];
        }
        rc2EncryptBlock(K, block);
        block.copy(out, offset);
        previous = out.subarray(offset, offset + RC2_BLOCK_SIZE);
    }
    return out;
}
