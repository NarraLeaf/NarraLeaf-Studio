import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { parsePlistDictionary, type PlistDictionary } from "../mobile/plist";
import { adHocSignBundle } from "./adhocSign";
import type { BundleEntry, BundleTree } from "./bundleTree";
import { infoPlist, syntheticBundle, syntheticMachO } from "./macBundleFixtures";

const sha1 = (data: Buffer): Buffer => crypto.createHash("sha1").update(data).digest();
const sha256 = (data: Buffer): Buffer => crypto.createHash("sha256").update(data).digest();
const fileData = (tree: BundleTree, path: string): Buffer => {
    const entry = tree.get(path);
    if (!entry || entry.kind !== "file") {
        throw new Error(`${path} is not a file in the tree`);
    }
    return entry.data;
};

/*
 * codesign's result for `syntheticBundle()`, signed with
 * `codesign --sign - --force --preserve-metadata=entitlements,requirements,flags,runtime --deep`
 * on macOS 15.7 (Apple silicon): the main executable's cdhash, and the SHA-256 of every file
 * signing changes. See macBundleFixtures.ts before changing the bundle.
 */
const APPLE_CDHASH = "ef2522faff1f5a1d81ffb5ce6821932edf44a532";
const APPLE_SIGNED_FILES: Record<string, string> = {
    "Synth.app/Contents/MacOS/Synth": "facf12660d3fbd8a53197f09fe89370eca80a5667184dbcc4aef10aae283063e",
    "Synth.app/Contents/MacOS/tool": "a36476d6b221c1a5f0b45de30f4b2ee189422e518813d9c474ce8e54a03a56bd",
    "Synth.app/Contents/_CodeSignature/CodeResources": "63c77b0cdb0c7091cd92ffd73298167861a0b6c125fe3ac0670b3e95f801457f",
    "Synth.app/Contents/Frameworks/plain/tool2": "e808a414a5cc14224e0b430786b9323af8d7d24dad5da64661774b5c80fdb153",
    "Synth.app/Contents/Frameworks/Inner.framework/Versions/A/Inner": "8037611697dda7128c8088b2e5ddb272a58a431c7d618bfe2a86aa314a016d09",
    "Synth.app/Contents/Frameworks/Inner.framework/Versions/A/Helpers/crash": "b94070fc9b4cd9240af095adc37c29c49dd032a3b819eefbcf39ba86b8144a64",
    "Synth.app/Contents/Frameworks/Inner.framework/Versions/A/_CodeSignature/CodeResources": "8d3424865915d973f9504fa9bc156c94a1552eaa1dd812b18307f18c1f81cac3",
    "Synth.app/Contents/Frameworks/Nodot Helper.app/Contents/MacOS/Nodot Helper": "21a05dbb192a5cbfd1bf6640b5c9c9e112260b16d0490924da1fef77087d18cd",
    "Synth.app/Contents/Frameworks/Nodot Helper.app/Contents/_CodeSignature/CodeResources": "6686de10a28a2fe11b36cbb86dcbacc827cfc4ea116b4dabf1845e5aee629e9b",
};

