
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

export type WindowLuanchOptions = {
    modal: boolean;
    child: boolean;
};
