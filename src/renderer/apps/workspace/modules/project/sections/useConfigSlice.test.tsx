// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { useMemo, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectConfig } from "@/lib/workspace/project/project";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { normalizeWindowConfiguration, type WindowConfiguration } from "@/lib/workspace/project/configuration";
import { useConfigSlice } from "./useConfigSlice";
import { ProjectWindowSection } from "./ProjectWindowSection";

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key, has: () => false }),
}));

vi.mock("@/apps/workspace/components/ui/freezeGuard", async importOriginal => {
    const actual = await importOriginal<typeof import("@/apps/workspace/components/ui/freezeGuard")>();
    return { ...actual, useFreezeGuard: () => actual.makeFreezeGuard(false, "frozen") };
});

afterEach(cleanup);

/**
 * A write the test answers by hand, in whatever order it likes.
 *
 * The project service lands writes in the order they were asked for, but the hook must not depend
 * on that to show the right thing: a panel config can also move for reasons of its own.
 */
type HeldWrite = {
    patch: Partial<WindowConfiguration>;
    resolve: () => void;
    reject: (message: string) => void;
};

function projectWith(window: Partial<WindowConfiguration>): ProjectConfig {
    return { name: "Demo", identifier: "demo", metadata: {}, app: { window } } as unknown as ProjectConfig;
}

/** The slice a section would hold, over a stand-in for the panel's config and the service's disk. */
function mountSlice() {
    let disk = projectWith({});
    const writes: HeldWrite[] = [];
    const notify = vi.fn();
    const uiService = { showNotification: notify } as unknown as UIService;
    const write = (patch: Partial<WindowConfiguration>) => new Promise<ProjectConfig>((resolve, reject) => {
        writes.push({
            patch,
            resolve: () => {
                disk = projectWith({ ...normalizeWindowConfiguration(disk.app?.window), ...patch });
                resolve(disk);
            },
            reject: message => reject(new Error(message)),
        });
    });

    const hook = renderHook(() => {
        const [config, setConfig] = useState(disk);
        const stored = useMemo(() => normalizeWindowConfiguration(config.app?.window), [config.app?.window]);
        return useConfigSlice<WindowConfiguration>({
            stored,
            write,
            onConfigChange: setConfig,
            uiService,
            normalize: normalizeWindowConfiguration,
        });
    });

    return {
        hook,
        writes,
        notify,
        value: () => hook.result.current.value,
        commit: (patch: Partial<WindowConfiguration>) => act(() => { void hook.result.current.commit(patch); }),
        settle: (write: HeldWrite, outcome: "resolve" | string = "resolve") => act(async () => {
            if (outcome === "resolve") {
                write.resolve();
            } else {
                write.reject(outcome);
            }
            await Promise.resolve();
        }),
    };
}

describe("useConfigSlice", () => {
    it("sends a second change while the first is on its way, and shows both at once", async () => {
        const slice = mountSlice();

        await slice.commit({ resizable: false });
        await slice.commit({ startFullscreen: true });

        // Neither waited for the other: this is the change that used to be refused.
        expect(slice.writes.map(write => write.patch)).toEqual([{ resizable: false }, { startFullscreen: true }]);
        expect(slice.value()).toMatchObject({ resizable: false, startFullscreen: true });

        await slice.settle(slice.writes[0]);
        expect(slice.value()).toMatchObject({ resizable: false, startFullscreen: true });
        await slice.settle(slice.writes[1]);
        expect(slice.value()).toMatchObject({ resizable: false, startFullscreen: true });
        expect(slice.notify).not.toHaveBeenCalled();
    });

    it("keeps the last value a field was given while an older write for it lands", async () => {
        const slice = mountSlice();

        await slice.commit({ resizable: false });
        await slice.commit({ resizable: true });
        await slice.commit({ resizable: false });

        await slice.settle(slice.writes[0]);
        expect(slice.value().resizable).toBe(false);
        // The middle write lands and moves the stored value to `true`; the field is still showing the
        // author's last choice, which has not answered yet.
        await slice.settle(slice.writes[1]);
        expect(slice.value().resizable).toBe(false);
        await slice.settle(slice.writes[2]);
        expect(slice.value().resizable).toBe(false);
    });

    it("says so when the latest write fails, and shows what the manifest holds", async () => {
        const slice = mountSlice();

        await slice.commit({ rememberGeometry: false });
        expect(slice.value().rememberGeometry).toBe(false);

        await slice.settle(slice.writes[0], "disk full");

        expect(slice.notify).toHaveBeenCalledWith("disk full", "error");
        expect(slice.value().rememberGeometry).toBe(true);
    });

    it("does not let an older write's failure take away a newer choice still on its way", async () => {
        const slice = mountSlice();

        await slice.commit({ startFullscreen: true });
        await slice.commit({ startFullscreen: false });
        await slice.commit({ startFullscreen: true });

        await slice.settle(slice.writes[0], "disk full");
        expect(slice.notify).toHaveBeenCalledTimes(1);
        expect(slice.value().startFullscreen).toBe(true);

        await slice.settle(slice.writes[1]);
        await slice.settle(slice.writes[2]);
        expect(slice.value().startFullscreen).toBe(true);
    });
});

describe("ProjectWindowSection", () => {
    function mountSection() {
        const calls: Partial<WindowConfiguration>[] = [];
        const held: (() => void)[] = [];
        let disk = projectWith({});
        const projectService = {
            updateWindowConfiguration: (patch: Partial<WindowConfiguration>) => {
                calls.push(patch);
                return new Promise<ProjectConfig>(resolve => held.push(() => {
                    disk = projectWith({ ...normalizeWindowConfiguration(disk.app?.window), ...patch });
                    resolve(disk);
                }));
            },
        } as unknown as ProjectService;

        function Panel() {
            const [config, setConfig] = useState(disk);
            return (
                <ProjectWindowSection
                    projectService={projectService}
                    uiService={null}
                    config={config}
                    onConfigChange={setConfig}
                />
            );
        }
        render(<Panel />);
        return { calls, held, disk: () => disk };
    }

    const switchFor = (label: string) => screen.getByRole("switch", { name: label });

    it("takes a click on every row while the first click is still being written, and greys none of them", async () => {
        const section = mountSection();
        const resizable = switchFor("project.window.resizableTitle");
        const remember = switchFor("project.window.rememberTitle");
        const fullscreen = switchFor("project.window.fullscreenTitle");

        fireEvent.click(resizable);
        // The first write is still on its way. Every switch has to still be a switch.
        for (const control of [resizable, remember, fullscreen]) {
            expect((control as HTMLButtonElement).disabled).toBe(false);
        }
        fireEvent.click(remember);
        fireEvent.click(resizable);

        expect(section.calls).toEqual([{ resizable: false }, { rememberGeometry: false }, { resizable: true }]);
        expect(resizable.getAttribute("aria-checked")).toBe("true");
        expect(remember.getAttribute("aria-checked")).toBe("false");

        await act(async () => {
            for (const release of section.held) {
                release();
                await Promise.resolve();
            }
        });

        expect(section.disk().app?.window).toMatchObject({ resizable: true, rememberGeometry: false });
        expect(resizable.getAttribute("aria-checked")).toBe("true");
        expect(remember.getAttribute("aria-checked")).toBe("false");
    });
});
