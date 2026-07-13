import type { LocaleNamespace } from "../types";

export const storyVars = {
    empty: "打开一个故事场景以管理它的变量。",
    valueType: {
        boolean: "布尔值",
        number: "数字",
        string: "字符串",
        json: "JSON",
    },
    row: {
        nameAria: "变量名",
        defaultPlaceholder: "默认值",
        defaultAria: "默认值",
        delete: "删除变量",
    },
    scene: {
        title: "场景变量",
        hint: "按场景保存，写入存档文件。",
        empty: "还没有场景变量。",
    },
    saved: {
        title: "存档变量",
        hint: "按存档保存，必须可序列化。",
        empty: "还没有存档变量。",
    },
    persistent: {
        title: "持久变量",
        hint: "应用级，与蓝图共享。",
        empty: "还没有持久变量。请在蓝图编辑器中添加。",
    },
} satisfies LocaleNamespace<"storyVars">;
