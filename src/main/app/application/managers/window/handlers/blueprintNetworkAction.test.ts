import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { executeBlueprintNetworkFetch } = vi.hoisted(() => ({
    // The options are declared rather than inferred so a test can read back *which* project's
    // settings reached the performer - the point of the guard, not just that it was reached.
    executeBlueprintNetworkFetch: vi.fn(async (_request: unknown, _options: unknown) => ({
        outcome: "ok",
        status: 200,
        body: null,
    })),
}));

// The request itself is not the subject here - which project's permissions govern it is - so the
// performer is a double. It also has to be one: the real thing goes to the network, and a test that
// did would be measuring a host rather than this handler.
vi.mock("@shared/utils/blueprintNetworkFetch", () => ({ executeBlueprintNetworkFetch }));

// Enough of Electron for `devModeNetworkPolicy` to load. Its session hooks are installed lazily and
// nothing here installs them; the reader this file is about touches no Electron at all.
vi.mock("electron", () => ({ session: { defaultSession: undefined }, net: { request: vi.fn() } }));

const { NETWORK_POLICY_ALLOWLIST, NETWORK_POLICY_ANY } = await import("@shared/types/networkAllowlist");
const { WINDOW_PROJECT_MISMATCH_CODE } = await import("@shared/types/window");
const { encodeProjectConfig } = await import("@shared/utils/nlproj");
const { BlueprintNetworkFetchHandler } = await import("./blueprintNetworkAction");

type AppWindowLike = Parameters<InstanceType<typeof BlueprintNetworkFetchHandler>["handle"]>[0];
type FetchData = Parameters<InstanceType<typeof BlueprintNetworkFetchHandler>["handle"]>[1];

let root = "";
/** The project the window has open: on the network, but only where its author said. */
let mine = "";
/** A project next to it whose author left the network wide open. */
let theirs = "";

/**
 * A project on disk, as the reader under test finds one: a directory with a `.nlproj` in it.
 *
 * Written rather than stubbed because the whole point of this channel is that the setting is read
 * off disk instead of taken from the caller - a stubbed reader would agree with whatever path it
 * was handed and could not tell the two projects apart.
 */
async function writeProject(name: string, network: unknown): Promise<string> {
    const dir = path.join(root, name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
        path.join(dir, `${name}.nlproj`),
        encodeProjectConfig({ app: { network } } as never),
    );
    return dir;
}

/** A window carrying the props the main process wrote when it opened a project. */
function windowWith(props: unknown): AppWindowLike {
    return { getProps: () => props } as unknown as AppWindowLike;
}

function fetchOf(projectPath: string): FetchData {
    return { projectPath, request: { url: "https://mine.test/thing" } } as unknown as FetchData;
}

/** The options the performer was handed, which say whose settings were read. */
function governedBy() {
    return executeBlueprintNetworkFetch.mock.calls[0]?.[1] as unknown as {
        allowHttp: boolean;
        allowlist: { policy: string; entries: readonly string[] };
    } | undefined;
}

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-network-guard-"));
    mine = await writeProject("mine", {
        allowHttp: true,
        policy: NETWORK_POLICY_ALLOWLIST,
        allowlist: ["https://mine.test"],
    });
    theirs = await writeProject("theirs", { allowHttp: true, policy: NETWORK_POLICY_ANY });
    executeBlueprintNetworkFetch.mockClear();
});

afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
});

/**
 * Whose network settings apply to a Fetch node.
 *
 * The handler reads them off the project's own `.nlproj` rather than trusting a flag from the
 * renderer, which is what makes it a way of honouring the setting. That only holds while the
 * project is the caller's own: a renderer free to name the project is a renderer free to choose
 * which settings file it will be judged by, and the main process is outside the CSP and
 * `webRequest` cage the renderer is confined to, so what it reaches is bounded by nothing else.
 */
describe("BlueprintNetworkFetchHandler", () => {
    const handler = new BlueprintNetworkFetchHandler();

    /**
     * The hole, stated as the thing it prevents.
     *
     * `theirs` is a real project with a real settings file saying "any host". Without the check the
     * reader is pointed at it and the request goes out under its permissions - from a window whose
     * own project allows one host.
     */
    it("refuses a project this window does not have open", async () => {
        const result = await handler.handle(windowWith({ projectPath: mine }), fetchOf(theirs));

        expect(result.success).toBe(false);
        expect(executeBlueprintNetworkFetch).not.toHaveBeenCalled();
    });

    /**
     * Identifiable rather than merely refused. Every other answer this channel gives is a success
     * envelope carrying a network result, so a caller has nothing to compare an English sentence
     * against; the code is what a log or a diagnostic can recognise.
     */
    it("names the refusal with a code", async () => {
        const result = await handler.handle(windowWith({ projectPath: mine }), fetchOf(theirs));

        expect(result.code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
    });

    /**
     * A window with no project of its own - the launcher, settings, the wizard - has nothing for a
     * payload to agree with, and every window in the app carries this handler.
     */
    it("refuses a window that has no project open", async () => {
        const result = await handler.handle(windowWith({ onboarding: true }), fetchOf(mine));

        expect(result.success).toBe(false);
        expect(executeBlueprintNetworkFetch).not.toHaveBeenCalled();
    });

    /**
     * The ordinary case, asserted through to the settings rather than at the envelope: a handler
     * that answered success while reading the wrong project's list would pass a weaker test.
     */
    it("performs the request under the window's own project's settings", async () => {
        const result = await handler.handle(windowWith({ projectPath: mine }), fetchOf(mine));

        expect(result.success).toBe(true);
        expect(governedBy()).toMatchObject({
            allowHttp: true,
            allowlist: { policy: NETWORK_POLICY_ALLOWLIST, entries: ["https://mine.test/*"] },
        });
    });

    /**
     * The first of the two failure modes that matter more than the hole: a guard that refuses the
     * author's own project.
     *
     * A trailing separator is the same project, and `path.normalize` - the comparison this file's
     * neighbour used to carry - keeps it, so a guard written that way would refuse this on every
     * platform. Resolving both sides before comparing is what makes it one question.
     */
    it("accepts the window's own project with a trailing separator", async () => {
        const result = await handler.handle(
            windowWith({ projectPath: mine }),
            fetchOf(mine + path.sep),
        );

        expect(result.success).toBe(true);
        expect(governedBy()).toMatchObject({ allowlist: { policy: NETWORK_POLICY_ALLOWLIST } });
    });

    /**
     * The second, and the one only the shared identity rule answers. On Windows `D:\Game` and
     * `d:/game` are one directory: a picker writes `\`, a scripted or typed path usually carries
     * `/`, and the case is whatever it was typed as. A guard that folded neither would tell an
     * author their preview may not reach the host their own project lists.
     */
    it.runIf(process.platform === "win32")("accepts the window's own project under another spelling", async () => {
        const result = await handler.handle(
            windowWith({ projectPath: mine }),
            fetchOf(mine.replace(/\\/g, "/").toLowerCase()),
        );

        expect(result.success).toBe(true);
        expect(governedBy()).toMatchObject({ allowlist: { policy: NETWORK_POLICY_ALLOWLIST } });
    });

    /**
     * A payload is whatever the renderer sent, whatever the type says. Reported as this guard's own
     * refusal rather than as Node's `ERR_INVALID_ARG_TYPE` from `path.resolve`.
     */
    it("refuses a payload that is not a path at all", async () => {
        const result = await handler.handle(
            windowWith({ projectPath: mine }),
            fetchOf(undefined as unknown as string),
        );

        expect(result.code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
        expect(executeBlueprintNetworkFetch).not.toHaveBeenCalled();
    });
});
