import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { parsePlistDictionary, type PlistDictionary } from "../mobile/plist";
import { codeResources, resourceRule, writeXmlPlist, type SealedResource } from "./codeResources";
import { E_ACUTE, EMOJI, FULLWIDTH_A } from "./macBundleFixtures";

const sha1 = (data: Buffer): Buffer => crypto.createHash("sha1").update(data).digest();
const sha256 = (data: Buffer): Buffer => crypto.createHash("sha256").update(data).digest();
const fileAt = (path: string, text = path): SealedResource => ({ path, kind: "file", data: Buffer.from(text) });

function seal(resources: SealedResource[]): { files: PlistDictionary; files2: PlistDictionary } {
    const document = parsePlistDictionary(codeResources(resources).toString("utf8"));
    return { files: document.files as PlistDictionary, files2: document.files2 as PlistDictionary };
}

describe("resourceRule", () => {
    it("says which locations hold nested code, with omissions outranking them", () => {
        expect(resourceRule("Frameworks/Electron Framework.framework").nested).toBe(true);
        expect(resourceRule("Helpers/chrome_crashpad_handler").nested).toBe(true);
        expect(resourceRule("Library/LoginItems/x.app").nested).toBe(true);
        // Anything at the top of the content root, such as a licence file put there.
        expect(resourceRule("LICENSE.electron.txt").nested).toBe(true);
        expect(resourceRule("Libraries/libffmpeg.dylib").nested).toBe(false);
        expect(resourceRule("Resources/app.asar.unpacked/bindings.node").nested).toBe(false);
        expect(resourceRule("version.plist").nested).toBe(false);
        expect(resourceRule(".DS_Store")).toEqual({ omit: true, optional: false, nested: false });
        expect(resourceRule("Info.plist").omit).toBe(true);
        expect(resourceRule("App.dSYM/Contents/x").nested).toBe(false);
    });
});

