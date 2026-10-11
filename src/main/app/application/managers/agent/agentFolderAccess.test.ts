import path from "path";
import { describe, expect, it, vi } from "vitest";
import {
    AGENT_FOLDER_DECLINE_QUIET_MS,
    AgentFolderAccess,
    agentFolderRefusal,
    deepestCommonFolder,
    planAgentFolderRequest,
    type AgentFolderAccessHost,
    type AgentFolderRules,
} from "./agentFolderAccess";

/**
 * Which folders an agent may be let read, and how the author is asked. The two properties that
 * matter most: Studio's own folders (the token lives there) and the broad ones are never put to the
 * author even under full access, and one author sees one dialog per folder however many calls ask.
 */

const POSIX: AgentFolderRules = {
    pathApi: path.posix,
    caseInsensitive: false,
    home: "/Users/me",
    studioDirs: ["/Users/me/Library/Application Support/NarraLeaf Studio", "/Applications/NarraLeaf Studio.app"],
};

const WINDOWS: AgentFolderRules = {
    pathApi: path.win32,
    caseInsensitive: true,
    home: "C:\\Users\\me",
    studioDirs: ["C:\\Users\\me\\AppData\\Roaming\\NarraLeaf Studio", "C:\\Program Files\\NarraLeaf Studio"],
};

describe("folders that are never asked about", () => {
    it("refuses roots, the home folder and whatever holds it", () => {
        expect(agentFolderRefusal("/", POSIX)).toBe("root");
        expect(agentFolderRefusal("/Users", POSIX)).toBe("root");
        expect(agentFolderRefusal("/Users/me", POSIX)).toBe("home");
        expect(agentFolderRefusal("/Users/me/", POSIX)).toBe("home");
        expect(agentFolderRefusal("C:\\", WINDOWS)).toBe("root");
        expect(agentFolderRefusal("c:\\users\\ME", WINDOWS)).toBe("home");
        expect(agentFolderRefusal("D:\\", WINDOWS)).toBe("root");
    });

    it("refuses Studio's own folders, what is inside them and what holds them", () => {
        expect(agentFolderRefusal("/Users/me/Library/Application Support/NarraLeaf Studio", POSIX)).toBe("studio");
        expect(agentFolderRefusal("/Users/me/Library/Application Support/NarraLeaf Studio/logs", POSIX)).toBe("studio");
        // Reading ~/Library reads the token too.
        expect(agentFolderRefusal("/Users/me/Library", POSIX)).toBe("studio");
        expect(agentFolderRefusal("/Applications", POSIX)).toBe("studio");
        expect(agentFolderRefusal("c:\\users\\me\\appdata", WINDOWS)).toBe("studio");
    });

    it("refuses a relative path and lets an ordinary folder through", () => {
        expect(agentFolderRefusal("art", POSIX)).toBe("relative");
        expect(agentFolderRefusal("/Users/me/Downloads/kit", POSIX)).toBeNull();
        expect(agentFolderRefusal("D:\\Assets", WINDOWS)).toBeNull();
    });
});

describe("planning one dialog", () => {
    it("asks for each distinct folder, once, and drops folders inside another", () => {
        const plan = planAgentFolderRequest([
            "/Users/me/kit/bg",
            "/Users/me/kit/bgm",
            "/Users/me/kit/bg",
            "/Users/me/kit/bg/night",
        ], POSIX);
        expect(plan).toEqual({ ask: ["/Users/me/kit/bg", "/Users/me/kit/bgm"], refused: [] });
    });

    it("sets refused folders apart with their reason", () => {
        const plan = planAgentFolderRequest(["/Users/me", "/Users/me/kit", "/Users/me/Library/Application Support/NarraLeaf Studio"], POSIX);
        expect(plan.ask).toEqual(["/Users/me/kit"]);
        expect(plan.refused).toEqual([
            { folder: "/Users/me", reason: "home" },
            { folder: "/Users/me/Library/Application Support/NarraLeaf Studio", reason: "studio" },
        ]);
    });

    it("merges into the deepest shared folder only to fit the cap", () => {
        const folders = ["a", "b", "c", "d", "e", "f"].map(name => `/Users/me/Downloads/kit/${name}`);
        const plan = planAgentFolderRequest(folders, POSIX, 5);
        expect(plan.ask).toEqual(["/Users/me/Downloads/kit"]);
        expect(plan.refused).toEqual([]);
        expect(deepestCommonFolder("/Users/me/Downloads/kit/a", "/Users/me/Downloads/kit/b/c", POSIX)).toBe("/Users/me/Downloads/kit");
    });

    it("never merges into a folder right below home or a root, and refuses what does not fit", () => {
        const folders = ["Downloads", "Desktop", "Music", "Movies", "Pictures", "Documents", "Public"].map(name => `/Users/me/${name}/x`);
        const plan = planAgentFolderRequest(folders, POSIX, 5);
        expect(plan.ask).toHaveLength(5);
        expect(plan.ask.every(folder => folder.endsWith("/x"))).toBe(true);
        expect(plan.refused).toEqual([
            { folder: "/Users/me/Documents/x", reason: "tooMany" },
            { folder: "/Users/me/Public/x", reason: "tooMany" },
        ]);
    });

    it("treats spellings of one Windows folder as one", () => {
        const plan = planAgentFolderRequest(["D:\\Art\\BG", "d:/art/bg", "D:\\Art\\BG\\night"], WINDOWS);
        expect(plan.ask).toEqual(["D:\\Art\\BG"]);
    });
});

