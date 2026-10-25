// [INPUT]: Current configuration contracts and supported CLI operations.
// [OUTPUT]: Offline settings discovery, nested fields, choices and safe examples.
// [POS]: Configuration CLI documentation and allowlists; backend remains the validator.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use super::Scope;
use serde_json::{Value, json};

impl Scope {
    pub(super) fn fields(self) -> &'static [&'static str] {
        match self {
            Self::Settings => &[
                "expectedRevision",
                "hostRestartPolicy",
                "enabled",
                "answerOutlineEnabled",
                "promptEnhancementEnabled",
                "tokenMeterEnabled",
                "grokbotEnabled",
                "grokbotAutoSync",
                "generationMode",
                "provider",
                "model",
                "baseUrl",
                "protocol",
                "apiKey",
                "clearApiKey",
                "apiKeyEnv",
                "maxItems",
                "directionSource",
                "directionLibrary",
                "selectedDirections",
                "jev",
                "jevConsent",
                "jevApiKey",
                "clearJevApiKey",
                "quickPrompts",
                "maxInputChars",
                "maxOutputTokens",
                "timeoutMs",
            ],
            Self::Appearance => &[
                "expectedRevision",
                "typography",
                "settingsTheme",
                "language",
                "alwaysOnTop",
                "launcherAction",
                "settingsTarget",
                "position",
                "ui",
            ],
            Self::Surfaces => &["op", "revision", "placement", "theme", "edge"],
            Self::Layout => &[
                "op",
                "id",
                "placement",
                "layout",
                "expectedLayout",
                "tabs",
                "expected",
            ],
            Self::ModelControl => &["revision", "patch"],
            Self::Tasks => &[
                "op",
                "revision",
                "id",
                "title",
                "fields",
                "before",
                "ids",
                "archived",
                "expectedTask",
                "boardEnabled",
                "syncEnabled",
                "bindings",
                "iCloudConfirmed",
                "confirmRepair",
            ],
            Self::Terminology => &[
                "action",
                "revision",
                "enabled",
                "semantic",
                "autoExpand",
                "jumpOnClick",
                "cardStyle",
                "cardMaterial",
                "cardLiquidVariant",
                "cardCustomColor",
                "cardWidth",
                "entries",
                "id",
                "names",
            ],
            Self::CodexHost => &["op", "expectedRevision", "enabled", "version"],
            Self::Performance => &[
                "expectedRevision",
                "integrationEnabled",
                "monitoringEnabled",
            ],
        }
    }
    pub(super) fn operations(self) -> &'static [&'static str] {
        match self {
            Self::Surfaces => &["save"],
            Self::Layout => &["main-placement", "main-layout", "move", "edge-tabs"],
            Self::Tasks => &[
                "modules",
                "bindings",
                "repairBindings",
                "createColumn",
                "renameColumn",
                "create",
                "update",
                "remove",
                "archive",
                "reorder",
            ],
            Self::Terminology => &[
                "settings",
                "import",
                "manual",
                "master",
                "restore",
                "favorite",
                "unfavorite",
                "add-names",
                "retry-import",
                "remove-import",
                "reset-library",
            ],
            Self::CodexHost => &[
                "set-enabled",
                "check-update",
                "install",
                "restore",
                "start",
                "restart-disabled",
            ],
            _ => &[],
        }
    }
    pub(super) fn example(self) -> Value {
        match self {
            Self::Settings => json!({"generationMode":"manual"}),
            Self::Appearance => json!({"settingsTheme":"codex"}),
            Self::Surfaces => {
                json!({"placement":"sidebar","theme":{"theme":"matte","liquidVariant":"regular"}})
            }
            Self::Layout => json!({"op":"main-placement","placement":"sidebar"}),
            Self::ModelControl => json!({"patch":{"enabled":true}}),
            Self::Tasks => json!({"op":"createColumn","title":"待确认"}),
            Self::Terminology => json!({"jumpOnClick":false}),
            Self::CodexHost => json!({"op":"set-enabled","enabled":false}),
            Self::Performance => json!({"monitoringEnabled":false}),
        }
    }
}

pub(super) fn operation_fields(scope: Scope, op: &str) -> Option<&'static [&'static str]> {
    match (scope, op) {
        (Scope::Layout, "main-placement") => Some(&["op", "placement"]),
        (Scope::Layout, "main-layout") => Some(&["op", "placement", "layout", "expectedLayout"]),
        (Scope::Layout, "move") => Some(&["op", "id", "placement"]),
        (Scope::Layout, "edge-tabs") => Some(&["op", "tabs", "expected"]),
        (Scope::Terminology, "settings") => Some(&[
            "action",
            "revision",
            "enabled",
            "semantic",
            "autoExpand",
            "jumpOnClick",
            "cardStyle",
            "cardMaterial",
            "cardLiquidVariant",
            "cardCustomColor",
            "cardWidth",
        ]),
        (Scope::Terminology, "add-names") => Some(&["action", "revision", "names"]),
        (Scope::Terminology, "manual" | "import") => Some(&["action", "revision", "entries"]),
        (Scope::Terminology, "reset-library") => Some(&["action", "revision"]),
        (
            Scope::Terminology,
            "retry-import" | "remove-import" | "master" | "restore" | "favorite" | "unfavorite",
        ) => Some(&["action", "revision", "id"]),
        _ => None,
    }
}

