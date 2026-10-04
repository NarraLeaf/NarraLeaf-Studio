/**
 * Ad-hoc signing of a whole macOS bundle held in memory, with the result codesign gives for
 *
 *     codesign --sign - --force --preserve-metadata=entitlements,requirements,flags,runtime --deep
 *
 * which is what `@electron/fuses` runs on a macOS game after flipping its fuses. Doing it here
 * means a macOS game can be signed on a host that has no codesign, and that the result can be
 * compared file for file with a Mac's.
 *
 * `--deep` signs inside out. Within each bundle, the version 2 resource rules (`codeResources.ts`)
 * decide what is nested code: a directory at a nested-code location whose name has a dot in it
 * is a nested bundle and is signed as one, and a file there is signed in place if it is a Mach-O
 * image. Everything else is only hashed into the bundle's seal - including Mach-O images outside
 * the nested-code locations, such as `Libraries/*.dylib` or a `.node` under `Resources/`, which
 * codesign leaves exactly as they are. The bundle's own main executable is signed last, because
 * its signature covers the seal.
 *
 * A symbolic link is never nested code (codesign treats one at a nested-code location as a plain
 * resource) and is never followed, except for a framework's `Versions/Current`, which is how a
 * framework says which version is the bundle.
 */

import crypto from "crypto";
import { parsePlistDictionary } from "../mobile/plist";
import type { BundleEntry, BundleTree } from "./bundleTree";
import { codeResources, resourceRule, type SealedResource } from "./codeResources";
import {
    adHocDesignatedRequirement,
    adHocSignMachO,
    EMPTY_REQUIREMENTS_BLOB,
    embedsInfoPlist,
    isMachO,
    looseCodeIdentifier,
    type SignedMachO,
} from "./machOSignature";

const sha256 = (data: Buffer): Buffer => crypto.createHash("sha256").update(data).digest();
const REQUIREMENTS_HASH = sha256(EMPTY_REQUIREMENTS_BLOB);

/*
 * What codesign leaves out of a bundle's seal whatever the rules say: its own signature
 * directory, the old top-level link into it, the App Store receipt directory, and the main
 * executable (excluded by path in `sealResources`).
 */
const EXCLUDED_FROM_SEAL = new Set(["_CodeSignature", "CodeResources", "_MASReceipt"]);
const SIGNATURE_DIRECTORY = "_CodeSignature";

/**
 * Sign the bundle at `bundlePath` (a key prefix in `tree`, such as `My Game.app`) and everything
 * nested in it, innermost first.
 *
 * The tree is changed in place: every signed image's data is replaced, and each bundle gains
 * `_CodeSignature/CodeResources`. Returns the main executable's cdhash.
 *
 * Throws when the bundle holds something codesign would sign in a way no archive can carry - a
 * file that is not code at a nested-code location, which codesign signs into extended
 * attributes - and for anything this signer cannot sign the way codesign would.
 */
export function adHocSignBundle(tree: BundleTree, bundlePath: string, log: (message: string) => void = () => {}): Buffer {
    return signBundle(tree, new TreeIndex(tree), bundlePath, log).cdhash;
}

/* ------------------------------------------------------------------ the tree as directories */

type Node =
    | { kind: "directory" }
    | Exclude<BundleEntry, { kind: "directory" }>;

/**
 * The directory structure of a tree, including directories only implied by the paths under
 * them: a zip need not carry an entry for every directory.
 */
class TreeIndex {
    private readonly children = new Map<string, Set<string>>();

    constructor(private readonly tree: BundleTree) {
        for (const key of tree.keys()) {
            let parent = "";
            for (const part of key.split("/")) {
                let names = this.children.get(parent);
                if (!names) {
                    names = new Set();
                    this.children.set(parent, names);
                }
                names.add(part);
                parent = parent ? `${parent}/${part}` : part;
            }
        }
    }

