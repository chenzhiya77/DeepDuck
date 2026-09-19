# 推理档位：按协议翻译 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [2026-09-19-model-effort-probe-and-translation-design.md](../specs/2026-09-19-model-effort-probe-and-translation-design.md)
**Status:** 未开工（2026-09-19 起草；**同日两轮改动**：
**第三轮＝一次对当前代码的审查**（8 处，已全部落进 spec 与本计划）：①"可用集合"有两种、原稿混成了一个 ⇒ 后来只剩**声明子集**一个（见第四轮）；② 上一对那条 422 **不是"换成另一条"而是整条删除**（替代判据"值不在可译集合里"恒真）；③ 上一对刚落地的两个东西原稿没提 —— 工厂那条 anthropic lint（翻译后会变**假警告**）与界面 **9 处 / 5 个文件**的清空落点（原稿影响面漏了 `models-settings-page.tsx::toManagedInput` 与 `core/models/capability.ts`）；④ D3 的"探测优先"只在向导成立；⑤ composer 拿不到探测结果（原稿把它列进影响面是错的）；⑥ 探测在本机端点实测零收益；⑦ 补了两处边界（声明子集为空 / 交集为空≠探不到）；⑧ §4 编号理顺并记下**快照被临时目录清理**的教训。
**第四轮＝按"先翻译、后探测"拆**：实测本机所有可用端点都拿不到 `capabilities`（见 spec §6 的实测表），而翻译**不依赖探测、单独成立** ⇒ **探测（原 D1）整段摘出本对、登记在 spec §6**，等拿到会填能力块的端点再另起一对。本计划随之收成**三个 Task**（翻译 / 前端 / 文档+真栈），原来的"Task 1 探针"整条去掉。**文件名保留旧名**（`probe` 已名不副实）——已交付的上一对 spec 里有一条链接指向它。）

**Parent:** [2026-09-19-model-capability-protocol-check-design.md](../specs/2026-09-19-model-capability-protocol-check-design.md)（**已经落地**（四个提交）——它把"发错名字"的组合挡在写入口；本对**删掉**那条 422、并**撤掉**它那条 lint，因为字段开始被翻译而不是原样转发）

**Architecture:** 只有两件事：**翻译**（`models/factory.py` 一处，把条目声明的档位翻成该协议的名字 `output_config.effort` / `reasoning_effort`，越界时对**声明子集**回退）+ **撤回上一对**（写入期 422、工厂 lint、界面 9 处清空）。那两格改回按**声明子集**渲染。**`openai` 路径逐字节不变**；**不引入任何网络调用**。

**依赖顺序**：Task 0（核实）→ Task 1（翻译 + 删 422 + 撤 lint）→ Task 2（前端恢复 + 撤回清空）→ Task 3（文档 + 真栈）。

---

## Task 0 — 开工前的三项核实（只读，不改代码）

- [ ] 1. **工厂里 `reasoning_effort` 的全部落点 + 上一对那条 lint 的处置**：`models/factory.py` 中它被读/被放/被剔的每一处（含 `:278` 的剔除、Codex 分支、`:318-328` 的两处 reconcile），确认**只加一处翻译**就够、且 `openai` 路径不受影响。同时核 `model_kwargs` 的透传（`output_config` 经它进请求体，本机实测可通）。
      ⚠️ **上一对刚落了一条 `_warn_anthropic_reasoning_effort`**（`factory.py:137`，调用点在 kwargs 组装末尾）——**翻译落地后它会变成假警告**（合法的 `reasoning_effort` 被翻译走了却还在报警）。核实要定：**删掉它**，还是把判据改成"到构造期还剩未翻译的 `reasoning_effort`"；并列出 `tests/test_model_factory.py:1512` 那条用例要怎么改。
- [ ] 2. **界面那两格现在的门 + 要撤回的 9 处**：上一对落成后它们的入参形状（`ModelCapabilityEditor` 的 `canSendEffortLevels`）；确认改动是"**换一套入参语义**"（本对是把"这条腿能不能发"换成"**声明子集是不是空**"），不是"把假改真"。
      ⚠️ 按 `canSendEffortLevels` / `withoutEffortAxis` / `capabilityValueForProvider` 三个名字 grep，**上一对一共落了 9 处、5 个文件**（`core/models/capability.ts` 三个 helper；编辑器入参；编辑弹窗 2 处；添加弹窗 5 处；**`models-settings-page.tsx::toManagedInput`**）。**逐处点名列在 spec §5 的表格里**，核实就是照着那张表走一遍、确认没有第六个文件。
