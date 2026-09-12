# Plan: 百科补充层即生成方向 — 2026-09-12

**Spec**: `docs/superpowers/specs/2026-09-12-rag-wiki-supplement-direction-design.md`

**前置**: Phase-3 Batch-1（P1 双模式编辑框 / P6 手动卡片）已交付。本增量只补上 spec A7 里 **未落地的那半句**（"作为额外参考材料提供"），不重做编辑框、不动 `WIKI_SYSTEM_PROMPT`。

**层级映射**（对应 2026-09-12 评审的四层）：注入 → Task 1；触发 → Task 2；文案 → Task 3；文档与全量回归 → Task 4。测试随各 Task 的 RED→GREEN 走，不单列。

## 验证基线

- 后端：`cd backend && uv run --no-sync pytest <files> -q --basetemp=.pytest-tmp/wikidir`；
  `uv run --no-sync ruff check <files>` + `uv run --no-sync ruff format --check <files>` 双净。
- 前端：`cd frontend && python ../scripts/pnpm.py check`（eslint+tsc）双净；`python ../scripts/pnpm.py test <paths>`。
- Windows：pytest 必须带 `--basetemp`；本机仓库根真实 `models_config.json` 会让 3 个后端用例恒红、`chat-panel.dom.test.tsx` 1 条前端用例预存红——**判环境性别当回归**；
  `pnpm format` 因 `core.autocrlf` 对全树报 CRLF，判内容合规用"剥 CR 后与 prettier 输出比对、数字与 HEAD 相同"法。
- 后端 `--reload` 在本机不可靠（uvicorn win32 分支无硬杀兜底）：改后端后**手动重启网关**（用户自持进程，`make gateway`）。

## 架构基调

- **只有一条路径需要注入**：批量路径 `_write_bundle` 服务 backfill，而 backfill 的定义就是"还没有条目的实体" ⇒ 天然没有方向可注入。`WIKI_BATCH_SYSTEM_PROMPT` 与 `_write_bundle` **零改动**。
- **方向走 user message**，系统提示词一字不动 ⇒ 静态前缀不变，不改变既有 prefix-cache 行为。
- **保存只在补充层变化时触发重写**，fire-and-forget，busy 回退标脏；正文变化不触发（否则刚手改的正文会被同一请求冲掉）。
- **文案与实现同批交付**：不能先写承诺再补功能——这正是本增量要修的毛病。

## Task 1: 生成侧 guidance 注入 + 全量模式按方向拆条（seam B）

**Files:**
- Modify: `backend/packages/harness/deerflow/knowledge/wiki/generator.py`
  - 新增模块常量 `WIKI_DIRECTION_HEADER`
  - `_write_entry`（`:265`）增 `guidance: str | None = None`，在 user message（`:281-287`）的实体信息之后、`来源切片：` 之前插一段
  - `generate_wiki` dirty 分支（`:354-370`）：`singles` 从"只留实体行"改为 `(row, guidance)` 成对（`entry["supplement_content"]` 在手）
  - `generate_wiki` non-dirty 分支（`:371-374`）：先 `list_entries(kb_id)` 取 `{title: entry}`，把合格实体拆 `guided`（有非空补充层，走 `_write_entry`）/ `plain`（走既有 `plan_entry_batches`）
  - `regenerate_wiki_entries`（`:443-464`）：`entry` 已在手，把它带进 `_write_entry`
- Test: `backend/tests/knowledge/wiki/test_generator.py`（新增 5 例；复用既有 `_WikiLLM.calls`，无需新 fake）

- [x] **Step 1（RED）**：5 条用例先写测试
  ① `test_dirty_regeneration_injects_supplement_as_direction`：dirty 条目带补充层 → `llm.calls` 里该次 user message 含补充层原文与 `WIKI_DIRECTION_HEADER`；
  ② `test_regeneration_without_supplement_omits_direction_block`：无补充层 → 不含 header；
  ③ `test_full_rebuild_sends_guided_entries_through_single_call`：`only_dirty=False` 且库中一条有条目+补充层、一条无条目 → `llm.calls` 里同时存在"批量调用"（含 `实体清单：`）与"单条调用"（含 header），且批量名单里**不含**那条有方向的实体；
  ④ `test_per_entry_regenerate_injects_direction`：`regenerate_wiki_entries` 同样带上；
  ⑤ `test_blank_supplement_is_not_injected`：`"   "` → 不注入。
  **红在哪**：collection 期 `ImportError: cannot import name 'WIKI_DIRECTION_HEADER'`（符号尚不存在）——整文件 1 个收集错误，非断言写错。
