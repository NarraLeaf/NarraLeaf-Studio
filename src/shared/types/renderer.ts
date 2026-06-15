import { FileDetails, FileStat } from "@shared/utils/fs";
import { AppInfo } from "./app";
import { RendererInterfaceKey } from "./constants";
import { RequestStatus } from "./ipcEvents";
import { FsRequestResult, PlatformInfo } from "./os";
import { WindowAppType, WindowProps, WindowVisibilityStatus, WindowControlAbility, WindowCloseResults } from "./window";
import { GlobalStateValue } from "./state/globalState";
import { GlobalStateKeys } from "./state/globalState";
import { DevModeBundle, DevModeEntry, DevModeStatus } from "./devMode";
import type { PreviewStudioBlueprintOpenPayload } from "./previewStudioBlueprintOpen";
import { AppEventToken } from "./app";

export interface RendererPreloadedInterface {
    // Basic Information
    getPlatform(): Promise<RequestStatus<PlatformInfo>>;
    getAppInfo(): Promise<RequestStatus<AppInfo>>;
    getWindowProps<T extends WindowAppType>(): Promise<RequestStatus<WindowProps[T]>>;
    terminate(err?: string): Promise<void>;

    // Window
    window: {
        ready(): void;
        close(): void;
        closeWith<T extends WindowAppType = WindowAppType>(result: WindowCloseResults[T]): void;
        control: {
            minimize(): Promise<RequestStatus<void>>;
            maximize(): Promise<RequestStatus<void>>;
            unmaximize(): Promise<RequestStatus<void>>;
            close(): Promise<RequestStatus<void>>;
            status(): Promise<RequestStatus<{ status: WindowVisibilityStatus }>>;
            ability(): Promise<RequestStatus<WindowControlAbility>>;
        };
    };

    // File System
    fs: {
        stat(path: string): Promise<RequestStatus<FsRequestResult<FileStat>>>;
        list(path: string): Promise<RequestStatus<FsRequestResult<FileStat[]>>>;
        details(path: string): Promise<RequestStatus<FsRequestResult<FileDetails>>>;
        requestRead(path: string, encoding: BufferEncoding): Promise<RequestStatus<FsRequestResult<string>>>;
        requestReadRaw(path: string): Promise<RequestStatus<FsRequestResult<string>>>;
        requestWrite(path: string, encoding: BufferEncoding): Promise<RequestStatus<FsRequestResult<string>>>;
        requestWriteRaw(path: string): Promise<RequestStatus<FsRequestResult<string>>>;
        ensureRegularFile(path: string, data: string, encoding?: BufferEncoding): Promise<RequestStatus<FsRequestResult<void>>>;
        writeFileNoFollow(path: string, data: string, encoding?: BufferEncoding): Promise<RequestStatus<FsRequestResult<void>>>;
        recoverCorruptedJsonFile(path: string, replacement: string, encoding?: BufferEncoding): Promise<RequestStatus<FsRequestResult<void>>>;
        createDir(path: string): Promise<RequestStatus<FsRequestResult<void>>>;
        deleteFile(path: string): Promise<RequestStatus<FsRequestResult<void>>>;
        deleteDir(path: string): Promise<RequestStatus<FsRequestResult<void>>>;
        rename(oldPath: string, newName: string, isDir: boolean): Promise<RequestStatus<FsRequestResult<void>>>;
        copyFile(src: string, dest: string): Promise<RequestStatus<FsRequestResult<void>>>;
        copyDir(src: string, dest: string): Promise<RequestStatus<FsRequestResult<void>>>;
        moveFile(src: string, dest: string): Promise<RequestStatus<FsRequestResult<void>>>;
        moveDir(src: string, dest: string): Promise<RequestStatus<FsRequestResult<void>>>;
        isFileExists(path: string): Promise<RequestStatus<FsRequestResult<boolean>>>;
        isDirExists(path: string): Promise<RequestStatus<FsRequestResult<boolean>>>;
        isFile(path: string): Promise<RequestStatus<FsRequestResult<boolean>>>;
        isDir(path: string): Promise<RequestStatus<FsRequestResult<boolean>>>;
        selectFile(filters: string[], multiple: boolean): Promise<RequestStatus<FsRequestResult<string[]>>>;
        selectDirectory(multiple: boolean): Promise<RequestStatus<FsRequestResult<string[]>>>;
        hash(path: string): Promise<RequestStatus<FsRequestResult<string>>>;
        getPathForFile(file: File): string;
    };

    selectProjectDirectory(): Promise<RequestStatus<{ dest: string | null }>>;

    // Workspace
    selectFolder(): Promise<RequestStatus<{ path: string | null }>>;
    workspace: {
        launch(props: WindowProps[WindowAppType.Workspace], closeCurrentWindow?: boolean): Promise<RequestStatus<void>>;
        close(): Promise<RequestStatus<void>>;
        getDefaultProjectDirectory(): Promise<RequestStatus<{ dir: string }>>;
        onResolveImageAssetUrl(handler: (payload: { assetId: string }) => Promise<RequestStatus<{ url: string }>>): AppEventToken;
        onBlueprintNavigateFromPreview(handler: (payload: PreviewStudioBlueprintOpenPayload) => void): AppEventToken;
    };

    // App
    app: {
        launchSettings(props: WindowProps[WindowAppType.Settings]): Promise<RequestStatus<void>>;
        launchProjectWizard(props: WindowProps[WindowAppType.ProjectWizard]): Promise<RequestStatus<{ created: boolean; projectPath: string } | null>>;
        state: {
            getGlobalState<K extends GlobalStateKeys>(key: K): Promise<RequestStatus<{ value: GlobalStateValue<K> }>>;
            setGlobalState<K extends GlobalStateKeys>(key: K, value: GlobalStateValue<K>): Promise<RequestStatus<void>>;
            getAllGlobalState(): Promise<RequestStatus<{ settings: Record<string, any> }>>;
        };
        addRecentProject(name: string, path: string): Promise<RequestStatus<void>>;
    };

    devMode: {
        launch(projectPath: string, entry: DevModeEntry): Promise<RequestStatus<{ status: DevModeStatus }>>;
        stop(): Promise<RequestStatus<{ status: DevModeStatus }>>;
        reload(): Promise<RequestStatus<{ status: DevModeStatus }>>;
        getStatus(): Promise<RequestStatus<{ status: DevModeStatus }>>;
        onPayloadUpdate(handler: (payload: { bundle: DevModeBundle }) => void): AppEventToken;
        onControlReload(handler: (payload: { revision: number }) => void): AppEventToken;
        onControlError(handler: (payload: { message: string }) => void): AppEventToken;
        resolveImageAssetUrl(assetId: string): Promise<RequestStatus<{ url: string }>>;
        openBlueprintInWorkspace(
            payload: PreviewStudioBlueprintOpenPayload & { projectPath: string },
        ): Promise<RequestStatus<void>>;
    };
}

declare global {
    interface Window {
        [RendererInterfaceKey]: RendererPreloadedInterface;
    }
}
