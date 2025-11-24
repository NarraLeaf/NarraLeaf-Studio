import { Service } from "../Service";
import { Services, WorkspaceContext } from "../services";
import { FileSystemService } from "./FileSystem";

export class CharacterService extends Service<CharacterService> implements CharacterService {
    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        await depend([filesystemService]);
    }
}
