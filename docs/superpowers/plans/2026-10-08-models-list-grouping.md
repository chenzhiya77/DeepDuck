# 对话模型配置界面：分组单行、组内拖动与展示开关 —— 实施计划

## 范围与交接

一对一件事 = ①按 provider 分组合并容器（内缩分隔线）②行单行化（删副标题、去黑胶囊、模型 ID 收进编辑弹窗灰显行）③组内拖动（config_file 钉住、`order_pinned` 判定）＋「默认」胶囊 ④行尾展示开关（`hidden_in_chat` 名单，只过滤三处对话下拉）。成对 spec 同名（`../specs/2026-10-08-models-list-grouping-design.md`），决策点 **D1=甲 开关锁开 / D2=甲 `order_pinned` 无拖柄 / D3=甲 只管三处对话下拉**（2026-10-08 全裁，spec §3）。**不碰**：`models-add-dialog.tsx`、`functional-models-view.tsx`、默认模型与 merge 顺序语义（`models_config.py:191-212`）、`config.yaml`（API 永不写它）、RAG 功能角色与 agent 默认的运行时解析。TDD 必做（backend/AGENTS.md）。

## 硬约束（执行期注意）／Global Constraints

- **TDD 命令**（照 `backend/Makefile` 的 RUN 变量）：`RUN = PYTHONPATH=. PYTHONIOENCODING=utf-8 PYTHONUTF8=1 uv run --no-sync`；单测 = `$(RUN) pytest tests/test_models_config.py tests/test_models_config_api.py -q`（basetemp 用仓外隔离目录、跑完删）；门禁 = `$(RUN) pytest -m "not live" tests/` + `$(RUN) ruff check .` + `$(RUN) ruff format --check .`；前端 = `python ../scripts/pnpm.py test` + `check`（在 `frontend/` 下跑）。
- **整表写回不变**：`persist()` 仍是 PUT 全量替换（`models-settings-page.tsx:92-94`）；`hidden_in_chat` 随请求体整体写回、省略=清空。**`toManagedInput` 同款教训**：新增字段若在任何写路径被丢，下一次保存任意行就把它抹掉——所有 `persist()` 调用点（增/删/改/拖动/开关）都必须带上当前 `hidden_in_chat` 全量。
- **顺序语义不改**：合并 = config.yaml 块在前 + UI 追加（`models_config.py:191-212`），拖动只重排 UI 子集相对序 ⇒ 默认模型不变（唯一例外=config.yaml `models:` 空的部署，由「默认」胶囊随行标出）。
- **写回序 = 分组展平序**（组序 × 组内序；spec §2③）：分组视图下"显示序"有歧义，`persist()` 的数组按「组首次出现序 → 组内合并序」展平取 UI 条目序列；稳定性钉死「拖→存→重载→显示序不变」。
- **拖动 clamp**（spec §2③）：跨行落格只在 UI 行子块内生效，钉住行（config_file / `order_pinned`）不可越过，越过 = no-op——否则显示位移 + refetch 弹回。
- **默认模型恒豁免过滤**（spec §2④）：`!hidden_in_chat || is_default` 写在过滤函数一处；UI 锁开只是第一道防线（名单可被外部变动/手改 json 污染）。
- **过滤只在前端三处下拉做可选项过滤**：全量列表与可见选项分离——隐藏模型仍可被当前选中 / agent 默认命中（`input-box.tsx:552` 的 `models.find` 用全量）；`/api/models` 不做服务端剔除。
- 前端拖动复用 `kb-list-panel.tsx:34-194` 的原生 HTML5 sortable 式写法，不引新拖拽库；悬浮一律项目 Tooltip，不用原生 `title`（2026-10-06 既有裁定）。
- 真栈零写入：`models_config.json` 是活配置（他 3 条 UI 模型在内）——验收只做开关/拖动往返并**收尾还原逐字节**，或用后端单测+前端单测覆盖写路径、真栈只读验收观感；`config.yaml` 零改动。
- 提交信息英文 conventional；只 stage 本线文件；文档同步（README 用户可见面、`frontend/AGENTS.md` models-settings 段）。

