/**
 * Inputs for the ad-hoc signer's tests: small Mach-O images made from nothing, a bundle that
 * exercises every resource rule, and the helpers the golden test uses to read real bundles out of
 * zips and compare them.
 *
 * The synthetic inputs were also signed with Apple's codesign (macOS 15.7, Apple silicon), which
 * is where the cdhashes the unit tests pin come from: change a byte of what these functions make
 * and those expectations stop being codesign's, so re-sign the new input on a Mac before
 * updating them.
 */

import crypto from "crypto";
import { buildFatMachO, thinMachOArch } from "../fatMachO";
import { parseZipIndex, readEntryBytes } from "../mobile/zipModel";
import type { BundleEntry, BundleTree } from "./bundleTree";

/* ------------------------------------------------------------------ Mach-O images */

export type SyntheticMachOOptions = {
    arch: "arm64" | "x64";
    /** Everything that is not structure - code bytes, the UUID - is derived from this. */
    seed: string;
    fileType?: "execute" | "dylib";
    /** Whether the image has an LC_UUID. */
    uuid?: boolean;
    /** The macOS deployment target, as LC_BUILD_VERSION nibbles. 12.0 unless stated. */
    minMacOS?: number;
    /** Whether the image arrives with a linker-style signature, as Electron's arm64 images do. */
    linkerSigned?: boolean;
    /** Embed an `__info_plist` section in `__TEXT`, as some command-line tools do. */
    infoPlistSection?: boolean;
};

/** Deterministic bytes from a seed, so the same options always make the same image. */
export function seededBytes(seed: string, length: number): Buffer {
    const blocks: Buffer[] = [];
    for (let counter = 0; blocks.length * 32 < length; counter++) {
        blocks.push(crypto.createHash("sha256").update(`${seed}:${counter}`).digest());
    }
    return Buffer.concat(blocks).subarray(0, length);
}

const segmentName = (name: string): Buffer => Buffer.concat([Buffer.from(name, "latin1"), Buffer.alloc(16 - name.length)]);

function segmentCommand(
    name: string,
    vmaddr: bigint,
    vmsize: bigint,
    fileoff: number,
    filesize: number,
    prot: number,
    sections: Buffer[] = [],
): Buffer {
    const command = Buffer.alloc(72);
    command.writeUInt32LE(0x19, 0);
    command.writeUInt32LE(72 + sections.length * 80, 4);
    segmentName(name).copy(command, 8);
    command.writeBigUInt64LE(vmaddr, 24);
    command.writeBigUInt64LE(vmsize, 32);
    command.writeBigUInt64LE(BigInt(fileoff), 40);
    command.writeBigUInt64LE(BigInt(filesize), 48);
    command.writeUInt32LE(prot, 56);
    command.writeUInt32LE(prot, 60);
    command.writeUInt32LE(sections.length, 64);
    return Buffer.concat([command, ...sections]);
}

function section(name: string, segment: string, addr: bigint, size: number, offset: number): Buffer {
    const record = Buffer.alloc(80);
    segmentName(name).copy(record, 0);
    segmentName(segment).copy(record, 16);
    record.writeBigUInt64LE(addr, 32);
    record.writeBigUInt64LE(BigInt(size), 40);
    record.writeUInt32LE(offset, 48);
    return record;
}

/** A linker-style signature: one SHA-256 code directory flagged ad hoc and linker-signed. */
function linkerSignature(image: Buffer, codeLimit: number): Buffer {
    const ident = Buffer.from("synthetic\0", "latin1");
    const pages = Math.ceil(codeLimit / 4096);
    const hashOffset = 88 + ident.length;
    const cd = Buffer.alloc(hashOffset + pages * 32);
    cd.writeUInt32BE(0xfade0c02, 0);
    cd.writeUInt32BE(cd.length, 4);
    cd.writeUInt32BE(0x20400, 8);
    cd.writeUInt32BE(0x20002, 12);
    cd.writeUInt32BE(hashOffset, 16);
    cd.writeUInt32BE(88, 20);
    cd.writeUInt32BE(pages, 28);
    cd.writeUInt32BE(codeLimit, 32);
    cd[36] = 32;
    cd[37] = 2;
    cd[39] = 12;
    ident.copy(cd, 88);
    for (let page = 0; page < pages; page++) {
        crypto.createHash("sha256").update(image.subarray(page * 4096, Math.min((page + 1) * 4096, codeLimit))).digest()
            .copy(cd, hashOffset + page * 32);
    }
    const superblob = Buffer.alloc(20);
    superblob.writeUInt32BE(0xfade0cc0, 0);
    superblob.writeUInt32BE(20 + cd.length, 4);
    superblob.writeUInt32BE(1, 8);
    superblob.writeUInt32BE(0, 12);
    superblob.writeUInt32BE(20, 16);
    return Buffer.concat([superblob, cd]);
}

