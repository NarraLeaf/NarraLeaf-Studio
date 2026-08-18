import { describe, expect, it } from "vitest";
import {
  expandRc2Key,
  rc2CbcDecrypt,
  rc2CbcEncrypt,
  rc2DecryptBlock,
  rc2EncryptBlock
} from "./rc2";

/**
 * The eight vectors published in RFC 2268 section 5. They are the only external
 * oracle this cipher has - OpenSSL 3 will not do RC2 at all - so every one of
 * them is checked, in both directions.
 */
const RFC_2268_VECTORS = [
  {
    keyHex: "0000000000000000",
    effectiveBits: 63,
    plainHex: "0000000000000000",
    cipherHex: "ebb773f993278eff"
  },
  {
    keyHex: "ffffffffffffffff",
    effectiveBits: 64,
    plainHex: "ffffffffffffffff",
    cipherHex: "278b27e42e2f0d49"
  },
  {
    keyHex: "3000000000000000",
    effectiveBits: 64,
    plainHex: "1000000000000001",
    cipherHex: "30649edf9be7d2c2"
  },
  { keyHex: "88", effectiveBits: 64, plainHex: "0000000000000000", cipherHex: "61a8a244adacccf0" },
  {
    keyHex: "88bca90e90875a",
    effectiveBits: 64,
    plainHex: "0000000000000000",
    cipherHex: "6ccf4308974c267f"
  },
  {
    keyHex: "88bca90e90875a7f0f79c384627bafb2",
    effectiveBits: 64,
    plainHex: "0000000000000000",
    cipherHex: "1a807d272bbe5db1"
  },
  {
    keyHex: "88bca90e90875a7f0f79c384627bafb2",
    effectiveBits: 128,
    plainHex: "0000000000000000",
    cipherHex: "2269552ab0f85ca6"
  },
  {
    keyHex: "88bca90e90875a7f0f79c384627bafb216f80a6f85920584c42fceb0be255daf1e",
    effectiveBits: 129,
    plainHex: "0000000000000000",
    cipherHex: "5b78d3a43dfff1f1"
  }
] as const;

describe("rc2 - RFC 2268 section 5 vectors", () => {
  for (const vector of RFC_2268_VECTORS) {
    const label = `key ${vector.keyHex} / ${vector.effectiveBits} effective bits`;

    it(`encrypts ${label}`, () => {
      const K = expandRc2Key(Buffer.from(vector.keyHex, "hex"), vector.effectiveBits);
      const block = Buffer.from(vector.plainHex, "hex");
      rc2EncryptBlock(K, block);
      expect(block.toString("hex")).toBe(vector.cipherHex);
    });

    it(`decrypts ${label}`, () => {
      const K = expandRc2Key(Buffer.from(vector.keyHex, "hex"), vector.effectiveBits);
      const block = Buffer.from(vector.cipherHex, "hex");
      rc2DecryptBlock(K, block);
      expect(block.toString("hex")).toBe(vector.plainHex);
    });
  }
});

describe("rc2 - CBC", () => {
  it("round-trips several blocks", () => {
    const key = Buffer.from("88bca90e90", "hex"); // 40-bit, the PKCS#12 case
    const iv = Buffer.from("0102030405060708", "hex");
    const plaintext = Buffer.from("the quick brown fox jumps over th", "utf8").subarray(0, 32);

    const ciphertext = rc2CbcEncrypt(key, 40, iv, plaintext);
    expect(ciphertext.equals(plaintext)).toBe(false);
    expect(rc2CbcDecrypt(key, 40, iv, ciphertext).equals(plaintext)).toBe(true);
  });

  it("chains blocks - two identical plaintext blocks encrypt differently", () => {
    const key = Buffer.from("0102030405", "hex");
    const iv = Buffer.alloc(8);
    const plaintext = Buffer.concat([Buffer.alloc(8, 0xaa), Buffer.alloc(8, 0xaa)]);

    const ciphertext = rc2CbcEncrypt(key, 40, iv, plaintext);
    expect(ciphertext.subarray(0, 8).equals(ciphertext.subarray(8, 16))).toBe(false);
  });

  it("rejects a wrong-sized initialisation vector", () => {
    expect(() => rc2CbcDecrypt(Buffer.alloc(5), 40, Buffer.alloc(16), Buffer.alloc(8))).toThrow(
      /8-byte initialisation vector/
    );
  });

  it("rejects a ciphertext that is not a whole number of blocks", () => {
    expect(() => rc2CbcDecrypt(Buffer.alloc(5), 40, Buffer.alloc(8), Buffer.alloc(9))).toThrow(
      /multiple of 8/
    );
  });

  it("rejects an empty key", () => {
    expect(() => expandRc2Key(Buffer.alloc(0), 40)).toThrow(/1 to 128 bytes/);
  });
});
