// @vitest-environment jsdom
/**
 * The model import wizard as a host that already knows the kind opens it - the character editor,
 * whose runtime says which models it draws: straight onto the folder picker, and a folder holding one
 * model has it ticked, so the clean path costs one confirming click.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelImportWizard } from "./ModelImportWizard";

const env = vi.hoisted(() => ({
    /** What the folder picker answers. */
    picked: ["D:/models/Hiyori"] as string[],
    /** The picked folder's files, relative path to contents. */
    tree: {} as Record<string, string>,
    selectDirectory: undefined as unknown as ReturnType<typeof import("vitest").vi.fn>,
}));

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key, tn: (key: string, count: number) => `${key}:${count}`, locale: "en" }),
}));

vi.mock("@/lib/app/bridge", async () => {
    const { vi: hoistedVi } = await import("vitest");
    env.selectDirectory = hoistedVi.fn(async () => ({ success: true, data: { ok: true, data: env.picked } }));
    return { getInterface: () => ({ fs: { selectDirectory: env.selectDirectory } }) };
});

vi.mock("@/apps/workspace/context", () => {
    const root = "D:/models/Hiyori";
    const filesystem = {
        directorySize: async (directory: string) => directory === root
            ? { ok: true, data: { bytesByRelativePath: Object.fromEntries(Object.entries(env.tree).map(([path, text]) => [path, text.length])) } }
            : { ok: false },
        read: async (path: string) => {
            const relative = path.replace(/\\/g, "/").slice(root.length + 1);
            return relative in env.tree ? { ok: true, data: env.tree[relative] } : { ok: false };
        },
    };
    const context = { services: { get: () => filesystem } };
    return { useWorkspace: () => ({ context }) };
});

afterEach(() => {
    cleanup();
    env.selectDirectory.mockClear();
});

const MANIFEST = JSON.stringify({
    Version: 3,
    FileReferences: { Moc: "Hiyori.moc3", Textures: ["Hiyori.2048/texture_00.png"] },
});

async function open(props: Partial<React.ComponentProps<typeof ModelImportWizard>> = {}): Promise<void> {
    await act(async () => {
        render(<ModelImportWizard visible onClose={() => undefined} onImport={() => undefined} {...props} />);
    });
    // The scan reads asynchronously; let it settle.
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
    });
}

const checkbox = () => screen.getByRole("checkbox") as HTMLInputElement;

describe("the model import wizard opened for a known kind", () => {
    it("goes straight to the folder picker", async () => {
        env.tree = { "Hiyori.model3.json": MANIFEST, "Hiyori.moc3": "moc", "Hiyori.2048/texture_00.png": "png" };
        await open({ family: "live2d", tickLoneModel: true });

        expect(env.selectDirectory).toHaveBeenCalledTimes(1);
        expect(screen.queryByText("assets.modelImport.familyStep")).toBeNull();
        expect(checkbox().checked).toBe(true);
        expect(screen.getByRole("button", { name: "assets.modelImport.importCount:1" })).not.toBeNull();
    });

    it("ticks a lone model that the scan found a problem with, and still lists the problem", async () => {
        // The texture is missing: a blocking problem, which leaves a row unticked anywhere else.
        env.tree = { "Hiyori.model3.json": MANIFEST, "Hiyori.moc3": "moc" };
        await open({ family: "live2d", tickLoneModel: true });

        expect(checkbox().checked).toBe(true);
        expect(screen.getByText("assets.modelImport.problem.missing")).not.toBeNull();
    });

    it("leaves that row unticked where nobody asked for a lone model", async () => {
        env.tree = { "Hiyori.model3.json": MANIFEST, "Hiyori.moc3": "moc" };
        await open({ family: "live2d" });

        expect(checkbox().checked).toBe(false);
    });

    it("opens on the kind step without one", async () => {
        await open();

        expect(env.selectDirectory).not.toHaveBeenCalled();
        expect(screen.getByText("assets.modelImport.familyStep")).not.toBeNull();
    });
});