/**
 * A thin 64-bit Mach-O with just enough structure for codesign to sign it: `__TEXT` from the
 * start of the file, a `__LINKEDIT` after it, a UUID, a build version, and the zero padding after
 * the load commands that a signature command needs.
 */
export function syntheticMachO(options: SyntheticMachOOptions): Buffer {
    const { arch, seed, fileType = "execute", uuid = true, minMacOS = 0x000c0000, linkerSigned = false } = options;
    const executable = fileType === "execute";
    const pageSize = arch === "arm64" ? 0x4000 : 0x1000;
    const textSize = arch === "arm64" ? 0x4000 : 0x3000;
    const linkeditData = seededBytes(`${seed}:linkedit`, 0x1a7);
    const base = executable ? 0x100000000n : 0n;
    const plistSection = options.infoPlistSection
        ? [section("__info_plist", "__TEXT", base + 0x800n, 0x100, 0x800)]
        : [];

    const commands: Buffer[] = [];
    if (executable) {
        commands.push(segmentCommand("__PAGEZERO", 0n, 0x100000000n, 0, 0, 0));
    }
    commands.push(segmentCommand("__TEXT", base, BigInt(textSize), 0, textSize, 5, plistSection));
    const linkedit = segmentCommand("__LINKEDIT", base + BigInt(textSize), BigInt(pageSize), textSize, linkeditData.length, 1);
    commands.push(linkedit);
    if (uuid) {
        const command = Buffer.alloc(24);
        command.writeUInt32LE(0x1b, 0);
        command.writeUInt32LE(24, 4);
        seededBytes(`${seed}:uuid`, 16).copy(command, 8);
        commands.push(command);
    }
    const buildVersion = Buffer.alloc(24);
    buildVersion.writeUInt32LE(0x32, 0);
    buildVersion.writeUInt32LE(24, 4);
    buildVersion.writeUInt32LE(1, 8);
    buildVersion.writeUInt32LE(minMacOS, 12);
    buildVersion.writeUInt32LE(0x000f0000, 16);
    commands.push(buildVersion);
    const signatureCommand = Buffer.alloc(16);
    if (linkerSigned) {
        signatureCommand.writeUInt32LE(0x1d, 0);
        signatureCommand.writeUInt32LE(16, 4);
        commands.push(signatureCommand);
    }

    const loadCommands = Buffer.concat(commands);
    const header = Buffer.alloc(32);
    header.writeUInt32LE(0xfeedfacf, 0);
    header.writeUInt32LE(arch === "arm64" ? 0x0100000c : 0x01000007, 4);
    header.writeUInt32LE(arch === "arm64" ? 0 : 3, 8);
    header.writeUInt32LE(executable ? 2 : 6, 12);
    header.writeUInt32LE(commands.length, 16);
    header.writeUInt32LE(loadCommands.length, 20);
    header.writeUInt32LE(executable ? 0x00200085 : 0x00100085, 24);

    const unsignedLength = textSize + linkeditData.length;
    const image = Buffer.alloc(unsignedLength);
    header.copy(image, 0);
    loadCommands.copy(image, 32);
    // Code bytes start well clear of the load commands, leaving the padding a signature command needs.
    seededBytes(`${seed}:text`, textSize - 0x400).copy(image, 0x400);
    linkeditData.copy(image, textSize);
    if (!linkerSigned) {
        return image;
    }

    // The linker puts its signature 16-byte aligned at the end of __LINKEDIT and covers it there.
    const dataoff = Math.ceil(unsignedLength / 16) * 16;
    const commandAt = 32 + loadCommands.length - 16;
    const linkeditAt = 32 + loadCommands.indexOf(linkedit);
    const sized = Buffer.alloc(dataoff);
    image.copy(sized);
    sized.writeUInt32LE(dataoff, commandAt + 8);
    const draft = linkerSignature(sized, dataoff);
    const datasize = Math.ceil(draft.length / 16) * 16;
    sized.writeUInt32LE(datasize, commandAt + 12);
    sized.writeBigUInt64LE(BigInt(dataoff + datasize - textSize), linkeditAt + 48);
    const signed = Buffer.alloc(dataoff + datasize);
    sized.copy(signed);
    linkerSignature(sized, dataoff).copy(signed, dataoff);
    return signed;
}

