import crypto from "crypto";
import fs from "fs";
import path from "path";
import { list as listTar } from "tar";
import { describe, expect, it } from "vitest";
import type { BundleEntry } from "../macBundle/bundleTree";
import type { GameBuildWorkerFuses } from "../protocol";
import { readZipAsTree } from "./archive";
import { asarHeaderHash, assembleMacApp } from "./macApp";

/**
 * The macOS bundle Studio assembles without macOS, held against the one electron-builder built on a
 * Mac from the same Electron release and the same game.
 *
 * Gated: it needs the release zip and a reference build, too large for the repository. Point
 * `NLS_CROSS_HOST_GOLDEN` at a folder holding `electron-v38.8.6-darwin-arm64.zip` (the release) and
 * `ref-app.tgz` (a tar of `<game>.app` as Studio built it on a Mac with `--build-format=dir`, unsigned).
 *
 * What it can settle, and what it cannot: the Info.plists must match byte for byte (they are what the
 * signature seals first), the asar integrity hash must be the one electron-builder wrote, and the
 * bundle must hold the same files. Locale folders are left out of the file comparison because which
 * of them electron-builder keeps changed between 26.15.6 and 26.15.7 (the newer one keeps
 * `zh_CN.lproj` for `zh-CN`); the reference has to come from the electron-builder this checkout uses
 * for those to compare. Signatures are compared by the signer's own oracle, not here.
 */

const GOLDEN = process.env.NLS_CROSS_HOST_GOLDEN;
const enabled = Boolean(GOLDEN && fs.existsSync(path.join(GOLDEN, "ref-app.tgz")));

const FUSES: GameBuildWorkerFuses = {
    runAsNode: false,
    enableCookieEncryption: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: false,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false,
    resetAdHocDarwinSignature: true,
};

type RefEntry = { type: string; mode: number; data: Buffer; link?: string };

async function readReference(file: string): Promise<Map<string, RefEntry>> {
    const entries = new Map<string, RefEntry>();
    await listTar({
        file,
        onReadEntry: entry => {
            const relative = entry.path.replace(/\/$/, "");
            if (relative.split("/").some(segment => segment.startsWith("._"))) {
                entry.resume();
                return;
            }
            const chunks: Buffer[] = [];
            entry.on("data", (chunk: Buffer) => chunks.push(chunk));
            entry.on("end", () => entries.set(relative, {
                type: entry.type,
                mode: (entry.mode ?? 0) & 0o777,
                data: Buffer.concat(chunks),
                link: entry.linkpath,
            }));
        },
    });
    return entries;
}

describe.skipIf(!enabled)("assembleMacApp against an electron-builder bundle", () => {
    it("writes the same Info.plists and holds the same files", async () => {
        const root = GOLDEN as string;
        const release = await readZipAsTree(path.join(root, "electron-v38.8.6-darwin-arm64.zip"));
        const reference = await readReference(path.join(root, "ref-app.tgz"));
        const app = "skeleton-12.app";
        const ref = (relative: string): RefEntry => {
            const entry = reference.get(`${app}/${relative}`);
            if (!entry) {
                throw new Error(`reference has no ${relative}`);
            }
            return entry;
        };

        const resources = new Map<string, BundleEntry>();
        for (const [key, entry] of reference) {
            const prefix = `${app}/Contents/Resources/`;
            if (!key.startsWith(prefix)) {
                continue;
            }
            const relative = key.slice(prefix.length);
            if (relative !== "app.asar" && !relative.startsWith("app.asar.unpacked")) {
                continue;
            }
            resources.set(relative, entry.type === "Directory"
                ? { kind: "directory", mode: 0o755 }
                : { kind: "file", mode: entry.mode, data: entry.data });
        }
        const asar = resources.get("app.asar") as { data: Buffer };
        const hash = asarHeaderHash(asar.data, data => crypto.createHash("sha256").update(data).digest("hex"));
        expect(ref("Contents/Info.plist").data.toString("utf8")).toContain(hash);

        const built = await assembleMacApp({
            release,
            productName: "skeleton-12",
            appId: "com.narraleaf.games.skeleton-12",
            version: "1.0.0",
            author: "NarraLeaf",
            year: 2026,
            icon: ref("Contents/Resources/icon.icns").data,
            languages: ["zh-CN", "zh-TW", "en-US", "en-GB", "ja"],
            resources,
            asarHeaderHash: hash,
            notices: new Map([["THIRD-PARTY-NOTICES.txt", ref("Contents/THIRD-PARTY-NOTICES.txt").data]]),
            fuses: FUSES,
        });

        const plists = [
            "Contents/Info.plist",
            ...["", " (Renderer)", " (Plugin)", " (GPU)"].map(suffix => `Contents/Frameworks/skeleton-12 Helper${suffix}.app/Contents/Info.plist`),
        ];
        for (const plist of plists) {
            const mine = built.tree.get(`${app}/${plist}`) as { data: Buffer };
            expect(mine.data.toString("utf8"), plist).toBe(ref(plist).data.toString("utf8"));
        }

        // The reference keeps its notices in Contents/ (the layout before they moved to
        // Contents/Resources/), and its signatures; neither belongs in the comparison.
        const comparable = (key: string): boolean => !key.includes("_CodeSignature")
            && !/\.lproj(\/|$)/.test(key)
            && !/^skeleton-12\.app\/Contents(\/Resources)?\/(LICENSE\.electron\.txt|LICENSES\.chromium\.html|THIRD-PARTY-NOTICES\.txt)$/.test(key);
        const mineKeys = [...built.tree.keys()].filter(comparable).sort();
        const refKeys = [...reference.keys()].filter(key => key.startsWith(app) && comparable(key)).sort();
        expect(mineKeys).toEqual(refKeys);

        // The framework's locale folders electron-builder 26.15.7 keeps for these languages: its
        // matching treats `-` and `_` alike, so `zh-CN` keeps `zh_CN.lproj`, and a bare `ja` keeps
        // narrower forms such as `ja_FEMININE.lproj`.
        const lprojDir = `${app}/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/`;
        const kept = [...new Set([...built.tree.keys()]
            .filter(key => key.startsWith(lprojDir) && key.includes(".lproj"))
            .map(key => key.slice(lprojDir.length).split("/")[0]))].sort();
        expect(kept).toEqual(expect.arrayContaining(["en.lproj", "en_GB.lproj", "ja.lproj", "zh_CN.lproj", "zh_TW.lproj"]));
        expect(kept).not.toContain("de.lproj");
        expect(kept).not.toContain("en_FEMININE.lproj");

        // Everything but machine code (which the reference re-signed) is the same bytes.
        for (const key of mineKeys) {
            const mine = built.tree.get(key) as BundleEntry;
            const theirs = reference.get(key) as RefEntry;
            if (mine.kind === "symlink") {
                expect(theirs.link, key).toBe(mine.target);
            } else if (mine.kind === "file" && !isMachO(mine.data)) {
                expect(mine.data.equals(theirs.data), key).toBe(true);
            }
        }
    }, 120_000);
});

function isMachO(data: Buffer): boolean {
    if (data.length < 4) {
        return false;
    }
    const little = data.readUInt32LE(0);
    const big = data.readUInt32BE(0);
    return little === 0xfeedfacf || big === 0xcafebabe;
}
