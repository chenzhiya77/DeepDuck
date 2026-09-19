# 推理档位：按协议翻译 + 配置期探测 —— 设计

**Status:** 未开工（2026-09-19 起草）
**Parent:** [2026-09-10-model-capability-config-design.md](2026-09-10-model-capability-config-design.md)（声明层）· [2026-09-19-model-capability-protocol-check-design.md](2026-09-19-model-capability-protocol-check-design.md)（**它先落地**：把"发错名字"的组合挡在写入口；本 spec 把那条拒绝**删掉**、并撤掉它那条 lint，因为字段从此会被翻译而不是原样转发）

## 1. 问题

能力声明层只认**一套词汇**：`supported_reasoning_efforts` / `reasoning_effort`（`minimal/low/medium/high`）。工厂按条目字段名**原样转发**，于是：

1. **名字对不上协议**：同一件事在两家叫两个名字——OpenAI 形状 `reasoning_effort`（今天恰好同名，所以"看起来没翻译"），Anthropic 形状 **`output_config.effort`**（`anthropic` 0.97.0 稳定版 `types/message_create_params.py:138`，值域 `low/medium/high/xhigh/max`）。今天 anthropic 条目上声明档位 ⇒ 原样发 `reasoning_effort` ⇒ 本地 SDK `TypeError`（上一对 spec 处理的就是这个）。
2. **档位集合只能靠人预填**，而**协议其实给了可探的元数据**：`GET {base}/v1/models` 的返回对象 `ModelInfo` 里有 `capabilities`，其中 **`effort: EffortCapability{supported, low, medium, high, max, xhigh}`**（同一块里还有 `thinking{supported, types}` / `image_input` / `pdf_input` / `structured_outputs` / `context_management`）。⇒ 对 Anthropic 形状的端点，"这个模型支持哪些档"是**问得出来的**（只读、不推理、不花钱）。
   - ⚠️ **它是可选字段**：第三方 anthropic 兼容端点可以不填；**百炼的 anthropic 端点 `/v1/models` 直接 404**（本机实测）⇒ 探测**必须静默回落**，探不到 ≠ 不支持。
   - OpenAI 形状的 `/v1/models` **没有**这类元数据（只有 id / owned_by）⇒ 那一侧**无可探**，只能继续预填。
3. **两边的档位值域不重合**：我们 `minimal/low/medium/high`，它 `low/medium/high/xhigh/max` ⇒ 只有三档同名，`minimal` 与 `xhigh/max` 必须**显式决定**，不能靠同名直传糊过去。
4. **市面对照**：`models.dev` 用"逐模型声明机制 + 值集合"，`zcode` 把 `{路径, 值}` 写成数据（`reasoning.levels.<档>.<协议>.set`）——**都靠人写表**；Trae / WorkBuddy / Qoder **都打 `/v1/models` 拿模型清单，但四家没有一家解析 `capabilities`**（本机 bundle 实测）⇒ **这个能力块是"协议给了、没人用"的那种**。

## 2. 决定

> **两个集合，别混（本对最容易写错的一处）**：本对会出现两个"能用的档位集合"，它们的**来源、寿命、谁能读到**都不同——下游每处措辞都要点明是哪一个。
>
> | | **探测集合** | **声明子集** |
> | --- | --- | --- |
> | 来源 | `GET /v1/models` 的 `ModelInfo.capabilities.effort`（只对 Anthropic 形状） | 条目自己的 `supported_reasoning_efforts` |
> | 何时存在 | **只在配置期那一次**（探测完就丢） | 一直在，跟着条目落盘 |
> | 谁能读到 | **只有那次请求的响应与设置页** | **工厂/运行期**（`create_chat_model` 读条目） |
> | 不落盘 | ✅（D1） | —（本来就在盘上） |
>
> ⇒ **运行期只有"声明子集"可选**。所以 D2 的越界回退只能**基于声明子集**；`PUT` 那条校验也不可能读探测集合（它不探测、探测也不落盘）。

### D1 —— 档位集合：**Anthropic 形状先探测**，探不到回落声明

