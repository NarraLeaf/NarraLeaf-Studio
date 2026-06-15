import { FsRejectErrorCode, FsRequestResult } from "@shared/types/os";
import { RendererError } from "@shared/utils/error";
import { ProjectNameConvention } from "../../project/nameConvention";
import { Service } from "../Service";
import { FileSystemService } from "./FileSystem";
import { IServiceAssetsService, Services, WorkspaceContext } from "../services";
import { UuidService } from "./UuidService";

export class ServiceAssetsService extends Service<ServiceAssetsService> implements IServiceAssetsService {
    private static readonly AssetFileIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    private assetsDir = "";
    private servicesDir = "";

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const uuidService = ctx.services.get<UuidService>(Services.Uuid);
        await depend([filesystemService, uuidService]);

        this.assetsDir = ctx.project.resolve(ProjectNameConvention.EditorAssets);
        this.servicesDir = ctx.project.resolve(ProjectNameConvention.EditorServices);
        await Promise.all([this.ensureAssetsDir(), this.ensureServicesDir()]);
    }

    public async writeStore<T extends Record<string, any>>(namespace: string, data: T): Promise<FsRequestResult<{ path: string }>> {
        this.ensureReady();
        const filesystemService = this.getFileSystem();
        const dirResult = await filesystemService.createDir(this.servicesDir);
        if (!dirResult.ok) {
            return dirResult;
        }

        const targetPath = this.resolveStoreFile(namespace);
        const writeResult = await filesystemService.write(targetPath, JSON.stringify(data), "utf-8");
        if (!writeResult.ok) {
            return writeResult;
        }

        return { ok: true, data: { path: targetPath } };
    }

    public async readStore<T extends Record<string, any>>(namespace: string): Promise<FsRequestResult<T>> {
        this.ensureReady();
        const targetPath = this.resolveStoreFile(namespace);
        return this.getFileSystem().readJSON<T>(targetPath);
    }

    public async writeFile(data: string | Buffer | Uint8Array): Promise<FsRequestResult<string>> {
        this.ensureReady();
        const bytes: Uint8Array =
            typeof data === "string"
                ? new TextEncoder().encode(data)
                : data instanceof Uint8Array
                  ? data
                  : new Uint8Array(data);
        const fileId = this.getUuidService().generate();
        const targetPath = this.resolveAssetFile(fileId);
        if (!targetPath.ok) {
            return targetPath;
        }

        const ensureDir = await this.ensureAssetsDir();
        if (!ensureDir.ok) {
            return ensureDir;
        }

        const writeResult = await this.getFileSystem().writeRaw(targetPath.data, bytes);
        if (!writeResult.ok) {
            return writeResult;
        }

        return { ok: true, data: fileId };
    }

    public async readFile(fileId: string, encoding: BufferEncoding = "utf-8"): Promise<FsRequestResult<string>> {
        this.ensureReady();
        const targetPath = this.resolveAssetFile(fileId);
        if (!targetPath.ok) {
            return targetPath;
        }
        return this.getFileSystem().read(targetPath.data, encoding);
    }

    public async readRaw(fileId: string): Promise<FsRequestResult<Uint8Array>> {
        this.ensureReady();
        const targetPath = this.resolveAssetFile(fileId);
        if (!targetPath.ok) {
            return targetPath;
        }
        return this.getFileSystem().readRaw(targetPath.data);
    }

    public async deleteFile(fileId: string): Promise<FsRequestResult<void>> {
        this.ensureReady();
        const targetPath = this.resolveAssetFile(fileId);
        if (!targetPath.ok) {
            return targetPath;
        }
        return this.getFileSystem().deleteFile(targetPath.data);
    }

    private getFileSystem(): FileSystemService {
        return this.getContext().services.get<FileSystemService>(Services.FileSystem);
    }

    private getUuidService(): UuidService {
        return this.getContext().services.get<UuidService>(Services.Uuid);
    }

    private ensureReady(): void {
        if (!this.assetsDir || !this.servicesDir) {
            throw new RendererError("Service assets directories not initialized");
        }
    }

    private resolveStoreFile(name: string): string {
        return this.getContext().project.resolve(ProjectNameConvention.EditorServices, `${name}.json`);
    }

    private resolveAssetFile(fileName: string): FsRequestResult<string> {
        if (!ServiceAssetsService.AssetFileIdPattern.test(fileName)) {
            return {
                ok: false,
                error: {
                    code: FsRejectErrorCode.INVALID_PATH,
                    message: "Invalid service asset file id",
                },
            };
        }

        return { ok: true, data: this.getContext().project.resolve(ProjectNameConvention.EditorAssets, fileName) };
    }

    private async ensureAssetsDir(): Promise<FsRequestResult<void>> {
        return this.ensureDir(this.assetsDir, "assets");
    }

    private async ensureServicesDir(): Promise<FsRequestResult<void>> {
        return this.ensureDir(this.servicesDir, "services");
    }

    private async ensureDir(dir: string, label: string): Promise<FsRequestResult<void>> {
        if (!dir) {
            return {
                ok: false,
                error: {
                    code: FsRejectErrorCode.INVALID_PATH,
                    message: `Service ${label} directory is empty`,
                },
            };
        }

        const filesystemService = this.getFileSystem();
        const exists = await filesystemService.isDirExists(dir);
        if (!exists.ok) {
            return exists;
        }

        if (exists.data) {
            return { ok: true, data: undefined };
        }

        return filesystemService.createDir(dir);
    }
}


