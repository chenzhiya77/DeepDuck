# 对话模型配置界面：分组单行、组内拖动与展示开关 —— 设计

**Status:** 已实施（2026-10-08：后端 `82e3c74e4` + 前端 `c9fc68f95`；真栈验收见 plan Task 4，收官后本行改「已完工」）。裁决：①模型 ID 进编辑弹窗灰显 ②=甲 config_file 条目钉住 ③=甲「默认」胶囊＋去黑胶囊＋新增展示开关；**D1=甲 开关锁开 / D2=甲 `order_pinned` 无拖柄 / D3=甲 只管三处对话下拉**——三条全按推荐）。成对 plan 同名（`../plans/2026-10-08-models-list-grouping.md`）。

**本对一件事：把设置页「对话模型」列表从一列松散卡片改成按提供商分组的合并容器列表——行变单行、组内可拖、每行一个「对话列表展示」开关；模型 ID 的出口收进编辑弹窗。**

术语约定：

- **对话模型选择器** = 对话输入框的模型下拉，共三处：主对话（`input-box.tsx`）、侧栏对话（`sidecar-panel.tsx`）、知识库对话（`chat-panel.tsx`）。
- **展示开关** = 行尾 Switch：开 = 该模型出现在对话模型选择器的**可选项**里；关 = 不出现。纯展示过滤，**不是禁用**——被引用处照常工作。
- **默认模型** = 合并列表第一条（`config.models[0]`），后端以其为兜底（`lead_agent/agent.py:133`、`tools.py:114`、`context_usage.py:47`；前端兜底 `input-box.tsx:552`）。
- **合并列表** = `config.yaml` 的 `models` 块在前 + `models_config.json` 追加（同名原位顶替，`models_config.py:191-212`）。

来源：2026-10-08 用户两截图（参照设计：分组＋合并容器＋组内拖动＋行尾开关）＋三连问与三条裁决。前轮「模型 ID 放行内 ⓘ」方案作废，按裁决①改走编辑弹窗。

## 1. 问题（机制与证据链）

现状六缺口（逐条实证，均在 `frontend/src/components/workspace/settings/models-settings-page.tsx`）：

1. **松散**：每行是独立 `Item` 卡片、行间 `gap-4`（`:182`、`:190`）——视觉上是一叠卡片而非一个列表。
2. **行内重复**：副标题 `提供商 · 模型 ID`（`:197-199`）里，模型 ID 与标题（`display_name ?? name`）大量重复，提供商同组内逐行重复——两者都能上提到别处（提供商→组头、模型 ID→编辑弹窗）。
3. **位置固定**：无拖动能力；且「第一条=默认模型」这条系统语义在界面上完全不可见。
4. **黑胶囊冗余**：可编辑行的来源徽章 `Badge variant="default"`（"UI·可编辑"，`:202-206`）与行尾自带的铅笔/垃圾桶表达同一件事。
5. **模型 ID 无出口**：编辑弹窗（`models-edit-dialog.tsx`）字段序 = 显示名 / API Key / API 类型 / 接口地址 / Headers / 能力 / max_tokens，**没有模型 ID 行**——删副标题后若不在编辑弹窗补上，真实模型 ID 将无处可看。
6. **藏不起来**：专供 RAG 功能角色、评测等用途的模型也会出现在对话模型下拉里碍眼；当前没有任何「不在此展示」的手段。

## 2. 方案

### ① 分组与合并容器

- **分组键 = `provider`**（仅三值 `openai-compatible` / `anthropic` / `deepseek`，`models_config.py:47-51`；自定义 `use:` 反查不到时归「自定义提供商」）。组头文案**复用现有词表** `providerLabel()`（`models-settings-page.tsx:79-90`），零新词。
- **组序 = 合并列表首次出现序**，默认模型所在组恒在最上。
- **每组一个容器** `rounded-lg border bg-card`；行间改分隔线：首行以下 `border-t border-border/50`（不明显），**左端内缩到名称文字起点**（跳过拖柄列）、**右端止于图标区之前**（不完全分隔）。
- 组头是**纯标签**，不带铅笔/垃圾桶：提供商不是实体，无名可改、无物可删（参照图组头的两个图标不抄；其行尾刷新图标亦不在本次范围）。

### ② 行单行化与徽章整理

行结构（一行）：

```
[⠿ 拖柄] 名称(display_name ?? name) [「默认」胶囊] ……… [「配置文件」灰胶囊] [展示开关] [铅笔] [垃圾桶]
```