    node(path: string): Node | undefined {
        const entry = this.tree.get(path);
        if (entry && entry.kind !== "directory") {
            return entry;
        }
        return entry || this.children.has(path) ? { kind: "directory" } : undefined;
    }

    /** Names in a directory, sorted so that a walk is the same every time. */
    list(path: string): string[] {
        return [...this.children.get(path) ?? []].sort();
    }

    /** Where a symbolic link leads, followed until it reaches something that is not a link. */
    resolve(path: string): string {
        let current = path;
        for (let hops = 0; hops < 32; hops++) {
            const node = this.node(current);
            if (!node || node.kind !== "symlink") {
                return current;
            }
            if (node.target.startsWith("/")) {
                throw new Error(`${current} is an absolute link, which cannot point inside the bundle`);
            }
            const parts = current.split("/").slice(0, -1);
            for (const part of node.target.split("/")) {
                if (part === "..") {
                    parts.pop();
                } else if (part !== "." && part !== "") {
                    parts.push(part);
                }
            }
            current = parts.join("/");
        }
        throw new Error(`${path} is a chain of links that does not end`);
    }
}

/* ------------------------------------------------------------------ bundles */

type BundleLayout = {
    /** The directory the seal covers and whose paths it names. */
    root: string;
    infoPlist: string;
    /** The main executable, relative to `root`. */
    executable: string;
    identifier: string;
};

/**
 * Where a bundle keeps its sealed content, Info.plist and main executable: `Contents/` for an
 * app (or any bundle shaped like one), and the current version for a framework.
 */
function bundleLayout(tree: BundleTree, index: TreeIndex, bundle: string): BundleLayout {
    let root: string;
    let infoPlist: string;
    let executableDir: string;
    if (index.node(`${bundle}/Contents/Info.plist`)) {
        root = `${bundle}/Contents`;
        infoPlist = `${root}/Info.plist`;
        executableDir = "MacOS/";
    } else if (index.node(`${bundle}/Versions/Current`)) {
        root = index.resolve(`${bundle}/Versions/Current`);
        infoPlist = `${root}/Resources/Info.plist`;
        executableDir = "";
    } else {
        throw new Error(
            `${bundle} is not a bundle this signer understands: it has neither Contents/Info.plist nor Versions/Current`,
        );
    }

    const info = tree.get(infoPlist);
    if (!info || info.kind !== "file") {
        throw new Error(`${bundle} has no Info.plist at ${infoPlist}`);
    }
    if (info.data.subarray(0, 6).toString("latin1") === "bplist") {
        throw new Error(`${infoPlist} is a binary property list; this signer reads XML ones only`);
    }
    const plist = parsePlistDictionary(info.data.toString("utf8"));
    const executable = plist.CFBundleExecutable;
    const identifier = plist.CFBundleIdentifier;
    if (typeof executable !== "string" || executable === "") {
        throw new Error(`${infoPlist} names no CFBundleExecutable; a bundle without a main executable is not signed here`);
    }
    if (typeof identifier !== "string" || identifier === "") {
        throw new Error(`${infoPlist} has no CFBundleIdentifier to sign the bundle as`);
    }
    return { root, infoPlist, executable: `${executableDir}${executable}`, identifier };
}

