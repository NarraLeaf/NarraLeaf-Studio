import { RuntimeSettingCategory } from "./types";

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
        settings: [],
    }
}
