# Plan: 模型能力配置增量 — 2026-09-10（修订版）

**Spec**: `docs/superpowers/specs/2026-09-10-model-capability-config-design.md`（修订版）
**前置**: `2026-09-10-web-model-provider-config.md`（Task 1–5 已交付，本增量在其上叠加，不重做）。
**修订要点**: 强度复用项目既有 4 档（minimal/low/medium/high），不引入 qodercn 5 档；新增输入栏集成
（推理深度读子集 + 修模式菜单死条目）。

## 验证基线

- 后端：`cd backend && uv run --no-sync pytest <files> -q --basetemp=.pytest-tmp/capability`；
  `uv run --no-sync ruff check <files>` + `ruff format --check <files>` 双净。
- 前端：`cd frontend && python ../scripts/pnpm.py check`（eslint+tsc）双净；
  `python ../scripts/pnpm.py test <paths>`。
- Windows 陷阱：pytest 必须带 `--basetemp`（tmp_path 走系统 Temp 报 WinError 5）。

## 架构基调

- **UI 分两步，数据不分家**：两步向导编辑同一条 `ModelConfig`；提交沿用整体集合 `PUT /api/models/config`。
- **不探测能力**：step1→step2 只做凭证/模型存在性校验；可选项来自 curated 表预填（标注建议值）或用户声明。
- **词表复用**：强度用既有 4 档（minimal/low/medium/high），与输入栏 `threads/types.ts` 一致。
- 复用三个既有 seam：B（配置校验）/ A（admin API）/ C（前端），不新增 seam。

## Task 1: ModelConfig 能力字段 + 校验 + factory 隔离（seam B）

**Files:**
- Modify: `backend/packages/harness/deerflow/config/model_config.py`（新增
  `supported_context_windows: list[int]|None` + `CONTEXT_WINDOW_OPTIONS=[200_000,400_000,1_000_000]` 校验
  （∈/去重/升序/非空）；`context_window` 语义=默认 + 校验 ∈ 子集；
  `reasoning_effort: Literal[minimal,low,medium,high]|None`；
  `supported_reasoning_efforts: list[同枚举]|None` 子集校验（∈/去重/按枚举序/非空）+ 默认 ∈ 子集）
- Modify: `backend/packages/harness/deerflow/models/factory.py`（把 `supported_context_windows`、
  `supported_reasoning_efforts` 等非 provider 字段从构造 kwargs 排除，沿用 `context_window` 排除方式）
- Test: `backend/tests/test_models_config.py`（窗口子集/去重/升序、默认∈已选、强度子集/默认∈子集、
  旧文件无新字段仍可加载、factory 排除：新字段不进 provider kwargs）

- [x] RED → Implement → GREEN + revert proof + ruff 双净。（新增 17 例（16 seam B + 1 factory）：126 绿；revert proof：neuter 校验+排除 → 10 红 → 恢复；模型/配置回归 200 绿；ruff check+format 双净。遗留 `test_missing_models_file_falls_back_to_config_yaml` 失败已 stash 复证为环境性——本地根 `models_config.json` 被发现，与本增量无关）
- [x] Commit: `feat(config): structured model capabilities (window/effort subsets + defaults)`（44910b71；factory 排除落在 `test_model_factory.py`，紧邻既有 `context_window`/`pricing` 排除先例）

## Task 2: 凭证/模型存在性校验端点（seam A）

**Files:**
- Modify: `backend/app/gateway/routers/models.py`（新增 `POST /api/models/config/validate`，admin 门控、
  不落盘；body `{provider, endpoint, api_key, model}`；按 provider→端点键拼 URL，Bearer key 调
  `GET {endpoint}/models`（有界超时）；返回 `{ok, model_present, detail}`）
- Test: `backend/tests/test_models_config_api.py`（admin 403；ok 路径 mock 上游 `/models`；
  `model_present=false`；不可达 → `ok=false`+detail；validate 不落盘）