/** A universal image of an x86_64 and an arm64 synthetic image, made the way Studio makes one. */
export function syntheticUniversal(seed: string, options: Partial<SyntheticMachOOptions> = {}): Buffer {
    return buildFatMachO([
        { name: `${seed} x64`, arch: "x64", image: syntheticMachO({ ...options, arch: "x64", seed: `${seed}:x64` }) },
        {
            name: `${seed} arm64`,
            arch: "arm64",
            image: syntheticMachO({ ...options, arch: "arm64", seed: `${seed}:arm64`, linkerSigned: true }),
        },
    ]);
}

/* ------------------------------------------------------------------ a bundle */

export function infoPlist(executable: string, identifier: string): Buffer {
    return Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
        + '<plist version="1.0">\n<dict>\n'
        + `\t<key>CFBundleExecutable</key>\n\t<string>${executable}</string>\n`
        + `\t<key>CFBundleIdentifier</key>\n\t<string>${identifier}</string>\n`
        + "\t<key>CFBundlePackageType</key>\n\t<string>APPL</string>\n"
        + "</dict>\n</plist>\n",
        "utf8",
    );
}

const file = (data: Buffer | string, mode = 0o644): BundleEntry => ({
    kind: "file",
    mode,
    data: typeof data === "string" ? Buffer.from(data, "utf8") : data,
});
/** An executable file: what a Mach-O image is mode-wise. */
const code = (data: Buffer): BundleEntry => file(data, 0o755);
const link = (target: string): BundleEntry => ({ kind: "symlink", mode: 0o755, target });
const directory: BundleEntry = { kind: "directory", mode: 0o755 };

/*
 * Three names whose order differs between UTF-8 and UTF-16: by UTF-8 bytes the fullwidth A
 * (U+FF21) sorts before the emoji (U+1F600), by UTF-16 code units after it, because the emoji is
 * a surrogate pair. codesign orders the seal the UTF-16 way.
 */
export const E_ACUTE = String.fromCodePoint(0xe9);
export const FULLWIDTH_A = String.fromCodePoint(0xff21);
export const EMOJI = String.fromCodePoint(0x1f600);

/**
 * `Synth.app`, a bundle with one of everything the resource rules distinguish: omitted files,
 * optional localisations, `Base.lproj`, links in plain and nested-code locations, a versioned
 * framework with loose code of its own, a nested app whose identifier has no dot, loose code in
 * a plain directory under `Frameworks/`, a Mach-O image outside the nested-code locations, a
 * `.dSYM`, names that sort differently by UTF-8 and UTF-16, and names that need escaping.
 */
export function syntheticBundle(): BundleTree {
    const app = "Synth.app/Contents";
    const framework = `${app}/Frameworks/Inner.framework`;
    const helper = `${app}/Frameworks/Nodot Helper.app/Contents`;
    const entries: [string, BundleEntry][] = [
        ["Synth.app", directory],
        [app, directory],
        [`${app}/Info.plist`, file(infoPlist("Synth", "com.example.synth"))],
        [`${app}/PkgInfo`, file("APPL????")],
        [`${app}/version.plist`, file("<plist/>\n")],
        [`${app}/.DS_Store`, file("top-level finder data")],
        [`${app}/toplink`, link("Resources/app.dat")],
        [`${app}/Synth.dSYM/Contents/Info.txt`, file("debug symbols stand-in")],
        [`${app}/MacOS`, directory],
        [`${app}/MacOS/Synth`, code(syntheticUniversal("main"))],
        [`${app}/MacOS/tool`, code(syntheticMachO({ arch: "x64", seed: "tool" }))],
        [`${app}/Resources/app.dat`, file(seededBytes("app.dat", 5000))],
        [`${app}/Resources/.DS_Store`, file("finder data")],
        [`${app}/Resources/link`, link("app.dat")],
        [`${app}/Resources/lib.dylib`, code(syntheticMachO({ arch: "arm64", seed: "lib", fileType: "dylib" }))],
        [`${app}/Resources/payload.bin`, file(seededBytes("payload", 70000))],
        [`${app}/Resources/a&b<c>.txt`, file("escaped")],
        [`${app}/Resources/${E_ACUTE}.txt`, file("e acute")],
        [`${app}/Resources/${FULLWIDTH_A}.txt`, file("fullwidth A")],
        [`${app}/Resources/${EMOJI}.txt`, file("emoji")],
        [`${app}/Resources/en.lproj/Localizable.strings`, file("\"a\" = \"b\";")],
        [`${app}/Resources/en.lproj/locversion.plist`, file("<plist/>\n")],
        [`${app}/Resources/en.lproj/linked.strings`, link("Localizable.strings")],
        [`${app}/Resources/Base.lproj/Main.strings`, file("\"base\" = \"1\";")],
        [`${app}/Frameworks/plain/tool2`, code(syntheticUniversal("tool2"))],
        [`${framework}/Versions/A/Inner`, code(syntheticMachO({ arch: "arm64", seed: "inner", fileType: "dylib", linkerSigned: true }))],
        [`${framework}/Versions/A/Resources/Info.plist`, file(infoPlist("Inner", "com.example.inner"))],
        [`${framework}/Versions/A/Resources/data.txt`, file("framework data")],
        [`${framework}/Versions/A/Helpers/crash`, code(syntheticMachO({ arch: "arm64", seed: "crash", linkerSigned: true }))],
        [`${framework}/Versions/Current`, link("A")],
        [`${framework}/Inner`, link("Versions/Current/Inner")],
        [`${framework}/Resources`, link("Versions/Current/Resources")],
        [`${helper}/Info.plist`, file(infoPlist("Nodot Helper", "nodothelper"))],
        [`${helper}/MacOS/Nodot Helper`, code(syntheticUniversal("helper"))],
    ];
    return new Map(entries);
}

