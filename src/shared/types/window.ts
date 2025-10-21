
export enum WindowAppType {
    Launcher = "launcher",
    Settings = "settings",
}

export type WindowProps = {
    [WindowAppType.Launcher]: {
    },
    [WindowAppType.Settings]: {
        highlight?: string;
    }
}

export type WindowVisibilityStatus = "minimized" | "maximized" | "normal";

export type WindowLuanchOptions = {
    modal: boolean;
    child: boolean;
};