- [x] RED → Implement → GREEN + revert proof + ruff 双净。（新增 9 例：admin 403 / ok 命中（含 URL+Bearer 断言）/
  `model_present=false`（回显可用 id）/ 不可达 / 上游 401（detail 不含 key）/ Anthropic 原生探测（`/v1/models` +
  `x-api-key`+`anthropic-version`，无 Authorization）/ 未知 provider 422（零上游调用）/ 非 http 端点 422 / 不落盘
  （文件字节不变 + `GET /api/models` 不含该模型）；`test_models_config_api.py` **18 绿**；回归
  models_config+models_authorization+model_factory **167 绿**（唯一失败 `test_missing_models_file_falls_back_to_config_yaml`
  为 T1 已复证的环境性——仓库根存在真实 `models_config.json` 且 cwd 上溯被发现，与本增量无关）；ruff check+format 双净。
  revert proof：neuter ①admin 门控 ②`model_present` 恒真 ③Anthropic 头部→恒 Bearer ⇒ **3 红**
  （requires_admin / reports_model_absent / uses_anthropic_native_probe）；恢复后全绿）
- [x] Commit: `feat(gateway): models config validate endpoint (credential + model presence)`

#### Task 2 交付纪要（2026-09-10）

- **实现落点**：`app/gateway/routers/models.py` 新增 `POST /api/models/config/validate`（admin 门控、
  `extra="forbid"`、**不落盘**），返回 `{ok, model_present, detail}`；辅助件 `_models_probe_url`（端点+路径拼接、
  去重 `/models` 与 `/v1` 前缀）/ `_models_probe_headers`（Anthropic 原生 vs Bearer）/ `_extract_model_ids`
  （`{"data":[{"id"}]}` 与裸字符串列表）/ `_probe_failure`。声明在 `/models/{model_name}` **之前**（沿用既有 NOTE 区）。
- **决策（偏离原计划文字，已记）**：计划写「Bearer key 调 `GET {endpoint}/models`」，但 Anthropic 既不在
  `/models` 列模型（实际是 `/v1/models`）也不用 Bearer（是 `x-api-key` + 必需 `anthropic-version`）——
  照字面实现会让三个白名单 provider 之一**永久校验失败**、反而挡住合法 Anthropic 模型。故按 provider 分派
  路径/头部（openai-compatible + deepseek 仍为 `/models` + Bearer），并加一例钉死。
- **URL 拼接口径**：`endpoint` 视为**基址**，路径由服务端固定追加（不收自由路径）；同时容忍用户粘贴
  `.../v1` 或完整 `.../models`（避免 `/v1/v1/models`、`/models/models`）。`endpoint` 必填，须 http(s)
  （pydantic validator，非 http → 422 且不发起请求）。
- **不泄漏**：`detail` 从不拼接 `api_key`；上游错误只回状态码 + 折叠空白后 ≤200 字符的响应片段（有断言）。
- **有界**：`httpx.AsyncClient(timeout=10.0)`；网络类异常（`httpx.HTTPError`/`InvalidURL`）→ `ok=false` 而非 500。
- **对 Task 3/4 的接口约束**：①前端 step1 需把「端点」设为**必填**（当前 add 弹窗允许留空，validate 不收空端点）；
  ②body 字段名冻结为 `{provider, endpoint, api_key, model}`，响应 `{ok, model_present, detail}`；
  ③`detail` 是英文技术文案，前端可自行用 i18n 文案覆盖展示。
- **遗留（未动）**：Task 3（前端类型/客户端/curated 表）、Task 4（两步向导）、Task 5（输入栏/运行时）、Task 6（收官+文档+浏览器实测）。

## Task 3: 前端能力类型/客户端/curated 表（seam C node）

**Files:**
- Modify: `frontend/src/core/models/types.ts`（`ManagedModel`/`ManagedModelInput` 增
  `supported_context_windows`/`supported_reasoning_efforts`/`reasoning_effort`）
