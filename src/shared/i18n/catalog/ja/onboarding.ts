import type { LocaleNamespace } from "../types";

/**
 * `onboarding` 日本語。初回起動のセットアップで、ランチャーのホーム画面より先に出る。
 *
 * テーマとアクセントの名前は `settings` 名前空間から読む。同じ設定に二通りの訳を置くと、
 * セットアップ画面と設定ウィンドウで「システムに合わせる」の言い方が食い違う。
 */
export const onboarding = {
  windowTitle: "{name} へようこそ",
  language: {
    title: "言語",
    expectation: "Studio の画面表示に使う言語。設定でいつでも変更できる",
    matchedToDevice: "この端末の言語と一致"
  },
  appearance: {
    title: "外観",
    expectation: "Studio の画面の見た目。どちらの設定もすぐに反映される"
  },
  done: {
    title: "セットアップ完了",
    expectation:
      "言語と外観は設定にある。どの画面でも F1 を押すと、カーソルの下にあるもののヘルプが開く",
    topics: "ヘルプトピック"
  },
  nav: {
    skip: "セットアップをスキップ",
    finish: "Studio を開く"
  }
} satisfies LocaleNamespace<"onboarding">;
