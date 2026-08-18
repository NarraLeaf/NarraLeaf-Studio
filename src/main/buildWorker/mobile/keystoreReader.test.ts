import crypto from "crypto";
import { describe, expect, it } from "vitest";
import {
  detectKeystoreFormat,
  KeystoreError,
  type KeystoreErrorCode,
  listAliases,
  readKeystore,
  type KeystoreIdentity
} from "./keystoreReader";
import type { SigningIdentity } from "./signingIdentity";

/**
 * Fixtures below are real keystores, generated once with the JDK's keytool and
 * with OpenSSL and pasted in as base64 - the tests never shell out, because CI
 * is not guaranteed to have either tool. How each was made is recorded next to
 * it so it can be regenerated.
 *
 * The expected values (modulus, serial, SHA-256 fingerprint) were read back out
 * of the same files by OpenSSL, not by this parser, so a bug here shows up as a
 * mismatch rather than as two wrongs agreeing:
 *
 *   openssl pkcs12 -in <file> -nodes -passin pass:<pw> > all.pem
 *   openssl rsa  -in all.pem -noout -modulus
 *   openssl x509 -in all.pem -noout -serial -subject -issuer -fingerprint -sha256
 *
 * The two JKS fixtures went through `keytool -importkeystore` into a throwaway
 * PKCS#12 first, since OpenSSL cannot read JKS; that conversion is keytool's
 * work, not this module's, so it is still an outside opinion.
 */

const MODERN_P12 = Buffer.from(
  "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",
  "base64"
);

const LEGACY_P12 = Buffer.from(
  "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",
  "base64"
);

const CHAIN_P12 = Buffer.from(
  "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",
  "base64"
);

const TWO_ENTRY_P12 = Buffer.from(
  "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",
  "base64"
);

const BASIC_JKS = Buffer.from(
  "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",
  "base64"
);

const SPLIT_PASSWORD_JKS = Buffer.from(
  "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",
  "base64"
);

/**
 * A JKS holding one trusted certificate and no key at all, made with:
 *   keytool -importcert -alias trusted -file leaf.der -keystore certonly.jks \n *     -storetype JKS -storepass storepass
 * Picking a certificate export instead of a keystore is a real mistake to make.
 */
const CERTIFICATE_ONLY_JKS = Buffer.from(
  "/u3+7QAAAAIAAAABAAAAAgAHdHJ1c3RlZAAAAZ+quTbIAAVYLjUwOQAAA0UwggNBMIICKaADAgECAggBAgMEBQYHCDANBgkqhkiG9w0BAQsFADA9MQsw" +
    "CQYDVQQGEwJVUzESMBAGA1UECgwJTmFycmFMZWFmMRowGAYDVQQDDBFOYXJyYUxlYWYgVGVzdCBDQTAeFw0yNjA3MjgyMTM5MjZaFw0zNjA3MjUyMTM5" +
    "MjZaMEAxCzAJBgNVBAYTAlVTMRIwEAYDVQQKDAlOYXJyYUxlYWYxHTAbBgNVBAMMFE5hcnJhTGVhZiBDaGFpbiBMZWFmMIIBIjANBgkqhkiG9w0BAQEF" +
    "AAOCAQ8AMIIBCgKCAQEA6KeigRzYIprKsSdn7aKVA7nrORVFsbA6NEO3IPw2ftBOHjDhzZmVxKIRCAp8ioq7Hwz6n/3mTaGP1gcs/Zex95OKVh+R2QUg" +
    "eTItctyDvgpCJfV/5HmuncCTPAwWo/G5eo6vexg+ka7Cn4fTqEVslFOqskbWfpQMn0vqa0QUh0Mxb8O27O8AOZY2gdk2oU1tIyWrOINIbFymjosUeR95" +
    "IIqlIx4db1JV+t1TSLD/gy4MlKtD7QZmJWvrmcIwIWBS2srDgWE8fagfB+3dx2WHsIgDEiNyGZh6kEj3RoSzFmZzEXuFbCh8S7zmE5bdOJ3vxcQPCWlS" +
    "OxjG+UNGNAzqQwIDAQABo0IwQDAdBgNVHQ4EFgQU56dkSNXe3JeQqUjyvOb1NJRSqKowHwYDVR0jBBgwFoAU3plG9Vb70j5GgXQ0r12jhcTsGcowDQYJ" +
    "KoZIhvcNAQELBQADggEBABWUHmK+ZQJfjr2P8C4y2e+1RmfUhYSl+SBjZ7ub3Em76C/BQsZl88GLfohhTnd1tL57RqC+Q90wxEfbsomWP09r4q47MfE2" +
    "Rk/31Nvp6K0pekggmqgHSdaj5/q9b4h3yMrrZKmM/YMqvA6xf6nIaawBw3/KgtbP4cKmzVv3ojAj/CxPkPrgU1V7eR01AEi0uax6XSdmrGLj85f7Cuc9" +
    "bmoz7tPHoVexJziMay0wEItBg20azBJLzJmZAuGBSdikyVgVk3bj3Z7FP6Jejm321aYkxYHF/CW4/IFY5CrypbU4J13wuy7OQV4kxYfkYrCeHTH/OHMC" +
    "F62dxcrDKUhqqa0e67COCshWh8OVUMSFe24QkzsNWA==",
  "base64"
);

