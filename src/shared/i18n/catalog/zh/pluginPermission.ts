import type { LocaleNamespace } from "../types";

export const pluginPermission = {
    title: "插件权限",
    window: {
        launcher: "启动器",
        settings: "设置",
        workspace: "工作区",
        projectWizard: "项目向导",
        devMode: "开发模式",
        pluginPermission: "插件权限",
        studio: "Studio",
    },
    install: {
        type: "插件安装请求",
        title: "{requester} 请求安装 {plugin}",
        body1: "Studio 为本次安装识别出以下特权控制：",
        body2: "同意安装即表示授予该插件版本所列出的权限，请仅安装您信任的插件",
        source: "来源：{source}",
    },
    filesystem: {
        type: "文件系统权限请求",
        title: "{plugin} 请求文件访问",
        body1: "该插件在您批准后将能够使用所申请的文件系统权限",
        bodyPermanent: "选择“仅允许一次”只会在当前 Studio 会话内授予该权限",
        bodySession: "本次请求仅在当前 Studio 会话内有效",
        permissionRecursive: "{mode}（{path} 及其子路径）",
        permissionSingle: "{mode}（{path}）",
    },
    api: {
        type: "插件 API 权限请求",
        title: "{plugin} 请求 {capability}",
        body1: "批准后，该插件将能够调用所请求的 Studio API",
        body2: "仅当该插件确实需要此权限以执行您所发起的操作时，才应予以批准",
    },
    trust: {
        type: "插件信任请求",
        title: "{requester} 请求信任 {plugin}",
        body1: "可信插件可由 Studio 自动启用，无需重复初始信任提示",
        body2: "请仅信任来自你所认识来源的插件",
        permission: "信任此插件身份",
    },
    generic: {
        type: "插件权限请求",
        title: "{plugin} 请求一项 Studio 权限",
        body: "允许前请先审查该请求",
    },
    mode: {
        read: "读取访问",
        write: "写入访问",
        readwrite: "读写访问",
    },
    button: {
        dontAllow: "不允许",
        deny: "拒绝",
        allowOnce: "仅允许一次",
        allow: "允许",
        alwaysAllow: "始终允许",
        granting: "授权中…",
    },
    error: {
        load: "无法加载权限请求",
        grant: "无法授予权限",
    },
} satisfies LocaleNamespace<"pluginPermission">;
