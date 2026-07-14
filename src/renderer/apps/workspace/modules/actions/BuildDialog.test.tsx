// @vitest-environment jsdom
import { render, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuildDialogContent, collectSelection, initialSelection, type BuildDialogSelection } from "./BuildDialog";
import type { GameBuildFormat, GameBuildPlatform } from "@shared/types/gameBuild";
import type { BuildConfiguration } from "@/lib/workspace/project/configuration";

afterEach(cleanup);

const INFO = (host: GameBuildPlatform) => ({
    hostPlatform: host,
    version: "1.0.0",
    encryptAssets: false,
    unsigned: true,
    defaultOutputDir: "/project/dist",
});

describe("BuildDialogContent", () => {
    it("enables the host platform by default and leaves others off", () => {
        const { getAllByRole } = render(
            <BuildDialogContent info={INFO("macos")} config={null} onChange={vi.fn()} />,
        );
        const switches = getAllByRole("switch"); // order: windows, macos, linux
        expect(switches[0].getAttribute("aria-checked")).toBe("false"); // windows
        expect(switches[1].getAttribute("aria-checked")).toBe("true"); // macos (host)
        expect(switches[2].getAttribute("aria-checked")).toBe("false"); // linux
    });

    it("disables platforms the host cannot build", () => {
        const { getAllByRole } = render(
            <BuildDialogContent info={INFO("windows")} config={null} onChange={vi.fn()} />,
        );
        const switches = getAllByRole("switch");
        expect(switches[0].hasAttribute("disabled")).toBe(false); // windows
        expect(switches[1].hasAttribute("disabled")).toBe(true); // macos
        expect(switches[2].hasAttribute("disabled")).toBe(true); // linux
    });

    it("reports the selected target when an off platform is switched on", () => {
        const onChange = vi.fn<(selection: BuildDialogSelection) => void>();
        const { getAllByRole } = render(
            <BuildDialogContent info={INFO("macos")} config={null} onChange={onChange} />,
        );
        // windows (index 0) starts off on a macOS host; switch it on.
        fireEvent.click(getAllByRole("switch")[0]);
        const last = onChange.mock.calls.at(-1)?.[0];
        expect(last?.targets.some(t => t.platform === "windows")).toBe(true);
        expect(last?.targets.some(t => t.platform === "macos")).toBe(true);
    });
});

describe("collectSelection", () => {
    it("drops platforms with no formats and defaults the output dir", () => {
        const state = {
            windows: new Set<GameBuildFormat>(["zip"]),
            macos: new Set<GameBuildFormat>(),
            linux: new Set<GameBuildFormat>(),
        } as Record<GameBuildPlatform, Set<GameBuildFormat>>;
        const selection = collectSelection(state, "  ");
        expect(selection.targets).toEqual([{ platform: "windows", formats: ["zip"] }]);
        expect(selection.outputDir).toBe("");
    });
});

describe("initialSelection", () => {
    it("never seeds a target the host cannot build, even if remembered", () => {
        // Project last built on macOS, reopened on a Windows host.
        const stored: BuildConfiguration = {
            platforms: ["macos", "windows"],
            formats: { macos: ["dmg"], windows: ["nsis"] },
            outputDir: "",
        };
        const selection = initialSelection(stored, "windows");
        expect(selection.targets.some(t => t.platform === "macos")).toBe(false);
        expect(selection.targets.some(t => t.platform === "windows")).toBe(true);
    });

    it("committed seed matches the displayed default (host platform on)", () => {
        const selection = initialSelection(null, "macos");
        expect(selection.targets.map(t => t.platform)).toEqual(["macos"]);
    });
});