- **删副标题**（`:197-199` 整行）。
- **去黑胶囊**（裁决③）：可编辑行不再渲染来源徽章（"可编辑"由行尾按钮自证）；**config_file 行保留 secondary 灰胶囊**（它解释"为何没有铅笔/垃圾桶"，属状态说明，按"状态骑在它描述的对象上"保留）。
- **模型 ID 进编辑弹窗**（裁决①）：「显示名」与「API Key」之间加一行「模型 ID」——`disabled` Input 灰显，值 = `model.model`。`handleSubmit` 早已原样透传 `model.model`（`models-edit-dialog.tsx:137`），本项纯展示、零行为变化。位置对齐既有四行块词汇序「提供商, Model ID, API Key, 接口地址」。

### ③ 组内拖动与「默认」胶囊

- **拖动复用现成写法**：`kb-list-panel.tsx:34-194` 的原生 HTML5 sortable 式拖动（过一行占一格），不引新拖拽库。
- **可拖条件 = `editable && !order_pinned`**（`order_pinned` 统一定义见 §3 D2：位置被 config.yaml 钉住 = name ∈ config.yaml 的 models 名单，含 config_file 条目与同名顶替条目）。config_file 行**无拖柄**、固定在组内上部（裁决②）；UI 行在组内下部自由排序。
- **拖动 clamp 在组内 UI 行子块内**（2026-10-08 审查 ★2）：钉住行不可越过——sortable 的跨行落格只在 UI 行之间生效，拖往钉住行方向时夹到 UI 子块边界即止（越过 = no-op，不产生半格位移）。否则 UI 行显示位移而写回序里 config_file 恒在组内上部，refetch 后弹回 = D2 乙同族缺陷。
- **写回序 = 分组展平序（组序 × 组内序）**（2026-10-08 审查 ★2）：拖动后 `persist()` 的数组顺序按「组首次出现序 → 组内合并序」展平取 UI 条目序列，不按视觉行序直接拍平——「显示序」在分组视图下有歧义，写死为展平序。性质钉死：**拖 → 存 → 重载 → 显示序不变**（稳定性用例覆盖）。
- **拖动只改 UI 子集的相对顺序**：保存仍走整表 PUT（`persist()`，`:92-94`），合并规则不变（config.yaml 块永远在前）⇒ **拖动不改变默认模型**；唯一例外是 config.yaml `models:` 为空的部署，那时第一条就是 UI 第一条——由「默认」胶囊随行标出，不靠位置暗说。
- **「默认」胶囊**（裁决③）：合并列表第一行名称后加 secondary 小胶囊「**默认**」（词进胶囊、骑在它标的那一行）。

### ④ 展示开关（新功能）

- 行尾 **Switch**（`ui/switch.tsx` 现成），开 = 展示。切换即走既有 `persist()` 整表写回，失败回滚开关态并报错。
- **落盘形态：`models_config.json` 顶层 `hidden_in_chat: [name, ...]`**（缺席 = 全展示）。选顶层名单而非条目字段的理由：不动条目本体、对 config_file / ui 两类条目统一生效、与 merge 顺序零耦合。PUT 为整体替换语义：`hidden_in_chat` 随请求体整体写回，省略 = 清空（与既有整表替换一致；**字段注释写明"省略=清空"**，防后来者当可选省略用，2026-10-08 审查 11）。
- **悬挂名随删剔除**（2026-10-08 审查 9）：`handleDelete` 删除模型时同步从 `hidden_in_chat` 名单剔除其名——过滤层对名单里的不存在名本就无害（查不到即忽略），但文件不留死名。
- **语义边界（写死）**：
  - 过滤**只作用于三处对话模型选择器的下拉可选项**；当前选中项与兜底查找仍用全量列表——隐藏 = 不碍眼，不是禁用。已被 agent 设为默认、被 RAG 功能角色引用的模型隐藏后照常工作（后端按 `name` 从 `config.models` 解析，与展示无关）。
  - **默认模型恒豁免过滤**（2026-10-08 审查 ★1）：过滤判定 = `!hidden_in_chat || is_default`（`is_default` = 合并列表第一条）。UI 锁开只是第一道防线；名单是持久化数据，config.yaml 变动可让名单里的模型顶上第一位（用户先隐藏 X、后删 config.yaml 首条 ⇒ X 成默认）——不豁免就恰重现 D1 要避免的「预选了个下拉里没有的模型」。豁免写在过滤函数一处，对手改 json、外部变动一并免疫。
  - **功能模型选择器**（`functional-models-view.tsx`）与**自定义 agent 默认模型选择器**（`agent-settings-dialog.tsx`）**不过滤**（见 D3）。
  - **默认模型行的开关锁开**（见 D1），禁用态悬浮给原因（项目 Tooltip，非原生 title）：「默认模型始终在对话列表中展示」。
- **后端**：`ModelsConfig` 解析 `hidden_in_chat`；`GET /api/models/config` 每条派生 `hidden_in_chat: bool`；`GET /api/models` 每条加 `hidden_in_chat: bool`（additive，旧前端忽略）。过滤逻辑留在前端（全量列表与可见选项分离），`/api/models` 不做服务端剔除。

