import type { LocaleNamespace } from "../types";

/**
 * `storyVars` 日本語。
 *
 * 見出しはこのパネルの持ち分をそのまま表す。プロジェクトの 2 つのスコープはプロジェクト側で
 * 定義され、このパネルが書き換える。シーンスコープはストーリー側の宣言で、ここには写るだけ。
 * `persistent` はキー名を保つが、表示は「グローバル」にする。ストーリーの `/global` 行と
 * そのバッジがすでにそう呼んでいる。
 */
export const storyVars = {
  valueType: {
    boolean: "真偽値",
    number: "数値",
    string: "文字列",
    json: "JSON"
  },
  row: {
    nameAria: "変数名",
    defaultPlaceholder: "既定値",
    defaultAria: "既定値",
    delete: "変数を削除"
  },
  scene: {
    title: "シーン変数",
    hint: "ストーリーの /local で宣言する。行をクリックするとその宣言へ移動する"
  },
  saved: {
    title: "セーブ変数",
    hint: "プロジェクトで定義し、値はセーブファイルに入る"
  },
  persistent: {
    title: "グローバル変数",
    hint: "プロジェクトで定義し、アプリ全体で有効。ブループリントと共有される"
  }
} satisfies LocaleNamespace<"storyVars">;
