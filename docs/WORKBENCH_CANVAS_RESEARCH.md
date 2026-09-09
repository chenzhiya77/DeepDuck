# 工作台画布调研：流程工具组装工作台的市场定位与技术裁决（2026-09-09）

**调研对象正名**：本文档调研的是一个「**流程工具组装工作台**」——用户与 lead agent 在主对话里商量出一条流水线，画布是这条流水线的**持久化与可视化载体**，执行由引擎按图跑。它**不是** harness 构成解剖视图（那是 `docs/AGENT_HARNESS_VISUALIZATION_RESEARCH.md` 的产品线，见 §2）。

用户定位原话（2026-09-09 澄清）：「**我的画布和 harness 不是一个东西**，画布我的想法只是**组装流程工具**，就是**使用我项目中的主对话作为组装的载体**。」

调研方法：一律一手来源（官方文档、官方公告、源码、GitHub API、第一方产品页）；二手中文转载只作线索，采信前必须回溯，回溯不到即标「二手待核」并进 §9。star / 最近 push / 许可 / 创建时间均为 **2026-09-09 GitHub API 匿名实测**（`gh` 未认证，curl 匿名配额内完成）。仓库侧每条代码断言先 Read/Grep 核实，行号以当日工作区为准（分支 `feat/rag-knowledge-base`，HEAD `473f43a3`）。

---

## 0. 一段话结论（直接给裁决）

**用户的形态定位成立，且市场没有完整同路者，但三块拼图各有强先例**：数据流引擎抄 ComfyUI（其 `CacheKeySetInputSignature`/`HierarchicalCache` 源码已核实，spec §11 的「输入 hash 记忆化、只重跑下游」不是传说而是 130k★ 项目的现行实现）；「对话/命令驱动生成 workflow 图」Dify 已经做了三代（1.15 加固 → 1.16「⌘K → /create 和 /refine」端到端增强 → 1.17 生成器优先推荐已装工具），Microsoft Power Automate 的 conversation-first Copilot 更是 2024 年就公测的官方先例；「agent 作为工作流里的一种节点」Dify 1.16 的 workflow Agent node 直接存在。但**没有一家同时做到「主对话作为组装载体 + 图上固化 + 数据流语义执行 + agent 只是节点类型之一」**——这正是空档。裁决：**做甲（纯数据流流水线）→ 乙（加 agent 节点类型）→ 丙（对话内组装，UI 层独立分期）；丁（agent↔agent 自由编排画布）不做**——红海（Coze/Dify/AgentKit 正面撞）且本仓已有等价能力（子代理委派体系）。引擎侧裁决：**DAG 引擎可以是新模块，但 agent 节点的执行必须经由既有 run 生命周期派发**（`RunManager`/`run_agent()`/`StreamBridge`/`run_events`），这是 `backend/AGENTS.md` 定时任务治理先例的直接约束——「scheduler 可以决定 *when* 工作运行，但必须经由既有 run 路径派发，而不是引入一套并行的执行栈」。工作台引擎决定的是 *what*，比 *when* 更深一层，越有变成并行执行栈的风险，越要钉死这条边界。

**第二刀（2026-09-09 用户在本次调研进行中澄清，见 §7.5）**：画布上「添加流程」的产物到底是**给 agent 读的 SOP**（`SKILL.md` / `SOUL.md`，建议性，执行者仍是 agent loop，**零新引擎**）还是**给引擎跑的程序**（workflow JSON，权威性，需要甲层引擎）。这一刀比 §3 的「数据流 vs agent 编排」更靠前，因为它决定第一个可交付物是什么：SOP 版的对话内组装（丙1）**今天就能落**，本仓已有 `setup_agent` / `update_agent` 两个内置工具与 `persistence/agents/` 三后端在做同一件事；程序版（丙2）必须等甲层 schema 冻结。§7.1 的推荐顺序据此细化。

---

## 1. 调研问题与方法

用户三问（原话）：

1. 「现在是不是可以开始研究工作台的设计了」——可以：spec §11 的立项前提（核心先经 DeerFlow + Qoder 双端 e2e 验证）**已于 2026-09-08 达成**（`docs/superpowers/specs/2026-09-08-image-gen-qwen-mcp-design.md` §12 两条「已裁决」：live smoke 一次通过、DeerFlow e2e 路径翻译三证闭环）。
2. 「市面上有产品是和我的路线相似的吗」——见 §4/§5：无完整同路者，三块拼图各有先例。
3. 「我的工作台（工作画布）的形式是不是就是控制 agent 与 mcp、与 agent 之间的工作编排呀……在画布上增加一个主 agent，给他添加提示词，接上 mcp、工具，然后与画布中的其他 agent 或者自身进行运作」——**这个描述是丁形态（agent 编排画布），与用户同日澄清的「画布只是组装流程工具」矛盾**。本文档按澄清后的口径裁决：用户真正要的是甲+乙+丙，「agent 挂提示词接工具」只是乙层里**一种节点**的配置面板，不是整张图的统治者（§3/§5/§7）。

前置材料（交叉引用，不复述）：

- `docs/superpowers/specs/2026-09-08-image-gen-qwen-mcp-design.md` §10（否决备选：每节点一个 MCP server 进程 = 进程爆炸；包 ComfyUI 作引擎 = 前提错位；HTTP 传输、base64 返回均否决）与 §11（二期「画布工作台 = 消费者 #3」原始定义）。**本文档对 §11 的增补见 §7.2**。
- `docs/AGENT_HARNESS_VISUALIZATION_RESEARCH.md`（相邻产品线，处理见 §2；其 §4.2 表格口径为本文对齐格式）。
- `backend/AGENTS.md`（Runtime 节的定时任务治理先例，约束力评估见 §7.4）。

---

## 2. 定位纠偏：工作台 ≠ harness 视图，为什么不能合并

仓库里已有的 `docs/AGENT_HARNESS_VISUALIZATION_RESEARCH.md` 调研的是 **harness 构成的可观测视图**（middleware 链、工具分组、子代理注册表的解剖图 + 运行事件点亮）。它和本工作台是**相邻但不同的产品线**，四条轴上没有一条重合：

| 轴 | harness 构成视图 | 流程组装工作台 |
|---|---|---|
| **数据源** | 从代码枚举派生（`build_middlewares()` / `get_available_tools()` / 子代理注册表，该文档 §6.2 启示 1） | 用户创作的 workflow JSON（持久化实体，有 CRUD 生命周期） |
| **生命周期** | 派生物：代码一变重新枚举即可，无「保存/命名/版本/导出」概念 | 创作物：用户资产，要存、要改、要引用、要导出成工具（spec §11 两种导出粒度） |
| **失败模式** | 枚举不到就静默省略（对策：fail-closed 标注未知） | 图跑偏/节点报错/缓存失效/agent 节点烧 token（对策：预算、上限、护栏、部分重跑） |
| **用户动作** | 只读 + 至多 time travel 重跑（该文档 §6.4 第 5 步） | 创作 + 执行 + 复跑 + 发布 |

