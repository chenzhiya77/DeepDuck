# 向量重灌与嵌入身份防护 —— 实施计划

- 成对 spec：`docs/superpowers/specs/2026-10-04-vector-reembed-and-embed-identity-guard-design.md`
- 日期：2026-10-04
- 状态：实施中（Task 0②③④ + Task 3 已交付 2026-10-04；Task 1/2/4/5/6/7 未动。✅ 全裁：D1=四类全量 / D2=甲按库一列 / D3=甲自动重建，2026-10-04 他拍）

## 范围与交接

四决策：D1 重灌（修数据，复用 `reindex_kb`）/ D2 记身份（结构修）/ D3 换模型触发重建（结构修）/ D4 失配检测（兜底/观测）。甲（查询侧链接加强）已淘汰不进本对。改动面=knowledge + `app/gateway/routers/rag_config.py` 保存路径 + 设置页提示；ragas/chat 链零改动。验收口径=小样本（3–6 题）对照，全量只在他点名时跑。

## 硬约束（执行期注意）

- 重建=只重嵌不重解析（`test_reindex.py:163` 是钉子，别碰）。
- 失败姿态=旧索引继续服务；不建空集合、不静默清库。
- 宽度三格口径不动；密钥轮换不进指纹、不触发。
- 门禁用 `backend/.venv/Scripts/python.exe`；basetemp 用仓外隔离目录、跑完删（见 [[env-induced-test-failures]]）。
- 工作树有别线未提交内容，提交按线拆、逐文件看 hunk。

## Task 0 — 落点核实

- [ ] ① KB 表模型与迁移：`knowledge/store.py` / persistence models 里 KB 行的落点，`embedding_identity` 加列走迁移 0019 的写法（对照 0018 的先例）。
- [x] ② 保存路径触发点：`rag_config.py:452` `_embedding_signature` 现比较哪几个字段、api_key 排除法怎么落；同宽指纹差分支的插入点。（已核 2026-10-04：指纹=provider/model/base_url 三字段、api_key 明确排除；插入点=`put_rag_config` 的 `rebuilding` 分支，宽度差优先吸收）
- [x] ③ 重建入口现状：`knowledge_service.py:1726-1745` 库级重建/状态查询的签名与并发语义（`reindex_in_progress` 单飞），D3 触发复用它要不要过 `rag_migration` 的「先建后切」通道（宽度变更走的是 `start_migration`）。（已核 2026-10-04：`migrate_collections` 开头就 `drop_collections` ⇒ 同宽不可复用；D3 走独立 `services/rag_reembed.py` 逐库 `reindex_kb`，不过先建后切通道；同跑互斥由保存路径 409 承担）
- [x] ④ 受害者扫描：断言 `_embedding_signature`/保存响应/重建状态的既有用例清单（`tests/knowledge/test_reindex.py`、rag_config 相关），谁会被「指纹字段/新响应键」波及。（已核 2026-10-04：api 面 41 条受害者修夹具/豁免归零；`test_rag_config_save_probe.py` 6 条门禁期二波抓到并修；`test_rag_config_probe.py` 4 条=预存红，HEAD A/B 定性见 Task 3 门禁）
- [ ] ⑤ D1 成本核实：四库实际待嵌文本数与批大小（`embedder.batch_size`），报数后再跑。

## Task 1 — D1：全量重灌（执行 + 对照）

- [ ] 报成本（批次数/预计调用数）等他点头再动手。
- [ ] 逐库跑 `reindex_kb`（4 库；单库失败不连坐、记录 last_run）。
- [ ] 抽验：四类各抽样 cos(存库, 现算) ≥ 0.9（复用 scratch `vec_space_check.py` 口径）。
- [ ] 小样本 L1 前后对照：3–6 题（含 q011/q005/q009）逐题翻盘 + Δhit/Δrecall 报数（基线=本对前实测 0.471/0.314，见 spec §1）。
- [ ] D2 身份写入落地后补跑一次：重建完成 ⇒ `embedding_identity` = 当前指纹。

## Task 2 — D2 记身份 TDD（已裁：甲=按库列）

- [ ] RED：①入库完成/重建完成 ⇒ 身份字段=当前指纹（现状无字段 ⇒ 红）；②api_key 轮换 ⇒ 指纹不变（防误触发）。
- [ ] GREEN：迁移 0019 + 写入两处（新库入库 / `reindex_kb` 成功后）。
- [ ] neuter：拆「成功后更新」⇒ 恰红 A1；还原复绿。
- [ ] 门禁：knowledge 面 + ruff 双净。

