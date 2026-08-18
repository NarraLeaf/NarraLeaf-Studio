import type { LocaleNamespace } from "../types";

export const plugins = {
  installLocal: "从文件夹安装",
  search: {
    placeholder: "搜索插件",
    clear: "清除搜索"
  },
  tab: {
    installed: "已安装",
    store: "商店"
  },
  emptyList: "尚未安装插件",
  emptyFiltered: "没有匹配“{query}”的插件",
  authorize: "授权",
  uninstall: "卸载",
  builtIn: "内置",
  permissions: "权限",
  noPermissions: "无特殊权限",
  updateAvailable: "有可用更新",
  requiresStudio: "此插件需要 Studio {range}，当前版本为 {version}",
  openReleasePage: "查看发行说明",
  homepage: "主页",
  moreActions: "更多操作",
  moreActionsNamed: "{name} 的更多操作",
  field: {
    status: "状态",
    version: "版本",
    publisher: "发布者",
    entries: "入口",
    categories: "分类",
    installed: "安装时间",
    updated: "更新时间"
  },
  status: {
    enabled: "已启用",
    disabled: "已禁用",
    needsAuthorization: "待授权"
  },
  store: {
    install: "安装",
    installed: "已安装",
    update: "更新",
    needsStudio: "需要 Studio {range}",
    emptyList: "注册表中暂无可用插件",
    offline: "无法连接到插件注册表",
    retry: "重试"
  },
  task: {
    installing: "正在安装插件…",
    downloading: "正在下载插件…",
    installed: "插件已安装",
    authorizing: "等待授权…",
    authorized: "插件已授权",
    enabling: "正在启用插件…",
    disabling: "正在禁用插件…",
    enabled: "插件已启用",
    disabled: "插件已禁用",
    uninstalling: "正在卸载插件…",
    uninstalled: "插件已卸载",
    reloading: "正在重新载入插件…",
    reloaded: "插件已重新载入"
  },
  error: {
    load: "加载插件失败",
    install: "安装插件失败",
    approve: "授权插件失败",
    update: "更新插件失败",
    uninstall: "卸载插件失败",
    registry: "无法连接到插件注册表",
    download: "下载插件失败"
  },
  workspace: {
    reload: "在此工作区重新载入",
    activity: {
      running: "正在此处运行",
      stopped: "未在此处运行",
      runtimeOnly: "仅游戏运行时",
      runtimeOnlyHint: "该插件只扩展运行中的游戏，在编辑器中没有可执行的部分",
      suppressed: "已为本项目停用",
      suppressedHint:
        "已安装的版本与本项目当初依赖的版本不兼容；请更新插件，或在「项目 → 依赖」中重新扫描依赖表",
      failed: "载入失败"
    },
    suppressedNotice:
      "本项目未载入这些插件：{names}；已安装的版本与项目当初依赖的版本不兼容，详见「插件」面板",
    pendingReopen: "下次打开本项目时生效",
    restartHint: "部分插件修改可能需要重启工作区才能生效",
    restart: "重启",
    restarting: "正在保存改动并重启…",
    recoveryNotice: "恢复模式不载入任何插件；此处的更改会在下次正常打开项目时生效",
    openPanel: "打开插件面板",
    error: {
      activate: "无法在此工作区启动 {name}",
      deactivate: "无法在此工作区停止 {name}",
      loadFailed: "{name} 载入失败",
      hostFailed: "无法载入插件"
    }
  }
} satisfies LocaleNamespace<"plugins">;
