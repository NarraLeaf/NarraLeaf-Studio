// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VcsServerDiscovery, VcsServerSession } from "@shared/types/vcs";
import { AddServerModal } from "./AddServerModal";

/**
 * Adding a server, from an address to a sentence about what was joined.
 *
 * Two things regress here, and each of them reads as reasonable while it is written.
 * A closing step that fills in "0 projects" for a server that would not answer the
 * question. And a step that stores something before the last one succeeded, which is
 * what makes leaving halfway a thing an author has to undo.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
            params ? `${key}(${Object.values(params).join("|")})` : key,
        has: () => false,
        tn: (key: string, count: number) => `${key}(${count})`,
        locale: "en",
    }),
}));

const bridge = vi.hoisted(() => ({
    probeServer: vi.fn(),
    addServer: vi.fn(),
    listServerProjects: vi.fn(),
    promptServerTrust: vi.fn(),
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        vcs: {
            probeServer: bridge.probeServer,
            addServer: bridge.addServer,
            listServerProjects: bridge.listServerProjects,
        },
        app: { promptServerTrust: bridge.promptServerTrust },
    }),
}));

const ADDRESS = "nlteam://team.example.lan:41402";
const AUTH = "https://team.example.lan:41402";
const ORIGIN = "lore://team.example.lan:41337";
/** What a server answers with, measured. */
const CAPABILITIES = ["projects", "project-detail", "members", "project-history"];

function discovery(capabilities: string[]): VcsServerDiscovery {
    return {
        protocol: 1,
        name: "Blackwood Studio",
        auth: { required: true, url: AUTH },
        data: { url: ORIGIN },
        authority: { sha256: "AB:CD" },
        version: "0.7.0",
        capabilities,
    };
}

function session(name?: string): VcsServerSession {
    return {
        authUrl: AUTH,
        remoteOrigin: ORIGIN,
        account: {
            userId: "u-1",
            displayName: "Ada Blackwood",
            username: "ada",
            email: "ada@example.com",
            identity: "Ada Blackwood <ada@example.com>",
            expiresAt: 0,
        },
        signedInAt: 0,
        ...(name === undefined ? {} : { name }),
    };
}

const onClose = vi.fn();
const onAdded = vi.fn();

afterEach(() => {
    cleanup();
    bridge.probeServer.mockReset();
    bridge.addServer.mockReset();
    bridge.listServerProjects.mockReset();
    bridge.promptServerTrust.mockReset();
    onClose.mockClear();
    onAdded.mockClear();
});

