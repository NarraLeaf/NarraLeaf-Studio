import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { readKeystore } from "./keystoreReader";
import { writePasswordlessPkcs12 } from "./pkcs12Writer";
import { IpaSigningError, signIpa, type ZsignRun } from "./signIpa";
import {
  APPLE_IDENTITY_PASSWORD,
  APPLE_IDENTITY_SUBJECT_CN,
  APPLE_PROFILE_APP_ID,
  APPLE_PROFILE_BUNDLE_ID,
  APPLE_PROFILE_NAME,
  appleIdentityP12,
  appleProvisioningProfile
} from "./signingFixtures";
import type { ZsignTool } from "./zsignTool";
import type { GameBuildWorkerIosSigning } from "../protocol";

/**
 * zsign itself is not run here - the real binary is the gated oracle in
 * zsignOracle.test.ts. What these tests pin is everything around the
 * invocation, which is where the interesting decisions are: that the password
 * never reaches the command line, that the ephemeral container really does hold
 * the identity, that it is gone afterwards on every path, and that the two
 * failures an author can actually hit (a leaf-only export, a profile for a
 * different app) are named before zsign gets a chance to produce a worse
 * message.
 */

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-signipa-test-"));
  tempDirs.push(dir);
  return dir;
}

const AVAILABLE: ZsignTool = { available: true, path: "C:/nowhere/zsign.exe" };

type Invocation = { executable: string; args: string[]; keystoreAtCallTime: Buffer | null };

/**
 * A stand-in zsign that records how it was called, snapshots the ephemeral
 * container while it still exists, and writes whatever output the test wants.
 */
function recorder(behavior: (invocation: Invocation) => Promise<ZsignRun> | ZsignRun) {
  const calls: Invocation[] = [];
  const run = async (executable: string, args: string[]): Promise<ZsignRun> => {
    const keyPath = args[args.indexOf("-k") + 1];
    const invocation: Invocation = {
      executable,
      args,
      keystoreAtCallTime: await fs.readFile(keyPath).catch(() => null)
    };
    calls.push(invocation);
    return behavior(invocation);
  };
  return { calls, run };
}

/** zsign's successful shape: exit 0 and the output file on disk. */
function succeeds() {
  return recorder(async (invocation) => {
    await fs.writeFile(invocation.args[invocation.args.indexOf("-o") + 1], "signed package bytes");
    return { exitCode: 0, output: ">>> Signed OK! (0.030s)\n>>> Done." };
  });
}

async function fixtureFiles(): Promise<{ dir: string; signing: GameBuildWorkerIosSigning }> {
  const dir = await tempDir();
  const p12File = path.join(dir, "identity.p12");
  const provisioningProfileFile = path.join(dir, "profile.mobileprovision");
  await fs.writeFile(p12File, appleIdentityP12());
  await fs.writeFile(provisioningProfileFile, appleProvisioningProfile());
  return {
    dir,
    signing: {
      p12File,
      p12Password: APPLE_IDENTITY_PASSWORD,
      provisioningProfileFile,
      toolPath: "C:/nowhere/zsign.exe"
    }
  };
}

async function options(overrides: Partial<Parameters<typeof signIpa>[0]> = {}) {
  const { dir, signing } = await fixtureFiles();
  const unsignedIpaPath = path.join(dir, "game.ipa.unsigned");
  await fs.writeFile(unsignedIpaPath, "unsigned package bytes");
  return {
    tool: AVAILABLE,
    unsignedIpaPath,
    signedIpaPath: path.join(dir, "game.ipa"),
    bundleId: APPLE_PROFILE_BUNDLE_ID,
    displayName: "My Game",
    signing,
    tempDirRoot: dir,
    now: new Date("2027-01-01T00:00:00Z"),
    ...overrides
  };
}

async function expectFailure(promise: Promise<unknown>, code: string): Promise<IpaSigningError> {
  const error = await promise.then(
    () => null,
    (thrown: unknown) => thrown
  );
  expect(error, "expected signIpa to fail").toBeInstanceOf(IpaSigningError);
  const signingError = error as IpaSigningError;
  expect(signingError.code).toBe(code);
  return signingError;
}

