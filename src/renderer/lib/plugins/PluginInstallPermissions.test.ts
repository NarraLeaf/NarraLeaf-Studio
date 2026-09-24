import { describe, expect, it } from "vitest";
import { createTranslator } from "@shared/i18n";
import { ApiCapability } from "@shared/types/pluginPermissions";
import { studioPermissionLabel } from "./PluginInstallPermissions";

const folder = { kind: "filesystem", path: "C:/Games/probe", mode: "read", recursive: true } as const;
const file = { kind: "filesystem", path: "C:/Games/probe.txt", mode: "readwrite", recursive: false } as const;
const bash = { kind: "api", capability: ApiCapability.BashExecute } as const;

/**
 * The Studio group of the install prompt and of the plugin details. Its rows were the one part of
 * the prompt built outside the catalog, and they read in English under every interface language.
 */
describe("studioPermissionLabel", () => {
    it("names a declared Studio control in the interface's language", () => {
        const zh = createTranslator("zh").t;
        expect(studioPermissionLabel(folder, zh)).toBe("读取访问（C:/Games/probe 及其子路径）");
        expect(studioPermissionLabel(file, zh)).toBe("读写访问（C:/Games/probe.txt）");
        expect(studioPermissionLabel(bash, zh)).toBe("Studio API：bash.execute");

        const ja = createTranslator("ja").t;
        expect(studioPermissionLabel(folder, ja)).toBe("C:/Games/probe の中で読み取り");
        expect(studioPermissionLabel(bash, ja)).toBe("Studio API：bash.execute");
    });

    it("words a file grant as the file access prompt words the same grant", () => {
        const en = createTranslator("en").t;
        expect(studioPermissionLabel(folder, en)).toBe(
            en("pluginPermission.filesystem.permissionRecursive", { mode: en("pluginPermission.mode.read"), path: folder.path }),
        );
        expect(studioPermissionLabel(file, en)).toBe("Read and write access for C:/Games/probe.txt");
        expect(studioPermissionLabel(bash, en)).toBe("Studio API: bash.execute");
    });
});
