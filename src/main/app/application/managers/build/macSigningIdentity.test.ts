import { execFile } from "child_process";
import { promisify } from "util";
import { describe, expect, it } from "vitest";
import { findMacSigningIdentities, macIdentityPresent } from "./macSigningIdentity";

/**
 * The parser is judged against captured `security find-identity` output, so it
 * says the same thing on every machine - including CI, and including a Mac that
 * holds no certificates at all. The one thing only a real host can answer is
 * whether the command exists, and that arm is the "return an empty list" path.
 */

/** Real shape, down to the leading spaces and the trailing count line. */
const TWO_IDENTITIES = `
  1) A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4 "Developer ID Application: NarraLeaf Ltd (A1B2C3D4E5)"
  2) 0F1E2D3C4B5A69788796A5B4C3D2E1F009182736 "Apple Development: someone@example.com (XY12ZW34AB)"
     2 valid identities found
`;

const NONE = "     0 valid identities found\n";

/**
 * Real `security` output, captured on macOS 14 from a keychain holding one
 * self-signed certificate. The interesting half is what `-v` does to it: the
 * certificate is listed as *matching* with a reason it cannot be used, and
 * dropped entirely from the valid list. That is the shape behind the
 * "missing" / "unusable" split in preflight, so it is pinned here rather than
 * imagined.
 */
const UNTRUSTED = `
Policy: Code Signing
  Matching identities
  1) D5EAC3C9DD696F985CE7A8AAFABB3D9817569673 "Developer ID Application: NarraLeaf Probe (TESTTEAM01)" (CSSMERR_TP_NOT_TRUSTED)
     1 identities found

  Valid identities only
     0 valid identities found
`;

describe("findMacSigningIdentities", () => {
    it("reads the hash, the name, and whether it can be distributed", async () => {
        const identities = await findMacSigningIdentities({ platform: "darwin", run: async () => TWO_IDENTITIES });

        expect(identities).toEqual([
            {
                sha1: "A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4",
                name: "Developer ID Application: NarraLeaf Ltd (A1B2C3D4E5)",
                developerId: true,
            },
            {
                sha1: "0F1E2D3C4B5A69788796A5B4C3D2E1F009182736",
                name: "Apple Development: someone@example.com (XY12ZW34AB)",
                // Signs a build that runs here and that Gatekeeper rejects
                // anywhere else; Apple will not notarize it either.
                developerId: false,
            },
        ]);
    });

    it("does not mistake the count line for an identity", async () => {
        expect(await findMacSigningIdentities({ platform: "darwin", run: async () => NONE })).toEqual([]);
    });

    it("lists the same certificate in two keychains once", async () => {
        // A duplicate is one identity to sign with. Offering it twice only
        // invites the question of which entry is which.
        const duplicated = `
  1) AABBCCDDEEFF00112233445566778899AABBCCDD "Developer ID Application: NarraLeaf Ltd (A1B2C3D4E5)"
  2) aabbccddeeff00112233445566778899aabbccdd "Developer ID Application: NarraLeaf Ltd (A1B2C3D4E5)"
     2 valid identities found
`;
        expect(await findMacSigningIdentities({ platform: "darwin", run: async () => duplicated })).toHaveLength(1);
    });

    it("reads an unusable identity, and its name without the reason suffix", async () => {
        // The wider list preflight falls back to. The team id in the common name
        // and the CSSMERR code outside the quotes are both parenthesised, so the
        // one that ends up in `name` is the thing this pins down.
        const identities = await findMacSigningIdentities({
            platform: "darwin",
            validOnly: false,
            run: async () => UNTRUSTED,
        });

        expect(identities).toEqual([{
            sha1: "D5EAC3C9DD696F985CE7A8AAFABB3D9817569673",
            name: "Developer ID Application: NarraLeaf Probe (TESTTEAM01)",
            developerId: true,
        }]);
    });

    it("counts an identity once across the two sections the wide list prints", async () => {
        // `security` without -v prints its whole list as "Matching identities"
        // and again under "Valid identities only".
        const both = `
Policy: Code Signing
  Matching identities
  1) AABBCCDDEEFF00112233445566778899AABBCCDD "Developer ID Application: NarraLeaf Ltd (A1B2C3D4E5)"
     1 identities found

  Valid identities only
  1) AABBCCDDEEFF00112233445566778899AABBCCDD "Developer ID Application: NarraLeaf Ltd (A1B2C3D4E5)"
     1 valid identities found
`;
        expect(await findMacSigningIdentities({ platform: "darwin", validOnly: false, run: async () => both }))
            .toHaveLength(1);
    });

    it("has none off macOS, without running anything", async () => {
        let ran = false;
        const identities = await findMacSigningIdentities({
            platform: "win32",
            run: async () => {
                ran = true;
                return TWO_IDENTITIES;
            },
        });
        expect(identities).toEqual([]);
        expect(ran).toBe(false);
    });

    it("returns an empty list rather than throwing when the probe fails", async () => {
        // No `security`, a locked keychain and a machine with no identities all
        // mean the same thing to every caller: nothing here to pick. Preflight
        // and the import form both run this with a dialog open and need a
        // verdict, not an exception.
        expect(await findMacSigningIdentities({
            platform: "darwin",
            run: async () => {
                throw new Error("spawn security ENOENT");
            },
        })).toEqual([]);
    });
});

