import { RuntimeSettingCategory, RuntimeSettingType } from "./types";

export type RSCategories = "project" | "security";
export const RuntimeSettings: Record<RSCategories, RuntimeSettingCategory> = {
    project: {
        name: "Project",
        description: "Project Settings",
        settings: [],
    },
    security: {
        name: "Security",
        description: "Security Settings",
        settings: [
            {
                type: RuntimeSettingType.Boolean,
                name: "security.allowHttp",
                label: "Allow HTTP Connection",
                description: "Allow HTTP Connection. This has to be enabled for the remote sources to be fetched.",
                defaultValue: true,
            },
            {
                type: RuntimeSettingType.Boolean,
                name: "security.allowRemoteScript",
                label: "Allow Remote Scripts",
                description: "Allow Remote Scripts to be executed. Enabling this may affect the security of the application.",
                defaultValue: false,
            },
        ],
    }
}
