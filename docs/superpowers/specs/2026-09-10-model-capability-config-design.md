# 模型能力配置（qodercn 式）增量设计 — 2026-09-10

> 增量于 `2026-09-10-web-model-provider-config-design.md`（已交付 Task 1–5）。本 spec 把「模型能力」
> 从单步弹窗里的几个开关，升级为 qodercn 形态的**两步向导 + 结构化能力配置**：支持的上下文窗口
> （多选）+ 默认上下文窗口（单选）+ 能力 chip + 思考强度档位，并在 step1→step2 之间加入
> **凭证/模型存在性校验**。

## Problem Statement

用户在网页「设置 → 模型」添加模型时，能力配置过于粗糙：上下文窗口只有一个整数
`context_window`，思考强度只有一个布尔 `supports_reasoning_effort`，没有「这个模型支持哪些
上下文窗口档位、默认用哪档、思考强度选哪档」的结构化表达。对照 qodercn 的模型配置（支持的上下文
窗口多选 + 默认单选 + 能力 chip + 思考强度分段），DeerFlow 的现状既不好填也不好读；且添加时没有
「先校验 key/模型是否可用再进入能力配置」的反馈环，填错 key 要到真正发消息才暴露。

## Solution

采用 qodercn 的心智模型但**不做运行时能力探测**（标准 provider API 不暴露这些属性）：

1. **两步向导**：step1 = 身份 + 凭证（provider / API 类型 / 端点 / api_key / 可重复 Model ID）；
   点「下一步」先做**凭证 + 模型存在性校验**（用 key 调 `GET {endpoint}/models`），通过才进 step2。
2. **step2 = 能力配置**：支持的上下文窗口（多选，固定枚举 200K/400K/1M）+ 默认上下文窗口
   （单选，必须 ∈ 已选）+ 能力 chip（视觉/思考）+ 思考强度（5 档：low/medium/high/xhigh/max）。
   可选项由**内置 curated 能力表**按 model id 预填（标注「建议值，可修改」），未知/BYOK 模型默认空、
   由用户声明——与 qodercn「内置模型按矩阵给可选项、BYOK 由用户声明」一致。
3. **存储仍为单条 `ModelConfig`**（不拆实体）：新增 `supported_context_windows`、把
   `context_window` 语义定为「默认窗口」、新增 `reasoning_effort` 存所选档位。两步编辑同一对象，
   提交时合并，沿用既有整体集合 `PUT /api/models/config`。

## User Stories

1. As an admin, I want to add a model by first entering provider/endpoint/key and Model IDs, so that identity and credentials are captured before capabilities.
2. As an admin, I want the wizard to validate my API key and model id against the provider before I configure capabilities, so that a bad key fails fast instead of at first message.
3. As an admin, I want to be blocked from step 2 when validation fails, with a clear reason, so that I never persist an unreachable model.
4. As an admin, I want to select which context-window sizes a model supports (200K/400K/1M, multi-select), so that the model's real window options are recorded.
5. As an admin, I want to pick a default context window from the selected set, so that runs use a sane window by default.
6. As an admin, I want the default window constrained to the selected supported set, so that config cannot express an invalid combination.
7. As an admin, I want capability toggles (vision / thinking) shown as chips, so that capability declaration matches qodercn's familiar shape.
8. As an admin, I want a thinking-intensity selector (low/medium/high/xhigh/max), so that I can pin the model's default reasoning depth.
9. As an admin, I want the thinking-intensity selector hidden when the model does not support reasoning effort, so that I am not offered meaningless controls.
10. As an admin, I want known model ids to prefill suggested capabilities (windows/vision/thinking/effort), so that I do not re-declare well-known facts.
11. As an admin, I want prefilled values clearly labeled as suggestions I can override, so that I know they are not authoritative detections.
12. As an admin adding several Model IDs with one key, I want the shared capability defaults applied to every created model, so that batch add stays one action.
13. As an admin, I want to edit an existing model's capabilities (and credentials) without changing its provider/model/name, so that identity stays stable.
14. As a non-admin, I want the Models section hidden and the endpoints denied, so that capability editing remains admin-only.
15. As an operator editing config.yaml by hand, I want old files without the new fields to keep loading, so that the schema change is backward compatible.
16. As a developer, I want the new capability fields excluded from provider constructor kwargs, so that they cannot leak into adapter instantiation.
17. As a maintainer, I want capability validation (subset/dup/default-membership/effort enum) enforced at config load, so that bad values fail loudly.
18. As a user of the chat selector, I want stored defaults to be what runs use, so that configured capability choices actually take effect.

## Implementation Decisions

- **存储形状（已确认）**：扩展**单条** `ModelConfig`，不拆实体/不拆文件。新增/改语义字段：
  - `supported_context_windows: list[int] | None` —— 支持的窗口档位，取值限于固定枚举
    `CONTEXT_WINDOW_OPTIONS = [200_000, 400_000, 1_000_000]`；校验：元素 ∈ 枚举、去重、升序、非空（若设置）。
  - `context_window: int | None` —— 语义改为**默认窗口**；校验：若 `supported_context_windows` 与
    `context_window` 同时设置，则 `context_window ∈ supported_context_windows`。
  - `reasoning_effort: Literal["low","medium","high","xhigh","max"] | None` —— 所选思考强度档位
    （5 档，镜像 qodercn）。`supports_reasoning_effort: bool` 保留为「是否支持」的能力开关，二者区分
    「能力」与「选择」。agent 级既有 3 档 `reasoning_effort`（`agents_config`）为独立预存关注点，不在本增量加宽。
  - `supports_thinking` / `supports_vision` 布尔保留（能力 chip）。
  - `ModelConfig` 为 `extra="allow"`，新字段全部可选 ⇒ 旧 config.yaml / models_config.json 不受影响（向后兼容）。
