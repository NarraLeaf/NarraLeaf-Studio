import { IUuidService, WorkspaceContext } from "../services";
import { Service } from "../Service";

export class UuidService extends Service<UuidService> implements IUuidService {
    protected async init(_ctx: WorkspaceContext, _depend: (services: Service[]) => Promise<void>): Promise<void> { }

    public generate(compact: boolean = false): string {
        const value = crypto.randomUUID();
        return compact ? value.replace(/-/g, "") : value;
    }
}