- **时机**：**配置期**（用户验凭据/编辑条目时那一次），**不是每次请求**——否则每个请求多一个网络往返。
- **落点**：**扩既有那条探针的响应**，而不是新开一个端点。`POST /api/models/config/validate` 已经按 provider 打对了路径与头（`/v1/models` + `x-api-key` + `anthropic-version`；OpenAI 形状走 `{base}/models` + Bearer），**再新开一个端点就是把同一件事写两遍**（本仓刚在重排行上治过这个病：_两条腿可以共享一份判断，不能共享一份副本_）。
- **读什么**：`ModelInfo.capabilities.effort` → 支持的档位集合（`supported` 为假 ⇒ 该模型不支持 effort）。
- **探不到怎么办**（三种都算"探不到"，**一律静默回落**，不报错、不阻断）：HTTP 404 / 返回里没有 `capabilities` / 网络或鉴权失败。
- **回落顺序（这条是给界面的：用**探测集合**，回落**声明子集**）**：探测集合 **∩** 我们自己的档名集合（见 D2）⇒ **非空则用它**；**空或探不到** ⇒ 用条目声明的 `supported_reasoning_efforts`；两者都没有 ⇒ 控件不出现（与今天一致）。
  - ⚠️ **"交集为空"与"探不到"要分两句**：探不到（404 / 没有 `capabilities` / 网络失败）⇒ 回落声明；**探到了但交集为空**（如只支持 `xhigh/max`）⇒ 这**不是**"探不到"，是**探到了但这一侧没有可用档** ⇒ 同样回落声明（声明也为空 ⇒ 控件不出现）。两者观感相同、理由不同，日志/文案上别写成同一句。
- **不落盘**：探测结果只用于**本次配置/本次界面**，不写进 `models_config.json`（避免陈旧；本仓探针族的既定纪律：只读不落盘、只报不拦）。

### D2 —— 发送：**按协议翻译**（两侧都要，且越界回退）

工厂在转发前把条目声明的档位翻译成该协议的名字：

| 我们声明的档 | openai 形状 → `reasoning_effort` | anthropic 形状 → `output_config.effort` |
| ------------ | -------------------------------- | --------------------------------------- |
| `minimal`    | `"minimal"`                      | **`"low"`**（对方没有这一档，取最低）   |
| `low`        | `"low"`                          | `"low"`                                 |
| `medium`     | `"medium"`                       | `"medium"`                              |
| `high`       | `"high"`                         | `"high"`                                |

- **为什么 `minimal → low`**：值域不重合（§1.3），必须显式给一条；取最低是"最接近的语义"，且不会凭空发明对方不认的值。
- **`xhigh` / `max`（对方多出的）本期不产生**：我们这边造不出来 ⇒ 不需要正向映射。**若探测结果显示只支持 `xhigh/max`**（交集里没有我们的档）⇒ 那是**界面**的事（D1 的"交集为空 ⇒ 回落声明"），**不是运行期的事**——运行期看不到探测结果，别把它写进翻译/回退的判据里。
- **越界回退（对齐 Claude Code 的既有行为）：对着"声明子集"回退，不是对着探测集合**。要发的档不在**该条目声明的 `supported_reasoning_efforts`** 里 ⇒ **回退到声明子集里最接近的一档**（同强度优先，否则取不高于它的最高档），**不是原样发、也不是报错**。
  - ⚠️ **为什么只能是声明**：工厂在请求期读不到探测集合（D1 明令不落盘、且探测是配置期的一次性动作）⇒ 运行期唯一可读的"能发哪些档"就是条目自己的声明。§2 开头那张表就是为这句存在的。
  - ⚠️ **声明子集为空时怎么办**：语义是"未声明"（`supported_reasoning_efforts` 缺省 ⇒ 既有兜底"每个档都可用"）。此时**不做任何回退**、按名翻译即可——这正是今天 OpenAI 路径的行为，不要在这里新造一种"拒绝发送"。
  - **默认档本来就在子集内**（`ModelConfig._validate_capability_subsets` 在载入期就保证了），所以回退实际只在**调用方从请求层传入一个越界档**时才会触发（`request > agent > model > None` 这条链的最外层）。
