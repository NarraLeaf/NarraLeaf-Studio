import type { LocaleNamespace } from "../types";

export const storyVars = {
    valueType: {
        boolean: "布尔值",
        number: "数字",
        string: "字符串",
        json: "JSON",
    },
    value: {
        true: "真",
        false: "假",
    },
    row: {
        nameAria: "变量名",
        defaultPlaceholder: "默认值",
        defaultAria: "默认值",
        delete: "删除变量",
        deleteInSession: "本次实时会话中不可用，离开会话后可以删除该变量",
    },
    live: {
        entryClaimed: "{name} 正在编辑该变量",
    },
    scene: {
        title: "场景变量",
        hint: "在故事中使用 /local 声明，点击行可跳到声明处",
    },
    saved: {
        title: "存档变量",
        hint: "在项目里定义，值保存在存档文件中",
    },
    // 跨存档保留的项目变量在面板、蓝图、帮助与开发模式里都叫「持久变量」；「全局变量」留给应用逻辑蓝图
    // 自己的变量，两者不能共用一个名字。键名保持 persistent 不动
    persistent: {
        title: "持久变量",
        hint: "在项目中定义，应用级，与蓝图共享",
    },
} satisfies LocaleNamespace<"storyVars">;
