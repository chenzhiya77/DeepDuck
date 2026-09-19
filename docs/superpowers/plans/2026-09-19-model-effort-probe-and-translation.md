# 推理档位：按协议翻译 + 配置期探测 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [2026-09-19-model-effort-probe-and-translation-design.md](../specs/2026-09-19-model-effort-probe-and-translation-design.md)
**Status:** 未开工（2026-09-19 起草；**同日第三轮更正** —— 对**当前代码**做了一次审查，改了 8 处，逐条记在这条里：
① **"可用集合"有两种、文档混成了一个** ⇒ spec §2 开头新增**两个集合的对照表**（**探测集合**＝配置期一次性、只有界面读得到、不落盘；**声明子集**＝跟着条目落盘、只有运行期工厂读得到），并把 D2 的越界回退**改成"对声明子集回退"**（原稿写"对该条目可用的档"，而工厂在请求期读不到探测结果）。原 §4#5 的触发条件也**不可能发生**（默认档必然属于声明子集，载入期校验保证），已改成"**调用方从请求层传越界档**"。
② **上一对那条 422 不是"换成另一条"，而是整条删除**：能替换成的判据（"值不在**可译集合**里"）**恒真**——我们四档全可译；而"默认档属于子集"早由载入期校验管着；想判"是否在**探测集合**里"也不可能（PUT 不探测、探测不落盘）⇒ §3 契约表与 Task 2 都改成"删掉，连同它那 4 条用例（**保留**控制组与'清干净就放行'）"。
③ **上一对刚落地的两个东西，原稿一个字没提**：工厂的 `_warn_anthropic_reasoning_effort`（翻译落地后它会变成**假警告**，`tests/test_model_factory.py` 那条用例要跟着改）、以及**界面 9 处 / 5 个文件**的"清空"落点（原稿影响面只列了编辑器 + 两个对话框，**漏了 `models-settings-page.tsx::toManagedInput` 与 `core/models/capability.ts`**）⇒ §5 改成**逐处点名的表格**。
④ **D3 的"探测优先"只在向导成立**：编辑对话框**没有探测入口**（不调 validate）⇒ 编辑路径恒为"来自声明"；原稿没提这一点，文案上会承诺一个做不到的来源标注。
⑤ **composer 那条深度菜单拿不到探测结果**（读的是公开列表的声明，探测不落盘）⇒ 原稿把它列进影响面（"候选来源：可用集合"）是错的，已改成"不动"。
⑥ **探测在本机那条端点上实测零收益**（一手核：`https://opencode.ai/zen/go/v1/models` ⇒ 200 / 37 条 / **0 条带 `capabilities`**）⇒ 写进 spec §6，并把 §4#14 的验收口径从"如果能找到这样的端点"改成**"探测＝桩验、真实端点无此元数据；翻译＝真实端点验过形状"**。
⑦ 顺带补：D2 的"**声明子集为空**"（＝未声明，既有兜底"每档可用"）与"**交集为空≠探不到**"两句；D4 增两条"不做"（不给编辑对话框加探测、不把探测结果塞进公开列表）。
⑧ §4 编号理顺并补齐（14/15 两条真栈与收尾；#15 记了上轮**快照被临时目录清理**的教训）。
⚠️ **一个待裁项（要你拍）**：实测显示 **D1（探测）在他的端点上零收益、D2（翻译）才是真收益** ⇒ **要不要把这对拆成"先只做翻译（立刻能用档位）、探测等有能填能力块的端点再补"**。不拆也能做，只是 Task 1 的验收只能靠桩。）
**Parent:** [2026-09-19-model-capability-protocol-check-design.md](../specs/2026-09-19-model-capability-protocol-check-design.md)（**已经落地**（四个提交）——它把"发错名字"的组合挡在写入口；本对落地时**删掉**那条 422、并**撤掉**它那条 lint，因为字段开始被翻译而不是原样转发）

**Architecture:** 两处新增都在既有链上：**探针**（扩 `POST /api/models/config/validate` 的响应，读 `ModelInfo.capabilities.effort`）+ **翻译**（`models/factory.py` 一处，把条目声明的档位翻成该协议的名字 `output_config.effort` / `reasoning_effort`，越界回退）。界面那两格改回"按可用集合渲染"。**探测只在配置期**、**结果不落盘**、**探不到静默回落**；`openai` 路径逐字节不变。

