import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { validateMobileShellManifest, type MobileShellManifest } from "./mobileShellManifest";
import { runMobileRepack } from "./runMobileRepack";
import {
  APPLE_IDENTITY_PASSWORD,
  APPLE_IDENTITY_SUBJECT_CN,
  APPLE_PROFILE_BUNDLE_ID,
  appleIdentityP12,
  appleProvisioningProfile
} from "./signingFixtures";
import { parseZipIndex, readEntryBytes } from "./zipModel";
import { resolveZsignTool } from "./zsignTool";
import type { GameBuildWorkerMobileJob } from "../protocol";

/**
 * The zsign oracle: the real vendored binary signing a real package built from
 * the real shell template, judged by an independent recomputation of what the
 * signature claims.
 *
 * Every other iOS test in this directory drives a stub, which can only show
 * that Studio calls zsign the way Studio intends. This one shows that the call
 * produces a signature that actually covers the executable - the page hashes in
 * the CodeDirectory are recomputed here from the Mach-O's own bytes, and a
 * flipped byte has to break them, or the check is theatre.
 *
 * Gated like the Android SDK oracle: it skips when the binary has not been
 * staged (a fresh checkout has not run project/build/prepare-codesign-tools.js,
 * and nothing downloads it on demand), and REQUIRE_ZSIGN_ORACLE=1 turns that
 * skip into a failure so a CI runner that lost the tool cannot look like a pass.
 */

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const TEMPLATE_DIR = path.join(REPO_ROOT, "node_modules/@narraleaf/studio-shell");
const MTIME = new Date(Date.UTC(2020, 0, 1));

// Resolved against the checkout: under vitest this file does not sit where the
// built worker does, and the subject here is the binary itself. In a real build
// the manager resolves this and hands the path over in the job.
const zsign = await resolveZsignTool({
  isPackaged: () => false,
  resolveResource: (relativePath: string) => path.resolve(REPO_ROOT, "resources", relativePath)
});
const oracleRequired = process.env.REQUIRE_ZSIGN_ORACLE === "1";
const zsignPath = zsign.available ? zsign.path : "";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/* ------------------------------------------------------- the Mach-O oracle */

const LC_CODE_SIGNATURE = 0x1d;
const MACHO_MAGIC_64_LE = 0xcffaedfe;
const EMBEDDED_SIGNATURE_MAGIC = 0xfade0cc0;
const CODE_DIRECTORY_SLOT = 0;
const CMS_SIGNATURE_SLOT = 0x10000;

type CodeDirectory = {
  identifier: string;
  /** Bytes of the file the hashes cover: everything before the signature. */
  codeLimit: number;
  pageSize: number;
  hashSize: number;
  /** SHA-256 is hash type 2; anything else would not be an iOS 12+ signature. */
  hashType: number;
  pageHashes: Buffer[];
};

/**
 * Parse the embedded code signature out of a thin little-endian 64-bit Mach-O.
 * Deliberately hand-rolled and minimal: an oracle that shared code with the
 * thing it judges would judge nothing.
 */
function readCodeSignature(macho: Buffer): { directory: CodeDirectory; hasCms: boolean } {
  expect(macho.readUInt32BE(0), "not a thin little-endian 64-bit Mach-O").toBe(MACHO_MAGIC_64_LE);
  const commandCount = macho.readUInt32LE(16);
  let offset = 32;
  let signatureOffset: number | null = null;
  for (let i = 0; i < commandCount; i++) {
    if (macho.readUInt32LE(offset) === LC_CODE_SIGNATURE) {
      signatureOffset = macho.readUInt32LE(offset + 8);
    }
    offset += macho.readUInt32LE(offset + 4);
  }
  expect(signatureOffset, "the executable carries no LC_CODE_SIGNATURE").not.toBeNull();

  const superBlob = macho.subarray(signatureOffset!);
  expect(superBlob.readUInt32BE(0)).toBe(EMBEDDED_SIGNATURE_MAGIC);
  const slotCount = superBlob.readUInt32BE(8);

  let directoryOffset: number | null = null;
  let hasCms = false;
  for (let i = 0; i < slotCount; i++) {
    const type = superBlob.readUInt32BE(12 + i * 8);
    if (type === CODE_DIRECTORY_SLOT) {
      directoryOffset = superBlob.readUInt32BE(16 + i * 8);
    } else if (type === CMS_SIGNATURE_SLOT) {
      hasCms = true;
    }
  }
  expect(directoryOffset, "the signature carries no CodeDirectory").not.toBeNull();

  const cd = superBlob.subarray(
    directoryOffset!,
    directoryOffset! + superBlob.readUInt32BE(directoryOffset! + 4)
  );
  const hashOffset = cd.readUInt32BE(16);
  const identifierOffset = cd.readUInt32BE(20);
  const codeSlots = cd.readUInt32BE(28);
  const hashSize = cd.readUInt8(36);
  return {
    hasCms,
    directory: {
      identifier: cd.subarray(identifierOffset, cd.indexOf(0, identifierOffset)).toString("utf8"),
      codeLimit: cd.readUInt32BE(32),
      hashSize,
      hashType: cd.readUInt8(37),
      pageSize: 1 << cd.readUInt8(39),
      pageHashes: Array.from({ length: codeSlots }, (_unused, i) =>
        cd.subarray(hashOffset + i * hashSize, hashOffset + (i + 1) * hashSize)
      )
    }
  };
}

