import type { LocaleNamespace } from "../types";

/**
 * `storyExpr` 日本語。式が解析できない、または解決できないときの理由。
 * コマンドラインと条件エディタで共用する。
 */
export const storyExpr = {
  /**
   * `StoryExpressionIssue["code"]` ごとに 1 文。まとめて「式が不正」と出さないのは、
   * 間違いの種類ごとに直し方が違うから。変数の綴り違いは名前を直す話で、
   * 括弧の閉じ忘れは文字を 1 つ足す話。
   */
  issue: {
    unexpectedToken: 'ここに "{text}" は置けない',
    unexpectedEnd: "式が途中で終わっている",
    unterminatedString: "引用符が閉じていない",
    unbalancedParen: "括弧が閉じていない",
    unknownVariable: '"{name}" という変数がない',
    unknownQualifiedVariable: '{scope} スコープに "{name}" はない',
    unknownScopePrefix: '"{prefix}" はスコープではない。scene、saved、persis のいずれかを使う',
    unknownFunction: '"{name}" という関数はない',
    badArity: "{fn} の引数の数が合わない。{received} 個を渡したが {expected} 個必要",
    unknownVisitedTarget: '{call} に "{name}" というものはない',
    unknownBlueprint: '"{name}" というストーリー値ブループリントはない',
    blueprintTakesNoArguments:
      '"{name}" はブループリントで、ブループリントの呼び出しは引数を取らない',
    ambiguousReference: '"{name}" という名前のものが複数ある。どちらかの名前を変える',
    blueprintShadowsFunction:
      "\"{name}\" は組み込み関数なので、ブループリントの名前にはできない。ブループリントの名前を変えるか、'{name}'() と書いて呼び出す",
    // 助言。この行自体は正しく、確定する。言っているのは、この中身がどのビルドにも入らないこと。
    unknownAppTagName: '"{name}" という名前のビルドバリアントはないので、これは決して真にならない'
  },
  /** 解析の先で *コマンドライン* が追加で見るもの。スロットが特定の形を求める場合。 */
  check: {
    notBoolean: "条件は gold >= 100 のような真偽の判定にする",
    typeMismatch: "これが返すのは {received} だが、変数が持つのは {expected}",
    notConstant: "既定値から別の変数は読めない。既定値はどの変数よりも先に決まる",
    duplicateVariable: "同じ名前の変数がこのスコープにすでにある",
    compoundWithoutTarget: "ここには足し込む先の変数がない"
  },
  /**
   * 行が確定しない理由。入力中の行にそのまま出る。
   *
   * `StoryCommandResolutionIssue["code"]` と解析側のコードにそれぞれ 1 文。以前はすべて
   * 「確定できない」の一言に潰れていて、`/var gold 1` の名前の衝突に気づく手がかりが無かった。
   */
  reason: {
    unknownCommand: "/{token} というコマンドはない",
    unknownParam: '/{token} に "{key}" というオプションはない',
    duplicateParam: '"{key}" が二度指定されている',
    extraPositional: '"{value}" は引数が 1 つ多い',
    badValue: '"{value}" はこのスロットに合わない',
    unterminatedQuote: "引用符が閉じていない",
    unknownAsset: '"{value}" という{assetType}がない',
    unknownCharacter: '"{value}" というキャラクターがいない',
    unknownScene: '"{value}" というシーンがない',
    unknownAudioTrack: '"{value}" というオーディオトラックがない',
    unknownLabel: 'このシーンに "{value}" というラベルはない',
    unknownAppTag: '"{value}" というビルドバリアントはない',
    unknownVariable: '"{value}" という変数がない',
    unknownForm: '{characterName} に "{value}" という表情はない',
    notPuppetCharacter:
      "{value} はランタイムが描くものではないので、設定できるモーションもスキンもない",
    ambiguousName: '"{value}" という名前のものが複数ある。どちらかの名前を変える',
    conflictingParams: "{keys} を 1 行に両方は書けない。行を 2 つに分ける",
    repeatTimesAndUntil: "繰り返しは回数か条件のどちらかで、両方は指定できない。片方を消す",
    expressionError: "{message}",
    expressionNotBoolean: "条件は gold >= 100 のような真偽の判定にする",
    // `{variable}` は必ず代入先で、式の側ではない。宣言された型を持つのは `/set` の左辺だけ。
    expressionTypeMismatch: '"{variable}" が持つのは {expected} なので、{received} は入れられない',
    duplicateVariable: '"{value}" はすでにある。別の名前にするか、/set で値を変える',
    reservedVariableName: '"{value}" は式の中でビルドバリアントを指す。別の名前にする',
    unknownTarget: '"{value}" という名前のものは舞台に出ていない',
    unsupportedOption: '"{value}" はここでは使えない。使える値は {allowed}',
    missingCore: "/{token} にはまだ{slot}が要る"
  }
} satisfies LocaleNamespace<"storyExpr">;
