import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserDataNamespace } from "@shared/types/constants";
import { WINDOW_PROJECT_MISMATCH_CODE } from "@shared/types/window";
import { encodeProjectConfig } from "@shared/utils/nlproj";
import { PersistentState } from "@shared/utils/persistentState";
import { ScopeStoreBridge, type BlueprintPersistentStoreAdapter } from "../../../../../../renderer/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import { WidgetRuntimeStateStore } from "../../../../../../renderer/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { forgetProjectStoreIdentifiers } from "../../../utils/windowProjectStore";
import type { AppWindow } from "../appWindow";
import {
    BlueprintPersistenceGetAllHandler,
    BlueprintPersistenceGetValueHandler,
    BlueprintPersistenceRemoveValueHandler,
    BlueprintPersistenceSetValueHandler,
} from "./blueprintPersistenceAction";

// Keep Conf's real file-backed implementation while replacing Electron's app bootstrap.
vi.mock("electron-store", async () => {
    const { default: Conf } = await import("conf");
    return {
        default: class extends Conf {
            constructor(options: { name: string; cwd: string; defaults: Record<string, unknown> }) {
                const { name, ...rest } = options;
                super({ ...rest, configName: name });
            }
        },
    };
});

let root: string;
let projectPath: string;
let window: AppWindow;

beforeEach(async () => {
    forgetProjectStoreIdentifiers();
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-bp-literal-keys-"));
    projectPath = path.join(root, "project");
    await fs.mkdir(projectPath, { recursive: true });
    await fs.writeFile(path.join(projectPath, "game.nlproj"), encodeProjectConfig({
        name: "Project", identifier: "game.literal.keys", metadata: {},
    }));
    window = {
        getProps: () => ({ projectPath }),
        app: { storageManager: {
            createState: (namespace: UserDataNamespace, name: string, defaults: Record<string, unknown>) =>
                new PersistentState({ dbPath: path.join(root, "userdata", namespace, name), defaults }),
        } },
    } as unknown as AppWindow;
});

afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
});

