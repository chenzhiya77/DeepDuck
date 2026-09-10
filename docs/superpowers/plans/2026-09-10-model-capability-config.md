# Plan: 模型能力配置（qodercn 式）增量 — 2026-09-10

**Spec**: `docs/superpowers/specs/2026-09-10-model-capability-config-design.md`
**前置**: `2026-09-10-web-model-provider-config.md`（Task 1–5 已交付，本增量在其上叠加，不重做）。

## 验证基线

- 后端：`cd backend && uv run --no-sync pytest <files> -q --basetemp=.pytest-tmp/capability`；
  `uv run --no-sync ruff check <files>` + `ruff format --check <files>` 双净。
- 前端：`cd frontend && python ../scripts/pnpm.py check`（eslint+tsc）双净；
  `python ../scripts/pnpm.py test <paths>`。
- Windows 陷阱：pytest 必须带 `--basetemp`（tmp_path 走系统 Temp 报 WinError 5）。

## 架构基调

- **UI 分两步，数据不分家**：两步向导编辑同一条 `ModelConfig`；提交沿用整体集合
  `PUT /api/models/config`。存储不拆实体。
- **不探测能力**：step1→step2 只做凭证/模型存在性校验；能力可选项来自前端 curated 表预填
  （标注建议值）或用户声明。
- 复用三个既有 seam：B（配置校验）/ A（admin API）/ C（前端），不新增 seam。

## Task 1: ModelConfig 能力字段 + 校验 + factory 隔离（seam B，spec §Implementation/存储形状）

**Files:**
- Modify: `backend/packages/harness/deerflow/config/model_config.py`（新增
  `supported_context_windows: list[int]|None` + `CONTEXT_WINDOW_OPTIONS` 枚举校验（∈/去重/升序/非空）；
  `context_window` 语义=默认 + 校验 ∈ supported；`reasoning_effort: Literal[low,medium,high,xhigh,max]|None`）
- Modify: `backend/packages/harness/deerflow/models/factory.py`（把 `supported_context_windows` 等新非
  provider 字段从构造 kwargs 排除，沿用 `context_window` 排除方式）
- Test: `backend/tests/test_models_config.py`（窗口子集/去重/升序、默认∈已选、强度枚举、旧文件无新字段
  仍可加载、**factory 排除**：新字段不进 provider kwargs）

- [ ] RED → Implement → GREEN + revert proof + ruff 双净。
- [ ] Commit: `feat(config): structured model capabilities (supported windows, default, effort levels)`

## Task 2: 凭证/模型存在性校验端点（seam A，spec §Implementation/校验端点）

**Files:**
- Modify: `backend/app/gateway/routers/models.py`（新增 `POST /api/models/config/validate`，admin 门控、
  不落盘；body `{provider, endpoint, api_key, model}`；按 provider→端点键拼 URL，Bearer key 调
  `GET {endpoint}/models`（有界超时）；返回 `{ok, model_present, detail}`）
- Test: `backend/tests/test_models_config_api.py`（admin 403；ok 路径 mock 上游 `/models`；
  `model_present=false`；不可达 → `ok=false`+detail；validate 不落盘）

- [ ] RED → Implement → GREEN + revert proof + ruff 双净。
- [ ] Commit: `feat(gateway): models config validate endpoint (credential + model presence)`

## Task 3: 前端能力类型/客户端/curated 表（seam C node）

**Files:**
- Modify: `frontend/src/core/models/types.ts`（`ManagedModel`/`ManagedModelInput` 增
  `supported_context_windows`/`reasoning_effort`）
- Modify: `frontend/src/core/models/api.ts`（`validateModelsConfig(...)` 客户端；`CONTEXT_WINDOW_OPTIONS`、
  `REASONING_EFFORT_LEVELS` 常量）
- Modify: `frontend/src/core/models/batch.ts`（`BatchSharedFields` 增 supportedWindows/defaultWindow/
  effort；展开携带新字段；默认∈已选门控）
- Create: `frontend/src/core/models/capability-registry.ts`（按 model id 模式给建议能力；未知 → 空）
- Test: `frontend/tests/unit/models/capability.test.ts`（registry 已知/未知；展开携带；默认∈已选门控）

- [ ] RED → Implement → GREEN + `pnpm check` 双净。
- [ ] Commit: `feat(frontend): model capability types, validate client, curated capability registry`

## Task 4: 两步向导 + 能力编辑器 + i18n（seam C dom）

**Files:**
- Modify: `frontend/src/components/workspace/settings/models-add-dialog.tsx`（改两步：step1 身份+凭证+
  Model ID 列表 →「下一步」调 validate → step2 能力编辑器：窗口多选+默认单选+能力 chip+强度分段
  （仅 supports_reasoning_effort 显示）；共享默认套用到批量 N 条；预填标注建议值）
- Modify: `frontend/src/components/workspace/settings/models-edit-dialog.tsx`（能力编辑器 + 可改凭证，
  身份冻结；旧数据无 supported 集合 → 默认=context_window 不报错）
- Modify: i18n `types.ts`/`en-US.ts`/`zh-CN.ts`（step 标签、200K/400K/1M、最小/低/中/高/极高、校验文案、
  supportedWindows/defaultWindow/suggested）
- Test: `frontend/tests/unit/settings/models-capability-wizard.dom.test.tsx`（step1→validate→step2；
  validate 失败阻止 step2；窗口多选+默认单选；强度分段门控；批量两 id → PUT payload 两条各带共享能力）

- [ ] RED → Implement → GREEN + revert proof + `pnpm check` 双净。
- [ ] Commit: `feat(frontend): two-step model wizard with capability editor (qodercn-style)`

## Task 5: 收官——回归 + 文档同步 + 浏览器实测

- [ ] 后端相关子集 GREEN + ruff 双净；前端 `pnpm check` 双净 + models/settings 套件对基线。
- [ ] Modify: `README.md`（用户面：两步添加/校验/能力配置）+ `backend/AGENTS.md`（架构面：能力字段语义、
  validate 端点、factory 隔离；orientation-layer 口径）。
- [ ] Commit: `docs: sync README and agent guide for model capability config`
- [ ] 浏览器实测（环境就绪时）：两步添加（校验通过→能力配置→保存）→ 聊天下拉/`GET /api/models` 反映；
  环境未就绪则延后并记录（对齐既有纪律）。

## 风险登记

| 风险 | 触发任务 | 缓解 |
|---|---|---|
| 新字段泄漏进 provider 构造 kwargs | T1 | factory 排除 + seam B 钉住「不进 kwargs」（沿用 PrivateAttr 教训） |
| validate 端点被滥用做 SSRF/自由 URL | T2 | 只接受白名单 provider + 端点键映射拼 URL，不收自由 URL；admin 门控；有界超时 |
| 默认窗口 ∉ 已选集合的非法组合 | T1/T4 | 配置层校验 + 前端提交门控双保险 |
| 旧 config 无新字段被误判损坏 | T1/T4 | 新字段全可选 + 向后兼容显示（默认=context_window） |
| curated 表预填被误读为「检测结果」 | T4 | UI 明确标注「建议值，可修改」；spec 明令不谎称探测 |
| Radix 多选/分段在 happy-dom 不稳 | T4 | 关键流转用稳定断言；枚举门控规则下沉 node 测试钉死 |