**依赖顺序**：Task 0（核实）→ Task 1（探测）→ Task 2（翻译 + **删掉**那条 422 + **撤掉**那条 lint）→ Task 3（前端恢复 + 候选来源）→ Task 4（文档 + 真栈）。

---

## Task 0 — 开工前的五项核实（只读，不改代码）

- [ ] 1. **既有探针的确切形状**：`app/gateway/routers/models.py` 里 validate 的实现（路径选择 `_ANTHROPIC_MODELS_PATH` / `_DEFAULT_MODELS_PATH`、头构造、10s 预算、`_MODELS_DETAIL_SAMPLE` 回显）与它的 **response model**。
      **本次审查已核掉一半**：`ModelsConfigValidateResponse` 现在有 `ok` / `model_present` / `detail` / `warning` 四个字段，路由上**确实带着 `response_model_exclude_none=True`**（`routers/models.py:490`，`warning` 就是"缺省而非 null"的现成先例）⇒ 新增可选字段的做法与风险都已经清楚。**剩下要核的**：`_MODELS_DETAIL_SAMPLE` 的回显路径会不会把新字段也截断/整形；以及"复用而不是新开端点"这一条的落地位置（`:511` 附近的那处路径分派）。
- [ ] 2. **探测读什么**：本机核 `ModelInfo` / `ModelCapabilities` / `EffortCapability` 的字段名（已核：`capabilities.effort.{supported,low,medium,high,max,xhigh}`、`thinking.{supported,types}`）；确认 `models.list()`（`GET /v1/models`）与 `models.retrieve()`（`GET /v1/models/{id}`）**哪个更可能有 `capabilities`**，以及 `effort.supported` 为假时的语义。⚠️ **读法要用 `model_dump()` 而不是属性**（老版本 SDK 属性拿不到但 dump 里还在，本仓 09-19 已定这条）。
- [ ] 3. **工厂里 `reasoning_effort` 的全部落点 + 上一对那条 lint 的处置**：`models/factory.py` 中它被读/被放/被剔的每一处（含 `:278` 的剔除、Codex 分支、`:318-328` 的两处 reconcile），确认**只加一处翻译**就够、且 `openai` 路径不受影响。同时核 `model_kwargs` 的透传（`output_config` 经它进请求体，本机实测可通）。
      ⚠️ **本次审查新增的一项**：上一对刚落了一条 `_warn_anthropic_reasoning_effort`（`factory.py:137`，调用点在 kwargs 组装末尾）——**翻译落地后它会变成假警告**（合法的 `reasoning_effort` 被翻译走了却还在报警）。核实要定：**删掉它**，还是把判据改成"到构造期还剩未翻译的 `reasoning_effort`"；并列出 `tests/test_model_factory.py:1512` 那条用例要怎么改。
- [ ] 4. **界面那两格现在的门 + 要撤回的 9 处**：上一对落成后它们的入参形状（`ModelCapabilityEditor` 的"这条腿能不能正确发送这套字段"）；确认**改动是"把假改真"还是"换一套入参语义"**（本对是把"能不能发"变成"可用集合是什么"）。
      ⚠️ **本次审查新增的一项**：按 `canSendEffortLevels` / `withoutEffortAxis` / `capabilityValueForProvider` 三个名字 grep，**上一对一共落了 9 处、5 个文件**（`core/models/capability.ts` 三个 helper；编辑器入参；编辑弹窗 2 处；添加弹窗 5 处；**`models-settings-page.tsx::toManagedInput`**）。**逐处点名列在 spec §5 的表格里**，核实就是照着那张表走一遍、确认没有第六个文件。
- [ ] 5. **真栈前置与反例**：网关 + 前端在跑；**动手前 `cp` 一份 `models_config.json` 原始字节**（⚠️ **别只放系统临时目录**——上一轮我的快照被清理过一次，见 spec §6）；把**百炼 anthropic 端点 `/v1/models` 404** 当成"静默回落"的现成反例记进用例。
      ⚠️ **本次审查已给出本机端点的实测**：`https://opencode.ai/zen/go/v1/models` ⇒ 200 / 37 条 / **0 条带 `capabilities`** ⇒ **探测那一段在他手上的端点上拿不到数据，Task 1 的真栈验收只能用桩**；"打一次真实调用"那一段仍可用它（真端点、只是没有能力元数据）。

