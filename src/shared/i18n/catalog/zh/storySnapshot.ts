import type { LocaleNamespace } from "../types";

/** `storySnapshot` - 场景快照（变量快照）侧边栏。 */
export const storySnapshot = {
    empty: "打开一个故事场景以管理其快照",
    defaults: "默认值",
    defaultsDetail: "每个变量从为它声明的值开始",
    noVariables: "此场景没有可用变量",
    add: "添加快照",
    delete: "删除快照",
    defaultName: "快照",
    nameAria: "快照名称",
    value: {
        true: "真",
        false: "假",
    },
} satisfies LocaleNamespace<"storySnapshot">;