**为什么不能合并成一套数据模型**：用户在本项目里有一条明确偏好——**不要为了展示方便把两套数据模型合并成一套**。具体到这里：构成视图的「节点」是运行时组件（middleware/工具组），工作台的「节点」是用户编排的可执行单元（工具调用/子图/agent 委派）；前者拓扑由代码决定、每次运行相同，后者拓扑由用户决定、每次创作不同。强行合并会造出一个「既能画 middleware 又能当 workflow 节点」的四不像 schema，两边的校验规则互相污染，而且构成视图那条产品线自己的最小路径（清单端点 + 自动布局 + 事件点亮）**不是本文档的推荐方案**——前一版任务简报曾把它误当推荐方案，已被用户纠正。两条线唯一合理的共享点是底层遥测（`run_events` 按 `seq` 消费）与前端渲染库（`@xyflow/react` 已在依赖里），数据模型、持久化、API 全部分开。

---

## 3. 核心区分：数据流 DAG vs agent 编排画布

这是本调研最重要的概念工作。市面上的「画布」产品分两族，语义完全不同：

| 维度 | **数据流 DAG**（ComfyUI / n8n / Langflow 一族） | **agent 编排画布**（Coze / AgentKit / AutoGen Studio 一族） |
|---|---|---|
| **节点是什么** | 纯函数/工具的一次调用：输入定则输出定 | 一个 agent：一个 loop，自带模型 + 提示词 + 工具集，**自己决定**调什么、调几次、何时停 |
| **边是什么** | 数据：上游输出即下游输入，可类型化校验（ComfyUI 的 socket 类型） | 委派/交接/控制流：传的是任务描述与结果文本，无类型可校验 |
| **谁决定路径** | 运行前全图确定；分支也是数据驱动（条件节点读输入选出口） | 运行时由节点内 LLM 决定；图只给「**允许的路径**」（handoff 白名单） |
| **能力差** | 输入 hash 记忆化 / 只重跑下游 / 部分执行 / 并行调度 / 成本可预估 / 可复现——**全有** | 上述六项**基本全无**：同一输入两次跑不一样，谈不上记忆化，成本只能事后统计 |
| **失败模式** | 节点报错、类型不匹配、上游变更导致下游缓存失效——**可定位、可重放** | 跑偏、循环、烧 token、agent 互相踢皮球——需要预算/上限/护栏**治理**而不是定位 |
| **一手例证** | ComfyUI 源码：`comfy_execution/caching.py` 的 `CacheKeySetInputSignature`（:82，节点签名 = 输入值 + 祖先序的 hashable 化）、`HierarchicalCache`（:361，子缓存键随祖先签名变化而失效 ⇒ 天然「只重跑下游」）、`graph.py` 的 `is_cached`（:178/:206）——2026-09-09 经 GitHub API 取 master 分支源码核实 | 本仓自己的子代理体系就是活例：`contracts/subagent_status_contract.json` 的 v2 `subagent_stop_reason` 枚举（`token_capped`/`turn_capped`/`loop_capped`，:5）——这三个值就是「agent 失败模式是治理问题」的制度化承认；OpenAI Agents SDK 的 `draw_graph()` 只画 handoff 静态接线（官方 visualization 页核实），运行时路径 SDK 自己都画不出来 |

**一句话区分：数据流 DAG 里图是「计划」，agent 编排画布里图是「授权」。** 计划可以逐格执行、核对、重放；授权只划出允许的范围，里面发生什么由 LLM 临场决定。

**用户的形态落在哪**：**对话内组装 → 图上固化 → 引擎按数据流执行**。agent 在这张图里只是**一种节点类型**（输入 = 任务描述/意图，输出 = 结果文本/文件路径），不是整张图的统治者。这个定位是否成立、有无先例——见 §5，结论：成立，且恰好落在两族产品的空档上。

**混用两种节点的语义边界（必须提前设计、后期补不了）**：

| 属性 | 确定性节点（工具/子图引用） | agent 节点 |
|---|---|---|
| 可缓存（输入 hash 命中即跳过） | ✅ | ❌ 永远 miss——同输入不同输出是特性不是 bug |
| 可只重跑下游 | ✅ | ✅（作为上游时，其输出落盘/落库后即成确定值） |
| 可复现（同输入保证同输出） | ✅ | ❌ 必须标为「每次可能不同」 |
| 成本可预估 | ✅ | ⚠️ 只有上限可估（token 预算/轮次上限，本仓三护栏已制度化） |
| 失败语义 | 节点报错，定位重放 | 治理信号（`subagent_stop_reason` 三值），需要预算与护栏 |

**UI 上如何让用户一眼分辨**：节点卡片上给确定性节点显示「⚡可缓存」徽标 + 上次命中状态，agent 节点显示「🎲 非确定性」徽标 + 预算配置入口（模型/上限）；连线时若下游是缓存敏感的确定性节点而上游是 agent 节点，边上提示「此边每次重跑」。这些必须在 workflow JSON schema 里就有 `deterministic: bool`（或按节点类型推导）字段，事后补会破坏缓存键的语义。

---

## 4. 市场扫描（一手证据 + 相似度打分）

打分口径：与用户形态三要素的相似度——**A 数据流引擎**（hash 记忆化/部分重跑/workflow JSON）、**B agent 作为节点类型**、**C 对话内组装（描述→生成图）**。每项 0–2 分（0 无 / 1 部分 / 2 完整），按总分排序，不按 star 排序。GitHub API 数据日期 **2026-09-09**。

