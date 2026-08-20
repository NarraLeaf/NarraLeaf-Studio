/**
 * A shell capability has to survive three hops, and nothing in the type system requires any of them.
 *
 * `GameAppHost` declares the capability, each shell implements it, `GameApp` hands it to the
 * blueprint bridge, and the bridge gives it to the nodes. Every field on that path is optional -
 * deliberately, because a shell with no window or no filesystem really does omit some - so a broken
 * hop reads exactly like a shell that cannot do the thing. `movePointer` reached the host, all
 * three shells implemented it, the bridge accepted an `onMovePointer`, and `GameApp` never
 * connected the two: every Move Mouse node in every shell answered "the cursor cannot be moved
 * here" from the day it landed, with types, lint and the whole suite green. It took clicking a
 * button on a real machine to find it.
 *
 * So this reads the files as text and checks the hops that types cannot:
 *
 *  1. `GameApp` forwards every host-backed bridge option, in **every** options block it builds.
 *  2. Both desktop shells implement every capability that is forwarded.
 *  3. The allowlist below still describes options that exist.
 *
 * Source-level for the reason `runtimeImportBoundary` and `builtinRendererParity` are: the defect
 * lives in wiring, and wiring is what a type checker is least able to insist on.
 *
 * It counts rather than searches. `GameApp` builds the options in two places - the stage host and
 * the nested-surface host - and a capability wired in one of them is exactly as broken as one wired
 * in neither, for whichever surface got the other. The first draft used `includes`, passed with one
 * of the two sites deleted, and would have shipped that.
 */

import fs from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";

const HERE = path.resolve(__dirname);
const HOST_FILE = path.join(HERE, "GameAppHost.ts");
const APP_FILE = path.join(HERE, "GameApp.tsx");
const BRIDGE_FILE = path.resolve(HERE, "../../blueprint-runtime/BlueprintHostApiBridge.ts");
const REPO_SRC = path.resolve(HERE, "../../../../..");

/**
 * The shells that run a real game, and must therefore answer for every capability the nodes can
 * reach. The workspace's story preview is deliberately absent: it has no window and no filesystem,
 * omits capabilities on purpose, and the nodes report that honestly.
 */
const GAME_SHELL_FILES: Readonly<Record<string, string>> = {
    "Dev Mode": path.join(REPO_SRC, "renderer/apps/dev-mode/components/DevModeContent.tsx"),
    "packaged runtime": path.join(REPO_SRC, "runtime/renderer/GameRuntimeApp.tsx"),
};

/** The type whose fields are the bridge's inputs. Named, so a rename fails loudly here. */
const BRIDGE_OPTIONS_TYPE = "CreateBlueprintHostApiRuntimeOptions";

/**
 * Options the bridge takes that are plainly a host capability under another name, and are wired
 * from something other than `host.<name>`. Each needs a reason, because the default has to be
 * "forwarded from the host" for the check to mean anything - and each is checked for staleness
 * below, because an allowlist nobody validates is how an exemption outlives the thing it excused.
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

/** The body of a `export type X = { … }` declaration, by name. */
function typeBodyOf(source: string, typeName: string): string {
    const start = source.indexOf(`export type ${typeName} = {`);
    if (start < 0) {
        throw new Error(`${typeName} is not declared where this test expects it`);
    }
    let depth = 0;
    for (let index = source.indexOf("{", start); index < source.length; index += 1) {
        if (source[index] === "{") depth += 1;
        else if (source[index] === "}") {
            depth -= 1;
            if (depth === 0) return source.slice(start, index + 1);
        }
    }
    throw new Error(`${typeName} is not closed`);
}

function bridgeOptionSuffixes(bridgeSource: string): string[] {
    const body = typeBodyOf(bridgeSource, BRIDGE_OPTIONS_TYPE);
    return [...new Set([...body.matchAll(/^ {4}on([A-Z]\w+)\??:/gm)].map(match => match[1]!))];
}

function hostFieldsFrom(hostSource: string): Set<string> {
    return new Set([...typeBodyOf(hostSource, "GameAppHost").matchAll(/^ {4}(\w+)\??:/gm)]
        .map(match => match[1]!));
}

/** Bridge options that name a host capability, paired with the field they come from. */
function hostBackedOptions(bridgeSource: string, hostSource: string): Array<{ option: string; field: string }> {
    const hostFields = hostFieldsFrom(hostSource);
    return bridgeOptionSuffixes(bridgeSource)
        .map(suffix => ({ option: `on${suffix}`, field: suffix.charAt(0).toLowerCase() + suffix.slice(1) }))
        .filter(pair => hostFields.has(pair.field));
}

async function readAll(): Promise<{ hostSource: string; appSource: string; bridgeSource: string }> {
    const [hostSource, appSource, bridgeSource] = await Promise.all([
        fs.readFile(HOST_FILE, "utf-8"),
        fs.readFile(APP_FILE, "utf-8"),
        fs.readFile(BRIDGE_FILE, "utf-8"),
    ]);
    return { hostSource, appSource, bridgeSource };
}