- **`openai` 方言逐字节不变**（名字相同 ⇒ 翻译是恒等映射）；认不出的 `use` 仍按 OpenAI 形状走（既有兜底不变）。
- 实现落点：`knowledge/` 之外的那条模型工厂（`models/factory.py` 的 `reasoning_effort` 处理处）——**一处翻译，两条腿共用**（与 caption 腿共用一个出网入口同思路）；`output_config` 经 `model_kwargs` 进入请求体（本机实测可通）。

### D3 —— 界面：那两格对 anthropic **恢复显示**，候选来自探测（优先）或声明（兜底）

> **本节的"可用集合"专指界面上的候选集** = **探测集合 ∩ 我们的档名**（非空则用它）**否则声明子集**（D1 的回落顺序）。它与 D2 运行期那个"声明子集"**不是同一个集合**——别混（§2 开头那张表）。

- **依赖上一对 spec 的 D3 反向**：本对落地后，"anthropic ⇒ 不渲染 + 提交时清空"要**撤掉**（因为那时它发得出去）；改回按"**该条目可用的档位集合**"渲染（集合为空才不渲染）。
  - ⚠️ **"撤掉"要撤干净：上一对落了 9 处、5 个文件**（`canSendEffortLevels` / `withoutEffortAxis` / `capabilityValueForProvider`）。逐处清单见 §5，**其中两处最容易漏**：`models-settings-page.tsx::toManagedInput`（整集合 PUT 的必经之路，漏了就等于"清空"没撤掉）与 `core/models/capability.ts`（三个 helper 的归宿）。
- **候选 = **探测集合** ∩ 我们的档名**（D1）非空则用它，否则用**声明子集**；界面上标明来源（"来自端点" / "来自声明"），让人知道自己填的是哪种。
  - ⚠️ **"探测优先"只在向导成立**：`POST /api/models/config/validate` 是**向导 step 1** 的探针，**编辑对话框没有探测入口**（它不调 validate）⇒ 编辑路径上候选**恒为声明子集**、来源恒为"来自声明"。要在编辑路径也探，得另给编辑对话框加一次探测——**本期不做**（见 D4）；所以文案上别承诺编辑路径会显示"来自端点"。
- **值域冲突照 D2 回退，但只在提交前**：用户选的档若不在可用集合里 ⇒ 提交时**回退**到最接近的一档（并让界面反映回退后的值，别撒谎）。**运行期的回退（D2）不回改界面**——界面负责的是"落盘的值是对的"，不是"运行时实际发了哪一档"。
  - 而**落盘的值本来就在声明子集内**（载入期校验保证），所以界面上真正会回退的场景只有一个：**探测集合比声明子集窄**（如端点说只支持 `low/high`，条目却声明了四档）⇒ 此时提交前把越界的档与默认档一起收进交集里。
- 能力**向导**的建议同样按 provider 与 D3 的可用集合过滤（与上一对 spec 的向导过滤一条线）；**composer 那条深度菜单不在本期**——它读的是公开列表的 `supported_reasoning_efforts`（声明），而探测结果不落盘、也不进 `GET /api/models` ⇒ 它拿不到探测集合，保持现状（见 §5）。

### D4 —— 不做

- **不做"预算"这一维**（`thinking.budget_tokens`）：它是同一张表上另一行；本期只做 effort 的名字对齐与取值来源。
- **不为 OpenAI 形状做探测**：那侧协议没给元数据（§1.2），不是漏做。
- **不扩我们自己的档位值域**（不加 `xhigh`/`max`）：那要改 `ModelConfig` 的 Literal + 前端档位表 + i18n 四份文案，属于另一条；本期靠 D2 的"交集 + 回退"消化。
- **不给编辑对话框加探测入口**（D3 已述）：validate 是向导 step 1 的探针；给编辑路径也探要动对话框的加载时序（打开即发一次网络请求），收益只是"编辑时也能看到端点说哪些档"——**本期不做**，编辑路径按声明渲染。
- **不把探测结果塞进公开列表**（`GET /api/models`）：那等于落盘（D1 禁止），而且 composer 那条深度菜单会跟着变成"端点说了算"——本期 composer 保持按声明（D3 末句）。
- **不动 `thinking` 的启用/禁用路径、不动任何默认值、不动 RAG 那几条腿。**
- **不每次请求探测**（D1 的时机是配置期）。