| 排名 | 产品 | star | 最近 push | 许可 | 自托管 | A | B | C | 关键一手证据 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Dify**（langgenius/dify） | 155,039 | 2026-09-08 | Dify Open Source License（modified Apache-2.0，多租户/商标附加条款，LICENSE 文件核实） | ✅ | 0 | 2 | 2 | GitHub Releases 核实：**1.16.0（2026-07-17）「Smarter AI Workflow Generation」——「⌘K → /create 和 /refine」生成器端到端增强**，配套 env `WORKFLOW_GENERATION_TIMEOUT_MS`；**1.15.0（2026-06-25）「harden /create and /refine workflow generation」**；1.17.0（2026-08-25）「生成器建议节点时优先已安装已配置的工具」。同版 1.16.0 还提到 **workflow agent nodes**（「referencing new agents from workflow agent nodes」）⇒ agent 是工作流节点类型。无 hash 记忆化证据 |
| 2 | **ComfyUI**（comfyanonymous → **Comfy-Org**/ComfyUI，仓库已迁移，API 返回 Moved Permanently） | 132,076 | 2026-09-08 | GPL-3.0 | ✅ | 2 | 0 | 0 | 源码核实（§3 表）：输入签名 hash 缓存 + 层级缓存 = 「只重跑下游」的现行实现；workflow JSON 持久化。**引擎层唯一满分先例**，但无 agent、无对话组装 |
| 3 | **Power Automate Copilot**（Microsoft 官方文档） | —（闭源 SaaS） | — | 商业 | ❌ | 0 | 0 | 2 | learn.microsoft.com 发布计划页核实（2024-05-16 公共预览，页已归档）：「**聊天体验增加了以自然语言要求 Copilot 创建工作流的能力**……Copilot 可能会提出问题来帮助形成明确的自动化计划……通过后续提示创建、优化、编辑和调整工作流」。**对话内组装的最早官方先例**（非 agent 产品，恰好证明这是 UI/交互层能力，可独立存在） |
| 4 | **Coze Studio**（coze-dev/coze-studio，字节开源） | 21,563 | **2026-07-29（放缓）** | Apache-2.0 | ✅ | 0 | 1 | 0 | README 核实：workflow「visual canvas where you can quickly build workflows by dragging and dropping nodes」；Golang 后端 + React 前端。Releases 核实：v0.2.3「add MCP configuration」，v0.3.0 Chatflow。**README 与 Releases 均无 A2A、无多 agent 协作、无自然语言生成工作流、无「Coze 3.0」字样**——二手报道的 3.0 特性在开源仓里找不到对应物（见 §9） |
| 5 | **n8n**（n8n-io/n8n） | 203,745 | 2026-09-08 | Sustainable Use License（fair-code；`.ee` 文件企业许可，LICENSE 核实） | ✅ | 0 | 1 | 0 | docs.n8n.io 核实：**MCP Server Trigger 节点**（「allow n8n to act as a MCP server」）+ **MCP Client Tool 节点**（「connect your n8n AI agents to external tools」）⇒ MCP 双向都是节点；AI agent 存在（「your n8n AI agents」）。数据边、无记忆化证据 |
| 6 | **Langflow**（langflow-ai/langflow） | 154,465 | 2026-09-08 | MIT | ✅ | 0 | 1 | 0 | README 核实：「Visual builder interface」；组件为节点单位；**MCP 双向**（消费 MCP servers + 「Deploy as an MCP server」把 flow 变工具——与 spec §11「整图复合工具导出」同构）；README 未提对话生成流 |
| 7 | **Microsoft Agent Framework**（microsoft/agent-framework） | 13,402 | 2026-09-08 | MIT | 库形态 | 1 | 1 | 0 | README 核实：**graph-based workflows**（sequential/concurrent/handoff/group）带 **checkpointing、streaming、human-in-the-loop、time-travel**；DevUI 是调试面板不是创作画布；Declarative Agents（YAML 声明 agent）。代码优先：图在代码里，无 workflow JSON 创作面 |
| 8 | **Flowise**（FlowiseAI/Flowise） | 55,435 | **2026-08-13（放缓）** | Apache-2.0 + `packages/server/src/enterprise` 商业双轨（LICENSE 核实） | ✅ | 0 | 1 | 0 | 「Build AI Agents, Visually」；AgentFlow 画布；未见记忆化/对话生成证据（README 抓取失败，按仓库描述与许可文件记录，细节标待核） |
| 9 | **CrewAI**（crewAIInc/crewAI） | 58,246 | 2026-09-08 | MIT | ✅ | 0 | 2 | 0 | README 核实：**开源侧代码优先，无画布**（CLI 生成「JSON-first crew project」）；crews（自治协作）与 **flows（「event-driven automations that combine precise workflow control」）** 双轨；「MCP/A2A support」。画布在商业 AMP Suite 侧，README 未描述 |
| 10 | **Flora** | —（闭源） | — | 商业 | ❌ | 1? | 0 | 0 | TechCrunch（2026-01-27，抓取部分成功）：「**These generated versions are mapped with each other on a canvas**」——节点 = 可分叉的迭代版本；$42M A 轮 Redpoint 领投。官方一手产品说明未获取（域名未确认），边机制/类型化端口/缓存全部未核实（§9） |
| 11 | **Microsoft Foundry Canvas** | —（公共预览） | — | 商业 | ❌ | 0 | 0 | 1 | learn.microsoft.com 英文原页核实（ms.date **2026-07-21**）：「It pairs a visual canvas with the Copilot chat session」「**As you make choices in the canvas... the canvas sends a ready-to-run prompt to your current Copilot session**... Copilot then scaffolds and edits the agent code in your workspace」；内嵌 Agent Inspector 本地跑；部署走 azd。**画布不执行 agent；画布 = 选项面板，产物 = 代码** |
| 12 | **GitHub Copilot canvases** | — | — | 商业 | ❌ | ? | ? | ? | docs.github.com（zh，抓取成功）：canvas 是「**可共享的、由智能体驱动的成果物和界面**」扩展，经 `/create-canvas` 会话创建。官方博客《How canvases make agentic workflows visible, steerable, and cost-efficient》**三次抓取失败**（120s 超时），是节点图还是「计划+改动同页」文档式面**未核实**（§9）；二手标题（toutiao）称「把计划和改动放一页」，仅线索 |
| 13 | **OpenAI AgentKit / Agent Builder** | — | — | 商业 | ❌ | ? | 2? | 1? | `openai.com/index/introducing-agentkit/` 及 `openai.com/zh-Hans-CN/agent-platform/` 均 403（不再重试）。**一手核实到的仅**：OpenAI Agents SDK visualization 页——`draw_graph()` 用 Graphviz 画 agents（黄框）/tools（绿椭圆）/**MCP servers（灰框）**/handoffs（有向边）的**静态接线图**。AgentKit 的 canvas/connectors/guardrails/evals 细节全部未一手核实（§9） |
| 14 | **AutoGen / AutoGen Studio**（microsoft/autogen） | 60,875 | **2026-04-15（停滞，实测确认）** | CC-BY-4.0（API 返回口径） | ✅ | 0 | 2 | 0 | push 停滞与前置文档记录一致；重心已迁往 Microsoft Agent Framework（排名 7）。Studio 画布属上一代形态，不再演进 |

**扫描判读**（三条最重要的新事实，相对任务简报已有证据）：

1. **Dify 的「⌘K → /create 和 /refine」AI Workflow Generation 已迭代三代**（1.15 加固 → 1.16 端到端增强 + 超时/并行度 env → 1.17 优先推荐已装工具）——「用对话描述 → 自动生成工作流图」**不是空白，是已被头部产品验证并持续投入的能力**，且 Dify 同时有 workflow Agent node（B 要素满分）。用户形态的差异化只剩「主对话（lead agent 会话本身）作为组装载体 + 数据流执行语义」这个组合。
2. **ComfyUI 仓库已从 comfyanonymous 迁移到 Comfy-Org 组织**（GitHub API 返回 Moved Permanently），132k★、GPL-3.0、2026-09-08 仍活跃；其缓存实现从 `comfy/execution/` 挪到 **`comfy_execution/`**——照抄时别按旧路径找源码。
3. **Coze 3.0 的开源侧证据缺失**：coze-studio 的 README 与全部 Releases 里没有 A2A、没有多 agent 协作、没有自然语言生成工作流、没有「3.0」字样（只有 v0.2.3 的 MCP 配置）。二手中文站描述的 3.0 转向即便属实，也只是 **SaaS 侧**的事，与可自托管的开源 Coze Studio 是两个东西——评估竞品时必须分开计。

