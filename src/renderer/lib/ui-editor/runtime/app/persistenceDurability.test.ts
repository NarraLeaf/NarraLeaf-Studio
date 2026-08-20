/**
 * A persistent value has to reach the store, and the API is now shaped so that it does.
 *
 * The scope bridge used to expose two setters one word apart — `persistenceSet` wrote an in-memory
 * map, `persistenceSetAsync` also wrote the store — and the memory-only one was the easier of the
 * two to reach for: synchronous, no promise to handle, and correct in every assertion made inside
 * the session that wrote it. The same confusion shipped three separate times:
 *
 *  - story-written persistent variables, which no blueprint could see;
 *  - the playtime total, which never survived a relaunch;
 *  - the read-text record, which meant skip-read-text skipped nothing and every "has the player
 *    heard this line" answered no, on every playthrough after the first.
 *
 * Each needed a person to find, twice by driving the real app, because no test written inside one
 * session can tell a durable write from a session-only one.
 *
 * So the shape changed rather than the call sites: there is one setter, it updates the map
 * synchronously and then writes through, and the session-only case has a name nobody reaches for by
 * accident. This file holds the shape in place. It is deliberately about the *API*, not about
 * individual writes — an allowlist of call sites was the previous design, and its first draft
 * excused the very defect it was written for.
 */

import fs from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";

const RENDERER_SRC = path.resolve(__dirname, "../../../..");
const BRIDGE = "lib/ui-editor/blueprint-runtime/ScopeStoreBridge.ts";

/** Every renderer source file, so a new caller cannot appear somewhere this test does not look. */
async function rendererSources(): Promise<Array<{ file: string; source: string }>> {
    const out: Array<{ file: string; source: string }> = [];
    async function walk(dir: string): Promise<void> {
        for (const entry of await fs.readdir(path.join(RENDERER_SRC, dir), { withFileTypes: true })) {
            const rel = path.posix.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "dist" || entry.name === "node_modules") {
                    continue;
                }
                await walk(rel);
            } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
                out.push({ file: rel, source: await fs.readFile(path.join(RENDERER_SRC, rel), "utf-8") });
            }
        }
    }
    await walk(".");
    return out;
}

describe("persistence durability", () => {
    it("has exactly one way to write a persistent value, and it reaches the store", async () => {
        const bridge = await fs.readFile(path.join(RENDERER_SRC, BRIDGE), "utf-8");
        // The second setter is gone. Reintroducing one under any name that reads as an alternative
        // to the real thing is how this defect comes back.
        expect(
            bridge.includes("persistenceSetAsync"),
            "persistenceSetAsync is back; the two-setter split is exactly what shipped three defects",
        ).toBe(false);
        expect(bridge).toContain("public persistenceSet(key: string, value: unknown): Promise<void>");
        expect(bridge).toContain("public persistenceSetSessionOnly(key: string, value: unknown): void");
    });

    it("updates the map before it awaits anything, so no caller needs to write twice", async () => {
        const bridge = await fs.readFile(path.join(RENDERER_SRC, BRIDGE), "utf-8");
        const body = bridge.slice(
            bridge.indexOf("public persistenceSet(key: string"),
            bridge.indexOf("public persistenceSetSessionOnly"),
        );
        const local = body.indexOf("applyPersistenceLocally");
        const through = body.indexOf("writePersistenceThrough");
        expect(local, "persistenceSet no longer updates the map").toBeGreaterThan(-1);
        expect(through, "persistenceSet no longer writes through").toBeGreaterThan(-1);
        // Order is the load-bearing part: it is why the paired double-write is unnecessary, and the
        // paired double-write is what every one of these call sites used to be.
        expect(local, "the map must be updated before the store write is started").toBeLessThan(through);
    });

    it("keeps every session-only write justified at the call site", async () => {
        const unexplained: string[] = [];
        for (const { file, source } of await rendererSources()) {
            if (file === BRIDGE) {
                continue;
            }
            const lines = source.split(/\r?\n/);
            lines.forEach((line, index) => {
                if (!line.includes("persistenceSetSessionOnly(")) {
                    return;
                }
                // The three lines above it have to say why this value is not worth keeping.
                const reason = lines.slice(Math.max(0, index - 3), index).join(" ");
                if (!reason.includes("//")) {
                    unexplained.push(`${file}:${index + 1}`);
                }
            });
        }
        expect(
            unexplained,
            `a session-only write needs a comment saying why the value is re-derived rather than kept:\n${unexplained.join("\n")}`,
        ).toEqual([]);
    });

    it("is non-vacuous: it can see the writes it is checking", async () => {
        let durable = 0;
        let sessionOnly = 0;
        for (const { file, source } of await rendererSources()) {
            if (file === BRIDGE) {
                continue;
            }
            durable += source.split(/scopeBridge\??\.persistenceSet\(|scope\.persistenceSet\(|persistence\.persistenceSet\(/).length - 1;
            sessionOnly += source.split("persistenceSetSessionOnly(").length - 1;
        }
        // If the bridge is renamed and these drop to zero, the checks above would pass on a
        // codebase that no longer persists anything at all.
        expect(durable, "no durable persistence writes found - has the bridge been renamed?")
            .toBeGreaterThan(4);
        expect(sessionOnly, "no session-only writes found - has the escape hatch been renamed?")
            .toBeGreaterThan(0);
    });
});
