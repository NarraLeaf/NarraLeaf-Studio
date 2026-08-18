import { execFile } from "child_process";
import { promisify } from "util";
import type { MacSigningIdentity } from "@shared/types/signing";

/**
 * The code-signing identities in this Mac's keychains.
 *
 * `security find-identity` is the same list `codesign` itself resolves a name
 * against, which is what makes it worth shelling out for rather than guessing:
 * the author picks from what will actually be found at signing time, and
 * preflight can say "that certificate is not on this machine" before a build
 * spends twenty minutes packaging to discover it.
 *
 * Read-only and side-effect free - it lists certificates, never unlocks a
 * keychain and never touches a private key. macOS may still prompt for keychain
 * access when `codesign` later uses the key; that is the OS's decision and not
 * something Studio can or should pre-empt.
 */

const execFileAsync = promisify(execFile);

export type { MacSigningIdentity };

/**
 * `security find-identity` prints one indented row per identity:
 *
 *     1) 0123ABCD... "Developer ID Application: Someone (A1B2C3D4E5)"
 *
 * followed by a count line this deliberately does not match. Without `-v` an
 * unusable identity is listed too, with the reason appended:
 *
 *     1) D5EAC3C9... "Developer ID Application: Someone (A1B2C3D4E5)" (CSSMERR_TP_NOT_TRUSTED)
 *
 * The suffix is optional in the pattern so one parser reads both forms, and the
 * caller decides which command produced the text.
 */
const IDENTITY_LINE = /^\s*\d+\)\s+([0-9A-Fa-f]{40})\s+"(.+?)"\s*(?:\(([A-Z_0-9]+)\))?\s*$/;

/** The prefix Gatekeeper requires for software distributed outside the App Store. */
const DEVELOPER_ID_PREFIX = "Developer ID Application:";

export type MacIdentityProbeInput = {
  platform?: NodeJS.Platform;
  /**
   * Whether to list only identities that can actually sign. True is the list
   * to offer an author; false also returns the ones `security` knows about but
   * refuses, which is what turns "your certificate is missing" into "your
   * certificate is there and expired".
   */
  validOnly?: boolean;
  /** Injected in tests; defaults to running `security`. */
  run?: () => Promise<string>;
};

/**
 * Code-signing identities on this host.
 *
 * `-v` is what makes the default list the *usable* one: it drops certificates
 * whose private key is missing, whose validity window has passed, or whose chain
 * does not reach a trusted root. A real Developer ID certificate chains to
 * Apple's root and survives it; the ones it removes are ones codesign would
 * refuse anyway, so offering them would only move the failure later.
 *
 * That is also why `validOnly: false` exists. An expired certificate sitting in
 * the keychain is *absent* from the default list, and reporting it as "not on
 * this machine" would send the author looking for a file they already have.
 * Preflight asks the wider question only when it is about to complain.
 *
 * Returns an empty list rather than throwing on any failure - a machine with no
 * identities, no `security` binary, or a locked keychain all mean the same thing
 * to every caller: there is nothing here to pick. Preflight and the import form
 * both run this while a dialog is open and need an answer, not an exception.
 */
export async function findMacSigningIdentities(
  input: MacIdentityProbeInput = {}
): Promise<MacSigningIdentity[]> {
  if ((input.platform ?? process.platform) !== "darwin") {
    return [];
  }
  const validOnly = input.validOnly ?? true;
  let output: string;
  try {
    output = input.run
      ? await input.run()
      : (
          await execFileAsync("security", [
            "find-identity",
            ...(validOnly ? ["-v"] : []),
            "-p",
            "codesigning"
          ])
        ).stdout;
  } catch {
    return [];
  }
  const identities: MacSigningIdentity[] = [];
  const seen = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const match = IDENTITY_LINE.exec(line);
    if (!match) {
      continue;
    }
    const sha1 = match[1].toUpperCase();
    // The same certificate in two keychains is listed twice, and without -v
    // `security` prints its whole list once as "Matching identities" and
    // again as "Valid identities only". Either way it is one identity to
    // sign with, and showing it twice only invites the question of which
    // entry is which.
    if (seen.has(sha1)) {
      continue;
    }
    seen.add(sha1);
    identities.push({
      sha1,
      name: match[2],
      developerId: match[2].startsWith(DEVELOPER_ID_PREFIX)
    });
  }
  return identities;
}

/** Whether `identity` names something this host can actually sign with. */
export function macIdentityPresent(identities: MacSigningIdentity[], identity: string): boolean {
  const wanted = identity.trim();
  if (!wanted) {
    return false;
  }
  // codesign matches a name by substring, so an author who typed only
  // "Developer ID Application" - enough for codesign when they hold exactly one
  // such certificate - must not be told it is missing.
  return identities.some(
    (candidate) =>
      candidate.name === wanted ||
      candidate.sha1 === wanted.toUpperCase() ||
      candidate.name.includes(wanted)
  );
}