describe("codeResources", () => {
    it("seals Resources/ and version.plist in both seals and everything else in files2 alone", () => {
        const { files, files2 } = seal([fileAt("Resources/app.asar"), fileAt("version.plist"), fileAt("Libraries/libEGL.dylib")]);
        expect(Object.keys(files)).toEqual(["Resources/app.asar", "version.plist"]);
        expect(files["Resources/app.asar"]).toEqual(sha1(Buffer.from("Resources/app.asar")));
        expect(Object.keys(files2)).toEqual(["Libraries/libEGL.dylib", "Resources/app.asar", "version.plist"]);
        expect(files2["Libraries/libEGL.dylib"]).toEqual({ hash2: sha256(Buffer.from("Libraries/libEGL.dylib")) });
    });

    it("omits what each table omits, which is not the same list", () => {
        const { files, files2 } = seal([
            fileAt("Info.plist"),
            fileAt("PkgInfo"),
            fileAt("Resources/.DS_Store"),
            fileAt("Resources/en.lproj/locversion.plist"),
        ]);
        // Version 1 has no rule for .DS_Store; version 2 omits it everywhere.
        expect(Object.keys(files)).toEqual(["Resources/.DS_Store"]);
        expect(Object.keys(files2)).toEqual([]);
    });

    it("marks localisations optional in both seals, except Base.lproj", () => {
        const { files, files2 } = seal([fileAt("Resources/en.lproj/a.strings"), fileAt("Resources/Base.lproj/b.strings")]);
        expect(files["Resources/en.lproj/a.strings"]).toEqual({ hash: sha1(Buffer.from("Resources/en.lproj/a.strings")), optional: true });
        expect(files2["Resources/en.lproj/a.strings"]).toEqual({ hash2: sha256(Buffer.from("Resources/en.lproj/a.strings")), optional: true });
        expect(files["Resources/Base.lproj/b.strings"]).toEqual(sha1(Buffer.from("Resources/Base.lproj/b.strings")));
        expect(files2["Resources/Base.lproj/b.strings"]).toEqual({ hash2: sha256(Buffer.from("Resources/Base.lproj/b.strings")) });
    });

    it("records links by target in files2 only, nested location or not, optional under a localisation", () => {
        const { files, files2 } = seal([
            { path: "Resources/link", kind: "symlink", target: "app.dat" },
            { path: "toplink", kind: "symlink", target: "Resources/app.dat" },
            { path: "Resources/en.lproj/l.strings", kind: "symlink", target: "a.strings" },
        ]);
        expect(files).toEqual({});
        expect(files2).toEqual({
            "Resources/link": { symlink: "app.dat" },
            "toplink": { symlink: "Resources/app.dat" },
            "Resources/en.lproj/l.strings": { symlink: "a.strings", optional: true },
        });
    });

    it("records nested code - a bundle or a loose image - by cdhash and requirement", () => {
        const cdhash = Buffer.alloc(20, 0xab);
        const requirement = `cdhash H"${cdhash.toString("hex")}"`;
        const { files, files2 } = seal([
            { path: "Frameworks/Inner.framework", kind: "nested", cdhash, requirement },
            { path: "Helpers/crash", kind: "nested", cdhash, requirement },
        ]);
        expect(files).toEqual({});
        expect(files2).toEqual({
            "Frameworks/Inner.framework": { cdhash, requirement },
            "Helpers/crash": { cdhash, requirement },
        });
    });

    it("seals a file known only by its digests exactly as the same file held in memory", () => {
        const data = crypto.randomBytes(5000);
        for (const path of ["Resources/app.asar.unpacked/assets.bin", "Resources/en.lproj/big.bin", "Libraries/big.bin"]) {
            expect(codeResources([{ path, kind: "hashedFile", sha1: sha1(data), sha256: sha256(data) }])
                .equals(codeResources([{ path, kind: "file", data }]))).toBe(true);
        }
    });

    it("writes codesign's rule tables into the seal", () => {
        const document = parsePlistDictionary(codeResources([]).toString("utf8"));
        expect(Object.keys(document)).toEqual(["files", "files2", "rules", "rules2"]);
        expect((document.rules2 as PlistDictionary)["^[^/]+$"]).toEqual({ nested: true, weight: 10 });
        expect((document.rules as PlistDictionary)["^Resources/"]).toBe(true);
    });
});

describe("writeXmlPlist", () => {
    it("lays a document out the way Core Foundation does", () => {
        const xml = writeXmlPlist({
            b: { hash2: Buffer.from("0123456789abcdef0123456789abcdef"), optional: true },
            a: Buffer.from([1, 2, 3]),
            c: {},
            d: "x & <y>",
            e: 1000,
        });
        expect(xml).toBe([
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
            '<plist version="1.0">',
            "<dict>",
            "\t<key>a</key>",
            "\t<data>",
            "\tAQID",
            "\t</data>",
            "\t<key>b</key>",
            "\t<dict>",
            "\t\t<key>hash2</key>",
            "\t\t<data>",
            "\t\tMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
            "\t\t</data>",
            "\t\t<key>optional</key>",
            "\t\t<true/>",
            "\t</dict>",
            "\t<key>c</key>",
            "\t<dict/>",
            "\t<key>d</key>",
            "\t<string>x &amp; &lt;y&gt;</string>",
            "\t<key>e</key>",
            "\t<real>1000</real>",
            "</dict>",
            "</plist>",
            "",
        ].join("\n"));
    });

    it("orders keys by UTF-16 code unit, as Core Foundation does, not by UTF-8 bytes", () => {
        const xml = writeXmlPlist({ [FULLWIDTH_A]: true, [EMOJI]: true, [E_ACUTE]: true, a: true, B: true });
        const keys = [...xml.matchAll(/<key>(.*)<\/key>/g)].map(match => match[1]);
        expect(keys).toEqual(["B", "a", E_ACUTE, EMOJI, FULLWIDTH_A]);
    });

    it("refuses data long enough that Apple would wrap it", () => {
        expect(() => writeXmlPlist({ a: Buffer.alloc(64) })).toThrow(/wrapped/);
    });
});
