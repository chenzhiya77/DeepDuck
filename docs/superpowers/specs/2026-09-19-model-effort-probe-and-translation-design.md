# 推理档位：按协议翻译 + 配置期探测 —— 设计

**Status:** 未开工（2026-09-19 起草）
**Parent:** [2026-09-10-model-capability-config-design.md](2026-09-10-model-capability-config-design.md)（声明层）· [2026-09-19-model-capability-protocol-check-design.md](2026-09-19-model-capability-protocol-check-design.md)（**它先落地**：把"发错名字"的组合挡在写入口；本 spec 把那条拒绝**放开**，因为那时字段会被翻译而不是原样转发）

## 1. 问题

能力声明层只认**一套词汇**：`supported_reasoning_efforts` / `reasoning_effort`（`minimal/low/medium/high`）。工厂按条目字段名**原样转发**，于是：

1. **名字对不上协议**：同一件事在两家叫两个名字——OpenAI 形状 `reasoning_effort`（今天恰好同名，所以"看起来没翻译"），Anthropic 形状 **`output_config.effort`**（`anthropic` 0.97.0 稳定版 `types/message_create_params.py:138`，值域 `low/medium/high/xhigh/max`）。今天 anthropic 条目上声明档位 ⇒ 原样发 `reasoning_effort` ⇒ 本地 SDK `TypeError`（上一对 spec 处理的就是这个）。
2. **档位集合只能靠人预填**，而**协议其实给了可探的元数据**：`GET {base}/v1/models` 的返回对象 `ModelInfo` 里有 `capabilities`，其中 **`effort: EffortCapability{supported, low, medium, high, max, xhigh}`**（同一块里还有 `thinking{supported, types}` / `image_input` / `pdf_input` / `structured_outputs` / `context_management`）。⇒ 对 Anthropic 形状的端点，"这个模型支持哪些档"是**问得出来的**（只读、不推理、不花钱）。
   - ⚠️ **它是可选字段**：第三方 anthropic 兼容端点可以不填；**百炼的 anthropic 端点 `/v1/models` 直接 404**（本机实测）⇒ 探测**必须静默回落**，探不到 ≠ 不支持。
   - OpenAI 形状的 `/v1/models` **没有**这类元数据（只有 id / owned_by）⇒ 那一侧**无可探**，只能继续预填。
3. **两边的档位值域不重合**：我们 `minimal/low/medium/high`，它 `low/medium/high/xhigh/max` ⇒ 只有三档同名，`minimal` 与 `xhigh/max` 必须**显式决定**，不能靠同名直传糊过去。
4. **市面对照**：`models.dev` 用"逐模型声明机制 + 值集合"，`zcode` 把 `{路径, 值}` 写成数据（`reasoning.levels.<档>.<协议>.set`）——**都靠人写表**；Trae / WorkBuddy / Qoder **都打 `/v1/models` 拿模型清单，但四家没有一家解析 `capabilities`**（本机 bundle 实测）⇒ **这个能力块是"协议给了、没人用"的那种**。

## 2. 决定

### D1 —— 档位集合：**Anthropic 形状先探测**，探不到回落声明