## Task 0 — 落点核实

> 动到的文件：只读核实 + 本 plan/spec 回填（2026-10-08 核实完毕）

- [x] ① 后端形状：`ModelsConfig`（`models_config.py:102`）加 `hidden_in_chat: list[str]`。⚠️ **新发现：`ModelsConfig.from_file`（:184）只 `model_validate({"models": ...})`——新顶层键会被静默丢弃，必须显式并入验证 dict**（否则文件写得进、读不回）。`ManagedModelInput`（`routers/models.py:172`）与 `ModelsConfigUpdateRequest`（:213）均 `extra="forbid"` ⇒ `hidden_in_chat` 只加在 **UpdateRequest 顶层**（名单不进条目）；`ModelsConfigResponse`（:248）/`ManagedModelResponse`（:228）加派生 `hidden_in_chat: bool`；`ModelResponse`（:37）加 `hidden_in_chat: bool`（default=False，conformance 兼容）。写回点唯一：`routers/models.py:715` `atomic_write_models_config(target_path, {"models": entries})` ⇒ 字典加 `"hidden_in_chat"` 键（`:644` 的 `seen`/`entries` 循环不动）。
- [x] ② `order_pinned` 判定源：`AppConfig._ui_model_names`（`app_config.py:467` PrivateAttr、`:584` 赋值）旁并列记 `_yaml_model_names`——赋值点上下文（`:570` 附近 `merge_ui_models(config_data.get("models") or [], ...)`）**yaml 名单就在这行手里**（合并前的 `config_data["models"]`），加一行集合记录即可，`merge_ui_models` 本身不动。`order_pinned` = name ∈ `_yaml_model_names`；拖柄条件 = `editable && !order_pinned`。
- [x] ③ 前端落点：`models-settings-page.tsx:186-229`（行渲染主改）、`:79-90`（providerLabel 复用为组头）、`:202-206`（黑胶囊删除点）、`models-edit-dialog.tsx:186-195`（显示名块后插模型 ID 灰显行）。**三处下拉核实为各自 `models.map` 渲染、非共享组件**：`input-box.tsx:2438`、`sidecar-panel.tsx:773`、`chat-panel.tsx:695`（各自消费 `useModels()` 的 `models`）⇒ 过滤逻辑放一个共享纯函数（`core/models/` 下可见性 helper）供三处调用，**不复制三份**。⚠️ **术语避让：`GET /api/models` 已有授权过滤变量 `visible_models`（`routers/models.py:118` 附近，RBAC `filter_resources`）——本对的"可见/隐藏"是展示层概念，命名用 `hidden_in_chat`/`shown`，不与 `visible_models` 混用**。
- [x] ④ 受害者扫描：直调 PUT 的用例只在 **`test_models_config_api.py`（11 处 `client.put("/api/models/config", json={"models": ...})`）**——请求体不带 `hidden_in_chat` ⇒ 省略=清空语义天然兼容（旧用例本就不碰名单，断言只看 models）；`test_models_authorization.py` 等其余文件零直调。前端既有钉 = `models-edit-dialog.dom.test.tsx`/`models-add-dialog.dom.test.tsx`（编辑弹窗加只读行不得破坏既有断言）。`functional-models-view.tsx:493` `useModels` + `:944/:966` `modelReferenceOptions(models, ...)` 确认消费全量列表 ⇒ **过滤不进 `useModels` 本体**（D3 边界钉死）。
- [x] ⑤ i18n 键盘点：`M.modelIds` = "Model ID" **已存在**（`zh-CN.ts:1680`，`models-add-dialog.tsx:371` 在用）⇒ 编辑弹窗模型 ID 行**复用它、零新词**。`sourceUi`（"UI·可编辑"，`zh-CN.ts:1656`）随黑胶囊删除退役；`sourceConfigFile`（"配置文件·只读"）保留。真正新增：「默认」胶囊词 / 展示开关 label（「在对话列表中展示」）/ 默认行锁定原因（Tooltip 文案）三个，落 `locales/{types,en-US,zh-CN}.ts`。

