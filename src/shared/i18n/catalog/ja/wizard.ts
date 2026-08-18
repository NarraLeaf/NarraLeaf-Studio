import type { LocaleNamespace } from "../types";

/**
 * `wizard` 日本語。プロジェクト追加ウィザード。
 *
 * 入口は 1 つで、最初のページで 3 つの流れに分かれる。
 * `origin -> project -> stage -> review` はここに新しいプロジェクトを書き、
 * `origin -> import` は `.nlspkg` から展開し、
 * `origin -> source -> clone` はバージョン管理サーバーから複製する。
 * `steps.*` は 3 つ分すべてのページ名で、見出しではなくレールのラベル。
 * どのページも先頭で自分の名前を繰り返さない。
 *
 * 「作成」ではなく「追加」なのは、3 つのうち 2 つが何も作らず、
 * 誰かが作り終えたプロジェクトを持ち込むだけだから。
 */
export const wizard = {
  appTitle: "プロジェクトを追加",
  steps: {
    origin: "入手元",
    project: "プロジェクト",
    stage: "ステージ",
    review: "確認",
    source: "アドレス",
    clone: "クローン",
    import: "読み込み"
  },
  nav: {
    createProject: "プロジェクトを作成",
    creating: "作成している…",
    cloneProject: "クローンを開始",
    cloning: "クローンしている…",
    importProject: "読み込みを開始",
    importing: "読み込んでいる…"
  },
  error: {
    closeError: "エラーを閉じる"
  },
  fields: {
    appId: "アプリ ID",
    author: "作者",
    location: "場所",
    scriptLocale: "脚本の言語",
    stageSize: "ステージの大きさ",
    version: "バージョン",
    versionControl: "バージョン管理",
    website: "ウェブサイト"
  },
  // 最初のページの左側。プロジェクトがどこから来るか。`next` はテンプレート一覧を持たない
  // 2 つの入手元で右側に出す文で、これによりページが空にならない。
  origin: {
    create: {
      label: "新しいプロジェクト",
      description: "テンプレートから作る"
    },
    import: {
      label: ".nlspkg を読み込む",
      description: "書き出したプロジェクトファイルを展開する",
      next: "次のページで .nlspkg ファイルと展開先を指定する"
    },
    clone: {
      label: "サーバーからクローン",
      description: "バージョン管理サーバー上のプロジェクトを複製する",
      next: "次のページでプロジェクトのアドレスと、手元の複製を置く場所を指定する"
    }
  },
  template: {
    blank: {
      name: "空",
      description: "プロジェクトの骨組みだけ"
    }
  },
  project: {
    name: "プロジェクト名",
    namePlaceholder: "プロジェクト名",
    appIdPlaceholder: "アプリの識別子",
    appIdHelper: "小文字、数字、ハイフンのみ。作成後は変更できない",
    appIdRequired: "アプリ ID は必須",
    appIdInvalid: "アプリ ID に使えるのは小文字、数字、ハイフンだけ",
    locationPlaceholder: "プロジェクトの場所",
    browseLocation: "フォルダを選ぶ",
    validatingDirectory: "フォルダを確認している…",
    directoryWillBeCreated: "このフォルダはプロジェクトと一緒に作られる",
    versionControlLoreHint:
      "プロジェクトフォルダの中にバージョン履歴が作られ、この時点のプロジェクトが最初のバージョンとして記録される",
    versionControlUnavailablePlatform:
      "この端末ではバージョン管理を使えない。バージョン管理なしでプロジェクトを作る",
    versionControlUnavailableInstallation:
      "この Studio ビルドではバージョン管理を使えない。バージョン管理なしでプロジェクトを作る",
    moreDetails: "詳細",
    versionHelper: "これがないとビルドを開始できない",
    authorPlaceholder: "作者のメールアドレス／組織／プロジェクト",
    descriptionPlaceholder: "プロジェクトの説明"
  },
  stage: {
    sizePlaceholder: "ステージの大きさを選ぶ",
    custom: "カスタム…",
    customInvalid: "幅と高さは {min} 以上 {max} 以下の整数にする",
    width: "幅",
    height: "高さ",
    // この選択がもたらす、数字からは見えない唯一の結果。
    orientationLandscape: "モバイル向けのビルドは横向きに固定される",
    orientationPortrait: "モバイル向けのビルドは縦向きに固定される",
    scriptLocaleHelper: "ストーリーを書く言語。翻訳はローカライズパネルで足す"
  },
  // 読み込みの流れの唯一のページ。2 つの選択欄と、展開するボタン。
  import: {
    packageLabel: ".nlspkg ファイル",
    packagePlaceholder: "ファイル未選択",
    choosePackage: "ファイルを選ぶ",
    locationPlaceholder: "フォルダ未選択",
    chooseFolder: "フォルダを選ぶ",
    working: "展開している…",
    error: {
      failedTitle: "読み込みに失敗",
      generic: "このファイルは展開できなかった",
      notAProjectTitle: "これは NarraLeaf Studio のプロジェクトではない",
      notAProject:
        "展開は終わったが、中に Studio のプロジェクトファイルがない。展開した中身は {path} にある"
    }
  },
  // クローンの流れの最初のページ。短いのは意図的で、プロジェクトについての残りは
  // すべてサーバー側に記録されている。
  source: {
    addressLabel: "プロジェクトのアドレス",
    addressHint: "このアドレスはプロジェクトを用意した人から渡される",
    // 「無効」とは言わず、足りないものを名指しする。ここで捕まえる間違いは、ほぼ必ず
    // サーバーまでは書けていて末尾のプロジェクト名が抜けているもの。
    addressInvalid:
      "プロジェクトのアドレスは末尾にプロジェクト名が要る。例：lore://studio.example.lan:41337/my-game",
    parsedServer: "サーバー",
    parsedName: "サーバー上のプロジェクト",
    // 選ぶ前に言う。空かどうかの確認はメインプロセスで走るので、そこで断られると
    // 作者がフォルダを決めた後になる。
    destinationHint: "新しいフォルダか、空のフォルダにする"
  },
  // クローンの流れの最後のページ。ネットワークに触れるのはここだけ。
  clone: {
    subtitle: "プロジェクト全体をこの端末に複製する",
    // 進捗率は出さない。バックエンドはクローンが終わってからしか進捗を返さないので、
    // ここにバーを置くと 0 のまま止まって消えることになる。
    working: "サーバーからプロジェクトを複製している…",
    error: {
      failedTitle: "クローンに失敗",
      generic: "サーバーからプロジェクトを取得できなかった",
      // Lore サーバーが持つのはリポジトリで、リポジトリが必ず Studio のプロジェクトとは限らない。
      // 実際に置かれているものなので名前を出す。このフォルダを再利用できない理由でもある。
      notAProjectTitle: "これは NarraLeaf Studio のプロジェクトではない",
      notAProject:
        "複製は終わったが、中に Studio のプロジェクトファイルがない。複製した中身は {path} にある"
    }
  },
  review: {
    template: "テンプレート",
    notSpecified: "未指定"
  },
  // ウィザードの検証と作成のサービスが出すエラー。
  validation: {
    templateFailed: "テンプレートの中身をプロジェクトへ複製できなかった",
    nameRequired: "プロジェクト名は必須",
    locationRequired: "プロジェクトの場所は必須",
    templateRequired: "プロジェクトのテンプレートは必須",
    stageSizeRequired: "ステージの大きさは必須",
    invalidPath: "パスが不正",
    notADirectory: "そのパスは存在するがフォルダではない。フォルダを選ぶか、新しく作る",
    cannotWrite: "そのフォルダには書き込めない。権限を確認するか、別のフォルダを選ぶ",
    notEmpty: "そのフォルダは空ではない。空のフォルダを選ぶか、新しく作る",
    validationFailed: "フォルダの検証に失敗",
    failedToValidate: "フォルダを検証できなかった",
    checkExistenceFailed: "フォルダの有無を確認できなかった",
    checkIsDirFailed: "パスがフォルダかどうかを確認できなかった",
    listContentsFailed: "フォルダの中身を一覧できなかった",
    selectDirectoryFailed: "フォルダを選択できなかった",
    createFailed: "プロジェクトを作成できなかった"
  }
} satisfies LocaleNamespace<"wizard">;
