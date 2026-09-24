import { afterEach, describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode } from "@shared/types/os";
import { i18nStore } from "@/lib/i18n";
import { Services, type WorkspaceContext } from "../services";
import { ProjectFileAccessError, ProjectService } from "./ProjectService";

/**
 * What the icon section says when picking an image for the app icon fails.
 *
 * The section shows a `ProjectFileAccessError`'s message as it is, so each is the author's sentence:
 * the picked file by the name it has on their disk, and the reason only where they can act on it.
 * It used to be `Failed to read D:\Art\logo.png: EACCES...` or `Unsupported icon file: .txt`.
 */

const picked = { result: { success: true, data: { ok: true, data: ["D:/Art/Key Art/logo.png"] } } as unknown };

vi.mock("@/lib/app/privilegedFacade", () => ({
    appPrivilegedFacade: {
        fs: {
            selectFile: async () => picked.result,
        },
    },
}));

function mount(readRaw: () => Promise<unknown>, createDir: () => Promise<unknown> = async () => ({ ok: true, data: undefined })) {
    const service = new ProjectService();
    service.setContext({
        project: {
            getConfig: () => ({ projectPath: "D:/projects/demo" }),
            resolve: (segments: string[]) => `D:/projects/demo/${segments.join("/")}`,
        },
        services: {
            get: (id: Services) => {
                if (id === Services.FileSystem) {
                    return { readRaw, createDir };
                }
                throw new Error(`Unexpected service ${id}`);
            },
        },
    } as unknown as WorkspaceContext);
    return service;
}

async function failure(service: ProjectService): Promise<Error> {
    return service.importProjectIconSource("master").then(
        () => { throw new Error("expected the import to fail"); },
        (error: Error) => error,
    );
}

/** Nothing a sentence may carry: the picked file's folder, a drive letter, Node's or the code's English. */
const LEAKS = /D:|Art\/|Key Art|EACCES|Failed|Unsupported|picker|app:\/\//;

describe("picking an icon image that cannot be used", () => {
    afterEach(() => {
        i18nStore.setLocale("en");
        picked.result = { success: true, data: { ok: true, data: ["D:/Art/Key Art/logo.png"] } };
    });

    it("names the file and why it could not be read, in the interface's language", async () => {
        const denied = async () => ({
            ok: false,
            error: { code: FsRejectErrorCode.PERMISSION_DENIED, message: "EACCES: permission denied, open 'D:/Art/Key Art/logo.png'" },
        });

        i18nStore.setLocale("en");
        const en = await failure(mount(denied));
        expect(en).toBeInstanceOf(ProjectFileAccessError);
        expect(en.message).toBe("“logo.png” could not be read. Studio is not allowed to read its file.");

        for (const locale of ["zh", "ja"] as const) {
            i18nStore.setLocale(locale);
            const error = await failure(mount(denied));
            expect(error.message).toContain("logo.png");
            expect(error.message).not.toMatch(LEAKS);
            expect(error.message.replace(/logo\.png|Studio/g, "")).not.toMatch(/[A-Za-z]{2,}/);
        }
    });

    it("says a file of the wrong kind cannot be an icon, by its name", async () => {
        picked.result = { success: true, data: { ok: true, data: ["D:/Art/Key Art/notes.txt"] } };
        const error = await failure(mount(async () => ({ ok: true, data: new Uint8Array() })));
        expect(error).toBeInstanceOf(ProjectFileAccessError);
        expect(error.message).toBe("“notes.txt” cannot be used as an icon.");
    });

    it("says the picker did not open, without the bridge's words", async () => {
        picked.result = { success: false, error: "Failed to open icon file picker: IPC timeout" };
        const error = await failure(mount(async () => ({ ok: true, data: new Uint8Array() })));
        expect(error).toBeInstanceOf(ProjectFileAccessError);
        expect(error.message).toBe("The file picker could not be opened.");
    });

    it("names the icon store, not the folder, when the icon folder cannot be made", async () => {
        const error = await failure(mount(
            async () => ({ ok: true, data: new Uint8Array([1]) }),
            async () => ({ ok: false, error: { code: FsRejectErrorCode.PERMISSION_DENIED, message: "EPERM: mkdir 'D:/projects/demo/assets/icons'" } }),
        ));
        expect(error).toBeInstanceOf(ProjectFileAccessError);
        expect(error.message).toBe("Could not save the project icon. The file is read-only, or Studio is not allowed to write to it.");
    });
});
