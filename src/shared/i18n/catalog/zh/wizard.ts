import type { LocaleNamespace } from "../types";

export const wizard = {
    appTitle: "新建项目",
    header: {
        title: "创建新项目",
        stepIndicator: "第 {current} 步，共 {total} 步",
    },
    steps: {
        template: {
            label: "模板",
            description: "选择项目模板",
        },
        details: {
            label: "详情",
            description: "项目信息",
        },
        settings: {
            label: "设置",
            description: "项目配置",
        },
        review: {
            label: "确认",
            description: "确认并创建",
        },
    },
    nav: {
        createProject: "创建项目",
        creating: "正在创建…",
    },
    error: {
        createFailedTitle: "创建项目失败",
        closeError: "关闭错误提示",
    },
    fields: {
        author: "作者",
        license: "许可证",
        location: "位置",
        versionControl: "版本控制",
        resolution: "分辨率",
        appId: "应用 ID",
    },
    template: {
        title: "选择项目模板",
        subtitle: "选择一个项目模板，借助预配置的结构和设置快速开始",
        options: {
            empty: {
                name: "空白",
                description: "从空白项目开始，从零构建",
                category: "自定义",
            },
        },
    },
    details: {
        title: "项目详情",
        subtitle: "填写项目的基本信息",
        basicInfo: {
            title: "基本信息",
            description: "项目的基本信息与元数据",
        },
        application: {
            title: "应用",
            description: "常用的应用设置。多数设置在项目初始化后无法更改",
        },
        projectName: "项目名称",
        projectNamePlaceholder: "输入项目名称…",
        appIdPlaceholder: "输入应用标识符…",
        appIdHelper: "只能包含小写字母、数字和连字符",
        appIdRequired: "应用 ID 为必填项",
        appIdInvalid: "应用 ID 只能包含小写字母、数字和连字符",
        authorPlaceholder: "作者邮箱 / 组织 / 项目",
        licensePlaceholder: "选择许可证…",
        customLicense: "自定义许可证",
        customLicensePlaceholder: "输入自定义许可证…",
        licenseOther: "其他",
        descriptionPlaceholder: "描述你的项目…",
        resolutionPlaceholder: "选择分辨率…",
        requiredFieldsTitle: "必填项",
        requiredFieldsMessage: "请填写必填项：项目名称、应用 ID 和分辨率",
    },
    settings: {
        title: "项目设置",
        subtitle: "配置项目位置、备份和版本控制设置",
        location: {
            description: "选择项目的保存位置。",
        },
        versionControl: {
            description: "为项目设置版本控制。",
        },
        projectLocation: "项目位置",
        projectLocationPlaceholder: "输入项目位置…",
        validatingDirectory: "正在校验目录…",
        directoryWillBeCreated: "创建项目时将自动创建该目录",
        versionControlSystem: "版本控制系统",
        versionControlPlaceholder: "选择版本控制…",
        backup: {
            none: "不备份",
            hourly: "每小时",
            daily: "每天",
            weekly: "每周",
        },
    },
    review: {
        title: "确认项目",
        subtitle: "创建前请确认你的项目设置",
        summary: {
            title: "项目概要",
            description: "项目配置一览",
        },
        selectedTemplate: {
            title: "已选模板",
            description: "将要使用的项目模板",
        },
        settings: {
            description: "将应用到项目的配置",
        },
        notSpecified: "未指定",
        custom: "自定义",
    },
    validation: {
        nameRequired: "项目名称为必填项",
        locationRequired: "项目位置为必填项",
        templateRequired: "项目模板为必填项",
        invalidPath: "无效路径",
        notADirectory: "所选路径已存在，但不是目录。请选择一个目录或新建一个。",
        cannotWrite: "无法写入所选目录。请检查权限或选择其他位置。",
        notEmpty: "目录不为空。请选择一个空目录或新建一个。",
        validationFailed: "目录校验失败",
        failedToValidate: "校验目录失败",
        checkExistenceFailed: "检查目录是否存在失败",
        checkIsDirFailed: "检查路径是否为目录失败",
        listContentsFailed: "列出目录内容失败",
        selectDirectoryFailed: "选择目录失败",
        createFailed: "创建项目失败",
    },
} satisfies LocaleNamespace<"wizard">;