type FakeWindow = { id: string; closed?: boolean };

function makeHost(overrides: Partial<AgentFolderAccessHost<FakeWindow>> = {}) {
    const allowed: string[] = [];
    const answers: ((value: boolean) => void)[] = [];
    let clock = 1_000_000;
    let full = false;
    const host = {
        rules: () => POSIX,
        allowedFolders: (window: FakeWindow) => [`/Users/me/games/${window.id}`, ...allowed],
        fullAccess: () => full,
        isClosed: (window: FakeWindow) => window.closed === true,
        ask: vi.fn((_window: FakeWindow, _folders: string[]) => new Promise<boolean>(resolve => answers.push(resolve))),
        remember: vi.fn(async (folders: string[]) => {
            allowed.push(...folders);
        }),
        grant: vi.fn(),
        now: () => clock,
        warn: vi.fn(),
        ...overrides,
    };
    return {
        host,
        allowed,
        answer: async (value: boolean) => {
            for (let tries = 0; tries < 20 && answers.length === 0; tries += 1) {
                await Promise.resolve();
            }
            answers.shift()?.(value);
        },
        advance: (ms: number) => {
            clock += ms;
        },
        setFullAccess: (value: boolean) => {
            full = value;
        },
    };
}

const WINDOW: FakeWindow = { id: "a" };
const PROMPT = { clientName: "Claude Code" };

