import { resolve } from "@shared/utils/path";

export type Resolution = {
    width: number;
    height: number;
};

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
};

export interface ProjectProps {
    projectPath: string;
}

export interface ProjectConfig {
    name: string;
    identifier: string;
    metadata: Partial<ProjectMetadata>;
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
        return resolve(this.config.projectPath, ...flattened);
    }

    public getConfig(): ProjectProps {
        return this.config;
    }
}