/* ------------------------------------------------------------- oracle data */

type Expected = {
  /** RSA modulus, upper-case hex, as printed by `openssl rsa -modulus`. */
  modulus: string;
  /** `openssl x509 -serial`. */
  serial: string;
  /** `openssl x509 -fingerprint -sha256`, colons and all. */
  fingerprint: string;
  commonName: string;
};

/**
 * modern.p12 and the JKS stores were each made with:
 *   keytool -genkeypair -alias <alias> -keyalg RSA -keysize 2048 -validity 3650 \
 *     -dname "CN=<cn>, O=NarraLeaf, C=US" -sigalg SHA256withRSA \
 *     -keystore <file> -storetype <PKCS12|JKS> -storepass <pw> -keypass <pw>
 */
const KEYTOOL_DEFAULT: Expected = {
  modulus:
    "D69F87711A079B98F98C2D47A318A3BBE60E6E5EB43F492D489084E0D2C534B043E0EAC6F735A9D0ED391FE5B14AB" +
    "E02F32B735C0CA38A697AE5EADAD66EDCEBCC05DC5999E578BFCB510E065A9F5B63BEECC23639DE833B5A57D91517" +
    "C435818970B9F237613C522978B28BB6F0BE87FEC23A609ECFFE9B2EDF289E7D3588968CDFDFDFE217F93DDD1F0E5" +
    "7FEDE79909896EA60FE2CFAC908A8A244B79F8B1738BBF29276A0AA86117921FF60844B18AB937F939640F0CCE5B7" +
    "4FE37C3C0860E6B0D04B77C77A666CB8D4B2440D10C9F5E35DA0329C3831E5D605DAA5D6DAF9E00037181D521453D" +
    "24A93CDFB6D520A882BE883BE18B39E8A3F1920210D5A93",
  serial: "24A44A5081983C20",
  fingerprint:
    "82:61:B5:15:5D:A2:87:86:27:82:DB:32:46:3F:C6:FE:E4:DD:CC:94:34:82:86:91:5A:6E:15:88:A3:16:C4:17",
  commonName: "NarraLeaf Test"
};

