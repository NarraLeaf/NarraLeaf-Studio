import { describe, expect, it, vi } from "vitest";
import { createTranslator } from "@shared/i18n";
import { FsRejectErrorCode, type FsRejectError, type FsRequestResult } from "@shared/types/os";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { FsWriteOutcome } from "@/lib/workspace/services/core/FileSystem";
import type { FsWriteReport } from "@/lib/workspace/services/autosave/writeReport";
import { SaveStatusService } from "@/lib/workspace/services/autosave/SaveStatusService";
import { GroupAssetsManager } from "@/lib/workspace/services/assets/mgr/GroupAssetsManager";
import { AssetCategory } from "@/lib/workspace/services/assets/assetTypes";
import { ASSET_LIBRARY_WRITE_REPORTED } from "@/lib/workspace/services/assets/assetLibraryWrite";
import { describeFolderEditFailure, isReportedLibraryWrite } from "./assetActionFailure";

/**
 * A folder edit whose file could not be written: what stays in the library, and how many notices the
 * author is shown for it.
 *
 * The library is `GroupAssetsManager` against a filesystem stub that refuses the folder list, and the
 * save-status surface is the real `SaveStatusService`, fed every write outcome the way
 * `FileSystemService.observeWrites` feeds it. The action's own notice is what `useAssetActions` puts up
 * from the answer (`describeFolderEditFailure`). Counting both is the only way to see "one failure, one
 * notice" - each surface on its own was always right about itself.
 */

const GROUPS_IMAGE = "assets.groups.image.json";
const ORDER_IMAGE = "assets.order.image.json";

/** What Node says about a read-only file: English, and naming the scratch file an atomic write renames. */
const READ_ONLY: FsRejectError = {
    code: FsRejectErrorCode.PERMISSION_DENIED,
    message: "EPERM: operation not permitted, open 'D:\\Temp\\proj\\assets\\assets.groups.image.json.tmp-81f2'",
};

type Write = { path: string; data: string; report?: FsWriteReport };

async function createHarness() {
    const writes: Write[] = [];
    const refused = new Set<string>();
    let observer: ((outcome: FsWriteOutcome) => void) | null = null;
    const showSticky = vi.fn((_notice: { message: string; detail?: string }) => `toast-${showSticky.mock.calls.length}`);

    const filesystem = {
        observeWrites: (handler: (outcome: FsWriteOutcome) => void) => {
            observer = handler;
            return () => { observer = null; };
        },
        async readJSON() {
            return { ok: true as const, data: {} };
        },
        async isFileExists() {
            return { ok: true as const, data: true };
        },
        async writeFileNoFollowOrCreate(path: string, data: string, _encoding: string, report?: FsWriteReport) {
            const refuse = [...refused].some(suffix => path.endsWith(suffix));
            if (!refuse) {
                writes.push({ path, data, report });
            }
            const result: FsRequestResult<void> = refuse
                ? { ok: false, error: READ_ONLY }
                : { ok: true, data: undefined };
            observer?.({ path, ok: result.ok, error: result.ok ? undefined : result.error, report });
            return result;
        },
    };

    const stubs: Record<string, unknown> = {
        [Services.FileSystem]: filesystem,
        [Services.UI]: { notifications: { showSticky, close: vi.fn() } },
        [Services.Console]: { log: vi.fn() },
    };
    const context = {
        project: { resolve: (segments: string[]) => `D:/Temp/proj/${segments.join("/")}` },
        services: {
            get: (id: string) => {
                const stub = stubs[id];
                if (!stub) {
                    throw new Error(`Service ${id} not found`);
                }
                return stub;
            },
        },
    } as unknown as WorkspaceContext;

    const saveStatus = new SaveStatusService();
    saveStatus.setContext(context);
    await saveStatus.initialize(context, async () => undefined);

    // The order file is written by the library service once a folder edit is held; the stub writes
    // it the same way, through the same observed route.
    let groups: GroupAssetsManager;
    const assetsService = {
        markOrderDirty: (category: AssetCategory) => {
            void filesystem.writeFileNoFollowOrCreate(
                `D:/Temp/proj/assets/assets.order.${category}.json`,
                JSON.stringify(groups.listOrderedGroups(category)),
                "utf-8",
            );
        },
        markDirty: vi.fn(),
        getEvents: () => ({ emit: vi.fn() }),
        getAssetOrderManager: () => ({ getGroupIds: () => [] }),
    };
    groups = await new GroupAssetsManager(assetsService as never, context).init();
    writes.length = 0;

    return { groups, writes, refused, showSticky, saveStatus };
}

