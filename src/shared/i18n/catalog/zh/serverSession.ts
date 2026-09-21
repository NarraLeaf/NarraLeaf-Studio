import type { LocaleNamespace } from "../types";

export const serverSession = {
    window: "服务器登录",
    title: "在该项目中使用此登录",
    signedInAs: "已登录为 {name}",
    // 作者作答之前的状态，一句话。
    unused: "该项目尚未使用过此登录。",
    // 同意的结果，按作者会看到的样子写。
    meaning: "使用后，该项目以 {name} 的身份上传和获取版本。",
    later: "可在该项目的 NarraLeaf Team 中更改。",
    confirm: "使用",
    cancel: "不使用",
    error: {
        load: "无法读取登录信息。",
    },
} satisfies LocaleNamespace<"serverSession">;