const TWO_ENTRY_ALPHA: Expected = {
  modulus:
    "BF5B374BDBB9F9F633D97D72B9FC56A44A60D4D6BD23AF757CE25EB8215005A20925AED367AC2D5B0744A6334403F" +
    "01BB6F23DCE7880EB17017FE03650BD99BF0116BC7C128642E855B9FBEFEA84AECD1460CE23C27D054297A6BF5656" +
    "21C19EAD5E75C9CC86FB9F71CEB8584F8AD793A85D742845AF53F290780C9A1845088F4703A934EC91490763BF2FC" +
    "5A5A916E14E0759772ED01D35315C990E5E8C4305D85F0FB29BBFD0360D8C6D201DEE68DEB49EF252A7087EAAE1D7" +
    "85DBB0F9E433EF19C8DD0945FD754334D07F16431DDD590C9914C13E33B3B0ABEDCB76D0FDFAE0BD9C1B9399BD191" +
    "93E32BBD4F605AA138A55B06AE5A1E41E7BD63C274C3C23",
  serial: "72FBCC9CB1E5EEC2",
  fingerprint:
    "E3:BD:0C:C5:6A:86:74:BC:00:DA:B5:8A:62:30:8C:34:00:D1:FD:22:CA:80:85:CE:55:D4:C7:FD:7D:9F:30:D1",
  commonName: "Alpha"
};

const TWO_ENTRY_BETA: Expected = {
  modulus:
    "A49672579299EC6C148161CEC74F721A50E7D87B93DCFB970BDF6344D92D7A19209AE485CCA5426F3291E9A6DA1B6" +
    "E6978CC2CB3F1F53D0BF74A7BAF19A59B9FF7C24B29213201714016A3C2404F1A39C6BF2083B95A3D2CEA2BB54279" +
    "AE6B8548D4007856B59DC395086ECB9A91DE2E89A88C38E1FF4F6AF7DE33D4CB4EEB475BE344A034ECB6897B8EC33" +
    "D06026A1F1B2443AB571AAE0531CEFBB586D05F46226C6FB46E55C097297AB6B0C63089FF4D6C93A5CE7F8EDB1157" +
    "1C99CBAAA04D4257A206164D8BAEA050CB2788A9A84EA29642C366FED48166263A2FAB429D4B1A5BC47BD05AC9C80" +
    "5582A0F4509AE6F1D3BA36F5EAE5A73AB856F2FC16E710D",
  serial: "4D74BE4D67658BAA",
  fingerprint:
    "1D:3F:95:FA:A7:71:01:40:DC:B4:59:84:06:7F:60:19:37:B7:05:C2:C7:15:98:26:30:88:96:1E:B7:45:53:E0",
  commonName: "Beta"
};

const BASIC_JKS_EXPECTED: Expected = {
  modulus:
    "D1FC901822BCAD2D50CDDE5240897C5C130A5F1701FFC7F7610FE7355F08704C6118DF06DDE945E9CCF0DAE55A8E8" +
    "D3CDC12167689BB6AF27FDD6DA50DD9DEDC924FD69485209B127BE23E45E5BC8FCAC303426DB61A0CC33D446048F7" +
    "1E41B452D5B97B8B555C36BF040B957EA98D6A4CE6D48A66E3DD57C30BC7E0B34619FC9C91AB5EA5C68DAADD8C424" +
    "4A878EB5D73CF254543C0427E0B47A75F677BA1A27649A745A09EA7D4409910838762520956E2E3E1D003797CECB1" +
    "786F3ED78B7DACCED086EEB7E21D0A7C659B70F306D491028DE952532A24FDCC767EFEF368E53E1F5DB59AD67780F" +
    "4AA2407B383BED00FD4FF32179889ABC1FBC5A533BCCE09",
  serial: "ABE201FAA9D3BFEF",
  fingerprint:
    "12:2F:39:AA:9C:FA:83:D3:29:F7:A7:9E:3A:F2:B5:85:15:BF:3C:B6:A8:6D:23:87:75:A2:4C:A3:CC:D5:C8:E2",
  commonName: "NarraLeaf JKS"
};

