import path from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { BuiltinWidgetDeclarations } from "./builtin/declarations";
import { BuiltinWidgetModules } from "./builtin";
import { widgetDefaultWordsFor } from "./defaultWords";

describe("widget declaration entry", () => {
    it("is the declaration and insertion factory each editor implementation uses", () => {
        expect(BuiltinWidgetModules.map(module => module.type)).toEqual(BuiltinWidgetDeclarations.map(module => module.type));
        for (const declaration of BuiltinWidgetDeclarations) {
            const module = BuiltinWidgetModules.find(candidate => candidate.type === declaration.type)!;
            expect(module.createDefaultElement).toBe(declaration.createDefaultElement);
            expect(module.createDefaultChildElements).toBe(declaration.createDefaultChildElements);
            expect(module.logicApi).toBe(declaration.logicApi);
            for (const locale of ["en", "zh", "ja"]) {
                const words = widgetDefaultWordsFor(locale);
                expect(module.createDefaultElement(words)).toEqual(declaration.createDefaultElement(words));
            }
        }
    });

    it("bundles without workspace, drawing, inspector or agent implementations", async () => {
        const root = path.resolve(__dirname, "../../../../..");
        const result = await build({
            entryPoints: [path.join(__dirname, "builtin/declarations.ts")],
            bundle: true,
            write: false,
            metafile: true,
            platform: "browser",
            alias: { "@": path.join(root, "src/renderer"), "@shared": path.join(root, "src/shared") },
            logLevel: "silent",
        });
        const forbidden = Object.keys(result.metafile!.inputs).filter(file =>
            /apps\/workspace|workspace\/services|\/renderer\.tsx?$|\/inspector\.tsx?$|\/dockerBar\.tsx?$|monaco|onnxruntime/.test(file),
        );
        expect(forbidden).toEqual([]);
    });
});
