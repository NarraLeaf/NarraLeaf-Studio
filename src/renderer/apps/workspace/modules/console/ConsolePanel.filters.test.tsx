// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsoleService } from "@/lib/workspace/services/core/ConsoleService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { ConsolePanel } from "./ConsolePanel";

const fixture = vi.hoisted(() => ({ context: null as WorkspaceContext | null }));
vi.mock("../../context", () => ({ useWorkspace: () => ({ context: fixture.context }) }));

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    fixture.context = null;
});

describe("console level filter", () => {
    it("restores an intentionally empty level selection", () => {
        vi.stubGlobal("ResizeObserver", class {
            observe() {}
            disconnect() {}
        });
        vi.stubGlobal("CSS", { escape: (value: string) => value });
        const service = new ConsoleService();
        service.append("build", { level: "info", message: "An existing build line" });
        const panelState = {
            getPanelState: () => ({ activeChannel: "build", visibleLevels: [] }),
            setPanelState: vi.fn(),
        };
        fixture.context = {
            services: { get: (id: Services) => {
                if (id === Services.Console) return service;
                if (id === Services.PanelState) return panelState;
                if (id === Services.UI) return { showNotification: vi.fn() };
                throw new Error(`Unexpected service ${id}`);
            } },
        } as unknown as WorkspaceContext;

        render(<ConsolePanel panelId="console" />);

        expect(screen.queryByText("An existing build line")).toBeNull();
        expect(panelState.setPanelState).toHaveBeenLastCalledWith("console", {
            activeChannel: "build", visibleLevels: [],
        });
    });
});