- [x] **Step 2**：实现。`guidance` 为空（`strip()` 后）时不拼段；dirty/regenerate 两条路径走成对传递；non-dirty 拆分只动路由，不改 `plan_entry_batches` 本身。
  注意 `_write_bundle` 内部漏标题时回退 `_write_entry`（`:323`）**不带** guidance —— 那条路是 backfill（无条目），正确。
- [x] **Step 3（GREEN）**：`test_generator.py` **32 passed**；整个 `tests/knowledge` **1064 passed / 2 skipped**（`generator.py` 的调用方全在这一层：worker、service、e2e smoke）。
- [x] **Step 4（revert proof）**：两刀都有牙——刀一 `_write_entry` 忽略 `guidance`（`direction = ""`）⇒ **3 红**（①注入 / ③全量拆条 / ④局部重建注入），②⑤ 两个"不注入"护栏仍绿；
  刀二 三个调用点全改传 `None`（dirty 成对 / 全量拆条 / regenerate 成对）⇒ **同样 3 红**，②⑤ 绿。恢复后 32 绿。
  **偏离**：原计划写"刀二只动 dirty+regenerate、③ 应保持绿"，实际把全量拆条一并 neuter（更强：三个站点各自被钉住），故 ③ 也转红。
- [x] **Step 5**：`ruff check` + `ruff format --check` 双净（两文件）。
- [x] **Step 6**：Commit **`06bffc01 feat(rag): feed the wiki supplement layer into generation as direction`**（2 文件，+138/-13）。

**交付判据**：`_write_entry` 的 guidance 只在非空时进入 user message；三个调用点的数据来源一次性核对（`:323` 不带、`:391` 带、`:464` 带）；`WIKI_SYSTEM_PROMPT` / `WIKI_BATCH_SYSTEM_PROMPT` 与 `_write_bundle` 字节不变。 **✅ 达成。**

#### Task 1 交付纪要（2026-09-12）

- **实现落点**：`generator.py` —— 模块常量 `WIKI_DIRECTION_HEADER`（表头同时写明优先级与"不得引入材料与要求之外的信息"）；`_write_entry` 增 `guidance: str | None = None`，非空时在"已有描述"与"来源切片"之间插 `HEADER\ndirection\n\n`；
  `generate_wiki` dirty 分支 `singles` 改 `(row, supplement)` 成对；非 dirty 分支新增 guided/plain 拆条（有非空补充层的走 `_write_entry`、其余保留 `plan_entry_batches`）；`regenerate_wiki_entries` 的 `rows` 改 `targets` 成对；
  模块 docstring 增一条 "Supplement as direction" 说明。
- **决策 / 偏离**：
  1. **无方向时 prompt 逐字节不变**：`direction_block` 为空串，字符串仍是 `…已有描述：…\n\n来源切片：…`。这是刻意设计（避免动到既有 27 例的 prompt 断言，也避免无谓的缓存失效），已写进 `_write_entry` docstring。
  2. **方向只进 user message，系统提示词零改动**（spec 的冻结决定）：静态前缀不变。
  3. **全量分支多一次 `list_entries(kb_id)` 读**：只在 `only_dirty=False` 时发生，换来"全量重建不静默丢方向"。可接受。
  4. 表头措辞按 spec 冻结值一字未改。
- **遗留**：Task 2（保存补充层即排队重写）、Task 3（文案三处 + DOM 断言）、Task 4（AGENTS 同步与全量回归）。

## Task 2: 保存补充层即排队重写（seam A）

**Files:**
- Modify: `backend/app/gateway/services/knowledge_service.py`（`update_wiki_entry`，`:629-656`）
  - 保存前比较：`_normalize_supplement(body 值)` 与 `_normalize_supplement(entry["supplement_content"])`（空白串 → `None`）
  - 变化 ⇒ `self.trigger_wiki_regeneration(kb_id, [entry_id])`（`:562`）；返回 `False` ⇒ `await self.wiki_store.mark_dirty_for_titles(kb_id, [entry["title"]])`（`wiki/store.py:117`）
  - 正文变化不参与触发