**门禁**：无（只读）。

---

## Task 1 — 探针：validate 带上"这个模型支持哪些档"（D1）

- [ ] **RED**（`backend/tests/test_models_config_api.py`，挨着既有 anthropic 探针用例 `:341`/`:394`）：
  1. 桩一个返回 `capabilities.effort` 的假端点 ⇒ 响应里带上档位集合（逐档断言；**特意用非四档集合**如 `{low, high, max}`，证明不是把我们自己的四档回显）；
  2. **404 反例**：桩回 404 ⇒ **不报错**、档位字段缺省（并断言响应里没有把 404 当成"不支持"）；
  3. **没有 `capabilities`**：桩回一个最小 `{id, display_name}` ⇒ 同样缺省、不报错；
  4. **网络失败**：桩超时/连接拒绝 ⇒ 仍按既有探针语义（`ok=false` 那一套），档位缺省；
  5. **第三态：探到了但交集为空**（桩回只支持 `{xhigh, max}`，我们这边一个都不占）⇒ 字段是**空列表**、**不是缺省**。这条钉的是"缺省 ≠ 空"这个区分：路由上有 `response_model_exclude_none=True`，`None` 会被剔掉、`[]` 会留下 ⇒ **界面上"探不到"与"探到了但没有可用档"必须是两种可分辨的输入**（spec §D1 的第二个 ⚠️）。
- [ ] **GREEN**：在既有 validate 的探针响应里**新增可选字段**（档位集合；**没有则缺省、不是 null；交集为空则是 `[]`**）；路径与头**复用**既有实现（不新开端点）。
      ⚠️ **验收的端点是桩，不是本机那条**：一手实测 `https://opencode.ai/zen/go/v1/models` 回 200 / 37 条 / **0 条带 `capabilities`** ⇒ 拿它验"探测成功"是验不到的（它能验的是"探不到 ⇒ 缺省"这一档）。
- [ ] **neuter 两条**：① 把"缺省"改成"探不到就报不支持（空集合）" ⇒ 用例 2/3 红（证明"探不到 ≠ 不支持"有牙）；② 把档位集合改成**回显我们自己的四档** ⇒ 用例 1 红。
- [ ] **门禁**：`ruff check` + `ruff format --check` 干净；窄面（`tests/test_models_config_api.py`）绿；**全量后端后台跑** + 抽 FAILED/ERROR id 去 HEAD 跑同一批双向 diff（`xargs -d '\n'`；HEAD 那棵树要先 `cp` 仓库根本地环境文件进去）。

## Task 2 — 翻译：按协议的名字发出去 + 对声明子集回退 + 删掉那条 422 + 撤掉那条 lint（D2）

- [ ] **RED**（`backend/tests/test_model_factory.py`）：
  1. `ChatAnthropic` + 声明 `[low, medium, high]` ⇒ 请求体里 **`output_config: {effort: "medium"}`**，且**不出现** `reasoning_effort`；
  2. **`minimal` 那一行**：声明 `minimal` ⇒ `output_config: {effort: "low"}`；
  3. **回退（触发条件是请求层，不是"默认档越界"）**：条目**声明** `{low, high}`、**调用方从请求层传 `medium`** ⇒ 发出去的是回退值 `low`，**不抛**。⚠️ 原稿写的"声明的默认档不在可用集合里"**不可能发生**（载入期校验保证默认档属于子集）；而"可用集合"在本对里特指**声明子集**（工厂读不到探测集合，见 spec §2 开头那张表）；
  3b. **声明子集缺省时不回退**：条目没声明 `supported_reasoning_efforts` ⇒ 每个档都按名翻译、**不做任何回退**（这是既有 OpenAI 路径的行为，别在这里新造"拒绝发送"）；
  4. **对照组**：同一份声明换 `ChatOpenAI` ⇒ `reasoning_effort: "medium"`（**逐字节等于今天**）。