---

## 5. 用户形态定位：对话内组装 → 图上固化 → 数据流执行

**定位是否成立：成立。** 逐要素对照先例：

- **对话内组装（丙）**：直接先例两个——Dify 的 `/create`+`/refine`（对话式创建与**迭代精修**，refine 语义与「在主对话里商量」最接近）与 Power Automate Copilot（「Copilot 可能会提出问题来帮助形成明确的自动化计划」——多轮商量式组装，官方文档原话）。**注意两家都是「专用生成入口」而非「主对话载体」**：Dify 是 ⌘K 命令面板，Power Automate 是独立 Copilot 聊天。用户设想的「lead agent 在正常工作对话中顺手产出 workflow JSON」比它们更进一步——lead agent 拥有本仓全部工具与上下文（RAG、技能、MCP 清单），组装出的图可以引用真实可用的节点，而不是像 Dify 1.17 才开始做的「优先推荐已装工具」。这是差异化点，也意味着丙层的核心工作是一个「workflow authoring 工具 + 契约校验」，而不是一个新聊天入口。
- **图上固化（画布 = 流程本体）**：与 Foundry Canvas **方向相反**——英文原页核实，Foundry 画布「呈现可选项」，每次选择变成「一个可直接运行的提示词」发给 Copilot 会话，**产物是工作区里的代码**，画布本身不是可执行实体，也不持久化为图。用户的画布产物是**可执行的 workflow JSON**，画布是它的视图。这个对比说明「canvas」一词在 2026 年的产品语境里至少有三义（选项面板 / agent 成果物界面 / 流程本体），立项文档里必须自定义术语，避免歧义。
- **数据流执行（甲）**：先例是 ComfyUI（引擎语义满分）与 n8n/Langflow/Flowise（数据边 + 工具节点，但无记忆化）。**hash 记忆化 + 只重跑下游在 agent 画布一族里确实无人做**——因为它们的边不是数据，无从 hash。这从反面证明：用户要保住记忆化/部分重跑/可复现这组能力，图的主干就必须是数据流语义，agent 只能作为节点混入（乙），不能让委派边统治全图（丁）。
- **agent 作为节点类型（乙）**：先例 Dify workflow Agent node（1.16 起支持跨工作区复用 agent、从 agent 节点引用新 agent）；n8n/Langflow 的 AI agent 节点同族。**无人在 agent 节点上明示「不可缓存/非确定」语义边界**（§3 表）——这是用户可以做得比先例更严谨的地方，且本仓已有治理信号（`subagent_stop_reason` 三值）可以直接投影到节点状态上。

**市场空白排序结论**：空档不在单要素（每个要素都有人做了），而在**组合**——「主对话载体 × 数据流语义 × agent 节点带治理信号 × 自托管」四者同时成立的产品不存在。最接近的 Dify 缺数据流执行语义（无记忆化/部分重跑）且许可带多租户限制；最接近引擎理想的 ComfyUI 缺 agent 与对话组装且是 GPL + 本地图像工具定位。

---

## 6. 边的语义裁决与 agent 节点自治

### 6.1 裁决：一张图里两种边共存，但类型系统分开

- **数据边**（主干）：带类型（image / text / path / json…，从工具 schema 推导），引擎做类型校验，参与缓存键计算。
- **委派边**（乙层限定）：agent 节点的出入边**退化为文本/文件路径通道**——入边聚合成「任务描述 + 附件路径」，出边是「结果文本 + 产物路径」。委派边**不承诺类型**，因此 **agent 节点的输出永远不参与下游缓存键**（下游若依赖它，必须每次重跑，UI 明示，见 §3 边界表）。
- 禁止第三种边（控制流跳转边）。分支用确定性条件节点（数据驱动）表达，不用「agent 决定走哪条边」表达——后者是丁形态的入口，一旦放开，全图退化为授权图，甲层能力全部作废。

### 6.2 agent 节点必须保持内部自治：本仓已有实证

2026-09-08 DeerFlow Web UI e2e（线程 `857e2785`，记录于当日会话与 spec §12 的「已裁决」条目）真实事件链：**local sandbox 按设计剥光 `*KEY*` 环境变量 → agent 走 skill 脚本路径被饿死（无凭证）→ agent 自愈切换到 MCP 壳工具 `image-generation_generate_image` → 成功出图并经 `present_files` 交付**（产物 1,016,558 字节 PNG 落盘）。代码依据（本次全部核实）：

- 剥 Key 是设计行为：`backend/packages/harness/deerflow/sandbox/env_policy.py` 的 `_SECRET_NAME_PATTERNS`（:24–44，`*KEY*`/`*SECRET*`/`*TOKEN*`/`*PASS*`/`*CREDENTIAL*`）与 `build_sandbox_env()`（:100）。
- MCP stdio 壳是 local 模式唯一密钥通道：`skills/public/image-generation/scripts/mcp_server.py` 模块 docstring（:1–7）明写「launched with explicit env from extensions_config.json — is the only key channel there」；`extensions_config.example.json` 的 `image-generation` 条目带 `"env": {"DASHSCOPE_API_KEY": "$DASHSCOPE_API_KEY"}`，`$VAR` 在 Gateway 加载期解析。
- 工具名 `image-generation_generate_image` 来自 per-server 前缀机制：`deerflow/mcp/tools.py` 的 `tool_name_prefix`（:453，默认 True；:469 前缀判断）。
- 路径闭环：stdio 子进程 cwd 钉到线程 workspace、TMPDIR 钉到 `workspace/.mcp/tmp`（`mcp/tools.py` :485–513），`_LOCAL_PATH_IN_TEXT_RE`（:56）把工具结果里的正斜杠相对路径 token 翻译回 `/mnt/user-data/...`；壳侧 `_remap_mnt()`（`mcp_server.py` :24）做反向翻译。spec §12 已裁决该双向翻译 e2e 实证生效。

**裁决推论**：静态图若把「调 skill 脚本」或「调 MCP 工具」写死为固定调用序列，这条自愈路径就没了——而自愈恰恰是那次 e2e 成功的原因。所以 **agent 节点的输入必须是「意图 + 可用工具集」，不是「固定调用序列」**；节点内部仍是一个完整的子代理 loop（自带模型、预算、护栏），图只决定它拿到什么任务、什么工具白名单、多少预算。这也回答了用户三问里的「给 agent 添加提示词，接上 mcp、工具」——这个配置面板是对的，但它配置的是**一个节点**，不是整张图。

### 6.3 agent 节点的实现 = 包装既有子代理委派，不是重新发明

「agent 编排能力仓库里已经有了，画布不需要重新发明它，只需要把它包成一个节点类型」——**这个判断成立**，证据链：

