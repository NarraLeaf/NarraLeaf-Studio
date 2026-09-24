/**
 * `project/app/blueprint.md` and the built-in `--help`, held to the registry they describe.
 *
 * The whole claim this tool makes is that there is no second catalogue to fall behind, and prose is
 * a second catalogue the moment it names a node type or copies an output. It had already drifted:
 * the sample output was missing two pins a node had grown, the count of files the catalogue lives
 * in was a third short, and `--help` offered a `--limit` the guide had never heard of.
 *
 * So the guide is read here rather than trusted. A node type it names must exist, the block it
 * shows as the answer to `node blueprint.sound.play` must be that answer character for character,
 * and a command or flag can be in one of the guide, the usage text and the code only by being in
 * all three.
 *
 * Comments in English per project convention.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { blueprintNodeRegistry, registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes";
import { registerBuiltInPluginBlueprintNodes } from "./builtinPluginNodes";
import { BLUEPRINT_GRAPH_KINDS, BLUEPRINT_OWNER_KINDS, describeNode, formatNodeDetail } from "./catalog";
import { COMMANDS, USAGE } from "./cli";

registerCoreBlueprintNodes();
// The document names a bundled plugin's node, so the registry it is held against has to be the
// one the CLI itself builds.
registerBuiltInPluginBlueprintNodes();

const GUIDE_PATH = path.resolve(__dirname, "../../../../project/app/blueprint.md");
const GUIDE = fs.readFileSync(GUIDE_PATH, "utf8");

/** The node type the guide shows a whole `node <type>` answer for. */
const SAMPLE_TYPE = "blueprint.sound.play";

/**
 * Fenced blocks of the guide, by the first line inside them.
 *
 * Which block is which cannot be a line number, or the test breaks every time a paragraph moves.
 */
function fencedBlockStartingWith(firstLine: string): string | null {
    const lines = GUIDE.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
        if (!lines[index].startsWith("```") || lines[index + 1] !== firstLine) {
            continue;
        }
        const end = lines.indexOf("```", index + 1);
        return lines.slice(index + 1, end).join("\n");
    }
    return null;
}

describe("the blueprint guide", () => {
    it("names only node types that exist", () => {
        // `blueprint.js` and `blueprint.md` are files, and the sentences around them are the reason
        // a bare "a dotted word starting with blueprint" is not enough on its own.
        const mentioned = new Set(
            [...GUIDE.matchAll(/\bblueprint(?:\.[A-Za-z][A-Za-z0-9]*)+/g)]
                .map(match => match[0])
                .filter(type => !/\.(js|md|json|ts)$/.test(type)),
        );
        expect(mentioned.size).toBeGreaterThan(3);
        const missing = [...mentioned].filter(type => !blueprintNodeRegistry.get(type));
        expect(missing).toEqual([]);
    });

    it("shows the answer the command actually gives", () => {
        const shown = fencedBlockStartingWith(SAMPLE_TYPE);
        const detail = describeNode(SAMPLE_TYPE);
        expect(detail).not.toBeNull();
        // Regenerate with: node project/app/blueprint.js node blueprint.sound.play
        expect(shown).toBe(formatNodeDetail(detail!));
    });

    it("names every owner kind there is, and no others", () => {
        const listed = [...GUIDE.matchAll(/`([a-z][A-Za-z]*(?:Main|Value|Asset|Action))`/g)].map(
            match => match[1],
        );
        expect([...new Set(listed)].sort()).toEqual([...BLUEPRINT_OWNER_KINDS].sort());
    });

    it("agrees with the usage text about which commands there are", () => {
        // The command column of the usage text: two spaces, a word, then its arguments. The flag
        // lines under "Common flags" are indented the same way and start with a dash instead.
        const inUsage = [...USAGE.matchAll(/^ {2}([a-z][a-z-]*) /gm)].map(match => match[1]);
        expect([...new Set(inUsage)].sort()).toEqual(Object.keys(COMMANDS).sort());
    });

    it("documents every flag a command takes", () => {
        for (const [command, spec] of Object.entries(COMMANDS)) {
            for (const flag of Object.keys(spec.flags)) {
                expect(USAGE, `${command} --${flag} is not in the usage text`).toContain(`--${flag}`);
            }
        }
    });

    it("offers the graph kinds a node can declare", () => {
        const declared = new Set(blueprintNodeRegistry.list().flatMap(def => def.graphKinds));
        expect([...declared].sort()).toEqual([...BLUEPRINT_GRAPH_KINDS].sort());
    });
});
