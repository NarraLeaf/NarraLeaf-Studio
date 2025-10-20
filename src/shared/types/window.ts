
export enum WindowAppType {
    Launcher = "launcher",
}

export type WindowProps = {
    [WindowAppType.Launcher]: {
    }
}

export type WindowVisibilityStatus = "minimized" | "maximized" | "normal";

