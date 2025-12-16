import { RendererError } from "@shared/utils/error";
import { Service } from "../Service";
import { ISettingsService, Services, WorkspaceContext } from "../services";
import { RSCategories, RuntimeSettings } from "../settings/settings";
import { RuntimeSettingSchema, RuntimeSettingType, TypeofSettingSchema } from "../settings/types";
import { ServiceAssetsService } from "./ServiceAssetsService";

export class SettingsService extends Service<SettingsService> implements ISettingsService {
    private static readonly Namespace = "runtime_settings";
    private serviceAssetsService: ServiceAssetsService | null = null;
    private readonly schemaIndex = new Map<string, RuntimeSettingSchema<RuntimeSettingType>>();
    private storedValues: Record<string, TypeofSettingSchema<RuntimeSettingType>> = {};
    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const serviceAssetsService = ctx.services.get<ServiceAssetsService>(Services.ServiceAssets);
        await depend([serviceAssetsService]);

        this.serviceAssetsService = serviceAssetsService;
        this.buildSchemaIndex();
        await this.loadStore();
    }

    public getCategories(): RSCategories[] {
        return Object.keys(RuntimeSettings) as RSCategories[];
    }

    public getSettings(category: RSCategories): RuntimeSettingSchema<RuntimeSettingType>[] {
        return RuntimeSettings[category].settings;
    }

    public get(name: string): RuntimeSettingSchema<RuntimeSettingType> | undefined {
        return this.schemaIndex.get(name);
    }

    public getValue<T extends RuntimeSettingType>(name: string): TypeofSettingSchema<T> | undefined {
        const schema = this.get(name) as RuntimeSettingSchema<T> | undefined;
        if (!schema) {
            return undefined;
        }

        if (Object.prototype.hasOwnProperty.call(this.storedValues, name)) {
            return this.storedValues[name] as TypeofSettingSchema<T>;
        }

        return schema.defaultValue;
    }

    public async setValue<T extends RuntimeSettingType>(name: string, value: TypeofSettingSchema<T>): Promise<void> {
        const schema = this.get(name) as RuntimeSettingSchema<T> | undefined;
        if (!schema) {
            throw new RendererError(`Runtime setting "${name}" is not registered`);
        }

        this.validateSettingValue(schema, value);
        const nextValues: Record<string, TypeofSettingSchema<RuntimeSettingType>> = {
            ...this.storedValues,
            [name]: value,
        };

        await this.persistStore(nextValues);
    }

    private buildSchemaIndex(): void {
        this.schemaIndex.clear();
        for (const category of this.getCategories()) {
            for (const setting of this.getSettings(category)) {
                this.schemaIndex.set(setting.name, setting);
            }
        }
    }

    private async loadStore(): Promise<void> {
        const result = await this.getServiceAssetsService().readStore<Record<string, TypeofSettingSchema<RuntimeSettingType>>>(
            SettingsService.Namespace,
        );

        if (!result.ok || !result.data) {
            return;
        }

        this.storedValues = { ...result.data };
    }

    private async persistStore(values: Record<string, TypeofSettingSchema<RuntimeSettingType>>): Promise<void> {
        const result = await this.getServiceAssetsService().writeStore(SettingsService.Namespace, values);
        if (!result.ok) {
            throw new RendererError(result.error?.message ?? "Failed to persist runtime settings");
        }
        this.storedValues = values;
    }

    private validateSettingValue<T extends RuntimeSettingType>(
        schema: RuntimeSettingSchema<T>,
        value: TypeofSettingSchema<T>,
    ): void {
        if (!schema.validation) {
            return;
        }

        const validation = schema.validation(value);
        if (validation === true) {
            return;
        }

        const message = typeof validation === "string"
            ? validation
            : `Invalid value provided for runtime setting "${schema.name}"`;
        throw new RendererError(message);
    }

    private getServiceAssetsService(): ServiceAssetsService {
        if (!this.serviceAssetsService) {
            throw new RendererError("ServiceAssetsService must be initialized before using runtime settings");
        }

        return this.serviceAssetsService;
    }
}
