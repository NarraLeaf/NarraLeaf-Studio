import { FileDetails, FileStat } from "@shared/utils/fs";
import { AppInfo } from "./app";
import { IPCMessageType, IPCType } from "./ipc";
import { FsRequestResult, PlatformInfo } from "./os";
import { WindowAppType, WindowProps, WindowVisibilityStatus, WindowControlAbility } from "./window";
import { GlobalStateKeys, GlobalStateValue } from "./state/globalState";

export enum IPCEventType {
    getPlatform = "getPlatform",
    appTerminate = "app.terminate",
    appWindowControl = "app.window.setControl",
    appWindowGetControl = "app.window.getControl",
    appWindowControlAbility = "app.window.getControlAbility",
    appWindowProps = "app.window.props",
    appInfo = "app.info",
    appWindowReady = "app.window.ready",
    appLaunchSettings = "app.settings.launchWindow",
    appGlobalStateGet = "app.globalState.get",
    appGlobalStateSet = "app.globalState.set",

    fsStat = "fs.stat",
    fsList = "fs.list",
    fsDetails = "fs.details",
    fsRequestRead = "fs.requestRead",
    fsRequestWrite = "fs.requestWrite",
    fsCreateDir = "fs.createDir",
    fsDeleteFile = "fs.deleteFile",
    fsDeleteDir = "fs.deleteDir",
    fsRename = "fs.rename",
    fsCopyFile = "fs.copyFile",
    fsCopyDir = "fs.copyDir",
    fsMoveFile = "fs.moveFile",
    fsMoveDir = "fs.moveDir",
    fsFileExists = "fs.fileExists",
    fsDirExists = "fs.dirExists",
    fsIsFile = "fs.isFile",
    fsIsDir = "fs.isDir",

    editorLaunch = "editor.launch",

    projectWizardLaunch = "projectWizard.launch",
    projectWizardSelectDirectory = "projectWizard.selectDirectory",
    projectWizardGetDefaultDirectory = "projectWizard.getDefaultDirectory",
}

export type VoidRequestStatus = RequestStatus<void>;
export type RequestStatus<T> = {
    success: true;
    data: T;
    error?: never;
} | {
    success: false;
    data?: never;
    error?: string;
};

export type IPCEvents = {
    [IPCEventType.getPlatform]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: PlatformInfo;
    };
    [IPCEventType.appTerminate]: {
        type: IPCMessageType.message,
        consumer: IPCType.Host,
        data: {
            err: string | null;
        },
        response: never;
    };
    [IPCEventType.appWindowControl]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            control: "minimize" | "maximize" | "unmaximize" | "close",
        },
        response: void;
    };
    [IPCEventType.appWindowGetControl]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: {
            status: WindowVisibilityStatus,
        };
    };
    [IPCEventType.appWindowControlAbility]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: WindowControlAbility;
    };
    [IPCEventType.appWindowProps]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: WindowProps[WindowAppType];
    };
    [IPCEventType.appInfo]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: AppInfo;
    };
    [IPCEventType.appWindowReady]: {
        type: IPCMessageType.message,
        consumer: IPCType.Host,
        data: {},
        response: never;
    };
    [IPCEventType.appLaunchSettings]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            props: WindowProps[WindowAppType.Settings];
        },
        response: void;
    };
    [IPCEventType.appGlobalStateGet]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            key: GlobalStateKeys;
        },
        response: {
            value: GlobalStateValue<GlobalStateKeys>;
        };
    };
    [IPCEventType.appGlobalStateSet]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            key: GlobalStateKeys;
            value: GlobalStateValue<GlobalStateKeys>;
        },
        response: void;
    };
} & IPCFsEvents & IPCEditorEvents & IPCProjectWizardEvents;

export type IPCFsEvents = {
    [IPCEventType.fsStat]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
        },
        response: FsRequestResult<FileStat>;
    };
    [IPCEventType.fsList]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
        },
        response: FsRequestResult<FileStat[]>;
    };
    [IPCEventType.fsDetails]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
        },
        response: FsRequestResult<FileDetails>;
    };
    [IPCEventType.fsRequestRead]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
            raw: boolean;
            encoding?: BufferEncoding;
        },
        response: FsRequestResult<string>; // a hash that can be used to fetch the file later
    };
    [IPCEventType.fsRequestWrite]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
            raw: boolean;
            encoding?: BufferEncoding;
        },
        response: FsRequestResult<string>;
    };
    [IPCEventType.fsCreateDir]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
        },
        response: FsRequestResult<void>;
    };
    [IPCEventType.fsDeleteFile]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
        },
        response: FsRequestResult<void>;
    };
    [IPCEventType.fsDeleteDir]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
        },
        response: FsRequestResult<void>;
    };
    [IPCEventType.fsRename]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            oldPath: string;
            newName: string;
            isDir: boolean;
        },
        response: FsRequestResult<void>;
    };
    [IPCEventType.fsCopyFile]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            src: string;
            dest: string;
        },
        response: FsRequestResult<void>;
    };
    [IPCEventType.fsCopyDir]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            src: string;
            dest: string;
        },
        response: FsRequestResult<void>;
    };
    [IPCEventType.fsMoveFile]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            src: string;
            dest: string;
        },
        response: FsRequestResult<void>;
    };
    [IPCEventType.fsMoveDir]: { 
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            src: string;
            dest: string;
        },
        response: FsRequestResult<void>;
    };
    [IPCEventType.fsFileExists]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
        },
        response: FsRequestResult<boolean>;
    };
    [IPCEventType.fsDirExists]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
        },
        response: FsRequestResult<boolean>;
    };
    [IPCEventType.fsIsFile]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
        },
        response: FsRequestResult<boolean>;
    };
    [IPCEventType.fsIsDir]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
        },
        response: FsRequestResult<boolean>;
    };
};

export type IPCEditorEvents = {
    [IPCEventType.editorLaunch]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            props: WindowProps[WindowAppType.Workspace];
            closeCurrentWindow: boolean;
        },
        response: void;
    };
};

export type IPCProjectWizardEvents = {
    [IPCEventType.projectWizardLaunch]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: void;
    };
    [IPCEventType.projectWizardSelectDirectory]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: string | null;
    };
    [IPCEventType.projectWizardGetDefaultDirectory]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: string;
    };
};