- 委派原语齐备：`deerflow/tools/builtins/task_tool.py`（导入 `SubagentExecutor`/注册表查询，:20；按 `subagent_type` 解析配置 :291；继承父 agent `tool_groups` 且 `subagent_enabled=False` 防递归 :381–394）；`deerflow/subagents/executor.py`（子代理图独立编译 `_create_agent` :544，`create_agent(...)` :602，**`checkpointer=False`** :608——一次性执行、不复用父 checkpointer）；`deerflow/subagents/registry.py`（`get_subagent_config` :50、`get_available_subagent_names` :150，built-in → custom → per-agent overrides 解析序）。
- 治理信号齐备：`SubagentLimitMiddleware`（并发/总量上限）、`LoopDetectionMiddleware`、`TokenBudgetMiddleware` 三护栏 + `contracts/subagent_status_contract.json` v2 的 `valid_stop_reason_values: ["token_capped","turn_capped","loop_capped"]`（:5）。
- 可观测齐备：子代理步骤经 `task_*` custom 事件持久化为 `subagent.start/step/end`（`runtime/events/catalog.py` :67 起），前端已有子任务卡片消费。

一个「agent 节点」= 以 workflow JSON 里的 {agent 类型/自定义提示词, 模型, 工具组白名单, 预算} 构造一次 `SubagentExecutor` 调用，把结果文本与产物路径写回节点输出。**注意 `checkpointer=False` 的含义**：agent 节点天然不可 time-travel、不可断点续跑——这与 §3 边界表的「不可复现」一致，schema 上应显式承认而不是补救。

---

## 7. 甲乙丙丁分层与推荐 + 与既有运行时的关系

### 7.1 四层定义（重新定义，不沿用 harness 调研的 A 层）

| 层 | 内容 | 先例 | 成本量级 | 立项前置条件 |
|---|---|---|---|---|
| **甲** | 纯数据流工具流水线：确定性节点、输入 hash 记忆化、只重跑下游、workflow JSON 持久化、React Flow 画布 | ComfyUI（引擎）、React Flow（前端，本仓已备依赖与组件） | **周级**（薄引擎：拓扑排序 + 缓存表 + 节点执行器三种来源；spec §11 已否决重方案） | ✅ 已达成：核心 e2e 双端验证（2026-09-08）；第一个节点（image-gen）已在 |
| **乙** | 甲 + agent 节点类型：包装 `SubagentExecutor`，标为不可缓存/非确定，预算与护栏字段进 schema，`subagent_stop_reason` 投影到节点状态 | Dify workflow Agent node（节点形态）；本仓子代理体系（实现） | **甲之上天级~周级**（原语全部现成，主要是 schema 语义与 UI 徽标） | 甲的 schema 先冻结 `deterministic` 语义（§3 边界表），否则缓存键返工 |
| **丙1** | 对话内组装 **SOP 产物**：主对话作为 authoring 载体，产出/修改 `SKILL.md`、`SOUL.md`、agent `config.yaml`——建议性流程，执行者仍是 agent loop | 本仓**已有等价能力**：`setup_agent` / `update_agent` 内置工具（§7.5）；Dify `/refine` 的迭代精修语义 | **天级**：零新引擎、零新执行器，只差画布化的编辑面与校验 | 无（既有资产格式即契约）；只需确认 SkillScan / `allowed-tools` 门禁不被画布写路径绕过 |
| **丙2** | 对话内组装 **程序产物**：lead agent 经一个新 built-in 工具产出/修改 workflow JSON，前端画布同步渲染 | Dify `/create`+`/refine`、Power Automate Copilot（均为专用入口；主对话载体无先例 = 差异化） | **UI/交互层，可独立分期**；引擎侧零改动（只是 JSON 的另一个生产者） | 甲的 JSON schema + 校验器就绪；节点清单可枚举（复用 `get_available_tools()`/MCP 配置/已发布图列表） |
| **丁** | agent↔agent 自由编排画布：整张图由 agent 节点与委派边构成 | Coze/Dify/AgentKit/AutoGen Studio 正面撞 | 不做 | **建议不做**：红海 + 本仓已有等价能力（`task` 委派 + 多子代理并发 + 三护栏），画布化丁形态只会得到一张「授权图」，§3 的六项数据流能力全部拿不到 |

**推荐顺序：丙1（可立即启动）→ 甲 → 乙 → 丙2**（2026-09-09 依 §7.5 的第二刀细化，原为「甲 → 乙 → 丙」）。丙1 是唯一**零新引擎**就能交付的一层，且本仓已有 `setup_agent` / `update_agent` 在对话里写 agent 资产，画布只是给它们一个可视编辑面；甲是地基且市场验证最充分；乙把用户澄清的形态补全（成本最低的增量，因为原语现成）；丙2 是交互升级、可延后，且有 Dify/Power Automate 先例，晚做不会错过窗口。丁明确放弃。**丙1 与甲不互斥也不互相阻塞**：前者的产物是 Markdown/YAML 资产，后者的产物是 workflow JSON，两套 schema 不应合并（理由同 §2）。**但这个顺序是依赖排序而非偏好排序**：丙1 的产物正是乙层 agent 节点所引用的内容，且外壳（入口/术语/节点视觉语言）必须一次定、三层共用——见 §7.6。

### 7.2 对 spec §11 定义的增补

spec §11 的二期定义（自建薄 DAG 引擎、抄 ComfyUI 三件套、MCP 是边界协议不是内部连线、节点来源三种、导出粒度两种、四个坑）经本次调研**全部维持**，但用户 2026-09-09 的澄清（主对话作为组装载体 + agent 作为节点类型）要求增补五条：

1. **节点来源从三种变四种语义类**：原生核心直调 / 外部 MCP 工具 / 已发布图引用之外，增加 **agent 节点**（内部是一次子代理委派）。注意它不违背「MCP 是边界协议不是内部连线」——agent 节点是内部原语（`SubagentExecutor`）的图化，不是新连线协议。
2. **schema 必须带确定性语义**：每个节点声明（或按类型推导）`deterministic`，缓存键只对确定性节点计算；agent 节点输出不参与下游缓存（§3 边界表、§6.1）。这是 §11 没写、后期补不了的坑，应与「四个坑」并列为第五坑。
3. **导出粒度对 agent 节点要加限制**：「整图复合工具」若含 agent 节点，导出的工具就是非确定性的——打包进同一 MCP server 进程时应在工具 description 里声明「每次调用结果可能不同 + 预算上限」，避免外部消费者把它当纯函数缓存。
4. **组装载体写入路线图**：§11 只定义了画布前端（React Flow 先例），未定义 authoring 路径；增补丙层「主对话经 built-in 工具产出/修改 workflow JSON」为独立分期项。
5. **执行派发受治理先例约束**：§11 的「Gateway 执行端点」必须走既有 run 生命周期（§7.4），不能在 Gateway 里新起一个与 `RunManager` 平行的执行器。

### 7.3 「长运行图 async task」坑的加重

§11 四坑之一是长运行图 async task。乙层落地后这个坑加重：agent 节点默认超时 `subagents.timeout_seconds=1800`（30 分钟）、`max_turns=150`，一张含两三个 agent 节点的图轻松越过任何同步 HTTP 超时。裁决：图执行从第一天起就是后台 run（复用 `POST /threads/{id}/runs` 的 background + SSE join 模式），节点级进度经 `run_events` 风格的持久化事件流暴露，**不做同步执行模式**。