const SPLIT_PASSWORD_JKS_EXPECTED: Expected = {
  modulus:
    "87B2A7C7BB3CF14C816B65859D63DE388350799A22EAA310487AFFEE231623272778856D129C131957D0EDE52A4E5" +
    "C9D5CA16D3CB1BA3E9FCD4AC0B00DCF057EF97EC7A9584ADE825CF8CA50D77850B11A8FBC7D54C6C9CB8D4C970851" +
    "97D4626DD0EF0AA1B4BE485FA22D01789D521C437837868F78F4D398A7B0E4E4D56A18BA5F2FF3740355447F6C5DD" +
    "27826185FD8C1AA8D201FD6DF5F9846BFCB822A2F236146E86D751C093D610ACE6271B2A4F47CBEF3F6C7BD5DD9FE" +
    "03ADA5756F044454FCB850F99074778E317FDB7ACB6E6C2F834058866B1963F71D279B8A0BEC6DCA78A1EFFB44445" +
    "7AE89773910D3259354B63E986EE3DB7428AA06D051B859",
  serial: "5156E7084CEC478C",
  fingerprint:
    "A1:22:54:98:37:4B:32:31:93:B0:75:8B:93:D2:89:B5:4C:AB:43:3B:EB:04:F5:24:4E:C5:ED:E6:15:A3:E0:FD",
  commonName: "NarraLeaf SplitPass"
};

const CHAIN_LEAF: Expected = {
  modulus:
    "E8A7A2811CD8229ACAB12767EDA29503B9EB391545B1B03A3443B720FC367ED04E1E30E1CD9995C4A211080A7C8A8" +
    "ABB1F0CFA9FFDE64DA18FD6072CFD97B1F7938A561F91D9052079322D72DC83BE0A4225F57FE479AE9DC0933C0C16" +
    "A3F1B97A8EAF7B183E91AEC29F87D3A8456C9453AAB246D67E940C9F4BEA6B44148743316FC3B6ECEF0039963681D" +
    "936A14D6D2325AB3883486C5CA68E8B14791F79208AA5231E1D6F5255FADD5348B0FF832E0C94AB43ED0666256BEB" +
    "99C230216052DACAC381613C7DA81F07EDDDC76587B0880312237219987A9048F74684B3166673117B856C287C4BB" +
    "CE61396DD389DEFC5C40F0969523B18C6F94346340CEA43",
  serial: "0102030405060708",
  fingerprint:
    "2D:A4:A8:05:84:E6:20:BE:9D:6A:2F:94:D2:4C:2D:37:D9:42:A9:CF:70:65:4F:71:AA:E7:E7:59:5A:F3:EA:99",
  commonName: "NarraLeaf Chain Leaf"
};

const CHAIN_ROOT_FINGERPRINT =
  "96:76:7A:AB:8C:1B:91:60:36:25:14:57:80:12:FE:97:00:39:DD:A8:44:D0:7E:84:CE:B6:CC:55:E0:65:C8:BE";

const STORE_PASSWORD = "storepass";
const SPLIT_KEY_PASSWORD = "keypass2";

const EVERY_FIXTURE = [
  MODERN_P12,
  LEGACY_P12,
  CHAIN_P12,
  TWO_ENTRY_P12,
  BASIC_JKS,
  SPLIT_PASSWORD_JKS
];

/* ----------------------------------------------------------------- helpers */

/** The modulus of the extracted key, in the shape `openssl rsa -modulus` prints. */
function modulusOf(identity: KeystoreIdentity): string {
  const jwk = crypto.createPublicKey(identity.privateKeyPem).export({ format: "jwk" });
  return Buffer.from(jwk.n as string, "base64url")
    .toString("hex")
    .toUpperCase();
}

function leafOf(identity: KeystoreIdentity): crypto.X509Certificate {
  return new crypto.X509Certificate(Buffer.from(identity.certificateDerBase64, "base64"));
}

/** Everything an outside tool already told us about one identity, checked at once. */
function expectMatchesOracle(identity: KeystoreIdentity, expected: Expected): void {
  expect(modulusOf(identity)).toBe(expected.modulus);

  const leaf = leafOf(identity);
  expect(leaf.serialNumber).toBe(expected.serial);
  expect(leaf.fingerprint256).toBe(expected.fingerprint);
  expect(leaf.subject).toContain(`CN=${expected.commonName}`);

  // The leaf really does belong to the key we returned, and the pair signs.
  const privateKey = crypto.createPrivateKey(identity.privateKeyPem);
  expect(leaf.checkPrivateKey(privateKey)).toBe(true);
  const message = Buffer.from("narraleaf release signing");
  const signature = crypto.sign("sha256", message, privateKey);
  expect(crypto.verify("sha256", message, leaf.publicKey, signature)).toBe(true);

  // The chain leads with the leaf.
  expect(identity.certificateChainDerBase64[0]).toBe(identity.certificateDerBase64);
}