/** How many of the CodeDirectory's page hashes disagree with the file's bytes. */
function countPageHashMismatches(macho: Buffer, directory: CodeDirectory): number {
  let mismatches = 0;
  for (let page = 0; page < directory.pageHashes.length; page++) {
    const start = page * directory.pageSize;
    const end = Math.min(start + directory.pageSize, directory.codeLimit);
    const actual = crypto.createHash("sha256").update(macho.subarray(start, end)).digest();
    if (!actual.equals(directory.pageHashes[page])) {
      mismatches++;
    }
  }
  return mismatches;
}

/* ------------------------------------------------------------- the subject */

async function readManifest(): Promise<MobileShellManifest> {
  return validateMobileShellManifest(
    JSON.parse(await fs.readFile(path.join(TEMPLATE_DIR, "manifest.json"), "utf8"))
  );
}

/** Build and sign a real .ipa; returns its path and the shell manifest. */
async function buildSignedIpa(): Promise<{
  ipaPath: string;
  templateManifest: MobileShellManifest;
}> {
  const templateManifest = await readManifest();
  const sourceDir = await tempDir("nls-zsign-site-");
  await fs.writeFile(path.join(sourceDir, "index.html"), "<!doctype html><title>web</title>");
  await fs.writeFile(path.join(sourceDir, "web.js"), "/* bridge */");

  const materialDir = await tempDir("nls-zsign-material-");
  const p12File = path.join(materialDir, "identity.p12");
  const provisioningProfileFile = path.join(materialDir, "profile.mobileprovision");
  await fs.writeFile(p12File, appleIdentityP12());
  await fs.writeFile(provisioningProfileFile, appleProvisioningProfile());

  const job: GameBuildWorkerMobileJob = {
    sourceDir,
    templateManifest,
    productName: "Oracle Game",
    appDirBaseName: "OracleGame",
    orientation: "landscape",
    indexHtmlOverride: "<!doctype html><title>mobile</title>",
    shellConfigJson: JSON.stringify({
      schemaVersion: 1,
      orientation: "landscape",
      backgroundColor: "#000000"
    }),
    ios: {
      templateAppZipPath: path.join(TEMPLATE_DIR, templateManifest.ios.template),
      outputName: "oracle.ipa",
      // Must be the bundle id the fixture profile was issued for; the
      // signing step refuses a mismatch, which is itself the point.
      bundleId: APPLE_PROFILE_BUNDLE_ID,
      shortVersionString: "1.2.3",
      bundleVersion: "1.2.3",
      signing: {
        p12File,
        p12Password: APPLE_IDENTITY_PASSWORD,
        provisioningProfileFile,
        toolPath: zsignPath
      }
    }
  };
  const outputDir = await tempDir("nls-zsign-out-");
  const [ipaPath] = await runMobileRepack(job, outputDir, () => undefined, MTIME);
  return { ipaPath, templateManifest };
}

/** The signed app's main executable, out of the .ipa. */
async function readExecutable(
  ipaPath: string,
  templateManifest: MobileShellManifest
): Promise<Buffer> {
  const ipa = await fs.readFile(ipaPath);
  const index = parseZipIndex(ipa);
  const name = `Payload/OracleGame.app/${templateManifest.ios.executableName}`;
  const entry = index.entries.find((candidate) => candidate.name === name);
  expect(entry, `the signed .ipa has no ${name}`).toBeDefined();
  return readEntryBytes(ipa, entry!);
}

describe("the zsign oracle's availability", () => {
  it("is present when CI demands it", () => {
    if (oracleRequired) {
      expect(zsign.available, "REQUIRE_ZSIGN_ORACLE is set but no staged zsign was found").toBe(
        true
      );
    }
  });
});

