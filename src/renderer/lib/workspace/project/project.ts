import { join } from "@shared/utils/path";
import type { ProjectDependencyTable } from "@shared/types/pluginDependencies";
import type { ProjectAppConfiguration } from "./configuration";

export type Resolution = {
    width: number;
    height: number;
};

/**
 * Platforms that take their own app icon. Android's is scaled into the shell
 * template's icon slots by the mobile repack; iOS joins once its build target
 * is offered.
 */
export type ProjectIconPlatform = "macos" | "windows" | "linux" | "android";

export interface ProjectIconConfig {
    path: string;
    sourceName: string;
    mediaType: string;
    updatedAt: string;
}

export type ProjectMetadata = {
    description: string;
    version: string;
    author: string;
    email: string;
    website: string;
    license: string;
    licenseString?: string;
    copyright: string;
    resolution: Resolution;
    icons: Partial<Record<ProjectIconPlatform, ProjectIconConfig>>;
};

export interface ProjectProps {
    projectPath: string;
}

export interface ProjectConfig {
    name: string;
    identifier: string;
    metadata: Partial<ProjectMetadata>;
    /**
     * Application-level configuration that affects how the game runs and is
     * packaged (network policy, etc.). Optional for backward compatibility with
     * projects created before this field existed.
     */
    app?: ProjectAppConfiguration;
    /**
     * Machine-managed table of the plugins this project depends on, bound by
     * plugin id. Derived by scanning plugin usage (see ProjectDependencyService);
     * travels with the `.nlproj` on export so dependencies can be resolved on
     * import and across Studio updates. Absent on projects that use no plugins.
     */
    dependencies?: ProjectDependencyTable;
}

export class Porject {
    private config: ProjectProps;

    constructor(config: ProjectProps) {
        this.config = config;
    }

    public getFileName(dest: string[]): string {
        if (dest.length === 0) {
            throw new Error("Path is empty");
        }

        return dest.at(-1)!;
    }

    public getTargetPath(dest: string[]): string {
        if (dest.length === 0) {
            throw new Error("Path is empty");
        }

        return dest.join("/");
    }

    public isDir(dest: string[]): boolean {
        if (dest.length === 0) {
            return false;
        }

        return dest.at(-1)!.endsWith("/");
    }

    public resolve(...paths: (Readonly<string[]> | string)[]): string {
        const flattened = paths.flatMap(path => Array.isArray(path) ? path : [path]);
        return join(this.config.projectPath, ...flattened);
    }

    public getConfig(): ProjectProps {
        return this.config;
    }
}