- Modify: `frontend/src/core/models/api.ts`（`validateModelsConfig(...)` 客户端；`CONTEXT_WINDOW_OPTIONS`、
  `REASONING_EFFORT_LEVELS = [minimal,low,medium,high]` 常量）
- Modify: `frontend/src/core/models/batch.ts`（`BatchSharedFields` 增 supportedWindows/defaultWindow/
  supportedEfforts/defaultEffort；展开携带新字段；默认∈子集门控）
- Create: `frontend/src/core/models/capability-registry.ts`（按 model id 模式给建议能力，含窗口/强度子集；
  未知 → 空）
- Test: `frontend/tests/unit/models/capability.test.ts`（registry 已知/未知；展开携带；默认∈子集门控）

- [x] RED → Implement → GREEN + `pnpm check` 双净。（`capability.test.ts` 新建，**16 绿**：词表常量=后端 200K/400K/1M 与
  minimal/low/medium/high / registry claude+claude 无强度子集 / gpt-5 全 4 档+默认 medium / gpt-4.1 与 gpt-4o 不串档 /
  deepseek-reasoner 仅 thinking / deepseek-chat 非推理 / 大小写 / 未知与空 id → `{}` / 返回拷贝不可污染表 /
  展开携带窗口+强度子集与默认 / 默认 ∉ 子集被丢（窗口、强度各一）/ 空子集不发 `[]` / 无子集时保留旧 `contextWindow` /
  validate 客户端 POST+body 与错误 detail 映射。既有 `batch.test.ts` 6 例仍绿（旧契约未破）；
  `tests/unit/models`+`tests/unit/settings` 全绿；`pnpm check`（eslint+tsc）**exit 0**。
  revert proof：neuter `gatedDefault`（恒返回默认值）⇒ **3 红**（窗口默认、强度默认、空子集）；恢复后全绿）
- [x] Commit: `feat(frontend): model capability types, validate client, curated capability registry`

#### Task 3 交付纪要（2026-09-10）

- **实现落点**：`core/models/types.ts`（`ReasoningEffortLevel` + `ManagedModel`/`ManagedModelInput` 增
  `supported_context_windows`/`supported_reasoning_efforts`/`reasoning_effort` + validate 的入参/出参类型）；
  `core/models/api.ts`（`CONTEXT_WINDOW_OPTIONS`/`REASONING_EFFORT_LEVELS` 常量 + `validateModelsConfig`，
  失败走 `ModelsConfigRequestError`）；`core/models/batch.ts`（`BatchSharedFields` 增
  supportedWindows/defaultWindow/supportedEfforts/defaultEffort；`declaredSubset`+`gatedDefault` 门控）；
  `core/models/capability-registry.ts`（新建）。
- **curated 表口径（7 行，全部只写厂商明面事实）**：claude→200K+vision+thinking（**不声称强度子集**：Anthropic 是
  thinking budget，不是 effort 档位）；gpt-5→400K+全 4 档+默认 medium+vision；gpt-4.1→1M+vision；
  gpt-4o/4-turbo→仅 vision（128K 不在枚举内，故不声明窗口）；o1/o3/o4→200K+low/medium/high+默认 medium；
  deepseek-reasoner→thinking；deepseek-chat/v3→非 thinking。**未声称**的一律留空，由用户声明（spec §5.3.2 明令不谎称探测）。
- **函数纯度**：`suggestCapabilities` 对结果做拷贝（含数组），避免调用方原地改表污染后续预填（有测试钉住）；
  空/空白 id → `{}`。
- **`defaultWindow` 的语义分隔**：声明了子集 ⇒ 默认必须 ∈ 子集（否则丢弃）；未声明子集 ⇒ 旧 `contextWindow`
  单值语义原样保留（既有 6 例不破）。空数组视为「未声明」而非「不支持任何档位」，避免提交后端必拒的空列表。