describe.skipIf(!zsign.available)("zsign on a Studio-built .ipa", () => {
  it("signs the package the repack produced", async () => {
    const { ipaPath, templateManifest } = await buildSignedIpa();
    const { directory, hasCms } = readCodeSignature(
      await readExecutable(ipaPath, templateManifest)
    );

    // hashType 2 is SHA-256, which is the only thing iOS 12+ accepts.
    expect(directory.hashType).toBe(2);
    expect(directory.hashSize).toBe(32);
    // The CodeDirectory's identifier is the app's bundle id - proof the
    // signature belongs to this app and not to the shell it came from.
    expect(directory.identifier).toBe(APPLE_PROFILE_BUNDLE_ID);
    // A CMS blob is what carries the certificate chain; ad-hoc signing has none.
    expect(hasCms).toBe(true);
  });

  it("covers the executable's bytes, page by page", async () => {
    const { ipaPath, templateManifest } = await buildSignedIpa();
    const macho = await readExecutable(ipaPath, templateManifest);
    const { directory } = readCodeSignature(macho);

    expect(directory.pageHashes.length).toBeGreaterThan(1);
    expect(countPageHashMismatches(macho, directory)).toBe(0);
  });

  it("stops covering it the moment a byte changes", async () => {
    // The reverse control. Without this the assertion above could pass on a
    // signature that hashed nothing at all.
    const { ipaPath, templateManifest } = await buildSignedIpa();
    const macho = await readExecutable(ipaPath, templateManifest);
    const { directory } = readCodeSignature(macho);

    const tampered = Buffer.from(macho);
    tampered[0x400] ^= 0xff;
    expect(countPageHashMismatches(tampered, directory)).toBe(1);
  });

  it("embeds the profile, and the identity it was signed with", async () => {
    const { ipaPath } = await buildSignedIpa();
    const ipa = await fs.readFile(ipaPath);
    const index = parseZipIndex(ipa);

    const embedded = index.entries.find(
      (entry) => entry.name === "Payload/OracleGame.app/embedded.mobileprovision"
    );
    expect(embedded, "the signed .ipa has no embedded.mobileprovision").toBeDefined();
    // Same profile, byte for byte: zsign copies it rather than rebuilding it.
    expect(readEntryBytes(ipa, embedded!).equals(appleProvisioningProfile())).toBe(true);

    const codeResources = index.entries.find(
      (entry) => entry.name === "Payload/OracleGame.app/_CodeSignature/CodeResources"
    );
    expect(codeResources, "the signed .ipa has no _CodeSignature/CodeResources").toBeDefined();

    // The signer's certificate travels in the CMS blob; find its subject
    // there rather than trusting what Studio meant to pass.
    const macho = await readExecutable(ipaPath, await readManifest());
    expect(macho.includes(Buffer.from(APPLE_IDENTITY_SUBJECT_CN, "utf8"))).toBe(true);
  });

  it("refuses a profile issued for a different app", async () => {
    // The build must not produce an .ipa no device will install; this is the
    // same judgement the signing-ios-profile-mismatch preflight makes, made
    // again at the last possible moment.
    const templateManifest = await readManifest();
    const sourceDir = await tempDir("nls-zsign-site-");
    await fs.writeFile(path.join(sourceDir, "index.html"), "<!doctype html><title>web</title>");
    const materialDir = await tempDir("nls-zsign-material-");
    const p12File = path.join(materialDir, "identity.p12");
    const provisioningProfileFile = path.join(materialDir, "profile.mobileprovision");
    await fs.writeFile(p12File, appleIdentityP12());
    await fs.writeFile(provisioningProfileFile, appleProvisioningProfile());

    const outputDir = await tempDir("nls-zsign-out-");
    await expect(
      runMobileRepack(
        {
          sourceDir,
          templateManifest,
          productName: "Oracle Game",
          appDirBaseName: "OracleGame",
          orientation: "landscape",
          indexHtmlOverride: "<!doctype html><title>mobile</title>",
          shellConfigJson: JSON.stringify({ schemaVersion: 1, orientation: "landscape" }),
          ios: {
            templateAppZipPath: path.join(TEMPLATE_DIR, templateManifest.ios.template),
            outputName: "oracle.ipa",
            bundleId: "com.example.not-the-profiles-app",
            shortVersionString: "1.2.3",
            bundleVersion: "1.2.3",
            signing: {
              p12File,
              p12Password: APPLE_IDENTITY_PASSWORD,
              provisioningProfileFile,
              toolPath: zsignPath
            }
          }
        },
        outputDir,
        () => undefined,
        MTIME
      )
    ).rejects.toThrow(/does not cover the bundle id/);

    // And nothing half-finished was left where an artifact would be.
    expect(await fs.readdir(outputDir)).toEqual([]);
  });

  it("leaves no unsigned package beside the signed one", async () => {
    const { ipaPath } = await buildSignedIpa();
    expect(await fs.readdir(path.dirname(ipaPath))).toEqual(["oracle.ipa"]);
  });
});
