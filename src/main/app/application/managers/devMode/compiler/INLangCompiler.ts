export type NLangCompileResult = {
    ok: boolean;
    errors?: string[];
    artifacts?: Record<string, unknown>;
    diagnostics?: Record<string, unknown>;
};

export type NLangCompileContext = {
    projectPath: string;
};

export interface INLangCompiler {
    compile(context: NLangCompileContext): Promise<NLangCompileResult>;
}

export class NullNLangCompiler implements INLangCompiler {
    async compile(): Promise<NLangCompileResult> {
        return { ok: true };
    }
}