## Task 3 — D3 换模型触发重建 TDD（已裁：甲=自动逐库重建）✅ 2026-10-04 交付

- [x] RED：①同宽、指纹差保存 ⇒ 触发逐库重建（甲）/响应带强确认要求（乙）；②宽度差 ⇒ 仍走既有先建后切迁移（回归钉住，不许被本对改道）；③重建进行中再保存 ⇒ 409、什么都没写。—— 6 例写红（状态空/扣住不翻/失败不翻/二次 409/轮换不触发/宽度不改道）；GREEN 期补第 7 例=凭据随身份扣（`test_the_credential_waits_with_the_identity`）。
- [x] GREEN：`_embedding_signature` 比较扩展 + 触发分支（复用 Task 0③ 的入口）。—— 新增 `app/gateway/services/rag_reembed.py`（hold→逐库 `reindex_kb`→原子 flip，镜像 `rag_migration` 姿态）；`rag_config.py` 触发+503/409+hold 通道+`reembed` 响应键与 GET 端点。GREEN 期两条定形（spec §2.3 已记）：①响应=报文件现状、目标挂 `reembed.target_*`（对齐 `migration.target_dimension`），旧「同响应即换兜底」契约改为「翻转即换、状态点名目标」，两条既有用例改向；②`embedding_api_key` 进 hold 集不进指纹（窗口里旧端点拿旧钥；轮换单独保存仍即时）。
- [x] neuter：拆触发分支 ⇒ 恰红；宽度回归例保持绿（受害者不相交）。—— 实测：拆触发=6 红（启动侧断言）、拆 flip=9 红（落地侧断言）；交集 5（两头都断的集成形）、①独有 1（失败不翻）、②独有 4（落地断言）；三条「不该触发」钉子双绿。与「不相交」预期有出入，按实测报。
- [x] 门禁：knowledge 面 + ruff 双净。—— `test_rag_config_api.py` 87/87；`test_rag_config_save_probe.py` 6 条（我的 503 受害者）修夹具转绿（服务占位+即时重建桩+settle）；`test_rag_config_probe.py` 4 条预存红 HEAD worktree A/B 定性（双向同 4 条同签名=「provider 需要 embedding_base_url」，09-25 端点必填线欠账，非本对回归、不进本对修）；ruff check/format 双净。

## Task 4 — D4 失配检测 TDD

- [ ] RED：①库身份 ≠ 当前指纹 ⇒ 检索 API 响应带 `embedding_mismatch: true` + warning 日志（无密钥）；②一致 ⇒ 两样都没有；③查询不被拒绝（不锁定）。
- [ ] GREEN：读侧比对 + 响应键 + 文案（复用/升级 `embeddingChangeWarning`）。
- [ ] neuter：摘比对 ⇒ 恰红；还原复绿。
- [ ] 门禁：knowledge 面 + ruff 双净；前端 `pnpm check`（若文案动）。

## Task 5 — 门禁 + 文档

- [ ] 全量门禁：knowledge 面全绿（环境红按既有账登记）+ ruff 双净。
- [ ] 文档：`backend/AGENTS.md` RAG 段补「嵌入身份与重建」一段；spec/plan 回填实测数字与提交链；受影响前端文案键表。

## Task 6 — 真栈验收 + 收尾

- [ ] 真栈 A4：同宽换模型保存（改模型名→保存→改回，配置逐字节还原、md5 前后对照）⇒ 触发语义按待拍结果验证；完成后身份一致、L1 检索复常。
- [ ] 收尾：scratch 留 `ragas-perf/` 不进仓；工作树核对仅本对改动；提交链回填。

## Task 7 — D 小补丁：graph_search 抽取 malformed JSON 兜底（✅ 2026-10-04 他拍并入本对）

- [ ] RED：`_extract_query_entities` 收到畸形 JSON ⇒ 按既有兜底路径走整句候选（现状抛/返回空的行为差异用例钉住）。
- [ ] GREEN：解析失败的防御（一行级）；不动抽取 prompt 与模型。
- [ ] 门禁：knowledge 面 + ruff 双净。

## C 线去留判据（✅ 2026-10-04 他拍）

A（Task 1）完成后 3–6 题对照：「落上却空手」类（q011/q005/q009 型）**全翻盘 ⇒ C 转观察项**；仅剩多跳题仍 miss ⇒ 另立小对动 ④ 剪枝。
