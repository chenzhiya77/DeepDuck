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

- [ ] RED → Implement → GREEN + revert proof + ruff 双净。
- [ ] Commit: `feat(config): structured model capabilities (window/effort subsets + defaults)`

## Task 2: 凭证/模型存在性校验端点（seam A）

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
  `supported_context_windows`/`supported_reasoning_efforts`/`reasoning_effort`）
- Modify: `frontend/src/core/models/api.ts`（`validateModelsConfig(...)` 客户端；`CONTEXT_WINDOW_OPTIONS`、
  `REASONING_EFFORT_LEVELS = [minimal,low,medium,high]` 常量）
- Modify: `frontend/src/core/models/batch.ts`（`BatchSharedFields` 增 supportedWindows/defaultWindow/
  supportedEfforts/defaultEffort；展开携带新字段；默认∈子集门控）
- Create: `frontend/src/core/models/capability-registry.ts`（按 model id 模式给建议能力，含窗口/强度子集；
  未知 → 空）
- Test: `frontend/tests/unit/models/capability.test.ts`（registry 已知/未知；展开携带；默认∈子集门控）

- [ ] RED → Implement → GREEN + `pnpm check` 双净。
- [ ] Commit: `feat(frontend): model capability types, validate client, curated capability registry`

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

## Task 5: 输入栏集成——推理深度读子集 + 修模式死条目（seam C dom）

**Files:**
- Modify: `frontend/src/components/workspace/input-box.tsx`（推理深度选择器选项 =
  `selectedModel.supported_reasoning_efforts ?? 全部 4 档`；模式菜单 `!supportThinking` 时隐藏
  thinking/pro/ultra 条目，只剩闪速，消除死条目；`getResolvedMode` 兜底保留）
- Modify: `frontend/src/components/workspace/sidecar/sidecar-panel.tsx`（同款模式门控对齐，若其菜单同渲染）
- Test: `frontend/tests/unit/**/input-box*.dom.test.tsx`（推理深度只列子集；`!supports_thinking` 时模式菜单
  无 thinking/pro/ultra；(T,F) 全模式无推理深度回归）

- [ ] RED → Implement → GREEN + revert proof + `pnpm check` 双净。
- [ ] Commit: `fix(frontend): gate mode menu and reasoning-effort levels by model capabilities`

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
| 强度词表三套漂移（前端 4 / 后端 agent 3 / qodercn 5） | 全局 | 本增量只用前端 4 档；词表统一另立增量（out of scope） |
| Radix 多选/分段在 happy-dom 不稳 | T4/T5 | 关键流转用稳定断言；枚举门控规则下沉 node 测试钉死 |