describe("asking the author", () => {
    it("allows, remembers and grants", async () => {
        const { host, allowed, answer } = makeHost();
        const access = new AgentFolderAccess(host);
        const pending = access.request(WINDOW, ["/Users/me/kit/bg"], PROMPT, 10_000);
        await answer(true);
        const result = await pending;
        expect(result).toEqual({ granted: ["/Users/me/kit/bg"], denied: [], pending: [], refused: [] });
        expect(allowed).toEqual(["/Users/me/kit/bg"]);
        expect(host.grant).toHaveBeenCalledWith(WINDOW, ["/Users/me/kit/bg"]);
        expect(host.ask).toHaveBeenCalledWith(WINDOW, ["/Users/me/kit/bg"], PROMPT);
    });

    it("answers a denial, and does not ask again for a minute", async () => {
        const { host, allowed, answer, advance } = makeHost();
        const access = new AgentFolderAccess(host);
        const first = access.request(WINDOW, ["/Users/me/kit"], PROMPT, 10_000);
        await answer(false);
        expect(await first).toMatchObject({ granted: [], denied: ["/Users/me/kit"] });
        expect(allowed).toEqual([]);
        expect(host.grant).not.toHaveBeenCalled();

        expect(await access.request(WINDOW, ["/Users/me/kit"], PROMPT, 10_000)).toMatchObject({ denied: ["/Users/me/kit"] });
        expect(host.ask).toHaveBeenCalledTimes(1);

        advance(AGENT_FOLDER_DECLINE_QUIET_MS + 1);
        const again = access.request(WINDOW, ["/Users/me/kit"], PROMPT, 10_000);
        await answer(true);
        expect(await again).toMatchObject({ granted: ["/Users/me/kit"] });
        expect(host.ask).toHaveBeenCalledTimes(2);
    });

    it("grants folders already allowed without asking", async () => {
        const { host } = makeHost();
        const access = new AgentFolderAccess(host);
        const result = await access.request(WINDOW, ["/Users/me/games/a/assets"], PROMPT, 10_000);
        expect(result).toEqual({ granted: ["/Users/me/games/a"], denied: [], pending: [], refused: [] });
        expect(host.ask).not.toHaveBeenCalled();
    });

    it("refuses forbidden folders without a dialog", async () => {
        const { host } = makeHost();
        const result = await new AgentFolderAccess(host).request(WINDOW, ["/Users/me", "/"], PROMPT, 10_000);
        expect(result.refused).toEqual([{ folder: "/Users/me", reason: "home" }, { folder: "/", reason: "root" }]);
        expect(host.ask).not.toHaveBeenCalled();
    });

    it("shares one dialog between concurrent requests for the same folder, and shows one dialog at a time", async () => {
        const { host, answer } = makeHost();
        const access = new AgentFolderAccess(host);
        const other: FakeWindow = { id: "b" };
        const first = access.request(WINDOW, ["/Users/me/kit"], PROMPT, 10_000);
        const second = access.request(other, ["/Users/me/kit/bg"], PROMPT, 10_000);
        const third = access.request(WINDOW, ["/Users/me/voices"], PROMPT, 10_000);
        await Promise.resolve();
        await Promise.resolve();
        expect(host.ask).toHaveBeenCalledTimes(1);
        await answer(true);
        expect(await first).toMatchObject({ granted: ["/Users/me/kit"] });
        expect(await second).toMatchObject({ granted: ["/Users/me/kit/bg"] });
        // The second window is granted the folder too, though its own request asked nothing.
        expect(host.grant).toHaveBeenCalledWith(other, ["/Users/me/kit/bg"]);
        expect(host.ask).toHaveBeenCalledTimes(2);
        await answer(false);
        expect(await third).toMatchObject({ denied: ["/Users/me/voices"] });
    });

    it("answers pending when the author takes too long, and the later allow is remembered", async () => {
        const { host, allowed, answer } = makeHost();
        const access = new AgentFolderAccess(host);
        const result = await access.request(WINDOW, ["/Users/me/kit"], PROMPT, 5);
        expect(result).toEqual({ granted: [], denied: [], pending: ["/Users/me/kit"], refused: [] });
        await answer(true);
        await vi.waitFor(() => expect(allowed).toEqual(["/Users/me/kit"]));
        // The retry passes without a dialog.
        expect(await access.request(WINDOW, ["/Users/me/kit/bg"], PROMPT, 5)).toMatchObject({ granted: ["/Users/me/kit"] });
        expect(host.ask).toHaveBeenCalledTimes(1);
    });

    it("skips a queued dialog whose folders an earlier answer already allowed", async () => {
        const { host, answer } = makeHost();
        const access = new AgentFolderAccess(host);
        const parent = access.request(WINDOW, ["/Users/me/kit/bg"], PROMPT, 10_000);
        await Promise.resolve();
        const child = access.request(WINDOW, ["/Users/me/kit/bg/night"], PROMPT, 10_000);
        await answer(true);
        await parent;
        expect(await child).toMatchObject({ granted: ["/Users/me/kit/bg/night"] });
        expect(host.ask).toHaveBeenCalledTimes(1);
    });

    it("does not ask for a window that is gone", async () => {
        const { host } = makeHost();
        const result = await new AgentFolderAccess(host).request({ id: "x", closed: true }, ["/Users/me/kit"], PROMPT, 10_000);
        expect(result).toMatchObject({ denied: ["/Users/me/kit"] });
        expect(host.ask).not.toHaveBeenCalled();
    });

    it("under full access grants every folder but the forbidden ones, without a dialog", async () => {
        const { host, setFullAccess, allowed } = makeHost();
        setFullAccess(true);
        const result = await new AgentFolderAccess(host).request(
            WINDOW,
            ["/Volumes/Drive/art", "/Users/me/Desktop/x", "/Users/me/Desktop/x/y", "/Users/me/Library", "/"],
            PROMPT,
            10_000,
        );
        expect(result.granted).toEqual(["/Volumes/Drive/art", "/Users/me/Desktop/x"]);
        expect(result.refused).toEqual([{ folder: "/Users/me/Library", reason: "studio" }, { folder: "/", reason: "root" }]);
        expect(host.ask).not.toHaveBeenCalled();
        // Full access reads without adding to the author's list.
        expect(allowed).toEqual([]);
        expect(host.grant).toHaveBeenCalledWith(WINDOW, ["/Volumes/Drive/art", "/Users/me/Desktop/x"]);
    });
});
