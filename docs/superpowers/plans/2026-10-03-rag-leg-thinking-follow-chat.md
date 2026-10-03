# RAG 功能腿思考「跟随 chat」勾选 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. 「实测」段回填真实命令与数字，不预填、不估算。

**Spec:** [2026-10-03-rag-leg-thinking-follow-chat-design.md](../specs/2026-10-03-rag-leg-thinking-follow-chat-design.md)
**Status:** 🚧 **Task 0–3 ✅（2026-10-03）** —— D1=甲（每角色一布尔，默认 `False`）、D2=甲（caption 生效层 `max(用户值, 4096)`）；UI 形态定案。后端 TDD + 预算联动 + 前端下拉框已交付；下一棒 Task 4（门禁 + 文档收尾）。

**Architecture:** 五个角色构造点把配置布尔传进既有工厂（`thinking_enabled=…`），工厂的开/关形状分发不动；caption 出站口加对称的开启分发；UI 一个多选下拉框读写五个角色位。

## 范围与交接

| 决策 | 本期落点 | 明确移出 |
| --- | --- | --- |
| D1 配置形状 | ✅ 已裁=甲（每角色一布尔，默认 `False`） | 对话腿思考（10-03 已结案） |
| D2 caption 预算联动 | ✅ 已裁=甲（生效层 `max_tokens=4096`，不动配置字面） | 档位（深度）选择面 |
| UI 多选下拉框 | 定案（spec §2.0，五角色行+占位文案） | 思考能力保存期探针（搁置） |

## 硬约束

- 默认全不勾=五腿请求体与今天逐字节一致；「跟随 chat」语义唯一（含条目闸+默认档位+warning）；行=角色位（同模型互不干扰）；翻案记录进 spec + 图谱并发化 spec 状态行指回。

## Task 0 — 落点核实 ✅

- [x] ① 五构造点行号**零漂移**：`graph/extractor.py:130`、`wiki/generator.py:220` + `worker.py:962`、`eval/factory.py:72`（`build_judge_llm` :59）+ `eval/synthesis.py:149`；caption 出站口=`caption_client.py`（`_apply_thinking_off` :60、`request_caption` :109，`max_tokens` 由 `captioner.py:84-85`/`video/captioner.py:83-84` 传入）。
- [x] ② 写入链实为**两层 schema**（修正审查③措辞）：`RagConfig`（`app_config.py:191-200`）+ `RagConfigFile`（`rag_config_file.py`，`extra="forbid"` ⇒ 漏声明是 400 响亮报错、不会静默丢）；`merge_rag_config` 通用透传（`model_dump(exclude_none=True)`，**`false` 会落盘**）；`rag_config.py:393` 是模型名校验环、**不涉布尔**。布尔三态=None=未声明（吃 config.yaml 默认 `False`）/true/false 显式。热重载 ✓（`get_app_config()` 每触发解析，wiki 注释明写 per-trigger）。
- [x] ③ 共享闸落点：`model_target.py` 纯函数模块（8 def、无类），`create_rag_chat_model` 全仓 0 命中可用；包装内**懒 import** `deerflow.models.factory` 并按模块属性调用（保住 monkeypatch 面）。`VlmTarget`（`vlm_target.py:60-76`，frozen dataclass）扩 `enable_shape`/`supports_thinking` 两带默认字段=零破坏。
- [x] ④ 受害者扫描：**零用例断言五构造点的 thinking 参数**；间接面 3 文件 Task 1 后复跑——`test_eval_factory.py`（4 处 monkeypatch `models_factory.create_chat_model`）、`test_ragas_eval_cli.py:142`、`test_e2e_smoke.py:115`（走 `main_llm` 旁路=审查⑦那只）。

## Task 1 — D1 执行：后端 TDD ✅

- [x] RED：`test_leg_thinking_toggle.py` **13 红 / 1 守护行绿**（「默认仍发关闭形状」=今日行为）。红因=五腿不传 `thinking_enabled`、caption 无 `thinking` 参数/无开启形状。wiki 用例走真决议路径（未用 `main_llm` 注入口）。
- [x] GREEN：两层 schema 加 5 布尔 + `create_rag_chat_model` 共享闸（`model_target.py`，懒 import 保 monkeypatch 面；**闸只在开思考时查条目**）+ 五构造点传 `thinking=`（wiki 两处）+ `VlmTarget` 扩 `enable_shape`/`supports_thinking` + caption `_apply_thinking_on` + `request_caption` 闸 ⇒ **14/14**。
- [x] neuter：①还原抽取勾选读取 ⇒ 恰 **2 红**（extract 勾选 + 该腿闸用例）；②拆腿闸 ⇒ 恰 **1 红**（caption 闸独立、反证面不相交）；全还原复绿。
- [x] 门禁：knowledge + config/models 面 **1805 passed / 4 env 红**（缺 key 对 `test_embed_missing_api_key`/`test_rerank_missing_api_key` + parser 对=本机真实 MinerU token 泄进隔离断言）；ruff check/format 双净。**受害者处置**：判官两夹具补 `judge_thinking`/`get_model_config`（`test_eval_factory.py`/`test_ragas_eval_cli.py`，前例「给夹具补值」）+ `response_golden.json` 补 10 嵌套键（`config`×5=`False`、`sources`×5=`config_file`；字段面守卫拦对了=预期的"字段面变动"）。

## Task 2 — D2 执行：caption 预算联动 ✅

- [x] D2=甲：caption 发送预算 = `max(用户 caption_max_tokens, 4096)`（生效层 `request_caption`、闸后才涨、不动配置字面、不砍用户调高的值）+ 用例钉住（勾上⇒按上式、不勾⇒照用户值原样、被闸降级⇒不涨）。实测：RED 恰 1 红（地板用例）/3 守护绿 → GREEN **18/18** → neuter 拆地板恰 1 红（守护不相交）→ 还原绿；caption 面门禁 **235/235** + ruff 双净。

## Task 3 — 前端下拉框 ✅

- [x] 设置页 RAG 区多选下拉框：五行=五角色位（每行「角色名 · 当前所选模型名」，同模型两槽=两行）、勾选保存走既有 rag 配置热重载、触发器自述（`思考 · 跟随 chat（点击开启）`→`…（已选 N）`）无前置标签；D2=甲 ⇒ 勾 vlm 行无额外提示。实测：`config-form` **130 绿**（+27：种子/开/关/带出/回退）+ `functional-models.dom` **117 绿**（+6）+ 全量 **247 文件全绿**、`pnpm check` 零诊断。夹具补值=第三份 DOM 夹具 KEYS Proxy 按键函数名单补 `thinkingMenuState`（前例「给夹具补值」）；Radix 模态层会 aria-hide 菜单外内容 ⇒ 开着菜单时外部元素查询须 `hidden: true`。

## Task 4 — 门禁 + 文档 + 收尾

- [ ] 门禁：`tests/knowledge` + models 面 + `frontend pnpm check` + ruff 双净（实测数字回填）。
- [ ] 文档：spec/plan 回填实测、图谱并发化 spec 状态行加翻案指回、`config.example.yaml`/模板三套件补新字段注释、AGENTS.md 配置节同步。
- [ ] 提交链回填：本笔（成对起草）→ 后续交付笔。