### 7.4 与既有运行时的关系：复用 run 生命周期，裁决与代价

治理先例（`backend/AGENTS.md` Runtime 节，原文）：「Scheduled-task executions must reuse that same Gateway run lifecycle. The scheduler may decide *when* work runs, but it must dispatch through the existing run path rather than introducing a parallel execution stack.」其约束力评估：**强**。定时任务只决定 *when*，尚且被明令禁止另起执行栈；DAG 引擎决定 *what*（新的执行单元、新的状态机、新的取消语义），是更危险的「并行执行栈」候选。仓库为 run 生命周期付出的工程密度极高（租约与心跳、跨 worker 取消接管、孤儿回收、交付回执、interrupt/rollback、`uq_runs_thread_active` 唯一约束——见 `backend/AGENTS.md` RunManager/RunStore 契约节），新执行栈意味着这一整套全部重写或放弃。

两条路的代价：

| | **复用（推荐）** | **新建执行栈** |
|---|---|---|
| 做法 | 一次图执行 = 一个 run（新 `operation_kind` 或 metadata 标记 `workflow_run`），DAG 调度器作为 run worker 内部/前置的编排层；agent 节点经既有委派路径执行；节点进度写入 `run_events` 新 category（如 `workflow.node.start/end`，走 catalog + 契约同步流程） | 独立 WorkflowRunner：自己的任务表、自己的取消、自己的事件流 |
| 得到 | 取消/租约/孤儿回收/SSE/前端 run 卡片/交付回执全部白拿；治理一致 | 图级并发调度自由（多节点并行不受单 run 串行约束） |
| 代价 | 单 run 内并行节点受事件循环与 `run_events` 顺序语义约束；`uq_runs_thread_active` 意味着图执行占住线程（可给图执行专用 thread 化解）；图的中间态不是 checkpoint（LangGraph checkpointer 服务的是 agent loop，不服务 DAG 状态——DAG 状态需要自己的小表，这不是执行栈，是数据） | 重写全部治理；与 `run_events` 契约分叉；前端要维护两套进度消费；直接违反治理先例 |

**推荐**：复用。边界切法——「**DAG 状态与调度是新模块（数据层），执行派发走既有 run 生命周期（执行层）**」。节点级并行（数据流 DAG 的天然红利）在第一版可以先串行拓扑序执行（正确性优先），并行调度作为引擎内部优化后补，不必为它另起执行栈。`run_events` 增补 workflow 类事件时，遵守契约同步链（producer / `deerflow/constants.py` / `runtime/events/catalog.py` / `contracts/run_event_stream_contract.json` / `backend/docs/RUN_EVENT_STREAM.md` / 契约测试，`backend/AGENTS.md` 明列）。

### 7.5 第二刀：SOP 编辑器 vs 程序编辑器（2026-09-09 用户澄清，简报之后）

用户在本次调研进行中提出的三问（原话）：「那我原本的设计是不是就是**给 agent 制定流程，让 agent 按照这个流程一条线来执行**对吗，之前的**整个画布就是一个 agent** 对吗，我在画布上**添加流程是不是就相当于是 skills**」。这三问把裁决点从 §3 的「数据流 vs agent 编排」前移到了更根本的一刀：**画布产物是给 agent 读的 SOP，还是给引擎跑的程序？**

**逐问回答**：

1. **「整个画布就是一个 agent」——成立，且本仓已有这个对象。** 自定义 agent 资产 = `SOUL.md`（提示词/人格）+ `config.yaml`（模型、`tool_groups`、skills 白名单），存于 `users/{user_id}/agents/{name}/`，持久化有 file 与 SQL 两种后端（`persistence/agents/{base,file,sql}.py`，文件存在性 2026-09-09 核实）。画布在这一层不是新运行时对象，是**这份资产的可视化编辑器**。
2. **「添加流程 ≈ skills」——内容几乎相同，执行者完全不同**，这是分水岭：

| | 流程写成 `SKILL.md`（SOP） | 流程画成 workflow JSON（程序） |
|---|---|---|
| 给谁读 | 给 **LLM** 读，正文注入上下文 | 给**引擎**读 |
| 性质 | **建议**：agent 读完自己决定怎么执行 | **权威**：节点顺序不由 LLM 决定 |
| 能否偏离 | 能，而且这是特性（自愈的来源） | 不能，偏离即引擎 bug |
| 约束手段 | `allowed-tools` / `required-secrets`（`skills/tool_policy.py`、`skills/parser.py`）——**策略**，不是排程 | 类型化端口、缓存键、重跑范围 |
| 执行者 | agent loop | DAG 引擎 |
| 可复现 | 不保证 | 保证（确定性节点） |

3. **「让 agent 一条线执行」——取决于谁在走这条线。** agent 照着 SOP 走（它仍是决策者，会偏离、会自愈）= 丙1，零新引擎；引擎按图走（agent 只在节点内部出现）= 甲/乙，需要新执行器。

**判据来自本仓真实事件**：`skills/public/image-generation/SKILL.md` 本身就是一份 Step 1/2/3 的 SOP（分析图片 → 写结构化 prompt JSON → 调 `generate.py`）。2026-09-08 沙箱按设计剥光 Key、脚本路径被饿死时，**agent 偏离了这份 SOP**、自愈切到 MCP 壳工具并成功交付（§6.2）；而同日对这条流程的修复方式是**改 SOP 文本**（在 SKILL.md 加入「Prefer the host-side MCP tool when it is in your toolset」优先规则，commit `e50adc71`），不是重连一张图。这一条同时证明两件事：**SOP 有韧性**（能绕过饿死的步骤），**SOP 不保证执行**（agent 可以不走）。若当时是硬 DAG，它会在饿死的节点直接失败。

**「对话内组装 SOP」本仓已经在做**：`setup_agent`（bootstrap 期持久化新 agent 的 `SOUL.md` + `config.yaml`）与 `update_agent`（普通对话里对当前 agent 的 `SOUL.md` / `config.yaml` 做局部更新 + 原子写回），语义取自 `backend/AGENTS.md` 工具系统节，文件 `tools/builtins/setup_agent_tool.py`、`update_agent_tool.py` 存在性已核实（内部实现未逐行读，标待复核）。**这正是用户说的「主对话作为组装载体」——它已经能跑，只是没有画布。** 丙1 的工作量因此是「给既有能力加可视编辑面 + 校验」，不是新建能力。

**不要发明第四种产物**：三种产物在本仓已各有其主，画布应是它们的**装配面**——

| 产物 | 载体 | 归属 |
|---|---|---|
| 流程说明书 + 策略 | `SKILL.md` | `skills/public/*`、`users/{uid}/skills/custom/*` |
| 提示词 + 工具集 + skill 白名单 | `SOUL.md` + `config.yaml` | `users/{uid}/agents/{name}/` |
| 能力接入 | `mcpServers.<name>` | `extensions_config.json` |