function signBundle(tree: BundleTree, index: TreeIndex, bundle: string, log: (message: string) => void): SignedMachO {
    const layout = bundleLayout(tree, index, bundle);
    const executablePath = `${layout.root}/${layout.executable}`;
    const executable = tree.get(executablePath);
    if (!executable || executable.kind !== "file" || !isMachO(executable.data)) {
        throw new Error(
            executable?.kind === "diskFile"
                ? `${executablePath} is ${bundle}'s main executable, but it was left on disk as a payload file, `
                    + "which is never signed"
                : `${bundle}'s main executable ${executablePath} is missing or is not a Mach-O image`,
        );
    }

    const seal = codeResources(sealResources(tree, index, layout, log));
    if (!tree.has(`${layout.root}/${SIGNATURE_DIRECTORY}`)) {
        tree.set(`${layout.root}/${SIGNATURE_DIRECTORY}`, { kind: "directory", mode: 0o755 });
    }
    tree.set(`${layout.root}/${SIGNATURE_DIRECTORY}/CodeResources`, { kind: "file", mode: 0o644, data: seal });

    // A bundle is signed as its CFBundleIdentifier exactly as written; only loose code gets a suffix.
    const info = tree.get(layout.infoPlist) as Extract<BundleEntry, { kind: "file" }>;
    const specialSlots = [sha256(info.data), REQUIREMENTS_HASH, sha256(seal)];
    const signed = adHocSignMachO(executable.data, layout.identifier, specialSlots, executablePath);
    tree.set(executablePath, { ...executable, data: signed.image });
    log(`signed ${bundle} as ${layout.identifier}`);
    return signed;
}

/**
 * Walk a bundle's sealed content the way codesign's resource scan does, signing nested code on
 * the way, and return what the seal names.
 */
function sealResources(
    tree: BundleTree,
    index: TreeIndex,
    layout: BundleLayout,
    log: (message: string) => void,
): SealedResource[] {
    const resources: SealedResource[] = [];
    const walk = (directory: string): void => {
        for (const name of index.list(directory ? `${layout.root}/${directory}` : layout.root)) {
            const path = directory ? `${directory}/${name}` : name;
            const full = `${layout.root}/${path}`;
            if (EXCLUDED_FROM_SEAL.has(path) || path === layout.executable) {
                continue;
            }
            const node = index.node(full) as Node;
            const rule = resourceRule(path);
            if (node.kind === "directory") {
                if (rule.nested && name.includes(".")) {
                    resources.push(nestedResource(path, signBundle(tree, index, full, log)));
                } else {
                    walk(path);
                }
            } else if (node.kind === "symlink") {
                resources.push({ path, kind: "symlink", target: node.target });
            } else if (rule.nested && !rule.omit) {
                resources.push(signLooseCode(tree, full, path, node, log));
            } else if (node.kind === "diskFile") {
                resources.push({ path, kind: "hashedFile", sha1: node.sha1, sha256: node.sha256 });
            } else {
                resources.push({ path, kind: "file", data: node.data });
            }
        }
    };
    walk("");
    return resources;
}

/** Sign a file at a nested-code location, which must be a Mach-O image to be signable at all. */
function signLooseCode(
    tree: BundleTree,
    full: string,
    path: string,
    node: Extract<BundleEntry, { kind: "file" | "diskFile" }>,
    log: (message: string) => void,
): SealedResource {
    if (node.kind === "diskFile" || !isMachO(node.data)) {
        throw new Error(
            `${full} is not code, but it sits where a bundle keeps nested code. codesign would sign it into extended `
            + "attributes, which no zip carries, so the signature would break as soon as the game is unpacked. "
            + "Put it in the bundle's Resources folder instead.",
        );
    }
    if (embedsInfoPlist(node.data, full)) {
        throw new Error(`${full} embeds an Info.plist, which codesign signs it by and this signer does not handle`);
    }
    const fileName = path.slice(path.lastIndexOf("/") + 1);
    const identifier = looseCodeIdentifier(fileName, node.data, full);
    const signed = adHocSignMachO(node.data, identifier, [null, REQUIREMENTS_HASH], full);
    tree.set(full, { ...node, data: signed.image });
    log(`signed nested code ${full} as ${identifier}`);
    return nestedResource(path, signed);
}

/** How a parent's seal names signed nested code: by the cdhash and requirement codesign records. */
function nestedResource(path: string, signed: SignedMachO): SealedResource {
    return { path, kind: "nested", cdhash: signed.cdhash, requirement: adHocDesignatedRequirement(signed) };
}