- **⚠ 计划缺口（Task 3 交付时发现，待确认后补）**：
  1. **后端 PUT 尚不接收新字段**——`app/gateway/routers/models.py` 的 `ManagedModelInput` 是 `extra="forbid"`
     且 `put_models_config` 的 entry 字典未含三个新字段，前端一旦提交 `supported_context_windows` 等即 **422**
     （或若被静默丢弃则能力永不落盘）。计划中 Task 1（harness）/Task 2（validate）/Task 3（前端）**都没有**覆盖写入路径，
     需补一个小任务（建议「Task 3.5：PUT/GET 透传能力字段 + seam A 测试」）或并入 Task 4。
  2. **`toManagedInput` 会丢新字段**——`models-settings-page.tsx:30` 逐字段重建 PUT 入参；整体集合写语义下，
     任意一次保存（增/改/删）都会抹掉**所有其它模型**的能力子集。Task 4 需补该映射并加「保存往返不丢能力」用例。
  3. **`supports_reasoning_effort` 布尔不在 curated 形状内**（spec 只列了 5 个键）：Task 4 需按
     `supported_reasoning_efforts` 是否声明来推导该 chip 的预填状态，否则 Task 5 的输入栏门控
     （`supports_reasoning_effort && mode !== "flash"`）不会亮、强度子集形同虚设。
  4. curated 形状**不含默认窗口**：Task 4 自行决定预填规则（建议：子集只有一个 → 直接选中；多个 → 留空由用户选）。

## Task 3': 后端 PUT/GET 透传能力字段（seam A 补口，缺口 1）

> 由 Task 3 交付纪要发现：前端已能构造三条新字段，但写入路径不接收 ⇒ 里程碑不可用。
> 计划原文未列此任务；**待用户确认后**执行（或并入 Task 4）。

**Files:**
- Modify: `backend/app/gateway/routers/models.py`（`ManagedModelInput` 增 `supported_context_windows`/
  `supported_reasoning_efforts`/`reasoning_effort`；`ManagedModelResponse` 与其映射同步；`put_models_config`
  的 entry 字典透传三者） + `backend/tests/test_models_config_api.py`（PUT 后落盘含子集/默认；GET 回读一致；
  非法组合（默认 ∉ 子集）→ 422；旧客户端不带新字段仍可写）

## Task 4: 两步向导 + 能力编辑器 + i18n（seam C dom）

**Files:**
- Modify: `frontend/src/components/workspace/settings/models-add-dialog.tsx`（改两步：step1 身份+凭证+
  Model ID 列表 →「下一步」调 validate → step2 能力编辑器：窗口多选+默认单选+能力 chip+强度子集多选+
  默认强度单选；共享默认套用到批量 N 条；预填标注建议值）
- Modify: `frontend/src/components/workspace/settings/models-edit-dialog.tsx`（能力编辑器 + 可改凭证，
  身份冻结；旧数据无子集 → 默认=context_window / 全 4 档，不报错）
- Modify: i18n `types.ts`/`en-US.ts`/`zh-CN.ts`（step 标签、200K/400K/1M、supportedWindows/defaultWindow/
  supportedEfforts/defaultEffort/suggested/校验文案；强度标签复用既有 inputBox.reasoningEffort*）
- Test: `frontend/tests/unit/settings/models-capability-wizard.dom.test.tsx`（step1→validate→step2；
  validate 失败阻止 step2；窗口多选+默认单选；强度子集呈现；批量两 id → PUT payload 两条各带共享能力）

- [ ] RED → Implement → GREEN + revert proof + `pnpm check` 双净。
- [ ] Commit: `feat(frontend): two-step model wizard with capability editor`

## Task 5: 输入栏/运行时集成——推理深度读子集 + 修模式死条目 + 模型默认档生效（seam C dom + 后端）