**裁决**：SOP 与程序不是二选一，是**两层成本差一个量级的产物**，推荐顺序见 §7.1（丙1 → 甲 → 乙 → 丙2）。选择判据三条：

- 流程需要可复现、可缓存、成本可预估 → **程序**（workflow JSON，甲/乙）；
- 流程需要临场判断、可能因环境变化改道 → **SOP**（`SKILL.md` / `SOUL.md`，丙1）；
- 两者都要 → 确定性步骤进图、需要判断的步骤留 agent 节点（乙），或图外由 SOP 指导（丙1 与甲并存，互不阻塞）。

**必须避免的陷阱**：把 SOP 画成图、却按 SOP 语义执行——画布上看着是流程，实际由 agent 自由发挥，用户会以为拿到了可复现性而没有。**画布的视觉形式必须与执行语义一致**，这与 §3 的 `deterministic` 徽标是同一条原则的两个面：一个是节点级标注，一个是整图级标注。

### 7.6 三层是一整套吗：外壳一次定、产物两套、引擎分期（2026-09-09 追加）

用户追问：「丙1 → 甲 → 乙 不是一整套么」。**是一整套，但"整套"只在外壳层成立。** 三层不是三个独立项目，是同一条装配线加深三次，其依赖关系是可核实的：

- **丙1** 定义**节点里那个 agent 是什么**：`SOUL.md`（提示词）+ `config.yaml`（模型、`tool_groups`、skills 白名单）+ `SKILL.md`（SOP）；
- **甲** 定义**节点之间怎么连**：数据边、缓存键、重跑范围；
- **乙** 把丙1 定义好的那个 agent **当成一种节点接进甲的图**。

即 **丙1 的产物正是乙层 agent 节点所引用的内容**（§6.3 的 agent 节点 = 以 {agent 类型/自定义提示词, 模型, 工具组白名单, 预算} 构造一次 `SubagentExecutor` 调用，而这组字段的持久化载体就是丙1 的 agent 资产）。所以 丙1 → 甲 → 乙 **是依赖排序，不是偏好排序**。

| 层 | 是否一整套 | 依据 |
|---|---|---|
| **外壳**（入口 / IA / 术语 / 节点面板 / 画布视觉语言） | **一次定，三层共用** | 分期各定一次会造成术语漂移与返工；本仓 "canvas" 已被占用两次（`components/workspace/knowledge/graph-canvas.tsx` 是 ECharts 知识图谱、`components/ai-elements/canvas.tsx` 是 React Flow 包装组件），§5 又记录了该词在 2026 产品语境的三义 |
| **产物 schema**（SOP 资产 vs workflow JSON） | **必须两套，不合并** | 执行者不同（LLM vs 引擎）、可复现语义不同（§7.5 表）；合并会造出「既能当说明书又能当程序」的四不像 schema，两边校验规则互相污染——同 §2 的不合并原则 |
| **引擎** | **分期** | 丙1 零引擎（复用 `setup_agent`/`update_agent`）；甲建 DAG 引擎；乙只加一种节点类型 |

**前端入口裁决**（现状核实：`components/workspace/workspace-nav-chat-list.tsx` 一个 `SidebarGroup` 内四项——`/workspace/chats`、`/workspace/agents`（`useAgentsApiEnabled()` 门控，禁用态留在 tab order + `aria-disabled` + tooltip）、`/workspace/knowledge`、`/workspace/scheduled-tasks`）：

1. **顶级入口只加一个**，是甲/乙的家（`/workspace/workflows` 一类），与知识库同级；**标签不要用 Canvas**（理由同上），用「工作流」/「流程」。
2. **丙1 不加新入口**：它编辑的就是 agent 资产，而 `/workspace/agents`（含既有创建向导 `app/workspace/agents/new/page.tsx`）已是这份资产的家。丙1 另开顶级项会造成「两个地方都能编辑同一个 agent」的分裂。
3. **但丙1 的编辑面与甲的 agent 节点面板必须共用同一套节点视觉语言与术语**，且甲的 agent 节点可跳转/预览丙1 编辑的那份资产——这是「一整套」在 UI 上的具体含义，也是外壳必须一次定的原因。
4. **门控走 `/api/features`**，照 agents 项的先例（该端点当前只返回 `agents_api.enabled` 与 `browser_control.enabled`，需增一项）；甲层引擎与端点未建时无条件挂上去就是死入口。
5. **新路由要过 `pnpm perf:check`**（`performance-budgets.json` 有路由资产预算），React Flow 的 JS 体积需在立项时算入；若抄知识页多栏骨架（`panels-shell.tsx`），注意其 toast 是**列作用域**的（`kb-toast.ts` + `Toaster id`），因为全局 Toaster 会盖住 composer。

---

## 8. 仓库侧已具备与缺口清单

**已具备**（全部 2026-09-09 读文件核实，行号见括注）：

| 资产 | 位置 | 对工作台的意义 |
|---|---|---|
| 第一个节点：image-gen 核心 | `skills/public/image-generation/scripts/generate.py`（三 provider：MiniMax :140 / Gemini :185 / qwen-DashScope :229，统一入口 `generate_image` :299）；MCP 薄壳 `scripts/mcp_server.py`（FastMCP :74，单工具 `generate_image(prompt, output_path, reference_images, aspect_ratio)` :77–83） | commit `e50adc71`；同一核心三种消费方式（skill 脚本 / MCP 工具 / 未来 DAG 节点直调），正是 §11「节点来源三种」的活样板 |
| agent 节点原语 | `task_tool.py`（:20/:291/:381–394）、`subagents/executor.py`（:544/:602/:608 `checkpointer=False`）、`registry.py`（:50/:150） | 乙层不需要新执行原语，只需要节点包装（§6.3） |
| agent 治理信号 | `contracts/subagent_status_contract.json`（:5 三值 stop_reason）；`SubagentLimit`/`LoopDetection`/`TokenBudget` 三 middleware（`backend/AGENTS.md` 链 27–29 位） | agent 节点的预算面板与状态徽标直接投影 |
| 运行可观测与持久化 | `persistence/models/run_event.py`（`RunEventRow` :14，`seq` :29，`uq_events_thread_seq` :33）；事件目录 `runtime/events/catalog.py`（`run.start` :58 / `run.end` :59 / `subagent.start` :67 / `middleware:{tag}` :74）；契约 `contracts/run_event_stream_contract.json`；checkpointer + `POST /threads/{id}/history` | 图执行进度事件有现成管道与契约流程（§7.4） |
| 前端画布基建 | `frontend/package.json:60` `@xyflow/react ^12.10.0`；`components/ai-elements/` 已内置 canvas/connection/controls/edge/node/panel/toolbar 一整套 React Flow 包装组件 | **但当前无任何页面消费它们**（grep 全 frontend/src 无外部 import）——组件在、画布页为零 |
| when 层调度 | `backend/app/gateway/routers/scheduled_tasks.py` + `scheduler.enabled` 门控 | **scheduler 只管 when，不管 what**：它按 cron 派发既有 run，不定义执行内容；工作台引擎定义 what（图结构与节点语义），两者正交。未来「定时跑一张图」= scheduler 触发 workflow run，无需新机制 |
| MCP 密钥通道与路径闭环 | `env_policy.py`（:24–44/:100）、`mcp/tools.py`（:56/:453/:485–513）、`extensions_config.example.json` image-generation 条目（`$VAR` 加载期解析、`tool_call_timeout: 300`） | 见下方「密钥通道对画布的约束」 |

