import { execFile } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import { afterAll, describe, expect, it } from "vitest";
import { macSigningConfiguration } from "./desktopSigning";

/**
 * Real electron-builder macOS builds, answering the one question the option
 * mapping cannot answer about itself: whether electron-builder *acts* on what
 * `macSigningConfiguration` produces.
 *
 * Two claims rest on this and nothing else could settle them:
 *
 *  1. `identity: null` really does stop it signing. Left unset it searches the
 *     keychain, so on a machine that holds a certificate an "unsigned" build
 *     would come out signed - and no unit test can tell the two configs apart,
 *     because the difference only exists inside app-builder-lib.
 *  2. Flipping Electron fuses does not destroy the signature. A signed macOS
 *     target now gets `enableEmbeddedAsarIntegrityValidation`, and the fuse step
 *     rewrites the binary - which would invalidate a signature applied before
 *     it, and `resetAdHocDarwinSignature` would replace a real one with an
 *     ad-hoc one. app-builder-lib orders fuses *then* signing ("the fuses MUST
 *     be flipped right before signing"); this proves the order holds in the
 *     version we ship against.
 *
 * Ad-hoc signing (`identity: "-"`) stands in for a real Developer ID, which this
 * machine does not have. It exercises the identical path - findSigningIdentity,
 * buildSignOptions, @electron/osx-sign, codesign - and differs only in which
 * certificate ends up in the CMS. What it cannot show is Gatekeeper acceptance
 * or notarization; those still need a real certificate.
 *
 * Gated because each build takes about a minute. `NLS_MAC_SIGN_ORACLE=1` runs it.
 */

const execFileAsync = promisify(execFile);
const enabled = process.env.NLS_MAC_SIGN_ORACLE === "1" && process.platform === "darwin";
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const APP_ID = "com.narraleaf.signprobe";

/**
 * The fuse set a signed macOS game gets - `gameFusesForPlatform("macos", true)`.
 * Spelled out rather than imported: that function lives in the main process tree
 * behind Electron imports, and the two things this test needs from it are the
 * two flags that interact with signing.
 */
const SIGNED_GAME_FUSES = {
  runAsNode: false,
  enableCookieEncryption: false,
  enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: false,
  enableEmbeddedAsarIntegrityValidation: true,
  onlyLoadAppFromAsar: true,
  grantFileProtocolExtraPrivileges: false,
  resetAdHocDarwinSignature: true
};

const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

/**
 * What `codesign` says about a bundle.
 *
 * `signed` is deliberately not the interesting field. Every arm64 macOS binary
 * must carry at least an ad-hoc signature to execute, so the Electron
 * distribution arrives signed and an unsigned build stays signed - "no
 * signature" is not a state that exists here. The identifier is what separates
 * them: electron-builder rewrites it to the appId when it signs, and leaves the
 * distribution's own "Electron" when it does not.
 */
async function codesignIdentifier(appPath: string): Promise<string> {
  // codesign -dv writes to stderr, and exits non-zero only when there is no
  // signature at all.
  const { stderr } = await execFileAsync("codesign", ["-dv", "--verbose=4", appPath]).catch(
    (error: { stderr?: string }) => ({ stderr: error.stderr ?? "" })
  );
  return (/Identifier=(\S+)/.exec(stderr) ?? [])[1] ?? "";
}

async function buildProbe(
  label: string,
  mac: Record<string, unknown>,
  fuses?: Record<string, boolean>
): Promise<string> {
  const { build, Platform, Arch } = await import("electron-builder");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `nls-macsign-${label}-`));
  roots.push(root);
  const appDir = path.join(root, "app");
  const outDir = path.join(root, "out");
  await fs.mkdir(appDir, { recursive: true });
  await fs.writeFile(
    path.join(appDir, "package.json"),
    JSON.stringify({ name: "signprobe", version: "1.0.0", main: "main.js" })
  );
  await fs.writeFile(path.join(appDir, "main.js"), "require('electron').app.quit();\n");

  const electronPackage = JSON.parse(
    await fs.readFile(path.join(repoRoot, "node_modules", "electron", "package.json"), "utf8")
  ) as { version: string };

  await build({
    targets: Platform.MAC.createTarget(["dir"], Arch.arm64),
    projectDir: appDir,
    config: {
      mac,
      appId: APP_ID,
      productName: "SignProbe",
      electronVersion: electronPackage.version,
      // The installed dist, so the build neither downloads nor depends on
      // the network - the same discipline the real pipeline keeps.
      electronDist: path.join(repoRoot, "node_modules", "electron", "dist"),
      directories: { output: outDir },
      files: ["**/*"],
      asar: true,
      ...(fuses ? { electronFuses: fuses } : {}),
      npmRebuild: false,
      publish: null
    }
  });
  return codesignIdentifier(path.join(outDir, "mac-arm64", "SignProbe.app"));
}

describe.skipIf(!enabled)("the electron-builder macOS signing oracle", () => {
  it(
    "leaves the app untouched when the mapping says not to sign",
    { timeout: 300_000 },
    async () => {
      const { mac } = macSigningConfiguration(null);
      expect(mac).toEqual({ identity: null, notarize: false });

      // Still the distribution's own identifier: electron-builder logged
      // "skipped macOS code signing" and never re-signed. Had `identity` been
      // left unset instead, it would have searched the keychain.
      expect(await buildProbe("unsigned", mac as Record<string, unknown>)).toBe("Electron");
    }
  );

  it("signs, and the fuse flip does not undo it", { timeout: 300_000 }, async () => {
    const { mac } = macSigningConfiguration({ source: "keychain", identity: "-" });
    expect(mac).toMatchObject({ identity: "-", notarize: false });

    const identifier = await buildProbe(
      "signed",
      // Ad-hoc plus hardened runtime rejects the pre-signed Electron
      // framework's differing team id at launch; irrelevant to whether the
      // signature was applied, and off so the build is about one thing.
      { ...mac, hardenedRuntime: false } as Record<string, unknown>,
      SIGNED_GAME_FUSES
    );

    // Rewritten to the appId, which only the signing step does - and it did
    // it after @electron/fuses rewrote the binary.
    expect(identifier).toBe(APP_ID);
  });
});
