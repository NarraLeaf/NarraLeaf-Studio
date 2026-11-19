// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeamConnection } from "@shared/types/team";
import { Sidebar } from "./Sidebar";

/**
 * The Team account beside Settings: the workspace's face and card, drawn only while this machine
 * is signed in to a server, and following a sign-in or sign-out made after the launcher opened.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string) => key,
        has: () => false,
        tn: (key: string) => key,
        locale: "en",
    }),
}));

vi.mock("@/lib/app/useUpdateState", () => ({ useUpdateState: () => null }));
vi.mock("@/lib/renderApp", () => ({ getAppInfo: () => ({ version: "0.0.0" }) }));

const ORIGIN = "lore://team.example.lan:41337";

const state = vi.hoisted(() => ({
    servers: [] as unknown[],
    connectionListeners: [] as ((payload: { connection: unknown }) => void)[],
    /** Global state, written and broadcast the way the main process does. */
    global: {} as Record<string, unknown>,
    globalListeners: [] as ((change: { key: string; value: unknown }) => void)[],
}));

function ready(): TeamConnection {
    return {
        remoteOrigin: ORIGIN,
        state: "ready",
        capabilities: [],
        account: { id: "1", username: "lightdust", displayName: "Light Dust", operator: false },
        since: 1,
    };
}

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        app: {
            launchSettings: vi.fn(),
            state: {
                getGlobalState: (key: string) => Promise.resolve({ success: true, data: { value: state.global[key] } }),
                setGlobalState: (key: string, value: unknown) => {
                    state.global[key] = value;
                    for (const listener of [...state.globalListeners]) listener({ key, value });
                    return Promise.resolve({ success: true, data: undefined });
                },
                onGlobalStateChanged: (listener: (change: { key: string; value: unknown }) => void) => {
                    state.globalListeners.push(listener);
                    return { cancel: () => { state.globalListeners = state.globalListeners.filter(entry => entry !== listener); } };
                },
            },
        },
        vcs: {
            listServers: () => Promise.resolve({ success: true, data: { servers: state.servers } }),
        },
        team: {
            open: () => Promise.resolve({ success: true, data: ready() }),
            call: (_origin: string, method: string) => Promise.resolve(method === "account.profile.get"
                ? { success: true, data: { ok: true, value: { profile: { username: "lightdust", displayName: "Light Dust", bio: "Writes the night scenes" } } } }
                : { success: false }),
            avatar: () => Promise.resolve({ success: true, data: { dataUrl: null } }),
            onConnectionChanged: (listener: (payload: { connection: unknown }) => void) => {
                state.connectionListeners.push(listener);
                return { cancel: vi.fn() };
            },
        },
    }),
}));

function signedIn(): unknown {
    return {
        remoteOrigin: ORIGIN,
        signedInAt: 1,
        account: { userId: "1", username: "lightdust", displayName: "Light Dust" },
    };
}

const OTHER = "lore://other.example.lan:41337";

/** A second server, signed in to after the first. */
function signedInElsewhere(): unknown {
    return {
        remoteOrigin: OTHER,
        signedInAt: 2,
        account: { userId: "2", username: "moth", displayName: "Moth" },
    };
}

async function openCard(): Promise<HTMLElement> {
    const face = await waitFor(() => {
        const node = document.querySelector<HTMLElement>("[data-team-account]");
        expect(node).not.toBeNull();
        return node as HTMLElement;
    });
    fireEvent.click(face);
    return document.querySelector("[data-team-account-card]") as HTMLElement;
}

function pressed(card: HTMLElement): string | null {
    return card.querySelector("[data-team-account-choice][aria-pressed='true']")?.getAttribute("data-team-account-choice") ?? null;
}

afterEach(() => {
    cleanup();
    state.servers = [];
    state.connectionListeners = [];
    state.global = {};
    state.globalListeners = [];
});

describe("the Team account in the launcher", () => {
    it("is not drawn while this machine is signed in to no server", async () => {
        render(<Sidebar active="projects" onChange={vi.fn()} />);

        // Settings is there; the face beside it is not.
        await waitFor(() => expect(document.querySelector("[aria-label='launcher.nav.settings']")).not.toBeNull());
        await act(async () => { await Promise.resolve(); });
        expect(document.querySelector("[data-team-account]")).toBeNull();
    });

    it("shows the same card as the workspace, and its act opens the Servers tab", async () => {
        state.servers = [signedIn()];
        const onChange = vi.fn();
        render(<Sidebar active="projects" onChange={onChange} />);

        const face = await waitFor(() => {
            const node = document.querySelector<HTMLElement>("[data-team-account]");
            expect(node).not.toBeNull();
            return node as HTMLElement;
        });
        fireEvent.click(face);

        const card = document.querySelector("[data-team-account-card]") as HTMLElement;
        await waitFor(() => expect(card.textContent).toContain("Writes the night scenes"));
        expect(card.textContent).toContain("Light Dust");

        fireEvent.click(card.querySelector("[data-team-account-act='manage']") as HTMLElement);
        expect(onChange).toHaveBeenCalledWith("servers");
        expect(document.querySelector("[data-team-account-card]")).toBeNull();
    });

    it("appears once a sign-in made after the launcher opened changes a Team session", async () => {
        render(<Sidebar active="projects" onChange={vi.fn()} />);
        await waitFor(() => expect(state.connectionListeners.length).toBeGreaterThan(0));
        expect(document.querySelector("[data-team-account]")).toBeNull();

        state.servers = [signedIn()];
        act(() => {
            for (const listener of state.connectionListeners) listener({ connection: ready() });
        });

        await waitFor(() => expect(document.querySelector("[data-team-account]")).not.toBeNull());
    });

    it("lists no accounts to switch between while only one is held", async () => {
        state.servers = [signedIn()];
        render(<Sidebar active="projects" onChange={vi.fn()} onAddAccount={vi.fn()} />);

        const card = await openCard();
        expect(card.querySelector("[data-team-accounts]")).toBeNull();
        expect(card.querySelector("[data-team-account-act='add-account']")).not.toBeNull();
    });

    it("switches between held accounts, the latest sign-in shown until another is picked", async () => {
        state.servers = [signedIn(), signedInElsewhere()];
        render(<Sidebar active="projects" onChange={vi.fn()} />);

        let card = await openCard();
        await waitFor(() => expect(card.querySelectorAll("[data-team-account-choice]").length).toBe(2));
        expect(pressed(card)).toBe(OTHER);

        fireEvent.click(card.querySelector(`[data-team-account-choice='${ORIGIN}']`) as HTMLElement);
        // Picking closes the card, and the pick is kept where every window reads it.
        expect(document.querySelector("[data-team-account-card]")).toBeNull();
        expect(state.global["team.activeAccount"]).toMatchObject({ remoteOrigin: ORIGIN });

        card = await openCard();
        await waitFor(() => expect(pressed(card)).toBe(ORIGIN));
    });

    it("sends “add account” to wherever the launcher adds a server", async () => {
        state.servers = [signedIn()];
        const onAddAccount = vi.fn();
        render(<Sidebar active="projects" onChange={vi.fn()} onAddAccount={onAddAccount} />);

        const card = await openCard();
        fireEvent.click(card.querySelector("[data-team-account-act='add-account']") as HTMLElement);
        expect(onAddAccount).toHaveBeenCalledTimes(1);
        expect(document.querySelector("[data-team-account-card]")).toBeNull();
    });
});
