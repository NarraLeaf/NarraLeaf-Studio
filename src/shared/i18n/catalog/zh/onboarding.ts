import type { LocaleNamespace } from "../types";

/**
 * `onboarding` 简体中文。
 *
 * 只放这条流程自己的词。主题与强调色的名字从 `settings` 读，不在这里重写一遍：它们说的是同两个
 * 偏好，「跟随系统」有两种写法，就是设置流程和设置窗口对同一个选择各说各话的开始。
 */
export const onboarding = {
    windowTitle: "欢迎使用 {name}",
    language: {
        title: "语言",
        expectation: "Studio 界面使用的语言，之后可在设置中修改",
        matchedToDevice: "已匹配本机语言",
    },
    appearance: {
        title: "外观",
        expectation: "Studio 界面的外观，两项设置均即时生效",
    },
    done: {
        title: "Studio 设置完成",
        expectation: "语言和外观在设置中调整；在任意位置按 F1 可查看光标所在处的说明",
        topics: "帮助主题",
    },
    nav: {
        skip: "跳过设置",
        finish: "打开 Studio",
    },
} satisfies LocaleNamespace<"onboarding">;