**密钥通道对「画布上挂 MCP 工具节点」的约束**：local sandbox 模式下 skill 子进程拿不到任何 `*KEY*` 变量，**MCP stdio 的 env（`extensions_config.json -> mcpServers.<name>.env` 的 `$VAR`，Gateway 加载期解析）是唯一密钥通道**。所以画布上的 MCP 工具节点：(a) Key 永远留在服务端 env，workflow JSON 里只存 server 名 + 工具名 + 参数（§11「Key 留服务端 env」坑的具体化）；(b) stdio 子进程 cwd 钉死在线程 workspace、TMPDIR 钉在 `workspace/.mcp/tmp`——**节点的文件输出天然落在线程 user-data 树内**，`_LOCAL_PATH_IN_TEXT_RE` 会把结果文本里的相对路径翻译回 `/mnt/user-data/...`，DAG 引擎应把「节点输出」统一建模为 `/mnt/user-data/...` 虚拟路径而不是宿主机路径，才能同时兼容 local/AIO/provisioner 三种 sandbox；(c) 图执行跨线程复跑时，缓存的产物路径必须绑定线程 workspace（同一张图在另一线程跑 = 缓存全 miss，这是正确的语义而非缺陷）。

**缺口**（全部为「无」，已核实）：

1. workflow JSON schema 与校验器——不存在（`contracts/` 下只有 run_event / skill_review / slash_skill / subagent_status 四项）。
2. DAG 引擎（拓扑调度、输入 hash 缓存表、部分重跑）——不存在。
3. Gateway 图执行端点与图 CRUD 路由——26 个 router 中无任何 workflow/pipeline 路由（`scheduled_tasks.py` 是 when 层，见上）。
4. 前端画布页与图持久化——不存在（组件库在、零消费，见上）。
5. 节点清单枚举端点——不存在（harness 调研 §6.1 已记录「没有任何构成清单端点」；丙层组装需要它，但注意：丙层要的是「可编排节点清单」（工具/MCP/已发布图），不是「middleware 构成清单」——又一个两线不能合并数据模型的实例）。
6. 单节点/整图导出为 MCP 工具的打包器——不存在（`mcp_server.py` 是手写单例）。

---

## 9. 未能核实清单（避免误引）

1. **Coze 3.0（称 2026-06-01 发布）**：唯一来源仍是二手中文站（www.openai-hub.net/news/567/ 及 toutiao/smzdm 同题稿），coze.com / coze.cn 官方公告未获取到；**开源侧一手反证已取得**——coze-studio README 与全部 Releases（至 v0.5.1）无「3.0」、无 A2A、无多用户/多 Agent 协作、无「人是第一公民/飞书审批」、无一键接 Claude Code/Codex CLI/Openclaw 的表述；MCP 仅见 v0.2.3「add MCP configuration」。SaaS 侧 3.0 特性整体标**二手待核**。
2. **Coze SaaS 是否提供「对话描述 → 自动生成工作流图」**：coze-studio（开源）README/Releases 无此能力表述；SaaS 文档（coze.com/coze.cn）未抓取成功，待核。
3. **OpenAI AgentKit / Agent Builder 内部细节**：`openai.com/index/introducing-agentkit/` 与 `openai.com/zh-Hans-CN/agent-platform/` 均 403（未重试）；canvas 节点类型、connectors 是否即 MCP、guardrails/evals/ChatKit 的画布集成方式全部未一手核实。已核实的仅 OpenAI Agents SDK visualization 页（`draw_graph()` 静态结构图）。
4. **GitHub Copilot canvases 的形态**：github.blog 原文三次抓取失败（120s 超时 ×2、转载页混淆 ×1）；「节点图还是计划+改动同页」「能否在画布上操舵 agent 计划」未核实。docs.github.com（zh）核实到的是 canvas **扩展**语义（「可共享的、由智能体驱动的成果物和界面」+ `/create-canvas`），与 blog 标题主张的「agentic workflow 可见/可操舵/省成本」是什么关系，待核；toutiao「计划和改动放一页」仅二手线索。
5. **Flora 官方一手产品说明**：官方域名未确认（flora.fun 抓取失败）；itp.nyu.edu 校友新闻页抓取返回空内容；TechCrunch 2026-01-27 仅部分抓取成功（确认 $42M / Redpoint /「generated versions are mapped with each other on a canvas」）。**是否调用外部模型 API、是否有类型化端口、是否有缓存/只重跑下游、边的分叉机制**全部未核实；「累计 $52M、投资人名单（Rauch/Kan/Wells/Volpi/Menlo/a16z Speedrun 等）」维持任务简报口径，标二手待核。
6. **Flowise 细节**：README 原文抓取失败（curl 空返回，分支名未再核），「Build AI Agents, Visually」取自仓库 description；AgentFlow 画布形态、MCP 支持细节待核。许可双轨结构已从 LICENSE 文件一手核实。
7. **AutoGen 许可口径**：GitHub API 返回仓库级 `CC-BY-4.0`，与常识中的代码 MIT 许可不符（可能是 LICENSE 文件结构导致 API 误判），未进一步核；引用时建议只写「push 停滞于 2026-04-15（实测）」。
8. **e2e 线程 857e2785 的事件流**：自愈链路（剥 Key → 饿死 → 切 MCP 壳 → 出图 1,016,558 字节 PNG）来自 2026-09-08 会话记录与 spec §12 的「已裁决」条目，本次未重放 DB 事件逐条复核；其全部代码依据（§6.2 四处）已独立核实。
9. **n8n/Langflow 是否有「对话生成图」**：本次仅核实 Langflow README 未提及；n8n 的 AI workflow builder（若有）未查，不排除存在，待核。
10. **Dify workflow 是否有任何缓存/部分重跑机制**：Releases 未见表述，按「无」处理但未按源码核实（155k★ 仓库源码审计超出本次范围）。
11. **`setup_agent` / `update_agent` 的内部实现**（§7.5 丙1 的成本估算依赖它）：文件 `tools/builtins/setup_agent_tool.py`、`update_agent_tool.py` 与 `persistence/agents/{base,file,sql}.py` 的存在性已核实，行为语义取自 `backend/AGENTS.md` 工具系统节（bootstrap-only 绑定、局部更新 + 原子写回），**未逐行读实现**；丙1 立项前需核实：写路径是否经 SkillScan / `allowed-tools` 校验、`is_bootstrap` 绑定时机、以及画布写路径会不会绕过这些门禁。
