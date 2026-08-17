/**
 * Every shell capability the host declares has to be handed to the blueprint bridge.
 *
 * `GameApp` builds the bridge's options from the host, and each of those options is optional on the
 * bridge - a shell that cannot do a thing omits it, and the node reports the absence. That makes a
 * forgotten line invisible: `movePointer` reached `GameAppHost`, all three shells implemented it,
 * the bridge accepted an `onMovePointer`, and nothing connected the two. Every graph got "the
 * cursor cannot be moved here", in Dev Mode and in packaged games alike, with types, tests and lint
 * all green. It took clicking a button on a real machine to find it.
 *
 * So this reads the three files as text and pairs them up: for every `on<Name>` the bridge accepts
 * whose `<name>` is also a field on `GameAppHost`, `GameApp` must forward it. Source-level because
 * the defect is in wiring that no type can require - the same reason `runtimeImportBoundary` and
 * `builtinRendererParity` are written this way.
 *
 * It counts rather than searches. `GameApp` builds the options in two places - the stage host and
 * the nested-surface host - and a capability wired in one of them is exactly as broken as one wired
 * in neither, for whichever surface got the other. The first draft of this test used `includes`,
 * passed with one of the two sites deleted, and would have shipped that.
 */

import fs from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";

const HERE = path.resolve(__dirname);
const HOST_FILE = path.join(HERE, "GameAppHost.ts");
const APP_FILE = path.join(HERE, "GameApp.tsx");
const BRIDGE_FILE = path.resolve(HERE, "../../blueprint-runtime/BlueprintHostApiBridge.ts");

/**
 * Options the bridge takes that are plainly a host capability under another name, and are wired
 * from something other than `host.<name>`. Each needs a reason, because the default has to be
 * "forwarded from the host" for the check to mean anything.
 */
const FORWARDED_ELSEWHERE: Readonly<Record<string, string>> = {
    // Both are wrapped in GameApp so the running story is saved into the exported document and
    // restored from an imported one; the host only owns the file.
    onExportProgress: "wrapped as exportProgressInGame, which adds the playthrough",
    onImportProgress: "wrapped as importProgressInGame, which resumes the story",
};

function occurrences(source: string, needle: string): number {
    return source.split(needle).length - 1;
}

function optionNamesFrom(source: string): string[] {
    // The bridge's own options type is the one place these are declared.
    const block = source.slice(source.indexOf("onNetworkFetch"));
    return [...new Set([...block.matchAll(/\bon([A-Z]\w+)\??:/g)].map(match => match[1]!))];
}

function hostFieldsFrom(source: string): Set<string> {
    return new Set([...source.matchAll(/^ {4}(\w+)\??:/gm)].map(match => match[1]!));
}

describe("host capability forwarding", () => {
    it("hands every host capability the bridge accepts to the bridge", async () => {
        const [hostSource, appSource, bridgeSource] = await Promise.all([
            fs.readFile(HOST_FILE, "utf-8"),
            fs.readFile(APP_FILE, "utf-8"),
            fs.readFile(BRIDGE_FILE, "utf-8"),
        ]);
        const hostFields = hostFieldsFrom(hostSource);

        // How many option blocks there are, counted from one capability that is definitely in all
        // of them. Every other host-backed option has to appear the same number of times.
        const blocks = occurrences(appSource, "onNetworkFetch: host.networkFetch");
        expect(blocks, "no bridge option block found in GameApp").toBeGreaterThan(0);

        const wrong: string[] = [];
        for (const suffix of optionNamesFrom(bridgeSource)) {
            const field = suffix.charAt(0).toLowerCase() + suffix.slice(1);
            if (!hostFields.has(field)) {
                continue;
            }
            const option = `on${suffix}`;
            if (FORWARDED_ELSEWHERE[option]) {
                continue;
            }
            const found = occurrences(appSource, `${option}: host.${field}`);
            if (found !== blocks) {
                wrong.push(`${option}: host.${field} - forwarded ${found}x, expected ${blocks}x`);
            }
        }
        expect(wrong, `GameApp does not hand these to every bridge it builds:\n${wrong.join("\n")}`).toEqual([]);
    });

    it("is non-vacuous: it can see the capabilities that are wired", async () => {
        const bridgeSource = await fs.readFile(BRIDGE_FILE, "utf-8");
        const options = optionNamesFrom(bridgeSource);
        expect(options).toContain("NetworkFetch");
        expect(options).toContain("MovePointer");
        expect(options).toContain("OpenExternal");
    });
});