- **provider-kwarg 隔离（沿用 PrivateAttr 教训）**：`create_chat_model` 必须把
  `supported_context_windows`（以及任何非 provider 参数的新字段）从构造 kwargs 中**排除**，沿用
  `context_window` 的既有排除方式；seam B 测试钉住「新字段不进入 provider 构造 kwargs」。
- **校验端点（已确认加）**：`POST /api/models/config/validate`（admin 门控，**不落盘**），body =
  `{provider, endpoint, api_key, model}`；服务端按 provider→端点键映射拼 URL，用 Bearer key 调
  `GET {endpoint}/models`（有界超时），返回 `{ok, model_present, detail}`。`ok=false`（不可达/鉴权失败）
  或 `model_present=false` 时前端阻止进入 step2。复用 `PROVIDER_ALLOWLIST` 的端点键映射，不引入自由 URL。
- **curated 能力表（前端纯模块）**：`core/models/capability-registry.ts`，按已知 model id 模式给出建议
  `{supported_context_windows, supports_vision, supports_thinking, reasoning_effort}`；未知 id → 空默认
  （用户声明）。纯函数、node 可测。预填在 UI 标注「建议值，可修改」，**不谎称检测结果**。
- **两步向导（UI 分步，数据不分家）**：step1 身份+凭证（含批量 Model ID 列表）；「下一步」→ 调 validate
  → 通过进 step2；step2 能力编辑器（窗口多选 + 默认单选 + 能力 chip + 强度分段），作为**共享默认**套用到
  批量 N 条（与既有批量展开语义一致）；提交走既有整体集合 `PUT /api/models/config`（复用
  `expandBatchToEntries`，新增字段随 entry 携带）。编辑弹窗 = 能力编辑器 + 可改凭证，身份字段冻结。
- **向后兼容显示**：仅有 `context_window`、无 `supported_context_windows` 的旧数据 → UI 视为「未声明支持
  集合」，默认 = `context_window`，不报错。
- **i18n**：`types.ts`/`en-US.ts`/`zh-CN.ts` 新增 step 标签、窗口档位（200K/400K/1M）、强度 5 档
  （最小/低/中/高/极高）、校验成功/失败文案、`supportedWindows`/`defaultWindow`/`suggested` 等键。

## Testing Decisions

- 好测试 = 外部行为（校验规则、端点契约、向导流转、PUT payload），不测内部实现细节。
- **Seam B（复用）** `backend/tests/test_models_config.py`：窗口子集/去重/升序、默认∈已选、强度枚举、
  旧文件无新字段仍可加载；**factory 排除**：新字段不进入 provider 构造 kwargs。
- **Seam A（复用）** `backend/tests/test_models_config_api.py`：validate 端点 admin 403；ok 路径（mock
  上游 `/models`）；`model_present=false`；不可达 → `ok=false`+detail；validate **不落盘**（models_config.json 不变）。
- **Seam C（复用）** `frontend/tests/unit/models/*.test.ts`（node）：registry 已知 id 预填 / 未知 id 空；
  批量展开携带 supported windows/默认/强度；默认∈已选的提交门控。
  `frontend/tests/unit/settings/*.dom.test.tsx`（dom）：step1→validate→step2 流转；validate 失败阻止 step2；
  窗口多选+默认单选；强度分段仅在 supports_reasoning_effort 时显示；批量两 id → PUT payload 两条各带共享能力。
- 先例：既有 `test_models_config.py` / `test_models_config_api.py` / `batch.test.ts` /
  `models-settings-page.dom.test.tsx` 的夹具与断言风格。

## Out of Scope

- 运行时能力探测（标准 API 探测不到窗口/视觉/思考/强度，不做）。
- per-user BYO key / 多租户；Fast 模式；Credit/定价。
- 聊天选择器在请求级切换窗口/强度（本增量只存默认值；请求级切换另立增量）。
- 加宽 agent 级 3 档 `reasoning_effort` 到 5 档。
- `make setup` 写 `models_config.json`；前端配后端地址。

## Further Notes

- qodercn 参照（docs.qoder.cn / docs.qoder.com，2026-09 检索）：能力选项为**按模型 curated 矩阵**
  （文档明列各模型支持哪些参数），上下文窗口固定枚举 200K/400K/1M，思考强度 low/medium/high/xhigh/max；
  BYOK 添加流「验证通过后自动保存」= 凭证/模型校验，**非能力探测**；BYOK 的能力由用户在表单声明。
  DeerFlow 镜像该形态但以 curated 表预填 + 用户覆盖实现，不探测。
- 本增量不改动已交付 Task 1–5 的安全支点（独立可写文件、provider 白名单、来源 PrivateAttr、哨兵脱敏）。