- [ ] **GREEN**：在 `models/factory.py` 的 `reasoning_effort` 处理处加**一处**翻译（协议 → 名字/字段 + 映射表 + 对**声明子集**的回退），两条腿共用；认不出的 `use` 仍走 OpenAI 形状。
- [ ] **删掉上一对那条 422（不是"改成另一条"）**：`_reject_anthropic_effort_levels`（`routers/models.py:259`）与它的调用点（`:684`）**一齐删**；`tests/test_models_config_api.py` 里那 4 条参数化用例（`:585`）**删除**，而**控制组**（`:606`，`openai-compatible` / `deepseek` + 同样三字段 ⇒ 200）与**"清干净就放行"**（`:619`）**保留**——它们验的是别的规矩。
      ⚠️ **为什么不换成"值必须在可译集合里"**（spec §3 已写明）：我们四档**全都可译** ⇒ 那条判据恒真、什么都不拦；而"默认档属于子集"早由载入期校验管着；判"是否在**探测集合**里"也不可能（PUT 不探测、探测不落盘）。**提交信息里要写明这是有意放开**（理由：字段开始被翻译，不再原样转发）。
- [ ] **同批处理上一对那条 lint（否则它变成假警告）**：`_warn_anthropic_reasoning_effort`（`factory.py:137`）在翻译落地后不能再对"会被翻译走的 `reasoning_effort`"报警 ⇒ **删掉它**（首选：那条警告存在的唯一理由是"这个键会被原样转发进 `model_kwargs`"，翻译之后理由消失），并同步改掉 `tests/test_model_factory.py:1512` 那条用例；连带 `_KWARG_DIVERT_CONSEQUENCE` 若因此只剩一处使用者，说明原委后再决定留不留。
- [ ] **neuter 两条**：① 把 `openai` 也走新翻译（例如强行把 `minimal` 也改写成别的）⇒ 用例 4 红；② 把回退去掉（原样发越界值）⇒ 用例 3 红。
- [ ] **门禁**：同 Task 1（ruff 双净 + 窄面 + 全量对照 HEAD）。

## Task 3 — 前端：那两格恢复 + 候选来自探测（优先）或声明（兜底）（D3）

- [ ] **RED**（`frontend/tests/unit/settings/models-capability-wizard.dom.test.tsx` / `models-settings-page.dom.test.tsx`）：
  1. anthropic 条目那两格**重新出现**（对照组：可用集合为空时才不出现）；
  2. **候选**：validate 回 `{low, high, max}` ⇒ 那两格只给交集里的档（`low/high`），**不出现 `medium`**（证明不是"总是四个"）；
  3. **回退渲染（触发条件已更正）**：**探测集合比声明子集窄**（端点说只支持 `{low, high}`、条目声明了四档）⇒ 提交前把越界的档与默认档一起收进交集里，界面显示的是**收进后的值**（不撒谎）。⚠️ 原稿写的"声明默认档不在可用集合里"**不可能发生**——载入期校验保证默认档属于声明子集，界面上唯一能越界的就是"探测集合更窄"这件事；
  4. **来源标注**：候选来自探测集合 vs 来自声明子集，在渲染里可读到（按界面词汇断言）；
  5. **两条路径的来源不同**（spec §D3 的 ⚠️）：**向导**（validate 回过档位）能读到"来自端点"；**编辑对话框**（没有探测入口）**只能是"来自声明"** ⇒ 各断言一次，别把编辑路径也写成"来自端点"；
  6. **撤回上一对**：一条 anthropic 条目带三件套 ⇒ 保存后这三个字段**照旧是提交上去的值**（不再被清空）。
- [ ] **GREEN**：`ModelCapabilityEditor` 的入参从"能不能发"（`canSendEffortLevels: boolean`）换成"**可用集合（+来源）**"；两个对话框按各自的路径给值（向导接 validate 的结果、编辑弹窗给声明）；向导建议按同一集合过滤；**按 spec §5 那张表逐处撤回上一对**（**5 个文件、9 处**）——`core/models/capability.ts` 的三个 helper、编辑器入参、编辑弹窗 2 处、添加弹窗 5 处、**`models-settings-page.tsx::toManagedInput`**（最容易漏：整集合 PUT 的必经之路）。`reasoning-effort.ts`（composer）**不动**。
- [ ] **neuter 三条**：① 候选改回"总是四档" ⇒ 用例 2 红；② 去掉回退 ⇒ 用例 3 红；③ 去掉来源标注 ⇒ 用例 4 红。
- [ ] **门禁**：`pnpm check`（零诊断）；prettier 逐文件与 HEAD 比数字；**全量前端**。