## 3. 决策点（2026-10-08 全裁，三条均按推荐=甲）

| # | 在问什么 | 裁决 | 落法 | 不这么做的后果（当时推荐理由） |
|---|---|---|---|---|
| **D1** | 默认模型行的展示开关能不能关 | **甲＝锁开** | 默认行 Switch `disabled`＋项目 Tooltip「默认模型始终在对话列表中展示」 | 可关则兜底链要跟着改成「第一个可见模型」，易出"预选了个下拉里没有的模型"、「默认」语义分裂成两条 |
| **D2** | ui 条目与 config.yaml 同名（原位顶替）时给不给拖柄 | **甲＝无拖柄** | `GET /api/models/config` 每条加 `order_pinned: bool`（**统一定义（2026-10-08 审查 4）：位置被 config.yaml 钉住 = name ∈ config.yaml 的 models 名单**——含 config_file 条目与同名顶替条目；前端拖柄条件收敛为 `editable && !order_pinned` 一个判断）。判定源 = `AppConfig` 加载时记私有 `_yaml_model_names`（与 `_ui_model_names` 并列；`merge_ui_models` 合并后 yaml 名单不可回溯，须在 `from_file` 记录） | 给了拖柄而位置写不回 config.yaml＝"拖了保存不上"，用户当保存缺陷报障 |
| **D3** | 「不展示」管到哪些选择器 | **甲＝仅三处对话下拉** | agent 默认模型选择器、功能模型选择器不过滤 | 连它们一起过滤：藏掉正被引用的模型后排障看不见指向，隐藏本义是"不碍眼"非"不可用" |

## 4. 波及面

**改**：

- 后端：`deerflow/config/models_config.py`（`hidden_in_chat` 解析＋`order_pinned` 判定源 `_yaml_model_names`）、`app/gateway/routers/models.py`（PUT 请求模型、GET 派生字段、公共 `GET /api/models` 加性字段）、`deerflow/client.py::list_models/get_model`（镜像 `hidden_in_chat`，2026-10-08 审查 8 顺手项——conformance 测试字段有 default 即过，但客户端输出不缺字段才能供 TUI 后续过滤）。
- 前端：`models-settings-page.tsx`（分组/合并容器/单行/拖动/开关渲染主改）、`models-edit-dialog.tsx`（＋模型 ID 灰显行）、`input-box.tsx` / `sidecar-panel.tsx` / `chat-panel.tsx`（下拉选项过滤）、`core/models/types.ts` / `api.ts` / `hooks.ts`（字段透传）、`core/i18n/locales/{zh-CN,en-US,types}.ts`（新词：默认 / 展示 / 模型 ID / 锁定原因）。

**不动**：`models-add-dialog.tsx`、`functional-models-view.tsx`、默认模型与 merge 顺序语义（`models_config.py:191-212`）、`config.yaml`（API 永不写它）、RAG 功能角色与 agent 默认的运行时解析。

## 5. 测试与验收

- **后端**（TDD）：`hidden_in_chat` 读写 round-trip（含 config_file 名、省略=清空）；`order_pinned` 判定（config_file 条目 / 同名顶替条目 / 纯 UI 条目 / yaml 空四态，按 §3 D2 统一定义）；merge 顺序回归（UI 子集重排不移位 config.yaml 块、默认模型不变）。
- **前端单测**（纯函数落 `frontend/tests/unit/models/`、node 环境；组件钉落 `tests/unit/components/workspace/settings/`）：分组派生与组内重排纯函数；**默认模型恒豁免过滤**（名单含默认名时下拉仍含它，★1）；**拖动 clamp**（拖往钉住行方向 = no-op，★2）；**写回稳定性**（拖→存→重载→显示序不变，写回序=分组展平序，★2）；下拉选项过滤纯函数（可见选项与全量查找分离——隐藏模型仍可作当前选中/agent 默认命中）；开关写回失败回滚；`handleDelete` 同步剔除悬挂名。
- **真栈验收**：分组容器＋内缩分隔线观感；组内拖动保存后刷新位置保持、config_file 行不动；关掉展示后对话下拉消失而功能模型选择器仍在；默认行开关禁用且悬浮给原因；编辑弹窗模型 ID 灰显、保存后 `model` 不变；黑胶囊消失、config_file 灰胶囊保留。**分组预期锚**（2026-10-08 审查 10）：按当前配置应得两组——「OpenAI 兼容」×5、「DeepSeek」×1。

## 6. 登记项（本期不做）

- **TUI 模型选择器随选过滤**（2026-10-08 审查 8）：它走 `DeerFlowClient.list_models()`（`client.py:1103`），不在"三处对话下拉"内（D3 甲的字面范围）。本期 client 侧只镜像 `hidden_in_chat` 字段；TUI picker 接过滤留二期。