- [ ] 3. **真栈前置**：网关 + 前端在跑（或用私有端口的免登录实例跑当前工作树代码）；**动手前 `cp` 一份 `models_config.json` 原始字节**。
      ⚠️ **快照别只放系统临时目录**——上一轮我的那份**被清理过**，而工作树当时正处在被改状态（spec §6 记了全过程）；落点选一个不会被清的地方，或先用一次演练验好重建配方（**网关写这个文件在 Windows 上是 CRLF + 2 空格**）。
      ⚠️ 真栈会用到一条 **anthropic 形状**的条目（`use=langchain_anthropic:ChatAnthropic`）——本机现成的那条是 `minimax-m3`（走 `https://opencode.ai/zen/go`），它另有自己的问题（缺 `x-opencode-session` 头，**与本对无关**）⇒ **要么只用它验证"请求体形状"、要么另起一条条目**，别把它的 400 算到本对头上。

**门禁**：无（只读）。

---

## Task 1 — 翻译：按协议的名字发出去 + 对声明子集回退 + 删掉那条 422 + 撤掉那条 lint（D2）

- [ ] **RED**（`backend/tests/test_model_factory.py`）：
  1. `ChatAnthropic` + 声明 `[low, medium, high]` ⇒ 请求体里 **`output_config: {effort: "medium"}`**，且**不出现** `reasoning_effort`；
  2. **`minimal` 那一行**：声明 `minimal` ⇒ `output_config: {effort: "low"}`；
  3. **回退（触发面在界面之外）**：条目**声明** `{low, high}`、调用方从**请求层**传入 `medium` ⇒ 发出去的是回退值 `low`，**不抛**。⚠️ 原稿写的"声明的默认档不在可用集合里"**不可能发生**（载入期校验保证默认档属于子集）；真正能造出越界值的只有**请求层**与**自定义 agent 的 `config.yaml`**（界面上选不出来，因为候选就是声明子集）；
  3b. **声明子集缺省时不回退**：条目没声明 `supported_reasoning_efforts` ⇒ 每个档都按名翻译、**不做任何回退**（这是既有 OpenAI 路径的行为，别在这里新造"拒绝发送"）；
  4. **对照组**：同一份声明换 `ChatOpenAI` ⇒ `reasoning_effort: "medium"`（**逐字节等于今天**）。
- [ ] **GREEN**：在 `models/factory.py` 的 `reasoning_effort` 处理处加**一处**翻译（协议 → 名字/字段 + 映射表 + 对**声明子集**的回退），两条腿共用；认不出的 `use` 仍走 OpenAI 形状。
- [ ] **删掉上一对那条 422（不是"改成另一条"）**：`_reject_anthropic_effort_levels`（`routers/models.py:259`）与它的调用点（`:684`）**一齐删**；`tests/test_models_config_api.py` 里那 4 条参数化用例（`:585`）**删除**，而**控制组**（`:606`，`openai-compatible` / `deepseek` + 同样三字段 ⇒ 200）与**"清干净就放行"**（`:619`）**保留**——它们验的是别的规矩。
      ⚠️ **为什么不换成"值必须在可译集合里"**（spec §3 已写明）：我们四档**全都可译** ⇒ 那条判据恒真、什么都不拦；而"默认档属于子集"早由载入期校验管着。**提交信息里要写明这是有意放开**（理由：字段开始被翻译，不再原样转发）。
- [ ] **同批撤掉上一对那条 lint**：`_warn_anthropic_reasoning_effort`（`factory.py:137`）在翻译落地后不能再对"会被翻译走的 `reasoning_effort`"报警 ⇒ **删掉它**（首选：那条警告存在的唯一理由是"这个键会被原样转发进 `model_kwargs`"，翻译之后理由消失），并同步改掉 `tests/test_model_factory.py:1512` 那条用例；连带 `_KWARG_DIVERT_CONSEQUENCE` 若因此只剩一处使用者，说明原委后再决定留不留。
- [ ] **neuter 两条（都要有牙）**：① 把 `openai` 也走新翻译（例如强行把 `minimal` 也改写成别的）⇒ 用例 4 红；② 把回退去掉（原样发越界值）⇒ 用例 3 红。
- [ ] **门禁**：`ruff check` + `ruff format --check` 干净；窄面（`tests/test_model_factory.py` + `tests/test_models_config_api.py`）绿；**全量后端后台跑** + 抽 FAILED/ERROR 的 node id 去 HEAD 跑同一批、**双向 diff**（`xargs -d '\n'`，别 pipe 长跑；HEAD 那棵树要先 `cp` 仓库根本地环境文件进去 —— 四个 gitignored 文件：`config.yaml` / `models_config.json` / `extensions_config.json` / `rag_config.json`）。

## Task 2 — 前端：那两格恢复 + 撤回上一对（D3）

- [ ] **RED**（`frontend/tests/unit/settings/models-capability-wizard.dom.test.tsx` / `models-settings-page.dom.test.tsx`）：
  1. anthropic 条目那两格**重新出现**，候选就是**声明子集**（对照组：声明子集为空时不出现）；
  2. **撤回清空**：一条 anthropic 条目带三件套 ⇒ 保存后这三个字段**照旧是提交上去的值**（不再被清空）；
  3. **对照组**：`openai-compatible` 那条腿一字未变（既有"改能力子集"用例仍绿）。
