import type { LocaleNamespace } from "../types";

export const properties = {
  saving: "保存している…",
  preview: "プレビュー",
  select: "選択",
  panel: {
    title: "プロパティ",
    empty: "プロパティを変えるには要素を選ぶ",
    motionKeyframe: "モーションのキーフレーム",
    storyMotion: "ストーリーモーション",
    scene: "シーン",
    component: "コンポーネント",
    character: "キャラクター"
  },
  scene: {
    title: "インターフェースのプロパティ",
    interface: "インターフェース",
    type: "種類",
    slot: "スロット",
    typeGameUi: "ゲーム UI",
    typePage: "ページ",
    backgroundColor: "背景色",
    backgroundImage: "背景画像",
    animation: "アニメーション",
    logic: "ロジック"
  },
  diagnostics: {
    title: "静的な検査",
    selectOnCanvas: "→ キャンバスで選択",
    help: "グラフや結びつけの問題はブループリントエディタで見る。実行の追跡が出るのは開発モードだけ"
  },
  layout: {
    title: "レイアウト",
    size: "大きさ",
    position: "位置",
    rotation: "回転",
    appearance: "外観",
    width: "幅",
    height: "高さ",
    lockAspect: "縦横比を固定",
    unlockAspect: "縦横比の固定を解除",
    resetRotation: "回転をリセット",
    toggleVisibility: "表示を切り替え",
    animation: "アニメーション",
    uiElement: "UI 要素",
    linkedComponent: "リンクされたコンポーネント"
  },
  linkedComponent: {
    missing: "コンポーネントが見つからない",
    info: "リンクされたインスタンス。リンクを外すまで、変えられるのはパラメータと位置、大きさ、回転だけ"
  },
  componentParams: {
    title: "パラメータ",
    none: "パラメータがない",
    add: "パラメータを追加",
    remove: "パラメータを削除",
    namePlaceholder: "名前",
    defaultPlaceholder: "初期値"
  },
  binding: {
    notReady: "このコントロールのブループリントがまだ用意できていない",
    bindToField: "フィールドに結びつける…",
    bindProperty: "プロパティを結びつける",
    closePicker: "結びつけの選択を閉じる",
    searchFields: "フィールドを検索…",
    noMatches: "一致するフィールドがない",
    newField: "新しいフィールド",
    createAndBind: "作って結びつける",
    openField: "フィールドを開く",
    removeBinding: "結びつけを外す",
    removeBroken: "壊れた結びつけを外す",
    fieldLabel: "フィールド",
    fieldMissing: "フィールドがない",
    scopePage: "ページ",
    scopeApp: "アプリ",
    scopeItem: "アイテム",
    scopeKey: "{scope} のキー"
  },
  events: {
    title: "イベント",
    legacy: "旧形式のイベント id が見つかった"
  },
  blueprintEntry: {
    gameUiLogic: "ゲーム UI のロジック",
    pageLogic: "ページのロジック",
    interfaceFallback: "インターフェース",
    title: "{logic} - {name}",
    open: "サーフェスのブループリントを開く",
    noBlueprint: "このサーフェスにブループリントがない",
    brokenBindings: {
      other: "壊れた結びつけが {count} 件"
    }
  },
  color: {
    hue: "色相",
    opacity: "不透明度"
  },
  fontAsset: {
    fallbackName: "フォント",
    none: "フォントなし",
    choose: "フォントを選ぶ",
    loadError:
      "フォントを読み込めなかった（{error}）。アセットが正しくなるまで、プレビューは代替フォントで表示する",
    select: "フォントを選択"
  },
  imageFill: {
    title: "画像の塗り",
    imageSelected: "画像を選択済み",
    noImage: "画像なし",
    close: "画像の塗りのエディタを閉じる",
    modeLabel: "モード",
    selectMode: "モードを選ぶ",
    previewAlt: "塗りのプレビュー",
    selectImage: "画像を選ぶ",
    selectHint: "クリックするとアセットブラウザが開く",
    changeImage: "画像を変える",
    openEditor: "クリックでエディタを開く",
    resolveError:
      "画像アセットを解決できなかった（{error}）。そのアセットが用意されるまで、プレビューは実際と違う",
    selectFillImage: "塗りに使う画像を選択",
    mode: {
      cover: "カバー",
      contain: "収める",
      stretch: "引き伸ばし",
      crop: "切り抜き",
      tile: "タイル"
    }
  },
  menu: {
    open: "メニューを開く"
  },
  palette: {
    base: "基本",
    common: "よく使う色",
    recent: "最近の色",
    custom: "カスタム"
  },
  references: {
    label: "参照",
    building: "プロジェクトを調べている…",
    none: "どこからも参照されていない",
    // 索引が何も見つけられず、かつプロジェクトの一部を読めなかったときに `none` の代わりに出す。
    // ここからは両者が同じに見えるが、手を打ってよいのは片方だけ。
    unknown: "使われているかどうか分からない",
    unknownDetail: "{location} を読めなかった",
    count: {
      other: "参照 {count} 件"
    },
    dormant: "無効",
    dormantHint:
      "ウィジェットには保存されているが描画されない。塗りが色に設定されているため。このアセットを削除するとこの設定も消える",
    kind: {
      story: "ストーリー",
      blueprint: "ブループリント",
      uiElement: "インターフェース",
      character: "キャラクター",
      voice: "ボイス"
    }
  },
  tags: {
    label: "タグ",
    addPlaceholder: "タグを追加…",
    add: "タグを追加",
    remove: "タグを取り除く",
    removeAria: "タグ {tag} を取り除く"
  },
  thumbnail: {
    alt: "サムネイル",
    selectTitle: "サムネイルを選択",
    cropTitle: "サムネイルを切り抜く",
    error: {
      workspaceNotReady: "ワークスペースの準備ができていない",
      selectImage: "画像アセットを選んでください",
      loadAsset: "アセットを読み込めなかった",
      deleteFailed: "サムネイルを削除できなかった",
      saveFailed: "サムネイルを保存できなかった",
      unknown: "原因不明のエラー"
    }
  },
  asset: {
    namePlaceholder: "アセット名",
    descriptionPlaceholder: "説明を入力…",
    info: {
      dimensions: "寸法",
      format: "形式",
      size: "サイズ",
      hash: "ハッシュ",
      duration: "長さ",
      sampleRate: "サンプリング周波数",
      channels: "チャンネル数",
      family: "ファミリー",
      style: "スタイル",
      weight: "太さ",
      schema: "スキーマ",
      mimeType: "MIME タイプ",
      extension: "拡張子",
      frameRate: "フレームレート"
    },
    /**
     * リモートアセットの出どころ。「キャッシュ」「再ダウンロード」ではなく「取得」「更新の確認」。
     * プロジェクトが持っているのはバージョン管理下のスナップショットであってキャッシュではなく、
     * その違いこそが、この種類のアセットがオフラインでもビルドでき、クローンし直しても
     * 生き残る理由。
     */
    remote: {
      url: "取得元",
      fetched: "取得日時",
      neverFetched: "まだダウンロードしていない",
      refresh: "更新を確認",
      refreshFailedTitle: "取得元を確認できなかった"
    },
    image: {
      title: "画像のプロパティ",
      info: "画像の情報"
    },
    audio: {
      title: "音声のプロパティ",
      info: "音声の情報",
      preview: "音声情報",
      channelCount: {
        other: "{count} チャンネル"
      }
    },
    video: {
      title: "動画のプロパティ",
      info: "動画の情報",
      preview: "動画情報"
    },
    font: {
      title: "フォントのプロパティ",
      info: "フォントの情報",
      preview: "フォントのプレビュー",
      sampleText: "サンプルテキスト"
    },
    json: {
      title: "JSON のプロパティ",
      info: "JSON の情報",
      preview: "JSON の構造",
      schemaValue: "スキーマ：{schema}",
      noSchema: "スキーマなし"
    },
    model: {
      title: "モデルのプロパティ",
      info: "モデルの情報",
      entry: "エントリファイル",
      entryAuto: "検出：{entry}",
      entryUnresolvedNone: "エントリファイルを特定できなかった。1 つ選ぶ",
      entryUnresolvedAmbiguous: "エントリの候補が複数ある。1 つ選ぶ",
      files: "ファイル",
      fileCount: {
        other: "{count} ファイル"
      },
      browse: "バンドルの中身"
    },
    other: {
      title: "ファイルのプロパティ",
      info: "ファイルの情報",
      preview: "ファイル情報",
      fileSuffix: "{ext} ファイル",
      unknownType: "不明な種類",
      unknown: "不明"
    }
  }
} satisfies LocaleNamespace<"properties">;