## 3. 接口契约

| 契约                                        | 变化                                                                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/models/config/validate`          | 响应**新增可选字段**（探测集合，如端点报出的档位）；没有可报时**缺省**（不是 null，路由上已有 `response_model_exclude_none=True`，`warning` 就是先例），老客户端一字不变 |
| `PUT /api/models/config`                    | 上一对那条"`anthropic` 不许带 effort 三件套"的 422 **整条删除**（连同它的用例）；**不换成**"值不在可译集合里 ⇒ 422"——见下                                                                 |
| 工厂                                        | 新增**一处**按协议的档位翻译 + 对**声明子集**的越界回退；`openai` 路径逐字节不变；**同时处理上一对新加的那条 Anthropic lint**（见 §5）                                                            |
| `models_config.json` / `config.yaml` schema | **无新增字段**（档位仍用既有三个字段声明；探测集合不落盘）                                                                  |
| 界面                                        | 那两格按 D3 的"可用集合"（= 探测集合 ∩ 我们的档名，空则回落声明子集）渲染（本对落地前是"anthropic 全不渲染"），并标明候选来源（向导才有"来自端点"） |

⚠️ **为什么 PUT 那条是"删"而不是"换成另一条"**：能替换成的判据只有"值不在**可译集合**里"——可按 D2 的映射表，我们那四档**全都可译**（`minimal→low`、其余同名）⇒ 这条判据**恒真、什么都不拦**；而"默认档必须在子集里"早由 `ModelConfig._validate_capability_subsets` 在**载入期**管着。想让 PUT 判"值是否在**探测集合**里"也不可能：PUT 不探测、探测结果也不落盘（D1）⇒ 服务端手上没有那个集合。**所以这一条没有可写的替代形态，删掉即闭环**（翻译落地后它本来就没有存在理由）。

## 4. 验收

**后端**

1. **探测成功**：桩一个返回 `capabilities.effort` 的假 Anthropic 端点 ⇒ `validate` 的响应里带上该模型的档位集合（逐档断言，含只有 `low/high/max` 这种非四档集合）。
2. **探不到静默回落**（三条，各一条用例）：404（**用百炼 anthropic 端点那条 404 做真实反例**）/ 返回里没有 `capabilities` / 网络失败 ⇒ `validate` **不报错**，档位来源回落到条目声明。
3. **翻译**：`use=langchain_anthropic:ChatAnthropic` + 声明 `[low, medium, high]` ⇒ 请求体出现 **`output_config: {effort: "medium"}`**，且**不出现** `reasoning_effort`；同一份声明换 `ChatOpenAI` ⇒ 出现 `reasoning_effort: "medium"`（**逐字节等于今天的行为**）。
4. **`minimal` 那一行**：声明 `minimal` + anthropic ⇒ 请求体是 `output_config: {effort: "low"}`（映射表逐行有牙）。
5. **越界回退（触发条件已更正）**：条目**声明** `{low, high}`、而**调用方从请求层传了 `medium`**（`request > agent > model` 的最外层，唯一能造出越界值的入口）⇒ 发出去的是**回退值**（`low`），且**不抛**。⚠️ 原稿写的是"声明的默认档不在可用集合里"——**那条不可能发生**：载入期校验就保证了默认档属于声明的子集，所以回退的实际触发面只有请求层。
6. **认不出的 `use` 仍走 OpenAI 形状**（既有兜底不回归）。
7. **回归**：`openai-compatible` / `deepseek` 的请求体与今天**逐字节相同**（形状守卫既有用例全绿）。
8. **上一对那条 422 已删净**：`_reject_anthropic_effort_levels` 与其调用点都不在了；它的 4 条参数化用例**删除**，而**控制组**（`openai-compatible` / `deepseek` + 同样三字段 ⇒ 200）与"清干净就放行"那条**保留**（它们验的是别的规矩，顺手删掉会丢掉回归面）。
9. **上一对新加的那条 lint 已处理**：翻译落地后，`_warn_anthropic_reasoning_effort` 不能再对"会被翻译走的 `reasoning_effort`"报警 ⇒ 要么删掉它、要么把判据改成"到构造期还剩未翻译的 `reasoning_effort`"；对应地，`tests/test_model_factory.py` 里那条警告用例**必须跟着改**（否则它会在本对落地后变成"钉住假警告"的用例）。

**前端**

10. anthropic 条目的那两格**重新出现**（对照组：可用集合为空时才不出现）；候选 = 探测集合（探不到时是声明子集）；**来源标注**在渲染里能读到（按界面词汇断言）。
11. **向导**路径能看到"来自端点"（validate 回了档位时）；**编辑对话框**路径只能是"来自声明"（它没有探测入口，见 D3/D4）⇒ 两条路径各断言一次，别把编辑路径也写成"来自端点"。
12. 选了一个不在可用集合里的档 ⇒ 提交 payload 里是**回退后的值**（不撒谎）。
13. **撤回上一对**：anthropic 条目的三个字段**不再被清空**（那是上一对的行为）；§5 列的 9 处、5 个文件逐处核过——尤其 `models-settings-page.tsx::toManagedInput`（整集合 PUT 的必经之路）。

**真栈**

14. 起真栈 ⇒ 走完整链：validate 拿到探测集合 ⇒ 保存 ⇒ 打一次真实调用，确认请求体是 `output_config.effort` 且模型正常回话。
    ⚠️ **口径按实测写死，别留"如果能找到"**：手上的 Anthropic 形状端点（`https://opencode.ai/zen/go`）**实测不填 `capabilities`**（`/v1/models` 回 200、37 条、**0 条带能力块**，形状是 `created/id/object/owned_by`）⇒ **探测那一段在这条端点上拿不到东西，只能靠桩**；而"打一次真实调用"这一段可以用它验（它是真端点，只是没有能力元数据）。所以结论要**分两句写**：探测 = 桩验过、真实端点无此元数据；翻译 = 真实端点验过请求体形状，**未打 `api.anthropic.com`**。