function expectKeystoreError(run: () => unknown, code: KeystoreErrorCode): KeystoreError {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(KeystoreError);
  const error = thrown as KeystoreError;
  expect(error.code).toBe(code);
  return error;
}

/** Flip one bit in the middle of the file, inside the protected payload. */
function corrupt(file: Buffer): Buffer {
  const copy = Buffer.from(file);
  copy[Math.floor(copy.length / 2)] ^= 0x01;
  return copy;
}

/* ------------------------------------------------------------------- tests */

describe("detectKeystoreFormat", () => {
  it("reads the format from the leading bytes, not the name", () => {
    expect(detectKeystoreFormat(MODERN_P12)).toBe("pkcs12");
    expect(detectKeystoreFormat(LEGACY_P12)).toBe("pkcs12");
    expect(detectKeystoreFormat(CHAIN_P12)).toBe("pkcs12");
    expect(detectKeystoreFormat(BASIC_JKS)).toBe("jks");
    expect(detectKeystoreFormat(SPLIT_PASSWORD_JKS)).toBe("jks");
  });

  it("names JCEKS specifically, since the fix differs", () => {
    const jceks = Buffer.concat([Buffer.from("cececece", "hex"), Buffer.alloc(64)]);
    const error = expectKeystoreError(() => detectKeystoreFormat(jceks), "unsupported-format");
    expect(error.message).toContain("JCEKS");
    expect(error.message).toContain("keytool -importkeystore");
  });

  it("rejects a file that is not a keystore at all", () => {
    const error = expectKeystoreError(
      () => detectKeystoreFormat(Buffer.from("PK this is a zip file")),
      "unsupported-format"
    );
    expect(error.message).toContain(".p12");
    expect(error.message).toContain(".jks");
  });
});

describe("readKeystore - PKCS#12 from modern keytool (PBES2, AES-256-CBC, HMAC-SHA256)", () => {
  it("extracts the key and certificate OpenSSL reports for the same file", () => {
    const identity = readKeystore(MODERN_P12, { storePassword: STORE_PASSWORD });
    expectMatchesOracle(identity, KEYTOOL_DEFAULT);
    expect(identity.alias).toBe("release");
    expect(identity.certificateChainDerBase64).toHaveLength(1);
  });

  it("is assignable to the SigningIdentity the v2 signer already takes", () => {
    const identity = readKeystore(MODERN_P12, { storePassword: STORE_PASSWORD });
    const asSigningIdentity: SigningIdentity = identity;
    expect(asSigningIdentity.privateKeyPem).toContain("BEGIN PRIVATE KEY");
    expect(asSigningIdentity.certificateDerBase64).toBe(identity.certificateDerBase64);
  });

  it("lists its alias", () => {
    expect(listAliases(MODERN_P12, STORE_PASSWORD)).toEqual(["release"]);
  });
});

describe("readKeystore - legacy PKCS#12 (PBES1: 3DES for the key, 40-bit RC2 for the certificates)", () => {
  it("uses a cipher Node itself does not offer, which is why RC2 is hand-rolled", () => {
    expect(crypto.getCiphers()).not.toContain("rc2-40-cbc");
  });

  it("yields the same key and certificate as the modern copy it was converted from", () => {
    const identity = readKeystore(LEGACY_P12, { storePassword: STORE_PASSWORD });
    expectMatchesOracle(identity, KEYTOOL_DEFAULT);
    expect(identity.alias).toBe("release");
  });
});

