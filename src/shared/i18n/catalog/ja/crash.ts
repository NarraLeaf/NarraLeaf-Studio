/**
 * `crash` - 何かが既に壊れたあとに Studio が出す文言。ウィンドウが自身の画面の代わりに描くもの、
 * および、ページプロセスの終了、ウィンドウの無応答、メインプロセス自身の続行不能に対して
 * メインプロセスが出す 3 つのネイティブダイアログ。
 */
import type { LocaleNamespace } from "../types";

export const crash = {
    screen: {
        title: "このウィンドウは動作を停止した",
        detail: "他の Studio ウィンドウには影響しない。再読み込みすると、ディスク上のファイルからこのウィンドウを作り直す",
        reload: "ウィンドウを再読み込み",
        close: "ウィンドウを閉じる",
        showStackTrace: "スタックトレースを表示",
        copyDetails: "詳細をコピー",
        copied: "エラーの詳細をクリップボードにコピーした",
        copyFailed: "コピーできなかった：{error}",
        exportLogs: "ログを書き出す",
        exported: "ログを {path} に保存した",
        exportFailed: "ログを書き出せなかった：{error}",
        saved: "未保存の変更をディスクに書き込んだ",
        saveFailed: "未保存の変更をディスクに書き込めなかった",
    },
    rendererGone: {
        title: "ウィンドウが動作を停止した",
        message: "NarraLeaf Studio のウィンドウが動作を停止した",
        messageProject: "{project} のウィンドウが動作を停止した",
        detail: "原因：{reason}。ディスクに書き込まれていない変更は失われた",
        detailRepeated: "原因：{reason}。このウィンドウは繰り返し停止しているため、これ以上再読み込みしない",
        reload: "再読み込み",
        close: "ウィンドウを閉じる",
    },
    unresponsive: {
        title: "ウィンドウが応答しない",
        message: "NarraLeaf Studio のウィンドウが応答していない",
        messageProject: "{project} のウィンドウが応答していない",
        detail: "再読み込みすると、ディスクに書き込まれていない変更は破棄される",
        wait: "待機を続ける",
        reload: "再読み込み",
    },
    fatal: {
        title: "NarraLeaf Studio を終了する必要がある",
        message: "NarraLeaf Studio が続行できないエラーに遭遇した",
        detail: "レポートは {path} にある",
        restart: "再起動",
        quit: "終了",
    },
} satisfies LocaleNamespace<"crash">;
