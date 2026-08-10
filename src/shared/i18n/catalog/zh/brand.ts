import type { LocaleNamespace } from "../types";

export const brand = {
    presetName: {
        primary: "主色",
        secondary: "辅色",
        background: "背景色",
        foreground: "前景色",

        "button-primary": "按钮填充",
        "button-secondary": "按钮悬停填充",
        "button-border": "按钮边框",
        "button-text": "按钮文字",
        "button-shadow": "按钮阴影",

        "container-background": "容器背景",
        "container-border": "容器边框",
        "container-shadow": "容器阴影",

        "text-primary": "文字",
        "text-muted": "次要文字",

        "textInput-background": "文本输入框背景",
        "textInput-border": "文本输入框边框",
        "textInput-text": "文本输入框文字",
    },

    picker: {
        section: "工程配色",
    },

    group: {
        button: "按钮",
        container: "容器",
        text: "文字",
        textInput: "文本输入框",
    },

    panel: {
        add: "新建颜色",
        newColorName: "新建颜色",
        nameLabel: "名称",
        editColor: "编辑{name}",
        deleteColor: "删除{name}",
        delete: "删除",
        deleteConfirm: "删除「{name}」？",
        deleteUnused: "没有地方使用这个颜色",
        // 诚实地说明后果：指向被删颜色的地方不会被改写，解析不到任何值，各自改用自身的兜底颜色；
        // 工程检查会把它们列出来。
        deleteDetail: {
            other: "{count} 处使用它的地方将各自回落到自身的默认颜色",
        },
    },
} satisfies LocaleNamespace<"brand">;
