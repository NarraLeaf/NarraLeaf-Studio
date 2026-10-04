import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { adHocSignBundle } from "./adhocSign";
import type { BundleTree } from "./bundleTree";
import { readBundleZip, treeDifferences, universalBundleTree } from "./macBundleFixtures";

/**
 * The signer against Apple's codesign on a whole Electron game, byte for byte.
 *
 * The fixtures are a real game (`skeleton-12.app`, about 120 MB per architecture) and are too
 * large for the repository, so the test is gated: `NLS_MAC_SIGN_GOLDEN` names a directory whose
 * `golden/` folder holds
 *
 *  - `arm64-unsigned.zip`, `x64-unsigned.zip`: the app as Studio assembles it, before signing.
 *    The arm64 images arrive with the linker's signature, the x86_64 ones with none.
 *  - `arm64-apple.zip`, `x64-apple.zip`, `universal-apple.zip`: what
 *    `codesign --sign - --force --preserve-metadata=entitlements,requirements,flags,runtime --deep`
 *    made of them on macOS 15.7 (Apple silicon), unpacked with `ditto` and zipped with modes and
 *    links kept.
 *  - `universal-unsigned.zip`: the universal input that was signed on the Mac, which this test
 *    rebuilds from the two thin ones and checks it still matches before signing it.
 *
 * Each zip carries unix modes and symbolic links, so it reads back as the tree a Mac sees.
 */

const rig = process.env.NLS_MAC_SIGN_GOLDEN;
const golden = (name: string): BundleTree => readBundleZip(fs.readFileSync(path.join(rig as string, "golden", name)));
const APP = "skeleton-12.app";
const TIMEOUT = 300_000;

function expectSignedLikeCodesign(input: BundleTree, expected: BundleTree, label: string): void {
    const started = performance.now();
    adHocSignBundle(input, APP);
    const elapsed = performance.now() - started;
    console.info(`${label}: signed ${input.size} entries in ${elapsed.toFixed(0)} ms`);
    expect(treeDifferences(input, expected)).toEqual([]);
}

describe.skipIf(!rig)("ad-hoc signing a whole game, against codesign", () => {
    it("signs the arm64 app exactly as codesign does", () => {
        expectSignedLikeCodesign(golden("arm64-unsigned.zip"), golden("arm64-apple.zip"), "arm64");
    }, TIMEOUT);

    it("signs the x86_64 app exactly as codesign does", () => {
        expectSignedLikeCodesign(golden("x64-unsigned.zip"), golden("x64-apple.zip"), "x64");
    }, TIMEOUT);

    it("signs the universal app exactly as codesign does", () => {
        const input = universalBundleTree(golden("arm64-unsigned.zip"), golden("x64-unsigned.zip"));
        expect(treeDifferences(input, golden("universal-unsigned.zip"))).toEqual([]);
        expectSignedLikeCodesign(input, golden("universal-apple.zip"), "universal");
    }, TIMEOUT);
});