describe("Dev Mode persistence keys with the file-backed store", () => {
    it.each(["constructor", "prototype"])("persists and removes the valid key %s", async key => {
        const projectRef = { projectPath };
        const set = new BlueprintPersistenceSetValueHandler();
        const get = new BlueprintPersistenceGetValueHandler();
        const getAll = new BlueprintPersistenceGetAllHandler();
        const remove = new BlueprintPersistenceRemoveValueHandler();

        expect(await get.handle(window, { projectRef, key })).toEqual({ success: true, data: { value: undefined } });
        expect(await set.handle(window, { projectRef, key, value: { chapter: 2 } })).toEqual({ success: true });
        expect(await get.handle(window, { projectRef, key })).toEqual({ success: true, data: { value: { chapter: 2 } } });
        const all = await getAll.handle(window, { projectRef });
        expect(all).toMatchObject({ success: true, data: { values: { [key]: { chapter: 2 } } } });

        const dir = path.join(root, "userdata", UserDataNamespace.BlueprintPersistence);
        const [file] = await fs.readdir(dir);
        const json = JSON.parse(await fs.readFile(path.join(dir, file), "utf-8"));
        expect(Object.prototype.hasOwnProperty.call(json, key)).toBe(true);
        expect(json[key]).toEqual({ chapter: 2 });

        expect(await remove.handle(window, { projectRef, key })).toEqual({ success: true });
        expect(await get.handle(window, { projectRef, key })).toEqual({ success: true, data: { value: undefined } });
    });

    it("persists a script host key through the scope and actual IPC handlers", async () => {
        type PersistenceHost = {
            persistence: {
                get: BlueprintPersistentStoreAdapter["getValue"];
                set: BlueprintPersistentStoreAdapter["setValue"];
            };
        };
        // Load renderer modules with Vite's renderer alias, which their own imports also use.
        const [{ createDevModeBlueprintHostApi }, { buildGameScriptContext }] = await Promise.all([
            vi.importActual<{ createDevModeBlueprintHostApi: (options: unknown) => PersistenceHost }>(
                "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge",
            ),
            vi.importActual<{ buildGameScriptContext: (input: unknown) => { host: PersistenceHost } }>(
                "@/lib/ui-editor/blueprint-runtime/script/scriptRuntime",
            ),
        ]);
        const projectRef = { projectPath };
        const set = new BlueprintPersistenceSetValueHandler();
        const get = new BlueprintPersistenceGetValueHandler();
        const getAll = new BlueprintPersistenceGetAllHandler();
        const remove = new BlueprintPersistenceRemoveValueHandler();
        const adapter: BlueprintPersistentStoreAdapter = {
            getAll: async () => {
                const result = await getAll.handle(window, { projectRef });
                if (!result.success) throw new Error(result.error);
                return result.data.values;
            },
            getValue: async key => {
                const result = await get.handle(window, { projectRef, key });
                if (!result.success) throw new Error(result.error);
                return result.data.value;
            },
            setValue: async (key, value) => {
                const result = await set.handle(window, { projectRef, key, value });
                if (!result.success) throw new Error(result.error);
            },
            removeValue: async key => {
                const result = await remove.handle(window, { projectRef, key });
                if (!result.success) throw new Error(result.error);
            },
        };
        const makeContext = async () => {
            const scope = new ScopeStoreBridge();
            scope.setPersistenceAdapter(adapter);
            await scope.reloadPersistenceSnapshot();
            const hostApi = createDevModeBlueprintHostApi({
                document: { surfaces: [], elements: {} },
                scope,
                activeSurfaceId: "title",
                emit: () => undefined,
                onOpenSurface: () => undefined,
                onPageBack: () => undefined,
                onWidgetPatch: () => undefined,
                widgetRuntimeStore: new WidgetRuntimeStateStore(),
            });
            return buildGameScriptContext({
                self: { kind: "project" }, hostApi,
                hostAdapter: {}, vars: {}, stopPropagation: () => undefined,
            });
        };
        const script = await makeContext();
        await script.host.persistence.set("constructor", { chapter: 2 });
        expect(await script.host.persistence.get("constructor")).toEqual({ chapter: 2 });
        const reopened = await makeContext();
        expect(await reopened.host.persistence.get("constructor")).toEqual({ chapter: 2 });
    });

    it("preserves other keys when updating and deleting reserved literal keys", async () => {
        const projectRef = { projectPath };
        const set = new BlueprintPersistenceSetValueHandler();
        const getAll = new BlueprintPersistenceGetAllHandler();
        for (const [key, value] of [["settings.volume", 0.8], ["constructor", 1], ["prototype", false]] as const) {
            expect(await set.handle(window, { projectRef, key, value })).toEqual({ success: true });
        }
        expect(await set.handle(window, { projectRef, key: "constructor", value: null })).toEqual({ success: true });
        expect(await getAll.handle(window, { projectRef })).toEqual({
            success: true, data: { values: { "settings.volume": 0.8, constructor: null, prototype: false } },
        });
        expect(await set.handle(window, { projectRef, key: "prototype", value: undefined })).toEqual({ success: true });
        expect(await getAll.handle(window, { projectRef })).toEqual({
            success: true, data: { values: { "settings.volume": 0.8, constructor: null } },
        });
    });

    it.each([Symbol("invalid"), () => undefined, 1n])("reports invalid data for reserved keys without writing", async value => {
        const projectRef = { projectPath };
        const result = await new BlueprintPersistenceSetValueHandler().handle(window, { projectRef, key: "constructor", value });
        expect(result).toMatchObject({ success: false });
        expect(await new BlueprintPersistenceGetValueHandler().handle(window, { projectRef, key: "constructor" }))
            .toEqual({ success: true, data: { value: undefined } });
    });

    it("keeps the shared settings store's validation and literal dotted keys", () => {
        const settings = new PersistentState<Record<string, unknown>>({ dbPath: path.join(root, "settings.json"), defaults: {} });
        settings.setItem("settings.volume", 0.8);
        expect(settings.getItem("settings.volume")).toBe(0.8);
        expect(settings.raw()).toMatchObject({ "settings.volume": 0.8 });
        expect(() => settings.setItem("__proto__", 7)).toThrow(/Invalid key/);
        expect(() => settings.setItem("bad/key", 7)).toThrow(/Invalid key/);
    });

    it.each(["__proto__", "bad/key"])("keeps the existing key validation for %s", async key => {
        const result = await new BlueprintPersistenceSetValueHandler().handle(window, {
            projectRef: { projectPath }, key, value: 7,
        });
        expect(result).toMatchObject({ success: false });
    });

    it("does not let a window write another project's store", async () => {
        const result = await new BlueprintPersistenceSetValueHandler().handle(window, {
            projectRef: { projectPath: path.join(root, "another-project") }, key: "constructor", value: 7,
        });
        expect(result).toMatchObject({ success: false, code: WINDOW_PROJECT_MISMATCH_CODE });
    });
});
