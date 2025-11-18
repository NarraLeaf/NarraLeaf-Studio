import { ProjectNameConvention } from "../../project/nameConvention";
import { FileSystemService } from "../core/FileSystem";
import { Services, WorkspaceContext } from "../services";

export abstract class AssetServiceBase {
    constructor(private ctx: WorkspaceContext) { }

    protected getAssetPath(assetId: string): string {
        return this.ctx.project.resolve(ProjectNameConvention.AssetsDataShard(assetId));
    }

    protected getContext(): WorkspaceContext {
        return this.ctx;
    }

    protected getFileSystemService(): FileSystemService {
        return this.ctx.services.get<FileSystemService>(Services.FileSystem);
    }
}
