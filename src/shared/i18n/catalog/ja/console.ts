import type { LocaleNamespace } from "../types";

export const console = {
  level: {
    error: "エラー",
    warning: "警告",
    success: "成功",
    info: "情報",
    verbose: "詳細"
  },
  channelsAria: "コンソールのチャンネル",
  filterLevels: "レベルで絞り込む",
  export: "ログを書き出す",
  exportEmpty: "書き出せる{label}のログがない",
  exportChoosingFolder: "{label}のログを書き出すフォルダを選ぶ…",
  exportSuccess: "{label}のログを {path} に書き出した",
  exportFailed: "ログを書き出せなかった：{error}",
  emptyFiltered: "現在の絞り込みに一致する行がない",
  entryEmpty: "（空）",
  outputFallback: "出力",
  channels: {
    blueprint: "ブループリント",
    build: "ビルド",
    story: "ストーリー",
    storage: "ストレージ",
    blueprintDescription: "ブループリントの実行とグラフの診断",
    buildDescription: "ビルド、パッケージ化、プレビューの処理が出す内容",
    storyDescription: "ストーリーシーンのプレビューの診断と警告",
    storageDescription: "プロジェクトファイルの書き込み：保存の失敗、再試行、復旧"
  }
} satisfies LocaleNamespace<"console">;
