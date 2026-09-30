import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { PROJECT_TRUST_ON_ARRIVAL } from "@shared/types/projectTrust";

/**
 * The declared origins and the routes that record one, held against each other.
 *
 * Absence means distrusted, so a route that forgets to record an arrival produces a project that
 * does not run - the safe side, and one the author notices. What this file guards is the other
 * half: the origins that *vouch* on arrival. A route recording `created`, `recent` or
 * `command-line` trusts a project without asking, so the sites allowed to write each are named
 * here, and a new writer, a removed one, or an origin nothing declares is a visible diff rather
 * than a change nobody reviews.
 */

const MAIN_ROOT = path.resolve(__dirname, "../../..");
const TYPES_FILE = path.resolve(__dirname, "../../../../shared/types/projectTrust.ts");

/** Every site that records an arrival, and the origins it is allowed to record. */
const EXPECTED_RECORDING_SITES: Record<string, readonly string[]> = {
    // Every workspace window: a folder Studio never saw waits, a command-line build is the
    // operator's own decision.
    "app/app.ts": ["command-line", "opened"],
    // The migration: the author's recent list, vouched for once as the ledger turns fail-closed.
    "app/application/managers/projectTrustManager.ts": ["recent"],
    "app/application/managers/vcs/VcsManager.ts": ["remote"],
    "app/application/managers/window/handlers/projectPackageAction.ts": ["package"],
    // The wizard reporting a project it has just written - the one route that vouches for a
    // project on a renderer's word, which is why the handler checks the window, the grant and
    // the folder before it records.
    "app/application/managers/window/handlers/projectWizardCreatedAction.ts": ["created"],
};

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
    const union = source.slice(source.indexOf("export type ProjectTrustOrigin"));
    const body = union.slice(0, union.indexOf(";"));
    return [...body.matchAll(/\|\s*"([a-z-]+)"/g)].map(match => match[1]).sort();
}

/** `{ file (posix, relative to src/main) -> origins it records }`. */
function recordingSites(): Map<string, string[]> {
    const found = new Map<string, string[]>();
    for (const file of walk(MAIN_ROOT)) {
        const source = fs.readFileSync(file, "utf-8");
        const origins = [...source.matchAll(/recordArrival\([^)]*?,\s*"([a-z-]+)"/gs)].map(match => match[1]);
        if (origins.length > 0) {
            found.set(path.relative(MAIN_ROOT, file).replaceAll(path.sep, "/"), [...new Set(origins)].sort());
        }
    }
    return found;
}

describe("project trust origins", () => {
    it("declares every origin the arrival table decides for, and no other", () => {
        expect(declaredOrigins()).toEqual(Object.keys(PROJECT_TRUST_ON_ARRIVAL).sort());
    });

    it("vouches on arrival for exactly the origins that are somebody's explicit decision", () => {
        // Studio's own work, the author's existing work, and a project named at a keyboard. A
        // fourth entry here is a route that trusts a project without asking - review it.
        const vouching = Object.entries(PROJECT_TRUST_ON_ARRIVAL)
            .filter(([, voucher]) => voucher !== null)
            .map(([origin, voucher]) => `${origin}:${voucher}`)
            .sort();
        expect(vouching).toEqual(["command-line:author", "created:studio", "recent:studio"]);
    });

    it("records arrivals from exactly the sites named here, with exactly the origins named", () => {
        const sites = Object.fromEntries([...recordingSites()].sort());
        const expected = Object.fromEntries(
            Object.entries(EXPECTED_RECORDING_SITES).map(([file, origins]) => [file, [...origins].sort()]).sort(),
        );
        expect(sites).toEqual(expected);
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