- [ ] **GREEN**：`ModelCapabilityEditor` 的入参从"能不能发"（`canSendEffortLevels: boolean`）换成"**声明子集是否为空**"；两个对话框按各自的路径给值；**按 spec §5 那张表逐处撤回上一对**（**5 个文件、9 处**）——`core/models/capability.ts` 的三个 helper、编辑器入参、编辑弹窗 2 处、添加弹窗 5 处（含种子过滤与 provider 切换时的清空）、**`models-settings-page.tsx::toManagedInput`**（最容易漏：整集合 PUT 的必经之路）。`reasoning-effort.ts`（composer）**不动**。
- [ ] **neuter 两条**：① 把判据改回"provider 是不是 anthropic"（anthropic ⇒ 不渲染）⇒ 用例 1 红；② **只恢复渲染、不撤回提交时的清空** ⇒ 用例 2 红（neuter 只回退"清空"这一半，别连渲染一起还原，否则分不清哪半有牙）。
- [ ] **门禁**：`pnpm check`（eslint + tsc，**应为零诊断**）；prettier **逐文件与 HEAD 比"偏离区块数"**（不是行数——这些文件本来就有债、行数会随体量涨）；**全量前端**。

## Task 3 — 文档同步与真栈验收

- [ ] `backend/AGENTS.md`：记"**档位按协议翻译**（`output_config.effort` / `reasoning_effort`）、越界按**声明子集**回退"。
      ⚠️ **同时要改掉上一对写下的两处**（否则文档自相矛盾）：① 那条"写入期对账"的 invariant 里写着"**这条拒绝是暂时的** ⇒ 后续那对会放开"——本对已把它**删掉**，这句要改成过去式或直接删；② 那条"Anthropic 家族通用表有意留空 + 工厂那条只查 `reasoning_effort` 的 lint"——**lint 本对已撤**（翻译之后它没有理由存在），这条要重写。
- [ ] `frontend/AGENTS.md`：那两格**按声明子集渲染**；**同时改掉上一对写下的**"两格由 provider 决定渲不渲染、提交时清空"（本对已撤回）。
- [ ] **真栈验收**：起真栈 ⇒ 给一条 `use=langchain_anthropic:ChatAnthropic` 的条目填上档位 ⇒ 保存 ⇒ 打一次真实调用，确认请求体是 `output_config.effort` 且模型正常回话。**写清用的是哪个端点、未打 `api.anthropic.com`**（如果没打）。
      ⚠️ 若用本机现成的 `minimax-m3`（opencode Go），它**另有**缺 `x-opencode-session` 头导致的 400 —— 那是**另一个已登记的问题**，别混进本对的结论（见 Task 0#3）。
      ⚠️ 探测那一半**不在本对验收范围**（已摘出，见 spec §6）。
- [ ] **收尾**：配置**逐字节还原**（动手前 `cp` 过原始字节；网关在 Windows 上写 **CRLF + 2 空格**；**快照别只放系统临时目录**——上一轮我的那份被清理过，见 spec §6）、密钥不落盘、不新建残留文件。
- [ ] **门禁**：`frontend/AGENTS.md` 的 prettier 与 HEAD 同数（**必须在 `frontend/` 里跑**）；`models_config.json` md5 未变。
      ⚠️ **`backend/AGENTS.md` 没有 prettier 门禁**（上一对 Task 4 已查实：仓库根没有 prettier 配置；pre-commit 那条只管 `frontend/` 且 `types_or` 不含 markdown）⇒ 它的"与 HEAD 同数"只能看内容、不能用 prettier 数字衡量。

---

## 提交切分

| 提交 | 内容                                     |
| ---- | ---------------------------------------- |
| 0    | **本计划 + 它的 spec 成对**              |
| 1    | Task 1（翻译 + 对声明子集回退 + **删掉**上一对那条 422 + **撤掉**它那条 lint） |
| 2    | Task 2（前端恢复 + 按 5 文件撤回上一对 + 用例）     |
| 3    | Task 3（文档 + 真栈结论）                |

**依赖**：**上一对（`2026-09-19-model-capability-protocol-check`）已经落地**（`a9824e5b`/`56ebec1d`/`acc23f4f`/`bf6fd39e`/`3f5f0a5a`）——本对会**删掉**它那条 422、**撤掉**它那条 lint、并**撤回**它那 9 处界面清空。不改表、不改 schema、不动默认值；不做探测、不做预算那一维、不扩我们自己的档位值域。

**摘出本对的那一半去哪了**：**配置期探测**（原 D1）——它的设计、三种"探不到"、空交集的分辨、以及**本机五个端点的实测表**，全部登记在 spec §6，等拿到会填 `capabilities` 的端点再据此另起一对。
