# RAG 功能腿思考「跟随 chat」勾选 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. 「实测」段回填真实命令与数字，不预填、不估算。

**Spec:** [2026-10-03-rag-leg-thinking-follow-chat-design.md](../specs/2026-10-03-rag-leg-thinking-follow-chat-design.md)
**Status:** ✅ **D1=甲 / D2=甲 已裁（2026-10-03）** —— D1=每角色一布尔（`extract_thinking` 等 5 个，默认 `False`）、D2=caption 生效层联动 4096；UI 形态定案（多选下拉框，勾=跟随 chat / 不勾=现状 / 默认全不勾）。待开工 Task 0。

**Architecture:** 五个角色构造点把配置布尔传进既有工厂（`thinking_enabled=…`），工厂的开/关形状分发不动；caption 出站口加对称的开启分发；UI 一个多选下拉框读写五个角色位。

## 范围与交接

| 决策 | 本期落点 | 明确移出 |
| --- | --- | --- |
| D1 配置形状 | ✅ 已裁=甲（每角色一布尔，默认 `False`） | 对话腿思考（10-03 已结案） |
| D2 caption 预算联动 | ✅ 已裁=甲（生效层 `max_tokens=4096`，不动配置字面） | 档位（深度）选择面 |
| UI 多选下拉框 | 定案（spec §2.0，五角色行+占位文案） | 思考能力保存期探针（搁置） |

## 硬约束

- 默认全不勾=五腿请求体与今天逐字节一致；「跟随 chat」语义唯一（含条目闸+默认档位+warning）；行=角色位（同模型互不干扰）；翻案记录进 spec + 图谱并发化 spec 状态行指回。

## Task 0 — 落点核实

- [ ] ① 五构造点现址复核（`graph/extractor.py:130`、`wiki/generator.py:220`+`worker.py:962`、`eval/factory.py:59,72`（`build_judge_llm`）+`eval/synthesis.py:149`、caption 出站口）+ 配置字段落点（`RagConfig` `app_config.py:191-200` + **双层写入链** `config/rag_config_file.py:74`/`gateway/routers/rag_config.py:393` + 热重载）+ 共享闸落点（`create_rag_chat_model` 包装进 `knowledge/model_target.py`）+ `VlmTarget` 扩字段面（`vlm_target.py:70-76`）+ 既有用例受害者扫描（断言 `thinking_enabled` 的用例清单）。

## Task 1 — D1 执行：后端 TDD

- [ ] RED：按 D1 裁定写红——五角色各一用例（勾⇒构造点收到 `thinking_enabled=True`；默认⇒False 且请求体不变）+ 「跟随 chat 含条目闸」用例（`supports_thinking: false` 条目 ⇒ 闸回 warning）。⚠️ wiki 用例别走 `main_llm` 注入口（`worker.py:962` 的 `self._main_llm or` 是文档明示的测试旁路、生产不传）——要测决议路径用真构造点。
- [ ] GREEN：`RagConfig` + **双层写入链**加 5 布尔（D1 形状）+ `create_rag_chat_model` 共享闸包装 + 五构造点改走它（wiki 两处）+ `VlmTarget` 扩 `enable_shape`/`supports_thinking` + caption 出站口开启分发（`_apply_thinking_on`，无声明不发）。
- [ ] neuter：还原一处勾选读取 ⇒ 对应红；全还原全绿。

## Task 2 — D2 执行：caption 预算联动

- [ ] D2=甲：caption 发送预算 = `max(用户 caption_max_tokens, 4096)`（生效层、不动配置字面、不砍用户调高的值）+ 用例钉住（勾上⇒按上式、不勾⇒照用户值原样）。

## Task 3 — 前端下拉框

- [ ] 设置页 RAG 区多选下拉框：五行=五角色位（副文案=当前所选模型名）、勾选保存走既有 rag 配置热重载、占位文案「思考 · 跟随 chat（点击开启）」类在框内无前置标签、勾 vlm 行时按 D2=乙 显示提示（若裁定为乙）。

## Task 4 — 门禁 + 文档 + 收尾

- [ ] 门禁：`tests/knowledge` + models 面 + `frontend pnpm check` + ruff 双净（实测数字回填）。
- [ ] 文档：spec/plan 回填实测、图谱并发化 spec 状态行加翻案指回、`config.example.yaml`/模板三套件补新字段注释、AGENTS.md 配置节同步。
- [ ] 提交链回填：本笔（成对起草）→ 后续交付笔。
