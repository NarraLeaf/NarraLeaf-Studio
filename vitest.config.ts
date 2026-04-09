import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
        environment: "node",
        passWithNoTests: true,
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "src/renderer"),
            "@shared": path.resolve(__dirname, "src/shared"),
        },
    },
});
