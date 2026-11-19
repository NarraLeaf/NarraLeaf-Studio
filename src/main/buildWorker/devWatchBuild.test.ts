import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { BuildContext, BuildOptions } from "esbuild";

const require_ = createRequire(__filename);
const { watchBuild } = require_(path.resolve(__dirname, "../../../project/build/watch.js")) as {
    watchBuild(options: BuildOptions, onSuccess: () => void): Promise<BuildContext>;
};

function buildOptions(shouldFail: () => boolean): BuildOptions {
    return {
        stdin: { contents: "export const value = 1", loader: "js" },
        bundle: true,
        write: false,
        logLevel: "silent",
        plugins: [{
            name: "controlled-build-failure",
            setup(build) {
                build.onStart(() => shouldFail() ? { errors: [{ text: "build failed" }] } : undefined);
            },
        }],
    };
}

describe("development build watcher", () => {
    it("rejects an unsuccessful initial build without announcing success", async () => {
        const onSuccess = vi.fn();
        let context: BuildContext | undefined;
        let failure: unknown;
        try {
            context = await watchBuild(buildOptions(() => true), onSuccess);
        } catch (error) {
            failure = error;
        }
        try {
            expect(failure).toBeInstanceOf(Error);
            expect(onSuccess).not.toHaveBeenCalled();
        } finally {
            await context?.dispose();
        }
    });

    it("announces only successful rebuilds", async () => {
        const onSuccess = vi.fn();
        let fails = false;
        const context = await watchBuild(buildOptions(() => fails), onSuccess);
        try {
            expect(onSuccess).toHaveBeenCalledTimes(1);
            fails = true;
            await expect(context.rebuild()).rejects.toThrow();
            expect(onSuccess).toHaveBeenCalledTimes(1);
            fails = false;
            await context.rebuild();
            expect(onSuccess).toHaveBeenCalledTimes(2);
        } finally {
            await context.dispose();
        }
    });
});