15. 收尾：配置**逐字节还原**（动手前 `cp` 原始字节；网关在 Windows 上写 CRLF；**`cp` 的落点别只放系统临时目录**——上一轮我的快照被清理过，见 §6）、密钥不落盘、不新建残留文件。

## 5. 影响面

**后端**

- `backend/app/gateway/routers/models.py`（validate 的响应加可选字段；**删掉**上一对那条 422 函数 `_reject_anthropic_effort_levels` 与它的调用点）
- `backend/packages/harness/deerflow/models/factory.py`（① 一处按协议翻译 + 对**声明子集**的回退；② **上一对新加的 `_warn_anthropic_reasoning_effort` 要跟着处理**——删掉，或把判据改成"到构造期还剩未翻译的 `reasoning_effort`"，见 §4#9）
- `backend/tests/test_models_config_api.py`（探测集合 + 三条回落；**删掉**上一对那 4 条"必须 422"的参数化用例，保留控制组与"清干净就放行"）
- `backend/tests/test_model_factory.py`（翻译逐行 + 回退 + OpenAI 回归；**改掉**上一对那条"anthropic 的 `reasoning_effort` 会警告"的用例）

**前端（撤回上一对要动 5 个文件、9 处，逐处点名；漏一处就等于没撤干净）**

| 文件 | 落点 | 本对要做什么 |
| --- | --- | --- |
| `core/models/capability.ts` | `canSendEffortLevels` / `withoutEffortAxis` / `capabilityValueForProvider` | 三个 helper 的归宿：判据从"provider 是不是 anthropic"换成"可用集合是不是空" |
| `components/.../model-capability-editor.tsx` | 入参 `canSendEffortLevels`（**必填**） | 换成"可用集合（+来源）"，两格按集合渲染 |
| `components/.../models-edit-dialog.tsx` | 传参 + payload 里的 `capabilityValueForProvider` | 撤回清空；候选只能来自声明（无探测入口） |
| `components/.../models-add-dialog.tsx` | 传参 + payload + **种子过滤** + **provider 切换时清空** + `setSuggested` 读过滤后的值（共 5 处） | 撤回清空与种子过滤；改由 validate 回的集合决定候选 |
| **`components/.../models-settings-page.tsx`** | **`toManagedInput`**（上一对在这里按 provider 清空三个字段） | **最容易漏的一处**：它是整集合 PUT 的必经之路，撤回后这里要回到"原样带上字段" |
- `frontend/src/core/models/reasoning-effort.ts`：**不动**——composer 那条深度菜单读的是公开列表的声明（`GET /api/models` 不带探测集合），本期它拿不到探测数据；原稿把它列进影响面是错的（见 D3 末句）
- `frontend/tests/unit/settings/{models-capability-wizard,models-settings-page}.dom.test.tsx`（两格恢复、候选来源、提交前回退、撤回清空）