## Task 1 — 后端：`hidden_in_chat` + `order_pinned` TDD

> 动到的文件：`deerflow/config/models_config.py` / `app/gateway/routers/models.py` / `tests/test_models_config.py` / `tests/test_models_config_api.py`
> 交付（2026-10-08）：`82e3c74e4`。RED 9 新钉（7 例 + harness 2 辅助钉）全红→GREEN→neuter 反证 ①恰 1 红（四态/顶替例）②目标例红 + 共享写路径 3 例连带红（「恰 1 红」不成立于②：round-trip/clear/config_file 名/Public 四例同走写路径，一损俱损）→还原复绿；`test_client.py` 两处镜像断言顺带落（含既有精确字典钉的加性更新）。

- [x] RED 用例（红=今天字段不存在）：①`models_config.json` 带 `hidden_in_chat` 可解析、缺席=全展示 ②PUT 带名单 round-trip（读回一致）③PUT 省略=清空（整表替换语义）④名单含 config_file 名合法生效（顶层名单不进条目、不触发同名顶替）⑤`GET /api/models/config` 每条派生 `hidden_in_chat: bool` + `order_pinned: bool`（**四态：config_file 条目=True / 同名顶替条目=True / 纯 UI 条目=False / yaml 空恒 False**，统一定义见 spec §3 D2）⑥`GET /api/models` 加性 `hidden_in_chat`、无 `order_pinned`（公共面不暴露内部排序细节）⑦merge 顺序回归：UI 子集重排写回后 config.yaml 块仍在前、`models[0]` 不变。
- [x] GREEN：`ModelsConfig.hidden_in_chat`（default_factory=list，**字段注释写明"PUT 省略=清空"**——审查 11）+ 写回携带 + 两 GET 派生（`order_pinned` = name ∈ `AppConfig._yaml_model_names`，yaml 空恒 False）+ `AppConfig.from_file` 记 `_yaml_model_names` + **`client.list_models/get_model` 镜像 `hidden_in_chat`**（审查 8 顺手项，字段带 default 即过 conformance `test_client.py:3112`）。
- [x] neuter：①派生恒 False ⇒ 顶替例恰 1 红 ②写回丢名单 ⇒ round-trip 例恰 1 红——各一次反证后还原复绿。
- [x] 门禁（models 面）：`test_models_config*.py` 全绿 + `ruff check`/`ruff format --check` 双净。

## Task 2 — 前端：分组容器 + 单行 + 拖动 + 开关

> 动到的文件：`models-settings-page.tsx` / `models-edit-dialog.tsx` / `core/models/{types,api,hooks}.ts` / 三处下拉消费点 / `locales/{types,en-US,zh-CN}.ts` / 对应测试（**纯函数落 `frontend/tests/unit/models/`**——`batch.test.ts` 同层、node 环境；**组件钉落 `tests/unit/components/workspace/settings/`**——`models-edit-dialog.dom.test.tsx` 同层）
> 交付（2026-10-08）：`c9fc68f95`。四点执行期修正：ⓐ **组件钉落位改 `tests/unit/settings/models-settings-page.dom.test.tsx`**（页测试的既有归口；Task 0 受害者扫描漏了它，另起同名文件会造成一组件两归口）——其既有钉按裁决③/改版更新（黑胶囊断言反转、`data-slot="item"` 行面→分组容器、4 处 payload 断言随 mutate 载荷形状改 `.models`+`hidden_in_chat`）。ⓑ 下拖落位 off-by-one：删源后目标左移、按删后索引插入=原地弹回 ⇒ 改用 kb 先例 `kb-order.ts:82` 的原索引 splice 语义，纯函数补下拖用例。ⓒ Tooltip 钉 scoped 到 `[data-slot="tooltip-content"]`（Radix 子树内同句多命中）。ⓓ ⑦ 的三处下拉接线以纯函数语义钉 + Task 4 真栈三处逐验（三个消费组件过重不宜 dom 钉）。