- **时机**：**配置期**（用户验凭据/编辑条目时那一次），**不是每次请求**——否则每个请求多一个网络往返。
- **落点**：**扩既有那条探针的响应**，而不是新开一个端点。`POST /api/models/config/validate` 已经按 provider 打对了路径与头（`/v1/models` + `x-api-key` + `anthropic-version`；OpenAI 形状走 `{base}/models` + Bearer），**再新开一个端点就是把同一件事写两遍**（本仓刚在重排行上治过这个病：_两条腿可以共享一份判断，不能共享一份副本_）。
- **读什么**：`ModelInfo.capabilities.effort` → 支持的档位集合（`supported` 为假 ⇒ 该模型不支持 effort）。
- **探不到怎么办**（三种都算"探不到"，**一律静默回落**，不报错、不阻断）：HTTP 404 / 返回里没有 `capabilities` / 网络或鉴权失败。
- **回落顺序**：探测结果 **∩** 我们自己的档名集合（见 D2）⇒ 非空则用它；空或探不到 ⇒ 用条目声明的 `supported_reasoning_efforts`；两者都没有 ⇒ 控件不出现（与今天一致）。
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
- **`xhigh` / `max`（对方多出的）本期不产生**：我们这边造不出来 ⇒ 不需要正向映射。**若探测结果显示只支持 `xhigh/max`**（交集里没有我们的档）⇒ 按下面的回退处理。
- **越界回退（对齐 Claude Code 的既有行为）**：要发的档不在"该条目可用的档"里 ⇒ **回退到可用集合里最接近的一档**（同强度优先，否则取不高于它的最高档），**不是原样发、也不是报错**。
- **`openai` 方言逐字节不变**（名字相同 ⇒ 翻译是恒等映射）；认不出的 `use` 仍按 OpenAI 形状走（既有兜底不变）。
- 实现落点：`knowledge/` 之外的那条模型工厂（`models/factory.py` 的 `reasoning_effort` 处理处）——**一处翻译，两条腿共用**（与 caption 腿共用一个出网入口同思路）；`output_config` 经 `model_kwargs` 进入请求体（本机实测可通）。

### D3 —— 界面：那两格对 anthropic **恢复显示**，候选来自探测（优先）或声明（兜底）

- **依赖本轮 spec 的 D3 反向**：本对落地后，"anthropic ⇒ 不渲染 + 提交时清空"要**撤掉**（因为那时它发得出去）；改回按"**该条目可用的档位集合**"渲染（集合为空才不渲染）。
- 候选 = **探测结果 ∩ 我们的档名**（D1）非空则用它，否则用声明；界面上标明来源（"来自端点" / "来自声明"），让人知道自己填的是哪种。
- **值域冲突照 D2 回退**：用户选的档若不在可用集合里 ⇒ 提交时**回退**到最接近的一档（并让界面反映回退后的值，别撒谎）。
- 能力**向导**的建议同样按 provider 与可用集合过滤（与本轮 spec 的向导过滤一条线）。

### D4 —— 不做

- **不做"预算"这一维**（`thinking.budget_tokens`）：它是同一张表上另一行；本期只做 effort 的名字对齐与取值来源。
- **不为 OpenAI 形状做探测**：那侧协议没给元数据（§1.2），不是漏做。
- **不扩我们自己的档位值域**（不加 `xhigh`/`max`）：那要改 `ModelConfig` 的 Literal + 前端档位表 + i18n 四份文案，属于另一条；本期靠 D2 的"交集 + 回退"消化。
- **不动 `thinking` 的启用/禁用路径、不动任何默认值、不动 RAG 那几条腿。**
- **不每次请求探测**（D1 的时机是配置期）。

## 3. 接口契约