fn keys(value: impl serde::Serialize) -> Vec<String> {
    serde_json::to_value(value)
        .expect("configuration contract")
        .as_object()
        .expect("configuration object")
        .keys()
        .cloned()
        .collect()
}

pub(super) fn schema(scope: Scope) -> Value {
    let mut value = json!({
        "scope":scope.name(),
        "optionalBackend":matches!(scope, Scope::Performance),
        "fields":scope.fields(),
        "operations":scope.operations(),
        "example":scope.example(),
        "patchSemantics":"未指定的字段保留；数组、字典和 layout 整体替换，先 get 并保留其他条目",
        "arrays":"完整替换；请先读取现有值并保留不修改的条目",
        "revision":"涉及修订/快照的操作会自动读取保护值；显式值不覆盖；保存时后台再次校验，冲突不重试",
        "secrets":"读取及预览脱敏；凭据使用 --file -，不放入命令行参数",
        "dryRun":"仅检查客户端字段/修订及合并后的补丁，非完整后台校验，不执行保存",
        "operationFields":scope.operations().iter().filter_map(|op| operation_fields(scope,op).map(|fields|((*op).to_owned(),json!(fields)))).collect::<serde_json::Map<String, Value>>(),
    });
    let detail = match scope {
        Scope::Settings => json!({
            "nestedFields":{
                "directionLibrary[]":["id","name","instruction","enabled"],
                "quickPrompts[]":["label","prompt"],
                "jev":keys(crate::jev::Options::default())
            },
            "choices":{
                "hostRestartPolicy":["ask","force"], "generationMode":["auto","manual"],
                "directionSource":["auto","manual","smart"], "provider":["codex","api"],
                "protocol":["responses","chat_completions","anthropic_messages","auto"]
            },
            "readCommands":["config catalog models","config get settings"],
            "notes":{
                "directions":"get 返回 builtInDirections 和 directionLibrary；内置与个人条目通过 id 区分，selectedDirections 数组即顺序",
                "jev":"对象支持局部更新；首次同意须 --confirm，密钥由 jevApiKey 独立设置",
                "generation":"只修改生成配置，不触发生成或发送聊天",
                "maxInputChars":"0 表示完整上下文，正数为字符上限"
            },
            "examples":[{"tokenMeterEnabled":false,"grokbotAutoSync":false},{"directionSource":"manual","selectedDirections":["advance","explore"]}],
        }),
        Scope::Appearance => json!({
            "nestedFields":{
                "ui":keys(crate::panel::Ui::default()),
                "typography":keys(crate::panel::TypographyPreferences::default()),
                "position":["x","y"],
                "ui.dockLayout / ui.popoutLayout":keys(crate::panel::WorkbenchLayout::default())
            },
            "choices":{
                "language":["system","en","zh-CN"],"settingsTheme":["codex","light","dark"],
                "typography.mode":["follow","custom"],"typography.source":["body","session","composer"],
                "ui.promptClickMode":["fill","direct","hybrid"],"launcherAction":["inside","outside","settings"],
                "settingsTarget":["plugin","web"]
            },
            "notes":{
                "typography":"支持局部更新；scale 为 75–150%，customSize 为 10–32px",
                "ui":"下一步显示/操作：labelOnly、promptClickMode；侧栏：dockWidth、sidebarNewChat、sidebarDots",
                "legacy":"ui.dockLayout/popoutLayout 为旧两功能布局；新布局使用 config set layout，分形式材质使用 surfaces"
            },
            "examples":[{"language":"en","ui":{"labelOnly":true,"promptClickMode":"hybrid"}},{"typography":{"scale":110}},{"ui":{"dockWidth":360,"sidebarNewChat":true,"sidebarDots":false}}],
        }),
        Scope::Surfaces => json!({
            "nestedFields":{"theme":keys(crate::surfaces::Theme::default()),"edge":keys(crate::surfaces::Edge::default())},
            "choices":{"placement":crate::surfaces::PLACEMENTS,"theme.theme":["black","matte","frosted","native-glass"],"theme.liquidVariant":["regular","clear"],"edge.edge":["left","right","top"]},
            "readCommands":["config catalog displays"],
            "notes":{"theme":"需要 placement；支持局部更新，未指定 liquidVariant 时保留当前变体","edge.screen":"codex 表示跟随 Codex；空字符串为默认屏幕；固定屏幕使用 catalog displays 返回的 id","edge.position":"0–1，沿所选边缘的位置","edge.keepOpen":"保持展开"},
            "examples":[{"placement":"sidebar","theme":{"liquidVariant":"clear"}},{"edge":{"edge":"top","screen":"codex","position":0.5,"keepOpen":true}}],
        }),
        Scope::Layout => json!({
            "nestedFields":{"layout":["axis","groups"],"layout.groups[]":["ids","active","weight","collapsed"],"layout.groups[] split":["axis","groups","weight"],"tabs":keys(crate::surfaces::EdgeTabs::default())},
            "choices":{"id":crate::features::IDS,"placement":crate::surfaces::PLACEMENTS,"layout.axis":["auto","vertical","horizontal"]},
            "notes":{"main-placement":"主界面仅 sidebar / overlay / desktop；move 将单个功能移到 edge 或主界面","main-layout":"完整替换所选形式的布局；嵌套分栏、合并标签及 collapsed 折叠行均可保存；expectedLayout 为 get 返回的原布局或 null","edge-tabs":"tabs.order 为图标顺序；tabs.selected 为选中功能；未提供的字段保留；expected 对比 get 返回的 edgeTabs"},
            "examples":[{"op":"edge-tabs","tabs":{"order":["model","board"],"selected":"board"}},{"op":"main-layout","placement":"sidebar","layout":{"axis":"vertical","groups":[{"ids":["outline","next"],"active":"next","weight":1,"collapsed":true},{"ids":["terms"],"active":"terms","weight":1}]}}],
        }),
        Scope::ModelControl => json!({
            "nestedFields":{"patch":keys(crate::model_control::Preferences::default()),"patch.presets[]":["id","name","selection"],"patch.presets[].selection":["model","reasoning","speed"],"patch.groups[]":["id","name"],"patch.modelOverrides.<model-id>":["manufacturer","groupId"]},
            "choices":{"patch.presets[].selection.speed":["standard","fast"]},
            "notes":{"models":"实际模型/推理档来自 config get model-control 的 snapshot；未连接时可能为空，不使用示例名称代替真实模型 id","showUsage":"账号额度显示开关","collections":"pinned/modelOrder/groups/groupOrder/presets/expandedGroups 为完整列表；modelOverrides 为完整字典；删除常用、分组、预设需 --confirm"},
            "examples":[{"patch":{"showUsage":false,"modelColumnWidth":240}}],
        }),
        Scope::Tasks => json!({
            "nestedFields":{"fields":["title","notes","priority","due","column","completed"],"fields.due":["year","month","day","hour","minute","timeZone"]},
            "notes":{"fields":"create/update 支持局部字段；due 可为 null；priority 0/1/5/9 对应无/高/中/低，保留旧 0–9","guards":"update/remove/archive 自动携带 expectedTask，避免覆盖并发任务修改","legacyReminders":"旧 reminders 命令与 bindings/syncEnabled 仅兼容保留；普通配置读取不申请 Apple 权限"},
            "examples":[{"op":"modules","boardEnabled":true},{"op":"create","fields":{"title":"Review draft","notes":"Check the outline","priority":5}}],
        }),
        Scope::Terminology => json!({
            "nestedFields":{"entries[]":["id","name","english","definition","aliases","category","example","source"]},
            "choices":{"cardStyle":["plain","frost"],"cardMaterial":["matte","frosted","native-glass","black","custom"],"cardLiquidVariant":["regular","clear"]},
            "notes":{
                "revision":"settings/favorite/unfavorite/master/restore 使用 preferences.revision；名称/导入/重试/移除/重置使用 imports.revision，CLI 自动读取正确值",
                "add-names":"names 为 1–50 个名称；立即进入待处理列表，下次用户主动发送主聊天时由当前 Agent 补全，不由 CLI 发起聊天",
                "import":"config import terminology --file FILE 原样上传任意格式，最大 8 MB；解析范围由当前聊天 Agent 的文件能力决定",
                "structured":"set 的 action:manual/import 接受完整 entries，manual 一次一条；category 为空时旧 manual 操作可能调用分类模型，名称补全使用 add-names",
                "reset-library":"需 --confirm；删除个人添加、导入内容、文件和任务，保留基础词库及其中收藏/掌握记录",
                "remove-import":"删除对应任务和原件，需 --confirm；id 来自 imports.jobs",
                "export":"仅个人添加、收藏、已掌握；JSON 包含 entries 与 markdown；不导出完整基础词库"
            },
            "commands":["config import terminology --file terms.pdf --dry-run","config import terminology --file terms.pdf","config export terminology --format markdown --output my-terms.md"],
            "examples":[{"action":"add-names","names":["Retrieval-augmented generation"]},{"action":"reset-library"},{"cardMaterial":"frosted","cardWidth":360}],
        }),
        Scope::CodexHost => {
            json!({"notes":{"enabled":"set-enabled 保存启动意愿；不改写官方 CodexHost、供应商 Agent 或它们的模型配置","operations":"start/install/restore/restart-disabled 需 --confirm；读取状态不重启宿主"}})
        }
        Scope::Performance => {
            json!({"notes":{"integrationEnabled":"暂停/恢复连接，保留配置与本地任务，不重启 Codex","monitoringEnabled":"启用可见性能页的低频采样"}})
        }
    };
    value
        .as_object_mut()
        .unwrap()
        .extend(detail.as_object().unwrap().clone());
    value
}