## Task 4 — 文档同步与真栈验收

- [ ] `backend/AGENTS.md`：记"**档位按协议翻译**（`output_config.effort` / `reasoning_effort`）+ **配置期探测**（`ModelInfo.capabilities.effort`）、**探不到静默回落声明集合**、**越界按声明子集回退**"。
      ⚠️ **同时要改掉上一对写下的两处**（否则文档自相矛盾）：① 那条"写入期对账"的 invariant 里写着"**这条拒绝是暂时的** ⇒ 后续那对会放开"——本对已把它**删掉**，这句要改成过去式或直接删；② 那条"Anthropic 家族通用表有意留空 + 工厂那条只查 `reasoning_effort` 的 lint"——**lint 本对已删**（翻译之后它没有理由存在），这条要重写。
- [ ] `frontend/AGENTS.md`：那两格的候选来自**探测集合（优先）/声明子集（兜底）**、并标来源，**且"来自端点"只在向导可见**（编辑对话框没有探测入口）；**同时改掉上一对写下的**"两格由 provider 决定渲不渲染、提交时清空"（本对已撤回）。
- [ ] **真栈验收（结论分两句写，别留"如果能找到端点"）**：
      ① **探测那一段只能用桩**：手上的 Anthropic 形状端点 `https://opencode.ai/zen/go` **实测不填 `capabilities`**（`/v1/models` 200 / 37 条 / **0 条带能力块**）⇒ 走"端点答 200 但没有能力块 ⇒ 缺省并回落声明"这一档（**这本身就是验收的一半**：确认真实世界里"探不到"能安静落地）。
      ② **翻译那一段用真端点验**：给它一条 `use=langchain_anthropic:ChatAnthropic` 的条目、打一次真实调用，确认请求体是 `output_config.effort` 且模型正常回话；**写明未打 `api.anthropic.com`**。
- [ ] **收尾**：配置**逐字节还原**（动手前 `cp` 过原始字节；网关在 Windows 上写 **CRLF + 2 空格**；**快照别只放系统临时目录**——上一轮我的那份被清理过，见 spec §6）、密钥不落盘、不新建残留文件。
- [ ] **门禁**：`frontend/AGENTS.md` 的 prettier 与 HEAD 同数（**必须在 `frontend/` 里跑**）；`models_config.json` md5 未变。
      ⚠️ **`backend/AGENTS.md` 没有 prettier 门禁**（上一对 Task 4 已查实：仓库根没有 prettier 配置；pre-commit 那条只管 `frontend/` 且 `types_or` 不含 markdown）⇒ 它的"与 HEAD 同数"只能看内容、不能用 prettier 数字衡量。

---

## 提交切分

| 提交 | 内容                                     |
| ---- | ---------------------------------------- |
| 0    | **本计划 + 它的 spec 成对**              |
| 1    | Task 1（探针带档位集合 + 三条回落 + 空交集第三态）  |
| 2    | Task 2（翻译 + 对声明子集回退 + **删掉**上一对那条 422 + **撤掉**它那条 lint） |
| 3    | Task 3（前端恢复 + 候选来源 + 按 5 文件撤回上一对 + 用例）     |
| 4    | Task 4（文档 + 真栈结论）                |

**依赖**：**上一对（`2026-09-19-model-capability-protocol-check`）已经落地**（`a9824e5b`/`56ebec1d`/`acc23f4f`/`bf6fd39e`/`3f5f0a5a`）——本对会**删掉**它那条 422、**撤掉**它那条 lint、并**撤回**它那 9 处界面清空。不改表、不改 schema、不动默认值；不做预算那一维、不为 OpenAI 形状做探测、不扩我们自己的档位值域、不给编辑对话框加探测、不把探测结果塞进公开列表。
