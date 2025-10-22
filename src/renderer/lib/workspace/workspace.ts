import { throwException } from "@shared/utils/error";
import { getInterface } from "../app/bridge";
import { Porject } from "./project/project";
import { ServiceRegistry } from "./services/serviceRegistry";
import { WorkspaceContext } from "./services/services";
import { WindowAppType } from "@shared/types/window";

export class Workspace {
    public static async createContext(): Promise<WorkspaceContext> {
        const props = throwException(await getInterface().getWindowProps<WindowAppType.Workspace>());
        const project = new Porject({
            projectPath: props.projectPath,
        });

        return {
            project,
            services: new ServiceRegistry(),
        };
    }

    public static create(context: WorkspaceContext): Workspace {
        return new Workspace(context);
    }

    private context: WorkspaceContext;

    constructor(context: WorkspaceContext) {
        this.context = context;
    }

    public getContext(): WorkspaceContext {
        return this.context;
    }
}