describe("readKeystore - PKCS#12 holding a certificate chain (PBES2, AES-128-CBC)", () => {
  it("returns the chain leaf first", () => {
    const identity = readKeystore(CHAIN_P12, { storePassword: STORE_PASSWORD });
    expectMatchesOracle(identity, CHAIN_LEAF);

    expect(identity.certificateChainDerBase64).toHaveLength(2);
    const [leaf, root] = identity.certificateChainDerBase64.map(
      (der) => new crypto.X509Certificate(Buffer.from(der, "base64"))
    );
    expect(leaf.fingerprint256).toBe(CHAIN_LEAF.fingerprint);
    expect(root.fingerprint256).toBe(CHAIN_ROOT_FINGERPRINT);
    expect(leaf.issuer).toBe(root.subject);
    expect(leaf.checkIssued(root)).toBe(true);
  });
});

describe("readKeystore - choosing between two keys", () => {
  it("lists both aliases in file order", () => {
    expect(listAliases(TWO_ENTRY_P12, STORE_PASSWORD)).toEqual(["alpha", "beta"]);
  });

  it("returns the key the caller asked for", () => {
    expectMatchesOracle(
      readKeystore(TWO_ENTRY_P12, { storePassword: STORE_PASSWORD, alias: "alpha" }),
      TWO_ENTRY_ALPHA
    );
    expectMatchesOracle(
      readKeystore(TWO_ENTRY_P12, { storePassword: STORE_PASSWORD, alias: "beta" }),
      TWO_ENTRY_BETA
    );
  });

  it("matches an alias without regard to case, as keytool does", () => {
    const identity = readKeystore(TWO_ENTRY_P12, { storePassword: STORE_PASSWORD, alias: "BETA" });
    expect(identity.alias).toBe("beta");
  });

  it("refuses to guess when no alias is given", () => {
    const error = expectKeystoreError(
      () => readKeystore(TWO_ENTRY_P12, { storePassword: STORE_PASSWORD }),
      "ambiguous-alias"
    );
    expect(error.message).toContain("alpha");
    expect(error.message).toContain("beta");
  });

  it("lists what is available when the alias is not there", () => {
    const error = expectKeystoreError(
      () => readKeystore(TWO_ENTRY_P12, { storePassword: STORE_PASSWORD, alias: "gamma" }),
      "alias-not-found"
    );
    expect(error.message).toContain('"gamma"');
    expect(error.message).toContain("alpha, beta");
  });
});

describe("readKeystore - JKS", () => {
  it("extracts the key and certificate keytool and OpenSSL report for the same file", () => {
    const identity = readKeystore(BASIC_JKS, { storePassword: STORE_PASSWORD });
    expectMatchesOracle(identity, BASIC_JKS_EXPECTED);
    expect(identity.alias).toBe("release");
    expect(identity.certificateChainDerBase64).toHaveLength(1);
  });

  it("lists its alias", () => {
    expect(listAliases(BASIC_JKS, STORE_PASSWORD)).toEqual(["release"]);
  });

  it("opens a store whose key carries its own password", () => {
    const identity = readKeystore(SPLIT_PASSWORD_JKS, {
      storePassword: STORE_PASSWORD,
      keyPassword: SPLIT_KEY_PASSWORD
    });
    expectMatchesOracle(identity, SPLIT_PASSWORD_JKS_EXPECTED);
  });
});