const t = createTranslator("en").t;

describe("a new folder whose folder list could not be written", () => {
    it("is not in the library, and the next folder that is written does not carry it", async () => {
        const { groups, writes, refused } = await createHarness();
        refused.add(GROUPS_IMAGE);

        const failed = await groups.createGroup(AssetCategory.Image, "Lost", undefined, { callerReports: true });

        expect(failed.success).toBe(false);
        expect(groups.getGroups(AssetCategory.Image)).toEqual([]);

        refused.clear();
        const kept = await groups.createGroup(AssetCategory.Image, "Kept", undefined, { callerReports: true });

        expect(kept.success).toBe(true);
        expect(groups.getGroups(AssetCategory.Image).map(group => group.name)).toEqual(["Kept"]);
        const written = writes.filter(write => write.path.endsWith(GROUPS_IMAGE)).at(-1);
        const names = Object.values(JSON.parse(written!.data) as Record<string, { name: string }>).map(group => group.name);
        expect(names).toEqual(["Kept"]);
    });

    it("sends no row order out beside it", async () => {
        const { groups, writes, refused } = await createHarness();
        refused.add(GROUPS_IMAGE);

        await groups.createGroup(AssetCategory.Image, "Lost", undefined, { callerReports: true });

        expect(writes.some(write => write.path.endsWith(ORDER_IMAGE))).toBe(false);
    });

    it("is one notice from the action that asked, naming the action and the reason", async () => {
        const { groups, refused, showSticky } = await createHarness();
        refused.add(GROUPS_IMAGE);

        const result = await groups.createGroup(AssetCategory.Image, "Lost", undefined, { callerReports: true });
        const notice = describeFolderEditFailure(t("assets.createGroup.failed"), result, t);

        // The save-status surface was told, and said nothing on screen: the write was the action's.
        expect(showSticky).not.toHaveBeenCalled();
        expect(notice).toEqual({
            message: t("assets.createGroup.failed"),
            detail: t("workspace.shell.save.reason.permissionDenied"),
        });
    });

    it("is one notice from the save-status surface when the action does not report it", async () => {
        const { groups, refused, showSticky } = await createHarness();
        refused.add(GROUPS_IMAGE);

        // A folder made by a paste's duplicate: the paste writes several of the library's files and
        // leaves them to the save-status surface.
        const result = await groups.createGroup(AssetCategory.Image, "Lost Copy");

        expect(showSticky).toHaveBeenCalledTimes(1);
        expect(result.success).toBe(false);
        expect(result.code).toBe(ASSET_LIBRARY_WRITE_REPORTED);
        // ...and the paste's own list leaves the row out rather than naming it a second time.
        expect(isReportedLibraryWrite(result)).toBe(true);
    });
});

describe("a renamed folder whose folder list could not be written", () => {
    it("keeps its old name and is one notice from the action", async () => {
        const { groups, refused, showSticky } = await createHarness();
        const created = await groups.createGroup(AssetCategory.Image, "Before", undefined, { callerReports: true });
        refused.add(GROUPS_IMAGE);

        const result = await groups.renameGroup(AssetCategory.Image, created.data!.id, "After", { callerReports: true });
        const notice = describeFolderEditFailure(t("assets.rename.failed", { name: "Before" }), result, t);

        expect(groups.getGroups(AssetCategory.Image).map(group => group.name)).toEqual(["Before"]);
        expect(showSticky).not.toHaveBeenCalled();
        expect(notice.detail).toBe(t("workspace.shell.save.reason.permissionDenied"));
    });
});

describe("the notice for a failed folder edit", () => {
    it("never carries the answer's own message", () => {
        for (const locale of ["en", "zh", "ja"] as const) {
            const { t: translate } = createTranslator(locale);
            // Shaped as the service answers it, the log's message included.
            const answer = { code: FsRejectErrorCode.PERMISSION_DENIED, error: `Failed to save group: PERMISSION_DENIED ${READ_ONLY.message}` };
            const notice = describeFolderEditFailure(translate("assets.createGroup.failed"), answer, translate);
            const text = `${notice.message}\n${notice.detail ?? ""}`;
            expect(text).not.toMatch(/EPERM|PERMISSION_DENIED|assets\.groups|\.json|app:\/\/|[A-Z]:[\\/]/);
        }
    });

    it("is the title alone for a failure the disk did not answer", () => {
        expect(describeFolderEditFailure("Could not create the group", { code: undefined }, t))
            .toEqual({ message: "Could not create the group" });
    });
});