| 契约                                        | 变化                                                                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/models/config/validate`          | 响应**新增可选字段**（探测到的 `capabilities` 摘要，如支持的档位集合）；没有可报时**缺省**（不是 null），老客户端一字不变   |
| `PUT /api/models/config`                    | 本轮 spec 那条"anthropic 不许带 effort 三件套"的 422 **放开**；换成"值不在可译集合里 ⇒ 422"（或保留但放宽，见 Task 0 决定） |
| 工厂                                        | 新增**一处**按协议的档位翻译 + 越界回退；`openai` 路径逐字节不变                                                            |
| `models_config.json` / `config.yaml` schema | **无新增字段**（档位仍用既有三个字段声明；探测结果不落盘）                                                                  |
| 界面                                        | 那两格按"可用集合"渲染（本对落地前是"anthropic 全不渲染"），并标明候选来源                                                  |

## 4. 验收

**后端**

1. **探测成功**：桩一个返回 `capabilities.effort` 的假 Anthropic 端点 ⇒ `validate` 的响应里带上该模型的档位集合（逐档断言，含只有 `low/high/max` 这种非四档集合）。
2. **探不到静默回落**（三条，各一条用例）：404（**用百炼 anthropic 端点那条 404 做真实反例**）/ 返回里没有 `capabilities` / 网络失败 ⇒ `validate` **不报错**，档位来源回落到条目声明。
3. **翻译**：`use=langchain_anthropic:ChatAnthropic` + 声明 `[low, medium, high]` ⇒ 请求体出现 **`output_config: {effort: "medium"}`**，且**不出现** `reasoning_effort`；同一份声明换 `ChatOpenAI` ⇒ 出现 `reasoning_effort: "medium"`（**逐字节等于今天的行为**）。
4. **`minimal` 那一行**：声明 `minimal` + anthropic ⇒ 请求体是 `output_config: {effort: "low"}`（映射表逐行有牙）。
5. **越界回退**：声明的默认档不在可用集合里（如可用 `{low,high}`、声明 `medium`）⇒ 发出去的是**回退值**（`low`），且**不抛**。
6. **认不出的 `use` 仍走 OpenAI 形状**（既有兜底不回归）。
7. **回归**：`openai-compatible` / `deepseek` 的请求体与今天**逐字节相同**（形状守卫既有用例全绿）。

**前端**

8. anthropic 条目的那两格**重新出现**；候选 = 探测结果（探不到时是声明）；**来源标注**在渲染里能读到（按界面词汇断言）。
9. 选了一个不在可用集合里的档 ⇒ 提交 payload 里是**回退后的值**（不撒谎）。

**真栈**

10. 起真栈 ⇒ 用一条**真能填 `capabilities` 的 Anthropic 形状端点**（或桩）走一遍：validate 拿到档位集合 ⇒ 保存 ⇒ 打一次真实调用，确认请求体是 `output_config.effort` 且模型正常回话。**结论口径**：桩 / 第三方端点验过要写明，没打 `api.anthropic.com` 也要写明。
11. 收尾：配置**逐字节还原**（动手前 `cp` 原始字节；网关在 Windows 上写 CRLF）、密钥不落盘、不新建残留文件。

## 5. 影响面

- `backend/app/gateway/routers/models.py`（validate 的响应加可选字段；放开上一对的 422）
- `backend/packages/harness/deerflow/models/factory.py`（一处按协议翻译 + 回退）
- `backend/tests/test_models_config_api.py`（探测/回落/放开三条）
- `backend/tests/test_model_factory.py`（翻译逐行 + 回退 + OpenAI 回归）
- `frontend/src/core/rag/…`（不涉及）· `frontend/src/core/models/reasoning-effort.ts`（候选来源：可用集合）
- `frontend/src/components/workspace/settings/model-capability-editor.tsx` 与两个对话框（恢复渲染 + 来源标注）
- `frontend/tests/unit/settings/{models-capability-wizard,models-settings-page}.dom.test.tsx`
- 文档：`backend/AGENTS.md`（记"档位按协议翻译 + 配置期探测、探不到回落声明"）· `frontend/AGENTS.md`（候选来源）
- **无迁移、无 schema 变更、不动默认值、不给 `openai` 方言加任何新行为**

## 6. 已知缺口（写在案上）

- **探测只对 Anthropic 形状有效**：OpenAI 形状的 `/v1/models` 没有能力块 ⇒ 那一侧永远只能预填（这是协议事实，不是遗漏）。
- **`capabilities` 是可选字段**：第三方端点多不填（百炼 anthropic 端点直接 404）⇒ 探测的**命中率**取决于端点的实现程度；真端点 `api.anthropic.com` 填到什么程度，没有真 key 验不了（与本仓那条"没真 key"的缺口同源）。
- **我们的档位值域不扩**：`xhigh`/`max` 只能被折叠/回退消化，界面上出现不了这两个名字（要出现就得扩 Literal + i18n，另一条）。
- **`minimal → low` 是"我们的映射"**：不是官方等价关系（Claude Code 文档自己说"努力尺度按模型校准"，同名档跨模型不等强度）；文案里要写成我们的对应关系，别写成协议规定。
- **探测结果不落盘**：每次进配置页都会重探一次（只读、不花钱，但会多一个网络往返）；要缓存的话是另一个决定。
- **翻译只在 `models/factory.py` 这一处**：`claude_provider.py`（那条自研 Anthropic 客户端）有它自己的预算逻辑，**不在本 spec 的翻译范围内**（它的 `output_config` 取值要保持原样，别被这处翻译顺手改掉）。