describe("host capability forwarding", () => {
    it("hands every host capability the bridge accepts to every bridge it builds", async () => {
        const { hostSource, appSource, bridgeSource } = await readAll();

        // How many options blocks there are, counted from one capability that is certainly in all of
        // them. Every other host-backed option has to appear the same number of times.
        const blocks = occurrences(appSource, "onNetworkFetch: host.networkFetch");
        expect(blocks, "no bridge options block found in GameApp").toBeGreaterThan(0);

        const wrong = hostBackedOptions(bridgeSource, hostSource)
            .filter(pair => !FORWARDED_ELSEWHERE[pair.option])
            .map(pair => ({ ...pair, found: occurrences(appSource, `${pair.option}: host.${pair.field}`) }))
            .filter(pair => pair.found !== blocks)
            .map(pair => `${pair.option}: host.${pair.field} - forwarded ${pair.found}x, expected ${blocks}x`);
        expect(wrong, `GameApp does not hand these to every bridge it builds:\n${wrong.join("\n")}`).toEqual([]);
    });

    it("has both game shells implementing everything the nodes can reach", async () => {
        // The hop the first version of this test did not check. A capability can be declared,
        // forwarded, and still absent from a shell - and that shell's players are the only ones who
        // find out. The story preview is excluded above, on purpose.
        const { hostSource, bridgeSource } = await readAll();
        const forwarded = hostBackedOptions(bridgeSource, hostSource);
        expect(forwarded.length, "no host-backed bridge options found").toBeGreaterThan(3);

        const missing: string[] = [];
        for (const [shellName, file] of Object.entries(GAME_SHELL_FILES)) {
            const source = await fs.readFile(file, "utf-8");
            for (const { field } of forwarded) {
                // The shells build their host object as `const <field> = useCallback<…>` and then
                // name it in the object literal; either spelling counts as implementing it.
                if (!new RegExp(`\\b(const|function)\\s+${field}\\b`).test(source) && !source.includes(`${field}:`)) {
                    missing.push(`${shellName} has no ${field}`);
                }
            }
        }
        expect(missing, `these shells cannot do what the nodes will ask of them:\n${missing.join("\n")}`)
            .toEqual([]);
    });

    it("hands the options GameApp owns to every bridge it builds, and to the slot shell", async () => {
        // Options wired from `GameApp`'s own state rather than from a host field. The check above
        // cannot see them - it pairs `onFoo` with `host.foo` - and they break in exactly the same
        // silent way: a language picker in a settings page would restart the game while the same
        // picker in a quick menu changed the language under a running playthrough and left it
        // showing two.
        const { appSource } = await readAll();
        const shellSource = await fs.readFile(path.join(HERE, "StageSlotSurfaceShell.tsx"), "utf-8");
        const blocks = occurrences(appSource, "onNetworkFetch: host.networkFetch");

        expect(occurrences(appSource, "onLocaleChanged: handleLocaleChanged")).toBe(blocks);
        // The third bridge in the runtime, built per Game UI slot surface, wired from the option
        // `GameApp` passes it.
        expect(shellSource).toContain("onLocaleChanged: options.localeChangedInGame");
        expect(appSource).toContain("localeChangedInGame: handleLocaleChanged");
    });

    it("has both game shells able to restart themselves", async () => {
        // `restartApplication` is a host capability that no bridge option names - `GameApp` decides
        // when to reach for it - so the shell check above does not cover it. A shell that omits it
        // reports "this host cannot restart" for every language change made mid-playthrough.
        const { hostSource } = await readAll();
        expect(hostFieldsFrom(hostSource).has("restartApplication")).toBe(true);

        const missing: string[] = [];
        for (const [shellName, file] of Object.entries(GAME_SHELL_FILES)) {
            const source = await fs.readFile(file, "utf-8");
            if (!source.includes("const restartApplication") && !source.includes("restartApplication:")) {
                missing.push(`${shellName} cannot restart itself`);
            }
        }
        expect(missing, `these shells cannot restart: ${missing.join(", ")}`).toEqual([]);
    });

    it("keeps the wired-elsewhere allowlist honest", async () => {
        // An exemption that outlives the thing it excused is worse than no exemption: it silently
        // widens to whatever later takes the name.
        const { hostSource, bridgeSource } = await readAll();
        const known = new Set(hostBackedOptions(bridgeSource, hostSource).map(pair => pair.option));
        const stale = Object.keys(FORWARDED_ELSEWHERE).filter(option => !known.has(option));
        expect(stale, `these allowlist entries no longer name a host-backed bridge option:\n${stale.join("\n")}`)
            .toEqual([]);
    });

    it("is non-vacuous: it can see the capabilities that are wired", async () => {
        const { hostSource, bridgeSource } = await readAll();
        const options = hostBackedOptions(bridgeSource, hostSource).map(pair => pair.option);
        expect(options).toContain("onNetworkFetch");
        expect(options).toContain("onMovePointer");
        expect(options).toContain("onOpenExternal");
    });
});