- Modify: `backend/tests/knowledge/test_api.py`（新增 4 例，沿用 `service` fixture 与 `test_api.py:776-792` 的 monkeypatch 手法）

- [ ] **Step 1（RED）**：4 条用例
  ① `test_saving_supplement_triggers_single_entry_rewrite`：PATCH 补充层由 A→B ⇒ 触发被调且 `entry_ids == [entry_id]`；
  ② `test_saving_supplement_while_busy_falls_back_to_dirty`：`wiki_generation_in_progress` 为真 ⇒ 不触发、条目 `status == "dirty"`；
  ③ `test_editing_main_content_alone_neither_triggers_nor_marks_dirty`：只改正文 ⇒ 两个副作用都没有；
  ④ `test_clearing_supplement_also_triggers`：补充层 A→`None` ⇒ 触发（撤下方向同样要重写）。
  **红在哪**：①④ 因无触发而失败（mock 未被调用/条目未标脏），②③ 在 Step 2 之前会"通过"——它们锁定"不该发生的事"，属护栏而非 RED。
- [ ] **Step 2**：实现（含空白归一；保持 HTTP 契约与返回体不变，PATCH 仍回条目）。
- [ ] **Step 3（GREEN）**：4 例转绿；`tests/knowledge/test_api.py` 全绿。
- [ ] **Step 4（revert proof）**：一刀——`update_wiki_entry` 去掉触发与回退 ⇒ ①④ 转红、②③ 仍绿；恢复后 4 绿。
- [ ] **Step 5**：`ruff` 双净。
- [ ] **Step 6**：Commit。

**交付判据**：PATCH 响应体形状不变；触发只在补充层变化时发生；busy 路径有一条显式断言证明"方向没有静默丢失"（落 `dirty`）。

#### Task 2 交付纪要（待填）

## Task 3: 文案（i18n 三处 + DOM 断言）（seam C）

**Files:**
- Modify: `frontend/src/core/i18n/locales/types.ts`（注释口径，形状不变）
- Modify: `frontend/src/core/i18n/locales/zh-CN.ts`（`knowledge.wikiEdit`，`:921-934`）
- Modify: `frontend/src/core/i18n/locales/en-US.ts`（同块，`:986-1003`）
- Modify: `frontend/tests/unit/knowledge/wiki-edit-dialog.dom.test.tsx`（hint 断言）

**新文案（zh）**：`description` "主内容区可被下次生成覆盖；补充层永久保留，并作为每次生成的方向"；`mainContentHint` "⚠️ 此内容会在下次重新生成时被覆盖"（**删掉"您的编辑将作为参考材料融入新版本"**）；`supplementLabel` "补充层（AI 生成方向）"；`supplementPlaceholder` "写下你希望 AI 怎么改这篇条目，等同于给生成用的提示词。例如：语气严谨些，多介绍相关概念"；`supplementHint` "✅ 永久保留；每次重新生成都会作为你的要求带给 AI"。

**新文案（en）**：`description` "Main content can be replaced by regeneration; the supplement layer persists and steers every generation"；`mainContentHint` "⚠️ This content will be replaced on next regeneration"；`supplementLabel` "Supplement Layer (Generation Direction)"；`supplementPlaceholder` "Describe how you want the AI to rewrite this entry — it works like a prompt for generation. e.g. Keep the tone rigorous and cover more related concepts"；`supplementHint` "✅ Persists permanently; it is passed to the AI as your requirement on every regeneration"。

- [ ] **Step 1（RED）**：DOM 测试加两条断言——主内容区 hint **不含** `/参考材料|reference material/`；补充层 hint 匹配 `/方向|direction/`。
- [ ] **Step 2**：改三处 i18n；`types.ts` 只更新块注释（**key 集不变**，无新增/删除键）。
- [ ] **Step 3（GREEN）**：`wiki-edit-dialog.dom.test.tsx` 全绿（既有 `/主内容区/`、`/补充层/` 正则不受新标签影响）；`pnpm check` 双净。
- [ ] **Step 4（revert proof）**：一刀——`mainContentHint` 恢复旧值 ⇒ 1 红；恢复后全绿。
- [ ] **Step 5**：Commit。