/* ------------------------------------------------------------------ real bundles */

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;

/** A bundle tree read out of a zip that carries unix modes and symbolic links, as `ditto` reads it. */
export function readBundleZip(archive: Buffer): BundleTree {
    const tree: BundleTree = new Map();
    for (const entry of parseZipIndex(archive).entries) {
        const path = entry.name.replace(/\/$/, "");
        const mode = entry.unixMode & 0o7777;
        const type = entry.unixMode & S_IFMT;
        if (entry.isDirectory || type === S_IFDIR) {
            tree.set(path, { kind: "directory", mode });
        } else if (type === S_IFLNK) {
            tree.set(path, { kind: "symlink", mode, target: readEntryBytes(archive, entry).toString("utf8") });
        } else {
            tree.set(path, { kind: "file", mode, data: readEntryBytes(archive, entry) });
        }
    }
    return tree;
}

/**
 * The universal input Studio hands the signer, made from an arm64 and an x86_64 build of the
 * same app: the arm64 tree, plus what only the x86_64 one has, with every Mach-O image that
 * differs between them replaced by a universal image of the two (x86_64 first, as `lipo`
 * orders them). Anything else that differs is taken from the arm64 build.
 */
export function universalBundleTree(arm64: BundleTree, x64: BundleTree): BundleTree {
    const tree: BundleTree = new Map(arm64);
    for (const [path, theirs] of x64) {
        const ours = tree.get(path);
        if (!ours) {
            tree.set(path, theirs);
        } else if (ours.kind === "file" && theirs.kind === "file" && !ours.data.equals(theirs.data)
            && thinMachOArch(ours.data) === "arm64" && thinMachOArch(theirs.data) === "x64") {
            tree.set(path, {
                ...ours,
                data: buildFatMachO([
                    { name: `${path} (x64)`, arch: "x64", image: theirs.data },
                    { name: `${path} (arm64)`, arch: "arm64", image: ours.data },
                ]),
            });
        }
    }
    return tree;
}

/** Every way two trees differ, one line each, empty when they are the same file for file. */
export function treeDifferences(actual: BundleTree, expected: BundleTree): string[] {
    const differences: string[] = [];
    for (const [path, want] of expected) {
        const got = actual.get(path);
        if (!got) {
            differences.push(`missing ${path}`);
        } else if (got.kind !== want.kind) {
            differences.push(`${path} is a ${got.kind}, expected a ${want.kind}`);
        } else if (got.mode !== want.mode) {
            differences.push(`${path} has mode ${got.mode.toString(8)}, expected ${want.mode.toString(8)}`);
        } else if (got.kind === "file" && want.kind === "file" && !got.data.equals(want.data)) {
            differences.push(`${path} differs (${got.data.length} bytes, expected ${want.data.length})`);
        } else if (got.kind === "symlink" && want.kind === "symlink" && got.target !== want.target) {
            differences.push(`${path} points at ${got.target}, expected ${want.target}`);
        }
    }
    for (const path of actual.keys()) {
        if (!expected.has(path)) {
            differences.push(`unexpected ${path}`);
        }
    }
    return differences;
}