describe("signIpa", () => {
  it("never puts the password on the command line", async () => {
    const zsign = succeeds();
    await signIpa({ ...(await options()), run: zsign.run });

    const [call] = zsign.calls;
    expect(call.args).not.toContain("-p");
    expect(call.args).not.toContain("--password");
    // Nothing in argv may even contain the password as a substring.
    expect(call.args.some((argument) => argument.includes(APPLE_IDENTITY_PASSWORD))).toBe(false);
  });

  it("hands zsign a container that really holds the identity, with no password", async () => {
    const zsign = succeeds();
    await signIpa({ ...(await options()), run: zsign.run });

    const container = zsign.calls[0].keystoreAtCallTime;
    expect(container, "the ephemeral container did not exist when zsign ran").not.toBeNull();
    const ephemeral = readKeystore(container!, { storePassword: "" });
    const original = readKeystore(appleIdentityP12(), { storePassword: APPLE_IDENTITY_PASSWORD });
    expect(ephemeral.certificateChainDerBase64).toEqual(original.certificateChainDerBase64);
    expect(ephemeral.privateKeyPem).toBe(original.privateKeyPem);
    // Two certificates, because a leaf alone is what zsign rejects.
    expect(ephemeral.certificateChainDerBase64).toHaveLength(2);
  });

  it("passes the verified argument shape", async () => {
    const zsign = succeeds();
    const opts = await options();
    await signIpa({ ...opts, run: zsign.run });

    const { args } = zsign.calls[0];
    expect(zsign.calls[0].executable).toBe(AVAILABLE.path);
    expect(args[args.indexOf("-m") + 1]).toBe(opts.signing.provisioningProfileFile);
    expect(args[args.indexOf("-b") + 1]).toBe(APPLE_PROFILE_BUNDLE_ID);
    expect(args[args.indexOf("-n") + 1]).toBe("My Game");
    expect(args[args.indexOf("-o") + 1]).toBe(opts.signedIpaPath);
    // The package to sign is the trailing positional argument.
    expect(args.at(-1)).toBe(opts.unsignedIpaPath);
  });

  it("deletes the ephemeral container after a successful run", async () => {
    const zsign = succeeds();
    await signIpa({ ...(await options()), run: zsign.run });
    await expect(
      fs.access(zsign.calls[0].args[zsign.calls[0].args.indexOf("-k") + 1])
    ).rejects.toThrow();
  });

  it("deletes the ephemeral container after a failed run too", async () => {
    const zsign = recorder(() => ({ exitCode: 255, output: ">>> Signed Failed! (0.02s)" }));
    await expectFailure(signIpa({ ...(await options()), run: zsign.run }), "signing-failed");
    await expect(
      fs.access(zsign.calls[0].args[zsign.calls[0].args.indexOf("-k") + 1])
    ).rejects.toThrow();
  });

  it("reports what signed, and what it was signed for", async () => {
    const result = await signIpa({ ...(await options()), run: succeeds().run });
    expect(result.signerSubject).toContain(APPLE_IDENTITY_SUBJECT_CN);
    expect(result.profileName).toBe(APPLE_PROFILE_NAME);
    expect(result.applicationIdentifier).toBe(APPLE_PROFILE_APP_ID);
    expect(result.provisionedDeviceCount).toBe(1);
  });

  it("refuses to run at all when the tool is unavailable", async () => {
    const zsign = succeeds();
    const error = await expectFailure(
      signIpa({
        ...(await options()),
        tool: {
          available: false,
          reason: "not-staged",
          detail: "the tool was never staged",
          searched: []
        },
        run: zsign.run
      }),
      "tool-unavailable"
    );
    expect(error.message).toContain("the tool was never staged");
    expect(zsign.calls).toHaveLength(0);
  });

  it("names a leaf-only identity rather than letting zsign fail on the issuer", async () => {
    const original = readKeystore(appleIdentityP12(), { storePassword: APPLE_IDENTITY_PASSWORD });
    const dir = await tempDir();
    const p12File = path.join(dir, "leaf-only.p12");
    await fs.writeFile(
      p12File,
      writePasswordlessPkcs12({
        privateKeyDer: crypto
          .createPrivateKey(original.privateKeyPem)
          .export({ type: "pkcs8", format: "der" }),
        certificateChainDer: [Buffer.from(original.certificateDerBase64, "base64")]
      })
    );
    const profileFile = path.join(dir, "profile.mobileprovision");
    await fs.writeFile(profileFile, appleProvisioningProfile());
    const unsignedIpaPath = path.join(dir, "game.ipa.unsigned");
    await fs.writeFile(unsignedIpaPath, "unsigned");

    const zsign = succeeds();
    const error = await expectFailure(
      signIpa({
        ...(await options()),
        signing: {
          p12File,
          p12Password: "",
          provisioningProfileFile: profileFile,
          toolPath: "C:/nowhere/zsign.exe"
        },
        run: zsign.run
      }),
      "identity-chain-incomplete"
    );
    expect(error.message).toContain("Keychain Access");
    expect(zsign.calls).toHaveLength(0);
  });

  it("stops when the profile is for a different app", async () => {
    const zsign = succeeds();
    const error = await expectFailure(
      signIpa({ ...(await options()), bundleId: "com.example.somethingelse", run: zsign.run }),
      "profile-mismatch"
    );
    expect(error.message).toContain(APPLE_PROFILE_APP_ID);
    expect(zsign.calls).toHaveLength(0);
  });

  it("stops when the profile has expired", async () => {
    const zsign = succeeds();
    await expectFailure(
      signIpa({ ...(await options()), now: new Date("2030-01-01T00:00:00Z"), run: zsign.run }),
      "profile-expired"
    );
    expect(zsign.calls).toHaveLength(0);
  });

  it("reports a wrong identity password as such", async () => {
    const opts = await options();
    const error = await expectFailure(
      signIpa({
        ...opts,
        signing: { ...opts.signing, p12Password: "not the password" },
        run: succeeds().run
      }),
      "identity-unreadable"
    );
    expect(error.message).toMatch(/password is incorrect/);
    // The password itself must not be echoed back into the message.
    expect(error.message).not.toContain("not the password");
  });

  it("reports an unreadable profile as such", async () => {
    const opts = await options();
    await fs.writeFile(opts.signing.provisioningProfileFile, "this is not a profile");
    await expectFailure(signIpa({ ...opts, run: succeeds().run }), "profile-unreadable");
  });

  it("treats 'Signed Failed!' as failure even when the exit code says otherwise", async () => {
    const opts = await options();
    const zsign = recorder(async (invocation) => {
      await fs.writeFile(invocation.args[invocation.args.indexOf("-o") + 1], "half a package");
      return { exitCode: 0, output: ">>> Build CMS signature failed!\n>>> Signed Failed! (0.02s)" };
    });
    const error = await expectFailure(signIpa({ ...opts, run: zsign.run }), "signing-failed");
    expect(error.message).toContain("Signed Failed!");
    // A half-written package left on disk would be shipped as if it were signed.
    await expect(fs.access(opts.signedIpaPath)).rejects.toThrow();
  });

  it("fails when zsign claims success but writes nothing", async () => {
    const error = await expectFailure(
      signIpa({
        ...(await options()),
        run: recorder(() => ({ exitCode: 0, output: ">>> Done." })).run
      }),
      "signing-failed"
    );
    expect(error.message).toContain("wrote no package");
  });

  it("carries zsign's own words into the failure, rather than guessing", async () => {
    const error = await expectFailure(
      signIpa({
        ...(await options()),
        run: recorder(() => ({
          exitCode: 255,
          output: ">>> Unknown issuer hash 0xdeadbeef!\n>>> Signed Failed!"
        })).run
      }),
      "signing-failed"
    );
    expect(error.message).toContain("Unknown issuer hash 0xdeadbeef!");
  });

  it("refuses to write its output over its input", async () => {
    const opts = await options();
    await expect(
      signIpa({ ...opts, signedIpaPath: opts.unsignedIpaPath, run: succeeds().run })
    ).rejects.toThrow(/distinct input and output paths/);
  });
});
