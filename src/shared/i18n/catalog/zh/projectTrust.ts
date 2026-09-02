import type { LocaleNamespace } from "../types";

export const projectTrust = {
    window: "项目信任",
    title: "信任该项目",
    // 受信任之前的状态，一句话：还能做什么，不能做什么。
    untrusted: "该项目并非由 Studio 创建。受信任前可以编辑，但不能运行、预览、构建或测试。",
    // 一句话说清代价，不作弱化。
    meaning: "信任后，该项目自带的代码将在本机运行。",
    later: "可在设置的「受信任的项目」中更改。",
    confirm: "信任",
    cancel: "暂不",
    error: {
        load: "无法读取该项目的信息。",
    },
} satisfies LocaleNamespace<"projectTrust">;
