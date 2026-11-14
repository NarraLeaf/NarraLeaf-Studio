import { buildFatMachO, machOKind } from "../fatMachO";
import type { BundleEntry, BundleTree } from "../macBundle/bundleTree";

/**
 * A universal macOS bundle from its Intel and Apple-silicon halves, the job `@electron/universal`
 * does after electron-builder has packed one app per architecture.
 *
 * Both halves are assembled from the same game (same payload, same plists), so they differ only in
 * machine code - and in the one file Electron ships under an architecture's name in each,
 * `v8_context_snapshot.<arch>.bin`, which a universal app carries both of. A Mach-O file that differs
 * becomes a universal image of the two, x86_64 first as lipo and the signer expect. Identical files
 * are kept once when they can serve both architectures. Anything else differing means the halves
 * were not built alike, and stops the build rather than shipping one half's copy for both machines.
 */
export function mergeUniversalBundle(x64: BundleTree, arm64: BundleTree): BundleTree {
    const merged: BundleTree = new Map();
    for (const path of new Set([...x64.keys(), ...arm64.keys()])) {
        const intel = x64.get(path);
        const silicon = arm64.get(path);
        if (!intel || !silicon) {
            const entry = (intel ?? silicon) as BundleEntry;
            if (entry.kind === "file" && machOKind(entry.data) === "thin") {
                throw new Error(`${path} is a single-architecture image missing from the other half of the app.`);
            }
            merged.set(path, entry);
            continue;
        }
        if (sameEntry(intel, silicon)) {
            if (intel.kind === "file" && machOKind(intel.data) === "thin") {
                throw new Error(`${path} is the same single-architecture image in both halves of the app; a universal app needs both architectures.`);
            }
            merged.set(path, silicon);
            continue;
        }
        if (intel.kind === "file" && silicon.kind === "file"
            && machOKind(intel.data) === "thin" && machOKind(silicon.data) === "thin") {
            merged.set(path, {
                kind: "file",
                mode: silicon.mode,
                data: buildFatMachO([
                    { name: `${path} (x64)`, arch: "x64", image: intel.data },
                    { name: `${path} (arm64)`, arch: "arm64", image: silicon.data },
                ]),
            });
            continue;
        }
        throw new Error(`${path} differs between the Intel and Apple-silicon halves of the app and is not machine code; a universal app cannot hold both.`);
    }
    return merged;
}

function sameEntry(a: BundleEntry, b: BundleEntry): boolean {
    if (a === b) {
        return true;
    }
    switch (a.kind) {
        case "directory":
            return b.kind === "directory";
        case "symlink":
            return b.kind === "symlink" && a.target === b.target;
        case "file":
            return b.kind === "file" && a.data.equals(b.data);
        case "diskFile":
            return b.kind === "diskFile" && a.sha256.equals(b.sha256);
    }
}
