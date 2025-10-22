
export type ProjectMetadata = {
    description: string;
    version: string;
    author: string;
    email: string;
    website: string;
    license: string;
    copyright: string;
};

export interface ProjectProps {
    projectPath: string;
}

export interface ProjectConfig {
    name: string;
    metadata: Partial<ProjectMetadata>;
}

export class Porject {
    private config: ProjectProps;

    constructor(config: ProjectProps) {
        this.config = config;
    }
}