describe("readKeystore - each failure says something different", () => {
  it("names the store password when the store password is wrong", () => {
    for (const file of EVERY_FIXTURE) {
      const error = expectKeystoreError(
        () => readKeystore(file, { storePassword: "not the password", alias: "alpha" }),
        "wrong-store-password"
      );
      expect(error.message).toContain("keystore password is incorrect");
    }
  });

  it("reports a wrong store password from listAliases too", () => {
    expectKeystoreError(() => listAliases(MODERN_P12, "wrong"), "wrong-store-password");
    expectKeystoreError(() => listAliases(BASIC_JKS, "wrong"), "wrong-store-password");
  });

  it("says the key carries its own password when none was supplied", () => {
    const error = expectKeystoreError(
      () => readKeystore(SPLIT_PASSWORD_JKS, { storePassword: STORE_PASSWORD }),
      "wrong-key-password"
    );
    expect(error.message).toContain("its own password");
    expect(error.message).not.toContain("keystore password is incorrect");
  });

  it("says the key password is wrong when one was supplied and is wrong", () => {
    const error = expectKeystoreError(
      () =>
        readKeystore(SPLIT_PASSWORD_JKS, {
          storePassword: STORE_PASSWORD,
          keyPassword: "nope"
        }),
      "wrong-key-password"
    );
    expect(error.message).toContain("key password");
    expect(error.message).toContain("incorrect");
  });

  it("tells a wrong key password apart from a wrong store password in PKCS#12 too", () => {
    const error = expectKeystoreError(
      () => readKeystore(MODERN_P12, { storePassword: STORE_PASSWORD, keyPassword: "nope" }),
      "wrong-key-password"
    );
    expect(error.message).toContain("incorrect");
  });

  it("never repeats a password back in an error message", () => {
    const secret = "hunter2-do-not-echo-me";
    for (const file of EVERY_FIXTURE) {
      let message = "";
      try {
        readKeystore(file, { storePassword: secret, keyPassword: secret });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toBe("");
      expect(message).not.toContain(secret);
    }
  });

  it("says so when the file holds certificates but no key", () => {
    const error = expectKeystoreError(
      () => readKeystore(CERTIFICATE_ONLY_JKS, { storePassword: STORE_PASSWORD }),
      "no-key-entry"
    );
    expect(error.message).toContain("no signing keys");
    expect(listAliases(CERTIFICATE_ONLY_JKS, STORE_PASSWORD)).toEqual([]);
  });

  it("names an algorithm it cannot handle instead of failing vaguely", () => {
    // Hand-built rather than generated: this is the only way to get a
    // keystore whose integrity check uses MD5, which no shipping keytool
    // writes but which older third-party tools do.
    const der = (tag: number, ...parts: Buffer[]): Buffer => {
      const body = Buffer.concat(parts);
      return Buffer.concat([Buffer.from([tag, body.length]), body]);
    };
    const OID_MD5 = Buffer.from([0x06, 0x08, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x02, 0x05]);
    const OID_PKCS7_DATA = Buffer.from([
      0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01
    ]);
    const md5MacKeystore = der(
      0x30,
      Buffer.from([0x02, 0x01, 0x03]), // version 3
      der(0x30, OID_PKCS7_DATA, der(0xa0, der(0x04))), // authSafe, empty
      der(
        0x30, // MacData
        der(0x30, der(0x30, OID_MD5, Buffer.from([0x05, 0x00])), der(0x04, Buffer.alloc(16))),
        der(0x04, Buffer.alloc(8)), // salt
        Buffer.from([0x02, 0x01, 0x01]) // iterations
      )
    );

    expect(detectKeystoreFormat(md5MacKeystore)).toBe("pkcs12");
    const error = expectKeystoreError(
      () => readKeystore(md5MacKeystore, { storePassword: STORE_PASSWORD }),
      "unsupported-algorithm"
    );
    expect(error.message).toContain("1.2.840.113549.2.5");
    expect(error.message).toContain("keytool -importkeystore");
  });
});

describe("readKeystore - a damaged file is refused, not parsed", () => {
  it("rejects a one-bit change in the middle of every fixture", () => {
    for (const file of EVERY_FIXTURE) {
      const damaged = corrupt(file);
      expect(damaged.length).toBe(file.length);
      expect(damaged.equals(file)).toBe(false);

      let thrown: unknown;
      try {
        readKeystore(damaged, { storePassword: STORE_PASSWORD, alias: "alpha" });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(KeystoreError);
    }
  });

  it("rejects a truncated file", () => {
    expectKeystoreError(
      () => readKeystore(MODERN_P12.subarray(0, 400), { storePassword: STORE_PASSWORD }),
      "damaged-file"
    );
    expectKeystoreError(
      () => readKeystore(BASIC_JKS.subarray(0, 40), { storePassword: STORE_PASSWORD }),
      "wrong-store-password"
    );
  });
});