function seam(name: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-servers-seam='${name}']`);
}

/** Wait for one seam and hand it back. `querySelector` alone answers null without throwing. */
function find(name: string): Promise<HTMLElement> {
    return waitFor(() => {
        const node = seam(name);
        if (node === null) throw new Error(`nothing matched ${name}`);
        return node;
    });
}

function type(name: string, value: string): void {
    fireEvent.change(seam(name)!, { target: { value } });
}

function submit(): void {
    fireEvent.click(seam("submit")!);
}

/** Open the dialog and carry it as far as the identity step. */
async function reachIdentity(capabilities: string[] = CAPABILITIES) {
    bridge.probeServer.mockResolvedValue({
        success: true,
        data: { kind: "ready", address: ADDRESS, discovery: discovery(capabilities) },
    });
    render(<AddServerModal onClose={onClose} onAdded={onAdded} />);
    type("field-address", ADDRESS);
    submit();
    await find("wizard-step-2");
}

describe("storing the server", () => {
    it("presents a pasted token, with what the server already said about itself", async () => {
        bridge.addServer.mockResolvedValue({ success: true, data: { ok: true, session: session("Blackwood Studio"), servers: [] } });
        bridge.listServerProjects.mockResolvedValue({ success: true, data: { ok: true, projects: [] } });
        await reachIdentity();

        type("field-token", "  pasted-token  ");
        submit();

        await waitFor(() => expect(bridge.addServer).toHaveBeenCalledWith(AUTH, ORIGIN, "pasted-token", {
            name: "Blackwood Studio",
            version: "0.7.0",
            capabilities: CAPABILITIES,
        }));
        // Reaching the address a second time for a name it just gave would be a second
        // answer to a question put a moment ago.
        expect(bridge.probeServer).toHaveBeenCalledTimes(1);
    });

    it("puts a refused token in words and stays where it is", async () => {
        bridge.addServer.mockResolvedValue({ success: true, data: { ok: false, problem: { kind: "refused", detail: "" } } });
        await reachIdentity();

        type("field-token", "expired");
        submit();

        const problem = await find("problem");
        expect(problem.textContent).toBe("settings.servers.problems.refused");
        expect(seam("wizard-joined")).toBeNull();
        expect(onAdded).not.toHaveBeenCalled();
    });
});

describe("the closing step", () => {
    async function join(projects: unknown, name = "Blackwood Studio") {
        bridge.addServer.mockResolvedValue({ success: true, data: { ok: true, session: session(name), servers: [] } });
        bridge.listServerProjects.mockResolvedValue(projects);
        await reachIdentity();
        type("field-token", "token");
        submit();
        return find("wizard-joined");
    }

    it("says what was joined, as whom, and how much is on it", async () => {
        const joined = await join({
            success: true,
            data: { ok: true, projects: [{ id: "a" }, { id: "b" }, { id: "c" }] },
        });

        expect(joined.textContent).toContain("Blackwood Studio");
        // The address every other surface shows, from the origin that is the identity key.
        expect(joined.textContent).toContain("team.example.lan:41337");
        expect(joined.textContent).toContain("settings.servers.joined.signedInAs(Ada Blackwood)");
        await waitFor(() => expect(seam("joined-projects")!.textContent)
            .toBe("settings.servers.joined.projects(3)"));
        expect(onAdded).toHaveBeenCalledTimes(1);
    });

    it("draws no count line at all when the server would not say", async () => {
        const joined = await join({ success: true, data: { ok: false, problem: { kind: "no-token" } } });

        expect(joined.textContent).toContain("Blackwood Studio");
        expect(joined.textContent).toContain("settings.servers.joined.signedInAs(Ada Blackwood)");
        // A refusal is nothing to say. Not a zero, not a red sentence on a step that
        // succeeded, and not a wait before the rest of it is drawn.
        expect(seam("joined-projects")).toBeNull();
        expect(seam("problem")).toBeNull();
        expect(joined.textContent).not.toContain("settings.servers.joined.projects");
        expect(joined.textContent).not.toContain("0");
    });

    it("draws no count line when the call itself failed", async () => {
        const joined = await join({ success: false });

        expect(seam("joined-projects")).toBeNull();
        expect(joined.textContent).not.toContain("0");
    });

    it("says zero only where a server actually answered none", async () => {
        await join({ success: true, data: { ok: true, projects: [] } });

        await waitFor(() => expect(seam("joined-projects")!.textContent)
            .toBe("settings.servers.joined.projects(0)"));
    });

    it("does not print a nameless server's address twice", async () => {
        // A session stored before Studio kept the name reads as its address, and that
        // address is not repeated beneath itself.
        const joined = await join({ success: true, data: { ok: true, projects: [] } }, undefined);

        expect(joined.textContent!.match(/team\.example\.lan:41337/g)).toHaveLength(1);
    });
});

describe("a server that wants nobody's name", () => {
    it("ends there, with nothing to store", async () => {
        bridge.probeServer.mockResolvedValue({
            success: true,
            data: {
                kind: "ready",
                address: ADDRESS,
                discovery: { ...discovery(CAPABILITIES), auth: { required: false, url: AUTH } },
            },
        });
        render(<AddServerModal onClose={onClose} onAdded={onAdded} />);

        type("field-address", ADDRESS);
        submit();

        const done = await find("wizard-done");
        expect(done.textContent).toContain("settings.servers.noAccount(Blackwood Studio)");
        expect(bridge.addServer).not.toHaveBeenCalled();
    });
});

describe("reaching an address", () => {
    it("asks about an untrusted authority once, and takes a second refusal as the answer", async () => {
        bridge.probeServer.mockResolvedValue({
            success: true,
            data: {
                kind: "untrusted",
                address: ADDRESS,
                authority: { fingerprint: "AB", expected: "", subject: "CN=Team", expiresAt: "", path: "", canInstall: false, command: "" },
                discovery: null,
            },
        });
        bridge.promptServerTrust.mockResolvedValue({ success: true, data: { trusted: true } });
        render(<AddServerModal onClose={onClose} onAdded={onAdded} />);

        type("field-address", ADDRESS);
        submit();

        const problem = await find("problem");
        expect(problem.textContent).toBe("settings.servers.probe.untrusted");
        expect(bridge.promptServerTrust).toHaveBeenCalledTimes(1);
        expect(bridge.addServer).not.toHaveBeenCalled();
    });

    it("says nothing answered, and keeps what was typed", async () => {
        bridge.probeServer.mockResolvedValue({ success: true, data: { kind: "unreachable", detail: "" } });
        render(<AddServerModal onClose={onClose} onAdded={onAdded} />);

        type("field-address", ADDRESS);
        submit();

        const problem = await find("problem");
        expect(problem.textContent).toBe("settings.servers.probe.unreachable");
        // An address that did not answer is usually one character away from one that does.
        expect((seam("field-address") as HTMLInputElement).value).toBe(ADDRESS);
    });
});

describe("leaving", () => {
    it("stores nothing from the address step", async () => {
        render(<AddServerModal onClose={onClose} onAdded={onAdded} />);

        type("field-address", ADDRESS);
        fireEvent.click(seam("cancel")!);

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(bridge.probeServer).not.toHaveBeenCalled();
        expect(bridge.addServer).not.toHaveBeenCalled();
        expect(onAdded).not.toHaveBeenCalled();
    });

    it("stores nothing from the identity step", async () => {
        await reachIdentity();

        type("field-token", "a-token");
        fireEvent.click(seam("cancel")!);

        expect(bridge.addServer).not.toHaveBeenCalled();
        expect(onAdded).not.toHaveBeenCalled();
    });

    it("stores nothing from a server that wanted nobody's name", async () => {
        bridge.probeServer.mockResolvedValue({
            success: true,
            data: {
                kind: "ready",
                address: ADDRESS,
                discovery: { ...discovery(CAPABILITIES), auth: { required: false, url: AUTH } },
            },
        });
        render(<AddServerModal onClose={onClose} onAdded={onAdded} />);

        type("field-address", ADDRESS);
        submit();
        await find("wizard-done");
        submit();

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(bridge.addServer).not.toHaveBeenCalled();
    });
});
