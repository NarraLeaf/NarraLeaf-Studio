import { beforeEach, describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode } from "@shared/types/os";
import { defaultProjectData } from "../constants";
import type { ProjectData } from "../types";
import { ValidationService } from "./validationService";

const mocks = vi.hoisted(() => ({
    fs: {
        isDirExists: vi.fn(),
        isDir: vi.fn(),
        list: vi.fn(),
    },
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        fs: mocks.fs,
    }),
}));

const data = (over: Partial<ProjectData> = {}): ProjectData => ({ ...defaultProjectData, ...over });

describe("which page may be left", () => {
    it("waits for a template only in the flow that uses one", () => {
        expect(ValidationService.isStepValid("origin", data(), "create")).toBe(false);
        expect(ValidationService.isStepValid("origin", data({ template: "empty" }), "create")).toBe(true);
        expect(ValidationService.isStepValid("origin", data(), "import")).toBe(true);
        expect(ValidationService.isStepValid("origin", data(), "clone")).toBe(true);
    });

    /** Both answers are picked on the page, so both gate the button that unpacks. */
    it("holds the import page until a package and a folder are both chosen", () => {
        expect(ValidationService.isStepValid("import", data(), "import")).toBe(false);
        expect(ValidationService.isStepValid("import", data({
            packagePath: "D:/Downloads/My-Game.nlspkg",
        }), "import")).toBe(false);
        expect(ValidationService.isStepValid("import", data({
            location: "D:/Projects/my-game",
        }), "import")).toBe(false);
        expect(ValidationService.isStepValid("import", data({
            packagePath: "D:/Downloads/My-Game.nlspkg",
            location: "D:/Projects/my-game",
        }), "import")).toBe(true);
    });

    it("holds the project page until the three permanent answers are there", () => {
        expect(ValidationService.isStepValid("project", data({ name: "Game" }), "create")).toBe(false);
        expect(ValidationService.isStepValid("project", data({
            name: "Game",
            appId: "game",
            location: "D:/Projects/game",
        }), "create")).toBe(true);
    });

    it("takes a reverse-domain app id, which a build uses as the package id as it is", () => {
        // `deriveGameAppId` passes a dotted id through verbatim and files anything else under
        // NarraLeaf's own namespace, so refusing dots here left a studio no way to ship its own id.
        for (const appId of ["com.studio.game", "jp.circle.my-game", "game.v2", "my-game"]) {
            expect(ValidationService.validateAppId(appId), appId).toBe(true);
        }
        // A dot only between two non-empty parts: never leading, trailing or doubled - a trailing
        // dot would also be dropped from the folder name on Windows - and no part ends in a hyphen.
        for (const appId of ["com.", ".game", "com..game", "com.-game", "com.game-", "Com.Studio", "com.my game"]) {
            expect(ValidationService.validateAppId(appId), appId).toBe(false);
        }
    });

    it("refuses an app id the project could not be identified by", () => {
        expect(ValidationService.isStepValid("project", data({
            name: "Game",
            appId: "Game Two",
            location: "D:/Projects/game",
        }), "create")).toBe(false);
    });

    /**
     * An out-of-range custom size leaves `resolution` empty rather than at its last good value,
     * so this is the only thing standing between a typed mistake and a project written at a stage
     * nobody chose.
     */
    it("refuses a stage page whose typed size was cleared as unusable", () => {
        expect(ValidationService.isStepValid("stage", data({ resolution: "" }), "create")).toBe(false);
        expect(ValidationService.isStepValid("stage", data({ resolution: "1080x1920" }), "create")).toBe(true);
    });

    it("re-asserts every earlier gate on the page that writes", () => {
        const complete = data({
            name: "Game",
            appId: "game",
            location: "D:/Projects/game",
            resolution: "1920x1080",
        });
        expect(ValidationService.isStepValid("review", complete, "create")).toBe(true);
        expect(ValidationService.isStepValid("review", { ...complete, resolution: "" }, "create")).toBe(false);
        expect(ValidationService.isStepValid("review", { ...complete, appId: "" }, "create")).toBe(false);
    });
});

describe("ValidationService directory validation", () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it("reports permission errors instead of treating denied paths as creatable", async () => {
        mocks.fs.isDirExists.mockResolvedValue({
            success: true,
            data: {
                ok: false,
                error: {
                    code: FsRejectErrorCode.PERMISSION_DENIED,
                    message: "File system access is not allowed for path: /Users/me/Documents/Game",
                },
            },
        });

        const result = await ValidationService.validateProjectDirectory("/Users/me/Documents/Game");

        expect(result.success).toBe(false);
        expect(result.errors.directory).toBe("File system access is not allowed for path: /Users/me/Documents/Game");
        expect(mocks.fs.isDirExists).toHaveBeenCalledWith("/Users/me/Documents/Game");
        expect(mocks.fs.isDir).not.toHaveBeenCalled();
        expect(mocks.fs.list).not.toHaveBeenCalled();
    });

    it("allows an authorized project directory that will be created later", async () => {
        mocks.fs.isDirExists.mockResolvedValue({
            success: true,
            data: {
                ok: true,
                data: false,
            },
        });

        const result = await ValidationService.validateProjectDirectory("/Users/me/Documents/Game");

        expect(result.success).toBe(true);
        expect(result.data).toEqual({
            exists: false,
            isDirectory: false,
            isEmpty: true,
            canWrite: true,
        });
        expect(mocks.fs.isDir).not.toHaveBeenCalled();
        expect(mocks.fs.list).not.toHaveBeenCalled();
    });
});

/**
 * The identifier the wizard suggests while the name is typed. A Han character reads one way in
 * Chinese and another in Japanese, and the transliterator only knows the Chinese reading: it
 * suggested `fang-ke-hou` for 放課後, which is read "houkago".
 */
describe("the identifier suggested from a project name", () => {
    it("spells a Latin name as it always did", () => {
        expect(ValidationService.generateAppId("My Game!", "en")).toBe("my-game");
        expect(ValidationService.generateAppId("Épica", "ja")).toBe("epica");
    });

    it("romanizes kana, whatever language Studio is in", () => {
        expect(ValidationService.generateAppId("アリス", "en")).toBe("arisu");
        expect(ValidationService.generateAppId("ひまわり", "zh")).toBe("himawari");
    });

    it("reads Han characters as Mandarin for someone working in Chinese", () => {
        expect(ValidationService.generateAppId("你好世界", "zh")).toBe("ni-hao-shi-jie");
    });

    it("suggests nothing it would have to guess the reading of", () => {
        // Studio in Japanese or English: the Chinese reading may well be the wrong one.
        expect(ValidationService.generateAppId("放課後", "ja")).toBe("");
        expect(ValidationService.generateAppId("放課後", "en")).toBe("");
        // Kana beside the kanji make the name Japanese, whatever language Studio is in.
        expect(ValidationService.generateAppId("放課後のアリス", "zh")).toBe("");
        // Half a spelling is worse than none.
        expect(ValidationService.generateAppId("星の詩 Prologue", "ja")).toBe("");
    });
});