**文档**

- `backend/AGENTS.md`：记"档位按协议翻译 + 配置期探测、探不到回落声明、越界按**声明子集**回退"；**并改掉上一对写下的那句**"这条拒绝是暂时的"（本对落地后它已不存在）
- `frontend/AGENTS.md`：那两格候选来自探测集合（优先）/声明子集（兜底），**并标明来源只在向导可见**；同样要**改掉上一对写下的**"两格由 provider 决定、提交时清空"

- **无迁移、无 schema 变更、不动默认值、不给 `openai` 方言加任何新行为**

## 6. 已知缺口（写在案上）

- **探测只对 Anthropic 形状有效**：OpenAI 形状的 `/v1/models` 没有能力块 ⇒ 那一侧永远只能预填（这是协议事实，不是遗漏）。
- **`capabilities` 是可选字段**：第三方端点多不填（百炼 anthropic 端点直接 404）⇒ 探测的**命中率**取决于端点的实现程度；真端点 `api.anthropic.com` 填到什么程度，没有真 key 验不了（与本仓那条"没真 key"的缺口同源）。
- ⚠️ **本机在用的那条 Anthropic 形状端点实测不填**（2026-09-19 一手核）：`GET https://opencode.ai/zen/go/v1/models` ⇒ **HTTP 200 / 37 条 / 0 条带 `capabilities`**，形状是 `created/id/object/owned_by`（`minimax-m3` 也在，但没有能力块）。⇒ **对这条端点，"探测"这一半永远回落声明、等于没有收益**；真正让它"能用档位"的是 D2 的翻译。**结论**：本对的收益主要来自 D2；D1 的价值要等一个会填能力块的端点（或官方 `api.anthropic.com`）才兑现。**要不要把这对拆成"先翻译、后探测"是待裁项**（见 plan 的 Status）。
- **收尾用的一次性快照要放在不会被清理的位置**：上一轮我把 `models_config.json` 的原始字节 `cp` 到**系统临时目录**，中途被清理，而工作树当时正处在"被改过"的状态 —— 靠条目提交时用的是**哨兵**（服务端保留了原密钥）才按"删掉多写的条目 + 还原被清的字段 + 用应用自己的 `json.dump(indent=2)` + CRLF 重放"重建回原字节（md5 验过）。**教训**：快照别只放 temp；或先用一次演练验好重建配方再动配置。
- **我们的档位值域不扩**：`xhigh`/`max` 只能被折叠/回退消化，界面上出现不了这两个名字（要出现就得扩 Literal + i18n，另一条）。
- **`minimal → low` 是"我们的映射"**：不是官方等价关系（Claude Code 文档自己说"努力尺度按模型校准"，同名档跨模型不等强度）；文案里要写成我们的对应关系，别写成协议规定。
- **探测结果不落盘**：每次进配置页都会重探一次（只读、不花钱，但会多一个网络往返）；要缓存的话是另一个决定。
- **翻译只在 `models/factory.py` 这一处**：`claude_provider.py`（那条自研 Anthropic 客户端）有它自己的预算逻辑，**不在本 spec 的翻译范围内**（它的 `output_config` 取值要保持原样，别被这处翻译顺手改掉）。
