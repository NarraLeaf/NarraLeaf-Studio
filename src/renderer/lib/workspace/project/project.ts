import { join } from "@shared/utils/path";
import type { ProjectDependencyTable } from "@shared/types/pluginDependencies";
import type { ProjectIconSet } from "@shared/types/projectIcons";
import type { ProjectAppConfiguration } from "./configuration";

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
    /**
     * Legacy: an SPDX id the wizard used to collect.
     *
     * Nothing reads it and nothing writes it any more - a licence chosen at creation could not be
     * corrected anywhere in Studio afterwards, which made it the one piece of metadata that
     * required editing the `.nlproj` by hand. Declared so projects that carry one still decode.
     */
    license: string;
    /** Legacy companion to {@link license}, for its "Other" case. */
    licenseString?: string;
    /** One line, embedded in the packaged binaries' file properties. */
    copyright: string;
    /**
     * The full copyright and attribution notice, shipped beside the game as `COPYRIGHT.txt`.
     *
     * Separate from {@link copyright} rather than replacing it, because the two go to different
     * readers through different channels: `copyright` is a single line electron-builder writes
     * into Windows file properties and macOS's `NSHumanReadableCopyright`, where a multi-paragraph
     * notice would be unreadable, while this is the text a player opens - fonts, music, assets and
     * whoever else has to be credited.
     */
    copyrightText: string;
    resolution: Resolution;
    /**
     * The app-icon set: one master plus a per-target recipe. Stored raw, so
     * always read it through `normalizeProjectIconSet` - projects saved before
     * the master model existed hold the legacy five-slot shape here.
     */
    icons: ProjectIconSet;
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
