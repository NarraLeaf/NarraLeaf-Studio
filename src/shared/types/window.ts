
export enum WindowAppType {
    Launcher = "launcher",
    Settings = "settings",
    Workspace = "workspace",
    ProjectWizard = "project-wizard",
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
    [WindowAppType.ProjectWizard]: {
    },
}

export type WindowVisibilityStatus = "minimized" | "maximized" | "normal";

export interface WindowControlAbility {
    minimizable: boolean;
    maximizable: boolean;
    closable: boolean;
    resizable: boolean;
    movable: boolean;
    fullscreenable: boolean;
}

export type WindowLuanchOptions = {
    modal: boolean;
    child: boolean;
};