**交付判据**：中文与英文 key 集逐一对齐（无缺漏）；对话框里不再出现任何"会融入"的表述；"方向"语义在 label/placeholder/hint 三处一致。

#### Task 3 交付纪要（待填）

## Task 4: 文档同步与全量回归

**Files:**
- Modify: `backend/AGENTS.md`（RAG 小节：把补充层的描述从"人工批注、不参与生成"改成"生成方向 + 保存即重写"，并记 `_write_entry` 的 guidance 通路）
- Modify: `docs/superpowers/specs/2026-09-12-rag-wiki-supplement-direction-design.md`（状态翻转 + 落地日期）
- Modify: 本 Plan（Task 逐条回写提交号）

- [ ] **Step 1**：三处文档同步（AGENTS 是开发面、spec 是状态、plan 是回写）。
- [ ] **Step 2**：全量回归——后端 `tests/knowledge` 全绿（环境性红单列）；前端 `pnpm test` 全绿（预存红单列）；`pnpm check` 与 ruff 双门禁净。
- [ ] **Step 3（真栈实测，可选但建议）**：`make gateway` + `scripts/pnpm.py dev`：① 编辑条目写补充层「语气严谨些，多介绍相关概念」→ 保存 → 观察 wiki 页「更新中」→ 完成后正文**确实按方向变化**且补充层原文一字未动；② 改「更新百科」全量模式，确认有方向的条目仍按方向重写；③ 清空补充层 → 保存 → 重写后正文回到中性口径。
- [ ] **Step 4**：Commit（文档 + 交付纪要）。

**交付判据**：AGENTS.md 的表述与代码一致；spec 状态翻转；三条实测（或写明未测原因）落进交付纪要。

#### Task 4 交付纪要（待填）

## 风险登记

| 风险 | 触发任务 | 缓解 |
|---|---|---|
| 库级生成在跑时保存补充层 ⇒ 方向静默丢失 | T2 | 触发返回 `False` 即回退标脏；② 用例显式断言落 `dirty` |
| 用户在补充层写"事实纠正"，与切片材料冲突 | T1 | prompt 措辞明确"人工指令优先于来源切片"；同时保留"仍不得引入材料与要求之外的信息" |
| 方向把正文带偏（越写越长 / 跑题） | T1 | 系统提示词原有结构约束（`# 标题` + 2–4 段）不变；`guidance` 只作为 user message 的一个段落 |
| 全量重建的拆分改变批量效率 | T1 | 只有"写过方向"的条目退化为单条调用；无方向条目仍走 `plan_entry_batches` |
| 每次保存补充层多一次 LLM 调用 | T2 | 仅补充层实际变化时触发；正文编辑不触发 |
| 文案先于实现上线（旧毛病复现） | T3 | 文案与 T1/T2 同一批交付；T3 的交付判据要求"不再出现会融入的表述" |
| 编辑框文案改动打断既有 DOM 断言 | T3 | label 保留"主内容区/补充层"字样；断言用正则而非全等 |

## 开口（执行中如遇冲突以此为准）

- 若 `select_eligible_entities` 的返回行与 `list_entries` 的 `title` 对不齐（同名不同格式）⇒ 以 `entry["title"] == row["name"]` 的精确匹配为准，与 `generate_wiki` dirty 分支现有口径一致，不做模糊匹配。
- 若全量模式的拆分让单次运行的 LLM 调用数明显上升（有方向的条目很多）⇒ 保留拆分但把 `guided` 也按 `plan_entry_batches` 分组送入 `_write_entry` 时**不带** guidance 的实体单独成批——即"有方向的逐条、无方向的照旧"，不引入第三种批量 prompt。
- 若 T2 的触发与既有 `test_wiki_regenerate_*` 用例互相干扰（同一 `service` fixture 的 `_wiki_tasks`）⇒ 在新用例里显式 `await asyncio.gather(*service._wiki_tasks)`，与 `test_api.py:788` 同法。