/**
 * The half only a real host can answer: that `security` is where this thinks it
 * is, takes these arguments, and prints something this parser reads. Everything
 * above judges captured text, which cannot catch the command itself changing.
 *
 * Skips off macOS. `NLS_MAC_IDENTITY_KEYCHAIN` points it at a throwaway keychain
 * so a developer with no certificates can still exercise the populated path; without it the default keychains are read,
 * which is a valid run either way - an empty list is the correct answer on a
 * machine with no identities, and the assertions below are about shape.
 */
const execFileAsync = promisify(execFile);
const probeKeychain = process.env.NLS_MAC_IDENTITY_KEYCHAIN;

describe.skipIf(process.platform !== "darwin")("the security oracle", () => {
    const runReal = (validOnly: boolean) => async (): Promise<string> => (await execFileAsync("security", [
        "find-identity",
        ...(validOnly ? ["-v"] : []),
        "-p",
        "codesigning",
        ...(probeKeychain ? [probeKeychain] : []),
    ])).stdout;

    it("parses whatever this machine's keychains actually hold", async () => {
        const identities = await findMacSigningIdentities({ run: runReal(true) });

        for (const identity of identities) {
            expect(identity.sha1).toMatch(/^[0-9A-F]{40}$/);
            expect(identity.name.length).toBeGreaterThan(0);
            // The reason code lives outside the quotes and must never be read
            // as part of the certificate's name.
            expect(identity.name).not.toMatch(/CSSMERR/);
        }
        expect(new Set(identities.map(identity => identity.sha1)).size).toBe(identities.length);
    });

    it("sees at least as much without -v as with it", async () => {
        // The relationship the "missing" / "unusable" split rests on. It holds
        // on an empty machine too, where both sides are zero.
        const valid = await findMacSigningIdentities({ run: runReal(true) });
        const all = await findMacSigningIdentities({ validOnly: false, run: runReal(false) });

        expect(all.length).toBeGreaterThanOrEqual(valid.length);
        for (const identity of valid) {
            expect(all.map(candidate => candidate.sha1)).toContain(identity.sha1);
        }
    });

    it.skipIf(!probeKeychain)("finds the throwaway certificate only in the wide list", async () => {
        // The probe keychain holds one self-signed certificate: `security`
        // matches it and refuses it, which is exactly the state that used to be
        // reported to the author as "not on this machine".
        expect(await findMacSigningIdentities({ run: runReal(true) })).toEqual([]);
        const all = await findMacSigningIdentities({ validOnly: false, run: runReal(false) });
        expect(all).toHaveLength(1);
        expect(all[0].name).toContain("Developer ID Application:");
        expect(macIdentityPresent(all, all[0].name)).toBe(true);
    });
});

describe("macIdentityPresent", () => {
    const identities = [
        {
            sha1: "A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4",
            name: "Developer ID Application: NarraLeaf Ltd (A1B2C3D4E5)",
            developerId: true,
        },
    ];

    it("matches the full name and the thumbprint", () => {
        expect(macIdentityPresent(identities, "Developer ID Application: NarraLeaf Ltd (A1B2C3D4E5)")).toBe(true);
        expect(macIdentityPresent(identities, "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4")).toBe(true);
    });

    it("accepts a prefix, because that is what codesign accepts", () => {
        // codesign matches a name by substring. Telling an author their
        // certificate is missing when codesign would find it is the failure
        // this rule exists to avoid.
        expect(macIdentityPresent(identities, "Developer ID Application")).toBe(true);
        expect(macIdentityPresent(identities, "NarraLeaf Ltd")).toBe(true);
    });

    it("refuses a name that is not there, and an empty one", () => {
        expect(macIdentityPresent(identities, "Developer ID Application: Someone Else")).toBe(false);
        expect(macIdentityPresent(identities, "  ")).toBe(false);
        expect(macIdentityPresent([], "Developer ID Application: NarraLeaf Ltd (A1B2C3D4E5)")).toBe(false);
    });
});
