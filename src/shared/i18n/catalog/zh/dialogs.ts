import type { LocaleNamespace } from "../types";

export const dialogs = {
    window: {
        minimize: "最小化",
        maximize: "最大化",
        restore: "还原",
        appIcon: "应用图标",
    },
    modal: {
        close: "关闭对话框",
        confirmTitle: "确认操作",
        alertTitle: "提示",
    },
    select: {
        placeholder: "请选择…",
        searchPlaceholder: "搜索或选择…",
    },
    input: {
        required: "此项为必填",
        maxLength: "最多允许 {max} 个字符",
        editValue: "编辑值",
    },
    // Imperative InputDialog service (non-hook; uses translate()).
    createGroup: {
        title: "创建分组",
        prompt: "请输入{type}分组的名称",
        placeholder: "输入分组名称…",
        empty: "分组名称不能为空",
    },
    rename: {
        title: "重命名{type}",
        prompt: "请输入新的{type}名称",
        placeholder: "输入新名称…",
        empty: "{type}名称不能为空",
        sameName: "新名称不能与当前名称相同",
    },
    password: {
        placeholder: "输入密码…",
    },
    email: {
        placeholder: "输入邮箱地址…",
        invalid: "请输入有效的邮箱地址",
    },
    service: {
        alertTitle: "提示",
        selectTitle: "选择一项",
        inputTitle: "输入",
    },
    noun: {
        item: "项目",
        layer: "图层",
        character: "角色",
        group: "分组",
        story: "故事",
        scene: "场景",
        component: "组件",
        asset: "资源",
        image: "图片",
        audio: "音频",
        video: "视频",
        json: "JSON",
        blueprint: "蓝图",
        font: "字体",
        other: "其他",
    },
} satisfies LocaleNamespace<"dialogs">;
