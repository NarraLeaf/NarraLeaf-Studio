// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode } from "@shared/types/os";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { LocalizationService } from "@/lib/workspace/services/localization/LocalizationService";
import { isComposingText } from "@/lib/utils/imeComposition";
import { InlineTargetEditor } from "./TranslationInline";

let frozen = false;
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/apps/workspace/components/ui/freezeGuard", async importOriginal => {
    const actual = await importOriginal<typeof import("@/apps/workspace/components/ui/freezeGuard")>();
    return { ...actual, useFreezeGuard: () => actual.makeFreezeGuard(frozen, "frozen") };
});

afterEach(() => { cleanup(); frozen = false; });

describe("inline translation while editing", () => {
    it("stops accepting input and tag placement when a freeze arrives", () => {
        const onTargetChange = vi.fn();
        const props = {
            unitId: "line",
            sourceRuns: [{ text: "source", marks: { bold: true } }],
            target: "translated",
            editing: true,
            caret: null,
            placeholder: "placeholder",
            ariaLabel: "translation",
            onEdit: vi.fn(),
            onStopEdit: vi.fn(),
            onTargetChange,
        };
        const view = render(<InlineTargetEditor {...props} />);
        const field = screen.getByRole("textbox", { name: "translation" });
        expect(field.getAttribute("contenteditable")).toBe("true");

        frozen = true;
        view.rerender(<InlineTargetEditor {...props} />);
        expect(field.getAttribute("contenteditable")).toBe("false");
        expect(screen.getByRole("button", { name: "workspace.localization.table.applyStyle" }).matches(":disabled")).toBe(true);
        fireEvent.input(field);
        expect(onTargetChange).not.toHaveBeenCalled();
    });

    it("keeps the working copy while an earlier value is echoed during typing", () => {
        const props = {
            unitId: "line",
            sourceRuns: [{ text: "source", marks: { bold: true } }],
            target: "old",
            editing: true,
            caret: null,
            placeholder: "placeholder",
            ariaLabel: "translation",
            onEdit: vi.fn(),
            onStopEdit: vi.fn(),
            onTargetChange: vi.fn(),
        };
        const view = render(<InlineTargetEditor {...props} />);
        const field = screen.getByRole("textbox", { name: "translation" });
        field.textContent = "working copy";
        fireEvent.input(field);
        view.rerender(<InlineTargetEditor {...props} target="earlier echo" />);
        expect(field.textContent).toBe("working copy");
    });

    it("releases the input method state when an editing row unmounts", () => {
        const view = render(<InlineTargetEditor
            unitId="line"
            sourceRuns={[{ text: "source", marks: { bold: true } }]}
            target=""
            editing
            caret={null}
            placeholder="placeholder"
            ariaLabel="translation"
            onEdit={() => {}}
            onStopEdit={() => {}}
            onTargetChange={() => {}}
        />);
        fireEvent.compositionStart(screen.getByRole("textbox", { name: "translation" }));
        expect(isComposingText()).toBe(true);
        view.unmount();
        expect(isComposingText()).toBe(false);
    });

    it("saves an inline edit through the localization service and reopens it", async () => {
        const files = new Map<string, string>();
        const services: Record<string, unknown> = {
            [Services.FileSystem]: {
                read: async (path: string) => files.has(path)
                    ? { ok: true, data: files.get(path) }
                    : { ok: false, error: { code: FsRejectErrorCode.NOT_FOUND, message: "missing" } },
                writeFileNoFollowOrCreate: async (path: string, content: string) => {
                    files.set(path, content);
                    return { ok: true };
                },
                createDir: async () => ({ ok: true }),
                copyFile: async () => ({ ok: true }),
            },
            [Services.Project]: {
                getLocalizationConfiguration: () => ({ sourceLocale: "en", locales: [{ code: "ja", name: "Japanese" }] }),
            },
            [Services.SaveStatus]: { register: () => undefined, reportUnreadableDocument: vi.fn() },
        };
        const ctx = {
            project: { getConfig: () => ({ projectPath: "/project" }) },
            services: { get: (id: string) => services[id] },
        } as unknown as WorkspaceContext;
        const service = new LocalizationService();
        await service.initialize(ctx, async () => undefined);
        await service.loadDocument("ja");
        const props = {
            unitId: "line",
            sourceRuns: [{ text: "source", marks: { bold: true } }],
            target: "",
            editing: true,
            caret: null,
            placeholder: "placeholder",
            ariaLabel: "translation",
            onEdit: vi.fn(),
            onStopEdit: vi.fn(),
            onTargetChange: (target: string) => service.updateUnit("ja", "line", "source", { target }),
        };
        const view = render(<InlineTargetEditor {...props} />);
        const field = screen.getByRole("textbox", { name: "translation" });
        field.textContent = "訳文";
        fireEvent.input(field);
        await act(async () => { await service.flushPendingChanges(); });
        frozen = true;
        view.rerender(<InlineTargetEditor {...props} target="訳文" />);
        expect(field.getAttribute("contenteditable")).toBe("false");
        view.unmount();
        await service.teardown(ctx);

        const reopened = new LocalizationService();
        await reopened.initialize(ctx, async () => undefined);
        expect((await reopened.loadDocument("ja")).units.line.target).toBe("訳文");
        await reopened.teardown(ctx);
    });
});
