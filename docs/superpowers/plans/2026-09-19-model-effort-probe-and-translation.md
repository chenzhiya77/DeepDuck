# 推理档位：按协议翻译 + 配置期探测 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [2026-09-19-model-effort-probe-and-translation-design.md](../specs/2026-09-19-model-effort-probe-and-translation-design.md)
**Status:** 未开工（2026-09-19 起草）
**Parent:** [2026-09-19-model-capability-protocol-check-design.md](../specs/2026-09-19-model-capability-protocol-check-design.md)（**必须先落地**：它把"发错名字"的组合挡在写入口；本对落地时**放开**那条 422，因为字段开始被翻译而不是原样转发）

**Architecture:** 两处新增都在既有链上：**探针**（扩 `POST /api/models/config/validate` 的响应，读 `ModelInfo.capabilities.effort`）+ **翻译**（`models/factory.py` 一处，把条目声明的档位翻成该协议的名字 `output_config.effort` / `reasoning_effort`，越界回退）。界面那两格改回"按可用集合渲染"。**探测只在配置期**、**结果不落盘**、**探不到静默回落**；`openai` 路径逐字节不变。

**依赖顺序**：Task 0（核实）→ Task 1（探测）→ Task 2（翻译 + 放开那条 422）→ Task 3（前端恢复 + 候选来源）→ Task 4（文档 + 真栈）。

---

## Task 0 — 开工前的五项核实（只读，不改代码）

- [ ] 1. **既有探针的确切形状**：`app/gateway/routers/models.py` 里 validate 的实现（路径选择 `_ANTHROPIC_MODELS_PATH` / `_DEFAULT_MODELS_PATH`、头构造、10s 预算、`_MODELS_DETAIL_SAMPLE` 回显）与它的 **response model**（新增可选字段是否要 `response_model_exclude_none=True` 才能"缺省而非 null"——本仓有先例：`warning` 那条注释就是为这个写的）。确认**复用**它而不是新开端点的可行性。
- [ ] 2. **探测读什么**：本机核 `ModelInfo` / `ModelCapabilities` / `EffortCapability` 的字段名（已核：`capabilities.effort.{supported,low,medium,high,max,xhigh}`、`thinking.{supported,types}`）；确认 `models.list()`（`GET /v1/models`）与 `models.retrieve()`（`GET /v1/models/{id}`）**哪个更可能有 `capabilities`**，以及 `effort.supported` 为假时的语义。
- [ ] 3. **工厂里 `reasoning_effort` 的全部落点**：`models/factory.py` 中它被读/被放/被剔的每一处（含 `:278` 的剔除、Codex 分支、`:318-328` 的两处 reconcile），确认**只加一处翻译**就够、且 `openai` 路径不受影响。同时核 `model_kwargs` 的透传（`output_config` 经它进请求体，本机实测可通）。
- [ ] 4. **界面那两格现在的门**：上一对 spec 落成后它们的入参形状（`ModelCapabilityEditor` 的"这条腿能不能正确发送这套字段"）；确认**改动是"把假改真"还是"换一套入参语义"**（本对是把"能不能发"变成"可用集合是什么"）。
- [ ] 5. **真栈前置与反例**：网关 + 前端在跑；**动手前 `cp` 一份 `models_config.json` 原始字节**；确认手上有**一个能填 `capabilities` 的 Anthropic 形状端点**（没有就用桩）；把**百炼 anthropic 端点 `/v1/models` 404** 当成"静默回落"的现成反例记进用例。

**门禁**：无（只读）。

---

## Task 1 — 探针：validate 带上"这个模型支持哪些档"（D1）

- [ ] **RED**（`backend/tests/test_models_config_api.py`，挨着既有 anthropic 探针用例 `:341`/`:394`）：
  1. 桩一个返回 `capabilities.effort` 的假端点 ⇒ 响应里带上档位集合（逐档断言；**特意用非四档集合**如 `{low, high, max}`，证明不是把我们自己的四档回显）；
  2. **404 反例**：桩回 404 ⇒ **不报错**、档位字段缺省（并断言响应里没有把 404 当成"不支持"）；
  3. **没有 `capabilities`**：桩回一个最小 `{id, display_name}` ⇒ 同样缺省、不报错；
  4. **网络失败**：桩超时/连接拒绝 ⇒ 仍按既有探针语义（`ok=false` 那一套），档位缺省。
- [ ] **GREEN**：在既有 validate 的探针响应里**新增可选字段**（档位集合；没有则缺省、不是 null）；路径与头**复用**既有实现（不新开端点）。
- [ ] **neuter 两条**：① 把"缺省"改成"探不到就报不支持（空集合）" ⇒ 用例 2/3 红（证明"探不到 ≠ 不支持"有牙）；② 把档位集合改成**回显我们自己的四档** ⇒ 用例 1 红。
- [ ] **门禁**：`ruff check` + `ruff format --check` 干净；窄面（`tests/test_models_config_api.py`）绿；**全量后端后台跑** + 抽 FAILED/ERROR id 去 HEAD 跑同一批双向 diff（`xargs -d '\n'`；HEAD 那棵树要先 `cp` 仓库根本地环境文件进去）。

