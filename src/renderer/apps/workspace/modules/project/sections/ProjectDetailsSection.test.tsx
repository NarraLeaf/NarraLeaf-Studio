// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectConfig, ProjectMetadata } from "@/lib/workspace/project/project";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { ProjectDetailsSection } from "./ProjectDetailsSection";

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
 * The detail fields commit on blur. An author who leaves a field, comes back and leaves it again
 * before the first write has answered made two edits, and the second is the one that has to stay.
 */
function mountDetails() {
    let disk = { name: "Demo", identifier: "demo", metadata: { version: "1.0" } } as unknown as ProjectConfig;
    const held: { patch: Partial<ProjectMetadata>; settle: (error?: string) => void }[] = [];
    const notify = vi.fn();
    const projectService = {
        updateProjectMetadata: (patch: Partial<ProjectMetadata>) => new Promise<ProjectConfig>((resolve, reject) => {
            held.push({
                patch,
                settle: error => {
                    if (error) {
                        reject(new Error(error));
                        return;
                    }
                    disk = { ...disk, metadata: { ...disk.metadata, ...patch } };
                    resolve(disk);
                },
            });
        }),
    } as unknown as ProjectService;

    function Panel() {
        const [config, setConfig] = useState(disk);
        return (
            <ProjectDetailsSection
                projectService={projectService}
                uiService={{ showNotification: notify } as unknown as UIService}
                config={config}
                onConfigChange={setConfig}
            />
        );
    }
    render(<Panel />);
    const field = screen.getByPlaceholderText("1.0.0") as HTMLInputElement;
    const type = (value: string) => {
        act(() => field.focus());
        fireEvent.change(field, { target: { value } });
        act(() => field.blur());
    };
    const settle = (index: number, error?: string) => act(async () => {
        held[index].settle(error);
        await Promise.resolve();
        await Promise.resolve();
    });
    return { field, type, settle, held, notify, disk: () => disk };
}

describe("ProjectDetailsSection", () => {
    it("sends a second edit of a field whose first edit is still being written, and keeps it", async () => {
        const details = mountDetails();

        details.type("1.1");
        details.type("1.2");

        // The second blur is a write of its own, not a no-op waiting behind the first.
        expect(details.held.map(write => write.patch)).toEqual([{ version: "1.1" }, { version: "1.2" }]);

        // The older write landing does not put its older text back into the field.
        await details.settle(0);
        expect(details.field.value).toBe("1.2");

        await details.settle(1);
        expect(details.field.value).toBe("1.2");
        expect(details.disk().metadata?.version).toBe("1.2");
    });

    it("drops an edit the author leaves with Escape instead of storing it", () => {
        const details = mountDetails();

        act(() => details.field.focus());
        fireEvent.change(details.field, { target: { value: "9.9" } });
        act(() => { fireEvent.keyDown(details.field, { key: "Escape" }); });

        expect(details.held).toHaveLength(0);
        expect(details.field.value).toBe("1.0");
    });

    it("drops an edit to the description the author leaves with Escape, too", () => {
        const details = mountDetails();
        const description = screen.getByPlaceholderText("project.details.descriptionPlaceholder") as HTMLTextAreaElement;

        // Real focus, so the blur Escape causes is a real one: `fireEvent.focus` leaves the element
        // unfocused, `blur()` then does nothing, and the test passes without testing anything.
        act(() => description.focus());
        fireEvent.change(description, { target: { value: "A different game" } });
        act(() => { fireEvent.keyDown(description, { key: "Escape" }); });

        expect(document.activeElement).not.toBe(description);
        expect(details.held).toHaveLength(0);
        expect(description.value).toBe("");
    });

    it("says so when the write fails, and shows what the manifest holds", async () => {
        const details = mountDetails();

        details.type("2.0");
        await details.settle(0, "disk full");

        expect(details.notify).toHaveBeenCalledWith("disk full", "error");
        expect(details.field.value).toBe("1.0");
    });
});
