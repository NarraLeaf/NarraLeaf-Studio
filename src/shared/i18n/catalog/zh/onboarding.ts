import type { LocaleNamespace } from "../types";

/**
 * `onboarding` 简体中文。
 *
 * 只放这条流程自己的词。主题与强调色的名字从 `settings` 读，不在这里重写一遍：它们说的是同两个
 * 偏好，「跟随系统」有两种写法，就是设置流程和设置窗口对同一个选择各说各话的开始。
 */
export const onboarding = {
    language: {
        title: "语言",
        expectation: "Studio 界面使用的语言。之后可以在设置里改。",
        matchedToDevice: "按这台设备的语言选好的",
    },
    appearance: {
        title: "外观",
        expectation: "写作时 Studio 的样子。两项都是选了就生效。",
    },
    done: {
        title: "Studio 已经设置好",
        expectation: "语言和外观都在设置里。在任何地方按 F1，可以读到光标下那样东西的说明。",
    },
    nav: {
        skip: "跳过设置",
        finish: "打开 Studio",
    },
} satisfies LocaleNamespace<"onboarding">;