**Files:**
- Modify: `frontend/src/components/workspace/input-box.tsx`（推理深度选择器选项 =
  `selectedModel.supported_reasoning_efforts ?? 全部 4 档`；模式菜单 `!supportThinking` 时隐藏
  thinking/pro/ultra 条目，只剩闪速，消除死条目；`getResolvedMode` 兜底保留；
  **方案 A 解析序**：handleModeSelect/自动初始化不再无条件重写 effort —— 用户手选 > 模型默认 > 模式启发式；
  选中模型时预选 `model.reasoning_effort`）
- Modify: `frontend/src/core/threads/hooks.ts`（发送前 effort 解析对齐方案 A：context 显式 > 模型默认 > 模式启发式）
- Modify: `frontend/src/components/workspace/sidecar/sidecar-panel.tsx`（同款模式门控对齐，若其菜单同渲染）
- Modify: `backend/packages/harness/deerflow/agents/lead_agent/agent.py`（解析链插入模型默认兜底环：
  request > agent > model > None，供非 UI 调用方；模型默认取 `ModelConfig.reasoning_effort` 且 ∈ 子集）
- Test: `frontend/tests/unit/**/input-box*.dom.test.tsx`（推理深度只列子集；`!supports_thinking` 时模式菜单
  无 thinking/pro/ultra；(T,F) 全模式无推理深度回归；**模式切换不覆盖模型默认；预选模型默认**）
- Test: `backend/tests/test_lead_agent_runtime_options.py`（或既有 lead_agent 测试）：无 request/agent effort
  时落到模型默认；有 request effort 时 request 赢

- [ ] RED → Implement → GREEN + revert proof + `pnpm check` 双净。
- [ ] Commit: `fix(frontend): gate mode menu and reasoning-effort levels by model capabilities`
- [ ] Commit: `feat(runtime): honor per-model default reasoning effort (user > model > mode heuristic)`

## Task 6: 收官——回归 + 文档同步 + 浏览器实测

- [ ] 后端相关子集 GREEN + ruff 双净；前端 `pnpm check` 双净 + models/settings/input-box 套件对基线。
- [ ] Modify: `README.md`（用户面：两步添加/校验/能力子集）+ `backend/AGENTS.md`（架构面：能力字段语义、
  validate 端点、factory 隔离；orientation-layer 口径）+ `frontend/AGENTS.md`（输入栏门控说明）。
- [ ] Commit: `docs: sync guides for model capability config`
- [ ] 浏览器实测（环境就绪时）：两步添加（校验通过→能力配置→保存）→ 输入栏推理深度/模式门控反映；
  环境未就绪则延后并记录（对齐既有纪律）。

## 风险登记

| 风险 | 触发任务 | 缓解 |
|---|---|---|
| 新字段泄漏进 provider 构造 kwargs | T1 | factory 排除 + seam B 钉住「不进 kwargs」 |
| validate 端点被滥用做 SSRF/自由 URL | T2 | 只收白名单 provider + 端点键映射拼 URL；admin 门控；有界超时 |
| 默认窗口/强度 ∉ 子集的非法组合 | T1/T4 | 配置层校验 + 前端提交门控双保险 |
| 旧 config 无新字段被误判损坏 | T1/T4 | 新字段全可选 + 向后兼容显示（默认=context_window / 全 4 档） |
| curated 预填被误读为「检测结果」 | T4 | UI 标注「建议值，可修改」；spec 明令不谎称探测 |
| 输入栏门控改动破坏既有 (T,T)/(T,F) 行为 | T5 | 回归三形态 dom 测试；`getResolvedMode` 兜底保留 |
| 方案 A 改变模式→effort 既有语义（ultra 不再强制 high） | T5 | 仅当模型声明默认时模式不重写 effort；无默认保留启发式；dom 测试钉住两分支 |
| 强度词表三套漂移（前端 4 / 后端 agent 3 / qodercn 5） | 全局 | 本增量只用前端 4 档；词表统一另立增量（out of scope） |
| Radix 多选/分段在 happy-dom 不稳 | T4/T5 | 关键流转用稳定断言；枚举门控规则下沉 node 测试钉死 |
