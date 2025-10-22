
export enum WindowAppType {
    Launcher = "launcher",
    Settings = "settings",
    Workspace = "Workspace",
}

export type WindowProps = {
    [WindowAppType.Launcher]: {
    },
    [WindowAppType.Settings]: {
        highlight?: string;
    },
    [WindowAppType.Workspace]: {
        projectPath: string;
    },
}

export type WindowVisibilityStatus = "minimized" | "maximized" | "normal";

export type WindowLuanchOptions = {
    modal: boolean;
    child: boolean;
};
