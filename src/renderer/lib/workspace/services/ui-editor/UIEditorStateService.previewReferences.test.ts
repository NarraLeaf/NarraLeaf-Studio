import { describe, expect, it, vi } from "vitest";
import type { UIStageSlotId } from "@shared/types/ui-editor/document";
import { Services, type WorkspaceContext } from "../services";
import { UIEditorStateService } from "./UIEditorStateService";

const KEY = "uiEditor.preview.referenceSlots";

/**
 * A state service brought up against Studio settings held in `settings`, and nothing else.
 *
 * The document service is an empty object on purpose: the reference slots are view state, so any
 * path from them into the document would throw here rather than pass quietly.
 */
async function bootService(settings: Map<string, unknown>) {
    const settingsService = {
        getSync: (key: string) => settings.get(key),
        set: vi.fn(async (key: string, value: unknown) => {
            settings.set(key, value);
        }),
    };
    const store = {
        getSelection: () => ({ type: null, data: null }),
        getEvents: () => ({ on: () => () => undefined }),
    };
    const services: Record<string, unknown> = {
        [Services.UI]: { getStore: () => store },
        [Services.UIDocument]: {},
        [Services.GlobalSettings]: settingsService,
    };
    const ctx = { services: { get: (name: string) => services[name] } } as unknown as WorkspaceContext;
    const service = new (UIEditorStateService as unknown as new () => UIEditorStateService)();
    await (service as unknown as {
        init(ctx: WorkspaceContext, depend: () => Promise<void>): Promise<void>;
    }).init(ctx, async () => undefined);
    return { service, settingsService };
}

describe("UIEditorStateService Game UI reference slots", () => {
    it("starts with every reference off", async () => {
        const { service } = await bootService(new Map());
        expect(service.getPreviewReferenceSlotIds()).toEqual([]);
    });

    it("switches a slot on, says so once, and keeps it in Studio settings by slot id", async () => {
        const settings = new Map<string, unknown>();
        const { service, settingsService } = await bootService(settings);
        const heard: (readonly UIStageSlotId[])[] = [];
        service.on("previewReferenceSlotsChanged", slots => heard.push(slots));

        service.setPreviewReferenceSlotEnabled("onStage", true);
        service.setPreviewReferenceSlotEnabled("onStage", true);

        expect(service.getPreviewReferenceSlotIds()).toEqual(["onStage"]);
        expect(heard).toEqual([["onStage"]]);
        expect(settingsService.set).toHaveBeenCalledTimes(1);
        expect(settings.get(KEY)).toEqual(["onStage"]);
    });

    it("comes back on the next start as it was left", async () => {
        const settings = new Map<string, unknown>();
        const first = await bootService(settings);
        first.service.setPreviewReferenceSlotEnabled("notification", true);
        first.service.setPreviewReferenceSlotEnabled("onStage", true);
        first.service.setPreviewReferenceSlotEnabled("notification", false);

        const second = await bootService(settings);
        expect(second.service.getPreviewReferenceSlotIds()).toEqual(["onStage"]);
    });

    it("reads a damaged setting as every reference off", async () => {
        const { service } = await bootService(new Map<string, unknown>([[KEY, "onStage"]]));
        expect(service.getPreviewReferenceSlotIds()).toEqual([]);
    });
});