describe("adHocSignBundle", () => {
    it("signs a bundle with one of everything exactly as codesign does", () => {
        const tree = syntheticBundle();
        const before = new Map(tree);
        expect(adHocSignBundle(tree, "Synth.app").toString("hex")).toBe(APPLE_CDHASH);
        for (const [path, digest] of Object.entries(APPLE_SIGNED_FILES)) {
            expect(sha256(fileData(tree, path)).toString("hex"), path).toBe(digest);
        }
        // Nothing else changed: a Mach-O image outside the nested-code locations is only hashed.
        for (const [path, entry] of before) {
            if (!(path in APPLE_SIGNED_FILES)) {
                expect(tree.get(path), path).toBe(entry);
            }
        }
    });

    it("signs inside out and names each piece of code as codesign does", () => {
        const messages: string[] = [];
        adHocSignBundle(syntheticBundle(), "Synth.app", message => messages.push(message));
        const order = messages.map(message => message.replace(/ as .*$/, ""));
        expect(order.indexOf("signed nested code Synth.app/Contents/Frameworks/Inner.framework/Versions/A/Helpers/crash"))
            .toBeLessThan(order.indexOf("signed Synth.app/Contents/Frameworks/Inner.framework"));
        expect(order[order.length - 1]).toBe("signed Synth.app");
        // A bundle is its CFBundleIdentifier even without a dot; loose code gets the UUID suffix.
        expect(messages).toContain("signed Synth.app/Contents/Frameworks/Nodot Helper.app as nodothelper");
        expect(messages.some(message => /^signed nested code Synth\.app\/Contents\/MacOS\/tool as tool-55554944[0-9a-f]{32}$/.test(message))).toBe(true);
    });

    it("gives every bundle a _CodeSignature/CodeResources, in the framework's current version", () => {
        const tree = syntheticBundle();
        adHocSignBundle(tree, "Synth.app");
        for (const root of ["Synth.app/Contents", "Synth.app/Contents/Frameworks/Inner.framework/Versions/A", "Synth.app/Contents/Frameworks/Nodot Helper.app/Contents"]) {
            expect(tree.get(`${root}/_CodeSignature`)).toEqual({ kind: "directory", mode: 0o755 });
            expect(tree.get(`${root}/_CodeSignature/CodeResources`)?.mode).toBe(0o644);
        }
        const framework = parsePlistDictionary(fileData(tree, "Synth.app/Contents/Frameworks/Inner.framework/Versions/A/_CodeSignature/CodeResources").toString("utf8"));
        // A framework's Info.plist lives under Resources/ and is sealed like any resource there.
        expect(Object.keys(framework.files as PlistDictionary)).toEqual(["Resources/Info.plist", "Resources/data.txt"]);
        expect(Object.keys(framework.files2 as PlistDictionary)).toEqual(["Helpers/crash", "Resources/Info.plist", "Resources/data.txt"]);
    });

    it("seals a payload left on disk by its digests, without reading it, exactly as the bytes themselves", () => {
        const tree = syntheticBundle();
        const payloadPath = "Synth.app/Contents/Resources/payload.bin";
        const payload = fileData(tree, payloadPath);
        tree.set(payloadPath, {
            kind: "diskFile",
            mode: 0o644,
            path: "Z:\\nowhere\\payload.bin",
            size: payload.length,
            sha1: sha1(payload),
            sha256: sha256(payload),
        });
        expect(adHocSignBundle(tree, "Synth.app").toString("hex")).toBe(APPLE_CDHASH);
        expect(tree.get(payloadPath)?.kind).toBe("diskFile");
    });

    it("refuses a file that is not code where nested code goes, because its signature would live in extended attributes", () => {
        const tree = syntheticBundle();
        tree.set("Synth.app/Contents/LICENSE.electron.txt", { kind: "file", mode: 0o644, data: Buffer.from("MIT") });
        expect(() => adHocSignBundle(tree, "Synth.app")).toThrow(
            /Contents\/LICENSE\.electron\.txt is not code.*codesign would sign it into extended attributes, which no zip carries/,
        );
    });

    it("refuses a payload left on disk where nested code goes, or as a main executable", () => {
        const onDisk = (): BundleEntry => ({ kind: "diskFile", mode: 0o755, path: "x", size: 1, sha1: Buffer.alloc(20), sha256: Buffer.alloc(32) });
        const nested = syntheticBundle();
        nested.set("Synth.app/Contents/MacOS/big", onDisk());
        expect(() => adHocSignBundle(nested, "Synth.app")).toThrow(/extended attributes/);

        const main = syntheticBundle();
        main.set("Synth.app/Contents/MacOS/Synth", onDisk());
        expect(() => adHocSignBundle(main, "Synth.app")).toThrow(/main executable/);
    });

    it("signs a bundle whose directories are only implied by the paths under them", () => {
        const tree: BundleTree = new Map([
            ["Bare.app/Contents/Info.plist", { kind: "file", mode: 0o644, data: infoPlist("Bare", "com.example.bare") }],
            ["Bare.app/Contents/MacOS/Bare", { kind: "file", mode: 0o755, data: syntheticMachO({ arch: "arm64", seed: "bare" }) }],
        ]);
        expect(adHocSignBundle(tree, "Bare.app")).toHaveLength(20);
        expect(tree.has("Bare.app/Contents/_CodeSignature/CodeResources")).toBe(true);
    });

    it("refuses what is not a bundle it can sign", () => {
        expect(() => adHocSignBundle(syntheticBundle(), "Nothing.app")).toThrow(/not a bundle/);
        const binaryPlist = syntheticBundle();
        binaryPlist.set("Synth.app/Contents/Info.plist", { kind: "file", mode: 0o644, data: Buffer.from("bplist00\0\0") });
        expect(() => adHocSignBundle(binaryPlist, "Synth.app")).toThrow(/binary property list/);
    });
});
