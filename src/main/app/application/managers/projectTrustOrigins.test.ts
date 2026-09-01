import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * The declared arrival kinds and the routes that actually record one, held against each other.
 *
 * Distrust is armed by recording an arrival, so a route that brings a project in from elsewhere and
 * forgets to record it produces a project that is trusted forever - silently, and in exactly the
 * case the mode exists for. No test can know what a future import route looks like, so this cannot
 * catch that on its own. What it can do is keep the two halves honest: every declared origin has a
 * writer, every writer names a declared origin, and the list of writing sites is spelled out here
 * so that adding or removing one is a visible diff rather than a change nobody reviews.
 */

const MAIN_ROOT = path.resolve(__dirname, "../../..");
const TYPES_FILE = path.resolve(__dirname, "../../../../shared/types/projectTrust.ts");

/** Every site that arms distrust, named rather than discovered, so removing one fails here. */
const EXPECTED_RECORDING_SITES = [
    "app/application/managers/vcs/VcsManager.ts",
    "app/application/managers/window/handlers/projectPackageAction.ts",
] as const;

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full, out);
        } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
            out.push(full);
        }
    }
    return out;
}

function declaredOrigins(): string[] {
    const source = fs.readFileSync(TYPES_FILE, "utf-8");
    const union = source.slice(source.indexOf("export type ProjectImportOrigin"));
    const body = union.slice(0, union.indexOf(";"));
    return [...body.matchAll(/\|\s*"([a-z-]+)"/g)].map(match => match[1]).sort();
}

/** `{ file (posix, relative to src/main) -> origins it records }`. */
function recordingSites(): Map<string, string[]> {
    const found = new Map<string, string[]>();
    for (const file of walk(MAIN_ROOT)) {
        const source = fs.readFileSync(file, "utf-8");
        const origins = [...source.matchAll(/recordImport\([^)]*?,\s*"([a-z-]+)"/gs)].map(match => match[1]);
        if (origins.length > 0) {
            found.set(path.relative(MAIN_ROOT, file).replaceAll(path.sep, "/"), origins.sort());
        }
    }
    return found;
}

describe("project trust origins", () => {
    it("declares at least one kind", () => {
        expect(declaredOrigins().length).toBeGreaterThan(0);
    });

    it("records an arrival from exactly the sites named here", () => {
        expect([...recordingSites().keys()].sort()).toEqual([...EXPECTED_RECORDING_SITES].sort());
    });

    it("never records an origin the type does not declare", () => {
        const declared = new Set(declaredOrigins());
        for (const [file, origins] of recordingSites()) {
            for (const origin of origins) {
                expect(declared, `${file} records an undeclared origin "${origin}"`).toContain(origin);
            }
        }
    });

    it("has a writer for every declared origin", () => {
        // A kind nothing writes is a kind that describes nothing - either the route was removed and
        // the type was not, or the route was never wired and the type is a promise Studio does not
        // keep. Both read as "this arrival is handled" to anyone auditing the type alone.
        const written = new Set([...recordingSites().values()].flat());
        for (const origin of declaredOrigins()) {
            expect(written, `no route records the "${origin}" origin`).toContain(origin);
        }
    });
});