- [x] RED（dom 钉，各钉落前逐一验红）：①分组渲染（组头=providerLabel、组序=首次出现序、组内序=合并序）②行单行化（无副标题、无黑胶囊、config_file 灰胶囊保留）③「默认」胶囊恰在合并第一行 ④拖动：UI 行组内重排写回顺序正确、config_file 行与 `order_pinned` 行无拖柄 ⑤**拖动 clamp**（拖往钉住行方向 = no-op、不产生半格位移，★2）⑥**写回稳定性**（拖→存→重载→显示序不变，写回序=分组展平序，★2）⑦展示开关：关=三处对话下拉可选项消失而**当前选中/全量查找不受影响**、功能模型选择器仍在 ⑧**默认模型恒豁免过滤**（名单含默认名时下拉仍含它，★1）⑨默认行开关 `disabled` + Tooltip 原因 ⑩开关写回失败回滚开关态 ⑪`handleDelete` 同步剔除 `hidden_in_chat` 悬挂名（审查 9）⑫编辑弹窗模型 ID 灰显行（disabled、值=`model.model`、保存后原样透传）。
- [x] GREEN：`models-settings-page.tsx` 重构为「分组派生（纯函数）→ 组容器 → 行」；拖动按 `kb-list-panel` 写法接 `persist()`（**clamp 在 UI 行子块**）；写回序=**分组展平序**（组序×组内序，纯函数产出）；过滤函数 `!hidden_in_chat || is_default`（默认恒豁免）；`hidden_in_chat` 全量随每次 `persist()` 携带、`handleDelete` 同步剔除悬挂名；三处下拉消费点做可见选项过滤（全量列表留作 find/兜底）；编辑弹窗插模型 ID 行。
- [x] 门禁：前端全量 251 文件 / 2848 测试全绿 + `pnpm check`（eslint+tsc）双净。

## Task 3 — 门禁 + 文档回填

> 动到的文件：spec/plan 回填 + `frontend/AGENTS.md` + `backend/AGENTS.md` + `README.md`（若用户可见行为有说明价值）

- [ ] 全量门禁：后端 `pytest -m "not live" tests/`（basetemp 仓外、跑完删；红全定性在环境红带内、零新增）+ 前端全量 + `ruff`/`pnpm check` 双净。
- [ ] `frontend/AGENTS.md`「Interaction Ownership」models-settings 段补分组/拖动/`hidden_in_chat` 三句（含"过滤只在三处下拉的可选项、不进 useModels 本体"的不变量）；**`backend/AGENTS.md`「Models Configuration (models_config.json)」节补 `hidden_in_chat` 顶层名单 + `order_pinned` 派生字段一句**（该文件 schema 的权威文档，审查 7）；spec/plan 状态行回填；登记项定稿（spec §6：TUI picker 过滤留二期）。

## Task 4 — 真栈验收（只读 + 可还原）

> 动到的文件：零（真栈验证 + 状态还原）

- [ ] 观感验收（设置页）：分组合并容器 + 内缩分隔线（左起名称文字起点、右止图标区前）；行单行；黑胶囊消失、config_file 灰胶囊在；「默认」胶囊恰在第一行。**分组预期锚**（审查 10）：按当前配置应得两组——「OpenAI 兼容」×5、「DeepSeek」×1。
- [ ] 交互验收：UI 行组内拖动刷新后位置保持、config_file 行无拖柄不动；**拖往钉住行方向 no-op（clamp，★2）**；**拖→存→刷新→显示序不变（稳定性，★2）**；展示开关关掉后主对话/侧栏/知识库三处下拉消失该模型、agent 默认模型选择器与功能模型选择器仍在、已选中隐藏模型的会话仍正常显示所选；**默认模型恒在对话下拉（即使名单含它，★1）**；默认行开关禁用且悬浮给原因；编辑弹窗模型 ID 灰显、保存后模型 ID 不变。
- [ ] 收尾：所有开关/拖动改动**还原到验收前状态**（逐字节对 `models_config.json` 验 md5）；`config.yaml` 零改动。