## Task 2 — 翻译：按协议的名字发出去 + 越界回退 + 放开那条 422（D2）

- [ ] **RED**（`backend/tests/test_model_factory.py`）：
  1. `ChatAnthropic` + 声明 `[low, medium, high]` ⇒ 请求体里 **`output_config: {effort: "medium"}`**，且**不出现** `reasoning_effort`；
  2. **`minimal` 那一行**：声明 `minimal` ⇒ `output_config: {effort: "low"}`；
  3. **回退**：可用集合 `{low, high}`、声明 `medium` ⇒ 发出去的是回退值（`low`），**不抛**；
  4. **对照组**：同一份声明换 `ChatOpenAI` ⇒ `reasoning_effort: "medium"`（**逐字节等于今天**）。
- [ ] **GREEN**：在 `models/factory.py` 的 `reasoning_effort` 处理处加**一处**翻译（协议 → 名字/字段 + 映射表 + 回退），两条腿共用；认不出的 `use` 仍走 OpenAI 形状。
- [ ] **RED→GREEN（放开上一对的 422）**：`backend/tests/test_models_config_api.py` 里"anthropic 不许带 effort 三件套"的四条用例**改成**"允许，但值必须在可译集合里"（值不在集合里 ⇒ 422 保留）；**先让旧断言红、再改断言**，并在提交信息里说明**这是有意放开**（理由：字段开始被翻译）。
- [ ] **neuter 两条**：① 把 `openai` 也走新翻译（例如强行把 `minimal` 也改写成别的）⇒ 用例 4 红；② 把回退去掉（原样发越界值）⇒ 用例 3 红。
- [ ] **门禁**：同 Task 1（ruff 双净 + 窄面 + 全量对照 HEAD）。

## Task 3 — 前端：那两格恢复 + 候选来自探测（优先）或声明（兜底）（D3）

- [ ] **RED**（`frontend/tests/unit/settings/models-capability-wizard.dom.test.tsx` / `models-settings-page.dom.test.tsx`）：
  1. anthropic 条目那两格**重新出现**（对照组：可用集合为空时才不出现）；
  2. **候选**：validate 回 `{low, high, max}` ⇒ 那两格只给交集里的档（`low/high`），**不出现 `medium`**（证明不是"总是四个"）；
  3. **回退渲染**：声明默认档不在可用集合里 ⇒ 界面显示的是回退后的值（不撒谎）；
  4. **来源标注**：候选来自探测 vs 来自声明，在渲染里可读到（按界面词汇断言）。
- [ ] **GREEN**：`ModelCapabilityEditor` 的入参从"能不能发"换成"可用集合（+来源）"；两个对话框接 validate 的结果；向导建议按同一集合过滤；撤掉上一对的"anthropic ⇒ 不渲染 + 提交时清空"。
- [ ] **neuter 三条**：① 候选改回"总是四档" ⇒ 用例 2 红；② 去掉回退 ⇒ 用例 3 红；③ 去掉来源标注 ⇒ 用例 4 红。
- [ ] **门禁**：`pnpm check`（零诊断）；prettier 逐文件与 HEAD 比数字；**全量前端**。

## Task 4 — 文档同步与真栈验收

- [ ] `backend/AGENTS.md`：记"**档位按协议翻译**（`output_config.effort` / `reasoning_effort`）+ **配置期探测**（`ModelInfo.capabilities.effort`）、**探不到静默回落声明**、**值域不重合时的回退**"；并记"上一对那条 422 已在翻译落地后放开"。
- [ ] `frontend/AGENTS.md`：那两格的候选来自探测（优先）/声明（兜底），并标来源。
- [ ] **真栈验收**：起真栈 ⇒ 用一个**能填 `capabilities` 的 Anthropic 形状端点**（没有就用桩）走完整链：validate 拿到档位集合 ⇒ 保存 ⇒ 打一次真实调用验请求体是 `output_config.effort` 且模型正常回话；**结论要写明"桩/第三方端点验过、未打 `api.anthropic.com`"**（如果没有真 key）。
- [ ] **收尾**：配置**逐字节还原**（动手前 `cp` 过原始字节；网关在 Windows 上写 CRLF）、密钥不落盘、不新建残留文件。
- [ ] **门禁**：两份 `AGENTS.md` 的 prettier 与 HEAD 同数（**量 `frontend/AGENTS.md` 必须在 `frontend/` 里跑**）；`models_config.json` md5 未变。

---

## 提交切分

| 提交 | 内容                                     |
| ---- | ---------------------------------------- |
| 0    | **本计划 + 它的 spec 成对**              |
| 1    | Task 1（探针带档位集合 + 三条回落用例）  |
| 2    | Task 2（翻译 + 回退 + 放开上一对的 422） |
| 3    | Task 3（前端恢复 + 候选来源 + 用例）     |
| 4    | Task 4（文档 + 真栈结论）                |

**依赖**：**上一对（`2026-09-19-model-capability-protocol-check`）必须先落地**——本对会放开它那条 422。不改表、不改 schema、不动默认值；不做预算那一维、不为 OpenAI 形状做探测、不扩我们自己的档位值域。
