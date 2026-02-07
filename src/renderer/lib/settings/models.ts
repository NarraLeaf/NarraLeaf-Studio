import { RuntimeSettingType, TypeofSettingSchema } from "@/lib/workspace/services/settings/types";
import { GlobalStateKeys } from "@shared/types/state/globalState";

/**
 * Scopes describe where a setting is stored and applied.
 */
export enum SettingScope {
    Global = "global",
    Project = "project",
    Runtime = "runtime",
}

/**
 * Lightweight descriptor that the shared UI layer understands.
 */
export interface SettingDescriptor<T extends RuntimeSettingType = RuntimeSettingType> {
    id: string;
    type: T;
    label: string;
    description: string;
    defaultValue: TypeofSettingSchema<T>;
    options?: string[];
}

/**
 * Shape of each global application setting.
 */
export interface AppSettingDefinition<T extends RuntimeSettingType = RuntimeSettingType> {
    key: GlobalStateKeys;
    category: AppSettingCategoryKey;
    scope: SettingScope;
    type: T;
    label: string;
    description: string;
    defaultValue: TypeofSettingSchema<T>;
    options?: string[];
}

/**
 * Metadata used for rendering grouped categories.
 */
export interface SettingCategory {
    key: string;
    label: string;
    description: string;
    order: number;
}

export type AppSettingCategoryKey = "general" | "appearance" | "editor" | "workspace" | "sync" | "advanced";
