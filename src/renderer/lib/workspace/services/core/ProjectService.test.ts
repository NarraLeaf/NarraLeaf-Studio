import { describe, expect, it } from "vitest";
import { encodeProjectConfig } from "@shared/utils/nlproj";
import { ProjectService } from "./ProjectService";
import { Services, type WorkspaceContext } from "../services";
import type { ProjectConfig } from "../../project/project";

const PROJECT_PATH = "D:/projects/demo";

function config(encryptAssets: boolean): ProjectConfig {
    return {
        name: "Demo",
        identifier: "demo",
        metadata: {},
        app: {
            network: { allowHttp: false, allowRemoteResource: false, allowRemoteScript: false },
            security: { encryptAssets },
        },
    } as ProjectConfig;
}

/**
 * A .nlproj on a fake disk, plus the WorkspaceContext the service needs to find
 * it. `write` stands in for any other writer - a second Studio window, the
 * packaging pipeline, a hand edit - none of which the service is told about.
 */
function mount(initial: ProjectConfig) {
    const disk = { bytes: encodeProjectConfig(initial as never) };
    const filesystem = {
        list: async () => ({ ok: true, data: [{ name: "Demo", ext: ".nlproj", type: "file" }] }),
        readRaw: async () => ({ ok: true, data: disk.bytes }),
    };
    const ctx = {
        project: { getConfig: () => ({ projectPath: PROJECT_PATH }) } as unknown as WorkspaceContext["project"],
        services: {
            get: (serviceId: Services) => {
                if (serviceId === Services.FileSystem) {
                    return filesystem;
                }
                throw new Error(`Unexpected service lookup: ${serviceId}`);
            },
        },
    } as WorkspaceContext;

    return {
        ctx,
        write: (next: ProjectConfig) => {
            disk.bytes = encodeProjectConfig(next as never);
        },
    };
}

describe("ProjectService security configuration", () => {
    it("reads the effective policy from the manifest it loaded", async () => {
        const service = new ProjectService();
        const { ctx } = mount(config(true));

        await service.initialize(ctx, async () => undefined);

        expect(service.getSecurityConfiguration().encryptAssets).toBe(true);
    });

    it("picks up a manifest change made outside this window only on reload", async () => {
        const service = new ProjectService();
        const { ctx, write } = mount(config(true));
        await service.initialize(ctx, async () => undefined);

        write(config(false));

        // The cache is deliberately not a file watcher, so the stale read is
        // expected - it is why the build dialog reloads before describing the
        // package it is about to produce.
        expect(service.getSecurityConfiguration().encryptAssets).toBe(true);

        await service.reloadProjectConfig();

        expect(service.getSecurityConfiguration().encryptAssets).toBe(false);
    });
});
