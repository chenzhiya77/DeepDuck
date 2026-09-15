# Harness RAG

> 一套**内置本地知识库（RAG）子系统**，构建在 **harness agent** 框架之上：不依赖任何外部 RAG 引擎，从文档 / 表格 / 视频的解析与切分，到实体图谱、百科条目、三路检索、工作区管理与检索质量评测，整条链路都在框架内完成。
>
> 本仓库是一个**通用 agent**——底座是 harness agent 框架（lead agent 与子代理编排、中间件链、沙箱执行、工具 / MCP / 技能、记忆与持久化、网关运行时），其上为本项目实现的 **harness RAG**。框架部分来自 **DeerFlow**（[bytedance/deer-flow](https://github.com/bytedance/deer-flow)，MIT）。除 harness RAG 之外，agent 层还有本项目的自有能力（如「Agent 观测宠物」，见下文）。
>
> 工作分支：`feat/rag-knowledge-base`

## 📋 目录

- [两个组成部分](#两个组成部分)
- [harness RAG 提供什么](#harness-rag-提供什么)
- [效果展示](#效果展示)
- [Agent 观测宠物](#agent-观测宠物)
- [快速开始](#快速开始)
- [规模（实测）](#规模实测)
- [状态](#状态)
- [归属与许可](#归属与许可)

## 🧩 两个组成部分

### harness agent（底座框架）

一套用于构建与运行 agent 的框架：lead agent 与子代理编排、可插拔的中间件链、沙箱执行、工具注册（内建 / MCP / 社区）、技能系统、记忆与持久化，以及网关侧的 REST / SSE 运行时。

### harness RAG（本项目实现的部分）

构建在上述框架之上：知识库核心位于框架包内的 `deerflow/knowledge/`，检索能力以框架内建工具注册，并可作为框架级能力被 agent 装配；不反向依赖网关层（框架与网关之间有依赖方向的守门测试）。

**访问与安全边界**

- **默认不改变既有行为**：三个检索工具是 `opt_in`，只有显式声明 `rag` 工具组的 agent 才会装配；不配置就不影响现有 agent
- **知识库属主私有**：检索工具执行前先做属主校验，非属主取不到任何内容；共享（`visibility`）为二期预留，当前不做团队共享
- **agent 只读**：不存在 agent 侧的写入工具——上传、删除、触发解析、生成百科都是人类操作

## 🔍 harness RAG 提供什么

### 摄取与解析

- **经 MinerU 解析**：`.pdf`、`.doc` / `.docx`、`.ppt` / `.pptx`、`.png` / `.jpg` / `.jpeg`。文档内的表格会归一为 GFM 表格；正文中抽出的图片由 VLM 生成说明，并保留在原文档位置就地渲染
- **本地直读**（不走网络）：`.md` / `.markdown` / `.txt`
- **表格**：`.csv` 始终可用；`.xlsx` / `.xls` / `.tsv` 由 `rag.table.enabled` 门控。统一归一为 GFM 表格——Excel 逐 sheet 一张表，`.csv` / `.tsv` 按分隔符解析
- **视频**：`.mp4` / `.mov` / `.mkv` / `.webm`，由 `rag.video.enabled` 门控。**ASR（funasr / Paraformer）与关键帧 OCR（PaddleOCR）在本地运行**，不依赖外部推理服务；镜头画面说明与向量化仍走所配置的模型端点。ASR + 关键帧 + 分镜卡，产物以切片形式进入同一套检索
- **解析可接自建服务**：`rag.parse_provider` 默认 `mineru-cloud`（MinerU 官方 API）；改成 `mineru-local` 并填 `rag.parse_base_url` 即接**自建的 MinerU 服务**（轻客户端形态，本机不跑模型推理；该服务本身不带鉴权，只应部署在内网）。换解析来源不影响表格归一化、图片落盘与就地渲染

全部开启时共支持 19 种后缀。

### 加工

- **结构感知切分**：`heading_path` 等结构元数据随切片落库；表格按表头锚定行组，一张表拆成多张卡片时每张都自带表头
- **归一化（两把尺子）**：别名表（大小写 / 空白折叠、英文复数折叠、「中文（English）」括号折叠）+ 嵌入相似度阈值；簇的代表名优先取括号全名
- **跨片重解析（五步幂等链）**：合并实体行 → 重写关系端点（去重、去自环）→ 删别名向量并按合并后的描述重嵌代表 → 双写切片标签（业务库列 + Qdrant payload）→ 相关百科条目标脏
- **Wiki 百科生成**：资格 = 卫生门槛 + 跨 ≥2 切片；物料打包（源切片重叠 Jaccard ≥ 0.5、≤7 个一组，一次 LLM 产出多个条目）→ 脏条目增量重生成，并回填新合格条目
- **不变量**：单腿失败不阻塞文档到达 ready；管线在飞时并发重抽 / 删除返回 409；重排故障降级为 RRF 序

### 全链路联动（改动 → 下游传播）

知识入库后不是静态的——上游任何改动都会沿图谱与百科向下传导：

| 上游动作 | 下游传播 |
| --- | --- |
| 编辑切片 | 就地重嵌入；实体保持不变——需重新理解内容时显式「重抽」 |
| 重抽切片 | 撤旧抽取 → 清孤实体 → 按当前文本重抽（不重解析源文件）→ 归一化 → 合格实体标脏 |
| 删除切片 | 级联：图谱贡献 → 孤实体向量 → 百科失格链 → 向量点 → 业务行 |
| 新增文档 | 图谱腿重解析触达实体 → 相关条目标脏 → 增量重生成（并回填新合格条目） |
| 删除文档 | 三存储级联（向量 → 图谱 → 百科生命周期 → 业务行）；高频实体标脏、跌阈实体失格 |

### 检索（三路，共用一套连续引用编号）

- `hybrid_search`：混合召回（dense + sparse 单次调用）→ RRF 融合 → 重排；重排服务故障自动降级为 RRF 序
- `graph_search`：实体关系多跳
- `wiki_search`：百科条目，含用户自建的「我的条目」
- 回答侧纪律：引用编号由工具生成、模型只许照抄；无证据不作答（宁可拒答）；前端按工具返回结构化渲染「参考来源」

### 工作区（`/workspace/knowledge`）

三栏＝知识库列表 · 六个 tab · 绑定该知识库的对话面板。与知识库绑定的会话只在所属库的历史里出现，不进入全局最近会话列表。

### 全链路可视化

从摄取到评测，**每一层加工都有对应的可视化入口**：

| 链路层 | 看什么 |
| --- | --- |
| 摄取 / 解析 | 文档表：逐路径解析状态（向量 / 图谱 / 百科三条腿），失败可就地重试 |
| 切分 | 切片抽屉：tick 轨 + 卡片列表；表格类文档转出的 GFM 表切片自带表头 |
| 归一化 / 实体图谱 | 知识图谱：力导向图、社区层上卷、悬停高亮一跳邻居 |
| Wiki 百科 | 百科（Wiki）tab：「生成条目」与「我的条目」两区，条目抽屉回看源切片 |
| 三路检索 | 检索测试：一条查询的三路命中并列（含跨路耗时排名） |
| 向量空间 | 切片 / 实体 / 百科 / 条目四类点的 2D / 3D 投影 |
| 评测 | 题库、指标总览、趋势图 |
| 检索轮次 | 命中实时叠加到向量空间与知识图谱（见「特别设计」） |

### 特别设计

- **会话联动可视化**：对话或检索测试的每一轮命中，实时叠加到**向量空间**（命中点与查询点落图）与**知识图谱**（种子 / 扩展 / 证据三层染色 + 邻居高亮）。两 tab 共享「跟随对话」开关（默认开，关闭即冻结供手动探索）；叠加以增量方式更新，**不重排布局**
- **百科全链路可维护、且可定向**：任何上游改动经脏链增量重生成；条目编辑内容会作为下一次生成的「方向」；生成粒度可选增量 / 全量 / 按条目
- **任意会话可导入知识库**：从导出菜单或最近会话右键菜单直接入库成为文档

### 质量闭环

- **两层评测**：Layer-1 为确定性 IR 指标（命中率 / 召回@k / MRR / 路径准确率，可复现）；Layer-2 为 LLM 评分（含 RAGAS 的忠实度、答案相关性、引用精度等）
- **题目可自动生成**：选一篇或多篇文档**联合出题**，一次产出 1–10 道候选（默认 5 道），必须逐条**采纳 / 忽略**后才进题库；也可手工添加
- **门禁分工**：Layer-1 接入 CI（`.github/workflows/rag-eval.yml`，PR 触碰检索模块即运行并把摘要评回 PR）；Layer-2 只出报告、**不设门禁**（避免 judge 方差把回归判定带偏），在夜间任务里跑；报告预留人工校准位（每月抽样 ≥10% 回填 `human_sample_ratio` / `cohens_kappa`）
- **运行可见**：三阶段进度（检索评测 / 答题评测 / 质量评估）并可中止；趋势图按运行序数出图，缺一次运行不会把两个时段压成相邻点

### 模型配置（复用框架的 Settings → Models）

- 聊天模型：两步向导（先探活密钥与模型 ID，再声明能力），密钥落盘到 gitignored 的 `models_config.json`
- RAG 功能模型：图抽取、评测 judge、说明生成 VLM 从已配置模型中选择；另含嵌入、重排、ASR、Qdrant / MinerU 设置，落盘到 `rag_config.json`
- **三条外部依赖可选 provider**（与上面的聊天模型机制**互不相通**——不共享条目，也不继承其支持面）：嵌入可走百炼原生接口，或任一 OpenAI 兼容的 `/v1/embeddings`；重排可走百炼，或通用 `/rerank`；解析可走云，或自建的 MinerU 服务。**非 1024 维的嵌入会被拒绝启用**（向量库集合固定 1024 维），并提示走下面的重建入口
- **稀疏来源三选一**（`rag.embedding_sparse_source`）：随嵌入模型同出（百炼）、另配一个专门的稀疏服务（`tei-sparse`，对接 Text Embeddings Inference 的 `/embed_sparse`）、或本地 BM25（零模型、确定性最好，中文按字符二元切分）。换成只出稠密向量的嵌入模型后，必须选后两者之一
- **重建索引**：「设置 → 模型 → 功能模型 → 重建索引」按库重新嵌入现有切片。它只重嵌入、**不重解析**源文件——所以换 provider / 换维度之后原文件不在也照样能换

## 🖼️ 效果展示

### ① 文档与解析

上传后逐路径解析状态（向量 / 图谱 / 百科三条腿），失败可就地重试；点开文档即进入切片抽屉。
<img src="docs/assets/rag/4.2-1.jpg" width="720" alt="文档与解析">

<details>
<summary>展开截图：文档切片抽屉 / 视频切片抽屉 / 会话切片抽屉 / 类型展示 / 会话导入知识库（5 张）</summary>
<img src="docs/assets/rag/4.2-文档.jpg" width="720" alt="文档切片">
<img src="docs/assets/rag/4.2-视频.jpg" width="720" alt="视频切片">
<img src="docs/assets/rag/4.2-会话.jpg" width="720" alt="会话切片">
<img src="docs/assets/rag/4.2-类型展示.jpg" width="720" alt="类型展示">
<img src="docs/assets/rag/4.2-会话导入知识库.jpg" width="720" alt="会话导入知识库">
</details>

### ② 百科：生成条目 / 我的条目

AI 按实体资格自动沉淀「生成条目」；用户自建的「我的条目」与 AI 完全隔离、永不自动更新，可一键「混入搜索」参与检索；条目编辑内容还会作为后续重生成的"生成方向"。
<img src="docs/assets/rag/4.3-1.jpg" width="720" alt="百科 tab（生成条目 / 我的条目）">

<details>
<summary>展开截图：wiki指定方向优化 / 用户自建wiki条目（2 张）</summary>
<img src="docs/assets/rag/4.3-wiki指定方向优化.jpg" width="720" alt="wiki指定方向优化">
<img src="docs/assets/rag/4.3-自建条目.jpg" width="720" alt="用户自建wiki条目">
</details>

### ③ 检索测试：三路命中对比

一条查询同时跑向量 / 图谱 / 百科三路，命中并列展示（含跨路耗时排名），结果可一键存为评测题。
<img src="docs/assets/rag/4.4-测试.jpg" width="720" alt="三路检索命中对比">

<details>
<summary>展开截图：测试实体切换（1 张）</summary>
<img src="docs/assets/rag/4.4-测试实体.jpg" width="720" alt="测试实体切换">
</details>

### ④ 向量空间

切片 / 实体 / 百科 / 条目四类点的 2D / 3D 投影；检索命中实时叠加到图上，开「跟随对话」后每轮问答自动落点。
<img src="docs/assets/rag/4.5-向量空间.jpg" width="720" alt="向量空间投影与检索叠加">

<details>
<summary>展开截图：向量空间跳转（1 张）</summary>
<img src="docs/assets/rag/4.5-向量空间跳转.jpg" width="720" alt="向量空间跳转">
</details>

### ⑤ 知识图谱

实体关系力导向图，社区层可上卷看全局；检索路径按种子 / 扩展 / 证据三层染色，叠加不重排布局。
<img src="docs/assets/rag/4.6-知识图谱.jpg" width="720" alt="知识图谱与检索路径染色">

<details>
<summary>展开截图：图谱放大1 / 图谱放大2（2 张）</summary>
<img src="docs/assets/rag/4.6-知识图谱-放大1.jpg" width="720" alt="知识图谱-放大1">
<img src="docs/assets/rag/4.6-知识图谱-放大2.jpg" width="720" alt="知识图谱-放大2">
</details>

### ⑥ 评测

题库（可由 AI 从文档生成候选、人工采纳）+ 指标总览 + 趋势图；运行中可见三阶段进度，支持中止。
<img src="docs/assets/rag/4.7-评测-总览.jpg" width="720" alt="评测页指标总览与趋势">

<details>
<summary>展开截图：考题生成 / 考题评审 / 评测详情 / 评测历史（4 张）</summary>
<img src="docs/assets/rag/4.7-测评-考题生成.jpg" width="720" alt="考题生成">
<img src="docs/assets/rag/4.7-考题-审核.jpg" width="720" alt="考题评审">
<img src="docs/assets/rag/4.7-评测-详情.jpg" width="720" alt="评测详情">
<img src="docs/assets/rag/4.7-评测-历史.jpg" width="720" alt="评测历史">
</details>

### ⑦ 对话引用回显

回答句末标 `[n]`，点开即见「参考来源」；编号由检索工具生成、模型只许照抄，无证据宁可拒答。
<img src="docs/assets/rag/4.8-对话框.jpg" width="720" alt="回答中的引用与参考来源">

## 🦜 Agent 观测宠物

桌面上的一只鹦鹉，把 agent 的运行状态变成看得见的动作。它是**纯观察者**——只读线程状态，不发送、不修改内容，且点击穿透，可以理解成"app 的灯"。

五个循环态各有一套逐帧动画，随运行状态自动切换：

| 状态 | 动作 | 帧数 | 帧率 | 含义 |
| --- | --- | --- | --- | --- |
| `idle` | <img src="docs/assets/pet/parrot-idle.gif" width="120" alt="idle"> | 31 | 8 | 空闲 |
| `think` | <img src="docs/assets/pet/parrot-think.gif" width="120" alt="think"> | 31 | 8 | 思考中 |
| `wait` | <img src="docs/assets/pet/parrot-wait.gif" width="120" alt="wait"> | 30 | 8 | 等待中 |
| `work` | <img src="docs/assets/pet/parrot-work.gif" width="120" alt="work"> | 31 | 8 | 工具执行中 |
| `error` | <img src="docs/assets/pet/parrot-error.gif" width="120" alt="error"> | 31 | 8 | 运行出错 |

- 上表就是产品内的同一套精灵图；5 个循环态都已是真美术，`done` / `greet` 两个一次性态在画
- 美术与状态机分离：帧宽 / 帧率 / 显示尺寸由 manifest 声明，换一套图不需要改逻辑

## 🚀 快速开始

```bash
# 1) 交互式向导：生成 config.yaml 并检查依赖
make setup

# 2) 准备知识库所需的密钥（也可直接写进 config.yaml）
export DASHSCOPE_EMBEDDING_API_KEY=...   # 向量（dense + sparse 一次调用）
export DASHSCOPE_RERANK_API_KEY=...      # 重排
export SILICONFLOW_VLM_API_KEY=...       # 图片说明
export MINERU_API_TOKEN=...              # 文档解析

# 3) 起一个 Qdrant（默认地址 http://localhost:6333，见 config.yaml 的 rag: 块）
docker run -d --name qdrant -p 6333:6333 qdrant/qdrant

# 4) 启动全部服务，浏览器打开 http://localhost:2026
make dev
```

知识库相关配置都在 `config.yaml` 的 `rag:` 块：

```yaml
rag:
  qdrant_url: http://localhost:6333
  embedding_model: qwen3.7-text-embedding
  rerank_model: qwen3-rerank
  vlm_model: qwen3.7-flash
  worker_concurrency: 2
  extract_rate_limit_rps: 5.0
```

表格与视频摄取默认关闭，分别由 `rag.table.enabled` 与 `rag.video.enabled` 打开。

Docker / Helm / 完整配置参考等文档：[UPSTREAM_README.md](UPSTREAM_README.md)。

## 📊 规模（实测）

| 项 | 数量 |
| --- | --- |
| harness RAG 核心 `backend/packages/harness/deerflow/knowledge/` | 50 个 Python 文件 |
| 测试 `backend/tests/knowledge/` | 72 个测试文件、1021 个测试用例 |
| 前端 | `components/workspace/knowledge/` 49 个组件 + `core/knowledge/` 21 个模块 |
| 数据库迁移 | 9 个（0011–0018 + 视频分镜表） |

## ✅ 状态

| 部分 | 状态 |
| --- | --- |
| harness RAG | 已实现，含上面列出的全部能力 |
| Agent 观测宠物 | 5 个循环态（`idle` / `think` / `wait` / `work` / `error`）已交付；`done` / `greet` 在画 |
| Harness 可视化 / 组装画布与对外 MCP | 同一分支上在研 |

## ⚖️ 归属与许可

- 本仓库基于 **DeerFlow**（<https://github.com/bytedance/deer-flow>）构建。上游版权声明为 Copyright (c) 2025 Bytedance Ltd. and/or its affiliates，Copyright (c) 2025-2026 DeerFlow Authors。
- 上游的完整文档（安装 / Docker / Helm / 配置参考）：[UPSTREAM_README.md](UPSTREAM_README.md)；上游 README 的其它语言版本：[中文](README_zh.md) · [日本語](README_ja.md) · [Français](README_fr.md) · [Русский](README_ru.md)。
- 以上游的 [MIT 许可](LICENSE)发布；本仓库的新增部分同样以 MIT 发布。计划先以 RFC 议题向上游项目确认方向，再按切片提交 PR。
- 本仓库为非官方分支，与字节跳动无隶属或背书关系。
