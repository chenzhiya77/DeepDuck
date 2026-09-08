# 视频入库实施 plan（2026-09-08）

对应 spec：`docs/superpowers/specs/2026-09-08-video-ingest-design.md`（章节引用
以「spec §N」标记）。任务按序执行；每任务 RED → GREEN → revert proof → 提交。
后端验证基线：`cd backend && uv run pytest tests/knowledge -q`（沙箱需
`--basetemp=.pytest-tmp/<sub>` + PYTHONPATH/PYTHONIOENCODING/PYTHONUTF8 三 env，
Makefile 同款）+ `ruff check/format` 双净；前端：`python ../scripts/pnpm.py check`
+ `test run tests/unit/knowledge`。

## Task 1: 配置门控与后缀并集（spec §2/§7）

**Files:**
- Modify: `backend/packages/harness/deerflow/config/app_config.py`（rag.video 段 schema，默认 enabled=false）
- Modify: `backend/packages/harness/deerflow/knowledge/parser.py`（`VIDEO_UPLOAD_SUFFIXES` frozenset；`SUPPORTED_UPLOAD_SUFFIXES` 文本集**不动**）
- Modify: `backend/app/gateway/routers/knowledge_bases.py`（`/supported-formats` 返回并集当且仅当 enabled）
- Modify: `config.example.yaml`（注释段）
- Test: `backend/tests/knowledge/test_api.py`（门控并集两态：off 拒 .mp4 / on 收 .mp4；文本集恒在）

- [x] RED：门控两态用例 failed（端点恒返文本集）。（8 例 RED，含体积门与配置段用例）
- [x] Implement：配置段 + frozenset + 端点并集。（另落 `video_upload_limit_bytes()` 体积门：超 `max_size_mb` 门口即拒）
- [x] GREEN + revert proof（摘 `video_ingest_enabled` 门控 → 4 例 RED）。
- [x] Commit: `feat(rag): gate video upload suffixes behind rag.video.enabled`（`787e817e`）

## Task 2: video_shots 表与 store CRUD（spec §3）

**Files:**
- Modify: `backend/packages/harness/deerflow/knowledge/models.py`（VideoShotRow，唯一约束 (doc_id, shot_index)）
- Create: `backend/packages/harness/deerflow/knowledge/video/store.py`（VideoShotStore：bulk upsert / list by doc / pending 查询 / delete by doc）
- Migration: `make migrate-rev MSG="add video_shots table"`
- Test: `backend/tests/knowledge/video/test_store.py`（CRUD + resume pending 查询 + 级联删）

- [x] RED → Implement → GREEN → revert proof。（5 例；upsert 冻结「present keys overwrite / absent keys persist」，caption_status 不隐式重置；迁移 `77df30935788` 已剔除 autogen 混入的 content_hash 漂移 noise，upgrade head + downgrade -1 实跑验证）
- [x] Commit: `feat(rag): add video_shots table and store for shot cards`（`8c3868f1`）

## Task 3: probe + ASR 适配层（spec §2）

**Files:**
- Create: `backend/packages/harness/deerflow/knowledge/video/probe.py`（ffprobe 时长/可解码性；不可解码抛 `VideoUndecodableError`）
- Create: `backend/packages/harness/deerflow/knowledge/video/asr.py`（`TranscriptSegment(start_ms,end_ms,text)`；FunASR/whisper 双 provider 协议 + 本地 CPU 档；整腿失败抛 `AsrError`）
- Test: `backend/tests/knowledge/video/test_probe.py`（fake runner + 真实 ffprobe JSON 覆盖解析/错误映射；真实二进制端到端 skipif）+ `test_asr.py`（fake provider 协议 + normalize_transcript 时间戳合并纯函数 + provider 输出解析白盒）

- [x] RED → Implement → GREEN → revert proof。（25 passed + 1 skipped；本机无 ffmpeg/funasr/whisper，纯逻辑用 fake runner + fake provider 全覆盖，真实二进制端到端标 skipif 不阻塞回归——对原文「ffmpeg 合成 fixture」的合理偏离；probe 硬失败 VideoUndecodableError/FfprobeMissingError，asr 整腿降级 AsrError（依赖缺失延迟 import 即降级，不 crash）；normalize_transcript 钉死单位换算/排序/无效丢弃；blocking subprocess/推理经 run_file_io 落线程池）
- [x] Commit: `feat(rag): video probe and ASR adapter legs`（`c86f1c4f`）

## Task 4: 场景切分纯函数（spec §2/§10）

**Files:**
- Create: `backend/packages/harness/deerflow/knowledge/video/segmentation.py`（`merge_scene_bounds(cuts, duration_ms, max_shot_ms)` 兜底必切；`fallback_windows(duration_ms, window_ms)` 等距回退；边界去重/零长度镜头剔除纯函数）
- PySceneDetect 调用封在 worker 腿内（可 fake），纯函数不依赖它
- Test: `backend/tests/knowledge/video/test_segmentation.py`（兜底切/回退窗/零长度剔除/确定性同输入同输出）

- [x] RED → Implement → GREEN → revert proof。（20 passed 全本机、无 skipif——零外部依赖纯函数；等分兜底避免末尾碎片；覆盖/升序/无缝/≤max_shot/确定性五条不变量钉死；初始 RED 因与写实现并行发命令被抢跑，revert proof 已补回干净 RED 证据）
- [x] Commit: `feat(rag): scene segmentation pure functions with max-shot fallback`（`ca2ffabe`）

## Task 5: 关键帧 + OCR 适配层（spec §2/§8）

**Files:**
- Create: `backend/packages/harness/deerflow/knowledge/video/frames.py`（ffmpeg 抽中帧 → JPEG q80 ≤1280px 落 KB 存储目录 `frames/<doc_id>/shot_%04d.jpg`；caption 临时 3 帧不持久化；单镜头失败返回 None 不阻断）
- Create: `backend/packages/harness/deerflow/knowledge/video/ocr.py`（PaddleOCR 屏幕文字；失败空串）
- Test: `test_frames.py`（合成视频抽帧尺寸/质量预算/缺帧 None）+ `test_ocr.py`（fake OCR）

- [x] RED → Implement → GREEN → revert proof。（18 passed + 1 skipped；本机无 ffmpeg/PaddleOCR，纯逻辑用 fake runner + fake engine 全覆盖，真实抽帧端到端 skipif；帧路径精化为 `doc_dir/frames/shot_%04d.jpg`——doc_dir 已 per-doc 含 doc_id，对齐现有 images/ 布局、删除文档 _remove_dir 自动级联删帧，不再嵌套 `<doc_id>/`；单镜头失败 None 不阻断、OCR 每帧降级空串、caption 帧走 stdout pipe 不持久化；RED 独立成轮收集，未重蹈 Task 4 并行竞态）
- [x] Commit: `feat(rag): keyframe extraction and screen-text OCR legs`（`c174be79`）

## Task 6: 镜头卡 captioner 与卡文本组装（spec §3/§6）

**Files:**
- Create: `backend/packages/harness/deerflow/knowledge/video/captioner.py`（DashScope VLM，prompt 双模式对齐 `captioner.py` 先例；降级非硬依赖；>30% 失败率返回 degraded 标记）
- Create: `backend/packages/harness/deerflow/knowledge/video/shot_card.py`（**冻结卡正文模板**组装纯函数（**不含时间码头**，spec §3 嵌入文本契约）+ 展示合成纯函数 `render_card_display(body, shot)`（带头全卡单一源）+ 三模式 `card_text_mode` + 时间码 `HH:MM:SS.mmm` 格式化/解析往返 + `chunk_id_for_shot`）
- Test: `test_shot_card.py`（正文模板逐字钉死、展示合成往返、三模式、时间码往返、全空镜头判 empty）+ `test_captioner.py`（fake VLM + 30% 降级阈值）

- [x] RED → Implement → GREEN → revert proof。（29 passed 全本机、无 skipif——shot_card 纯函数逐字钉死冻结模板（场景/口述/屏幕文字，caption 空补（无）保三行稳定）+ 时间码往返×9 + 三模式消融 + empty 判定 + render 展示合成；captioner 用 httpx.MockTransport（对齐 test_parser 先例）+ monkeypatch DASHSCOPE_API_KEY，钉死 api_key 缺失全降级、单镜头失败计数、>30% degraded（30% 边界严格大于不触发）、无帧镜头不计 failed；base_url 读 cfg.rag.vlm_base_url（config 单一源，避开现有 captioner 未读该键的缺口）；RED 独立成轮收集）
- [x] Commit: `feat(rag): shot card assembler and VLM captioner with degradation gate`（`94bc2ffa`）

## Task 7: worker 腿接线 + resume + path_status（spec §2）

**Files:**
- Modify: `backend/packages/harness/deerflow/knowledge/worker.py`（视频分支腿序 probe→asr→segment→keyframe+ocr→caption→materialize；path_status 扩腿；progress 腿权重 asr30/segment5/caption35/materialize5；`_require_alive` 检查点；resume 只跑 pending 镜头；materialize 写 video_shots+chunks 后**落入现有 vector/graph/wiki 腿**零改动）
- Modify: `backend/packages/harness/deerflow/knowledge/store.py`（文档删除级联删 video_shots + 帧目录，对齐 `_remove_dir`）
- Test: `backend/tests/knowledge/video/test_worker_pipeline.py`（fake 全腿：2 镜头 fixture → legs/path_status/degraded 矩阵/resume 重入只跑 pending/删除级联）

- [ ] RED → Implement → GREEN → revert proof（摘 materialize → RED）。
- [ ] Commit: `feat(rag): wire video legs into the indexing worker with resume and degradation`

## Task 8: 引用时间码 + frame 端点（spec §4）

**Files:**
- Modify: `backend/app/gateway/services/knowledge_service.py`（引用 payload join video_shots：media/shot_index/start_ms/end_ms/frame_url，仅视频文档；文本引用字段不动）
- Modify: `backend/app/gateway/routers/knowledge_bases.py`（`GET /{kb_id}/documents/{doc_id}/shots/{shot_index}/frame` 流式 JPEG，鉴权对齐文档读取，无帧 404；文档列表 payload 带 duration_ms/镜头数仅视频文档）
- Test: `backend/tests/knowledge/test_video_citations_api.py`（payload 字段/404/鉴权/列表时长）

- [ ] RED → Implement → GREEN → revert proof。
- [ ] Commit: `feat(rag): timecode citations and keyframe serving endpoint`

## Task 8b: recaption 运维重跑入口（spec §2 运维重跑入口，评审 G1）

**Files:**
- Modify: `backend/app/gateway/routers/knowledge_bases.py`（`POST /{kb_id}/documents/{doc_id}/video/recaption` 202；在飞 409；非视频文档 404）
- Modify: `backend/app/gateway/services/knowledge_service.py`（`trigger_recaption`：重置 caption_status（done/failed→pending，empty 保持）+ 入队子集腿运行）
- Modify: `backend/packages/harness/deerflow/knowledge/worker.py`（子集腿模式：只跑 caption+materialize+增量重嵌向量+`mark_dirty_for_entities`；帧/ASR/segment 腿跳过，帧已持久化）
- Test: `backend/tests/knowledge/video/test_recaption.py`（重置矩阵 done→pending / empty 保持 / 在飞 409 / 非视频 404 / wiki dirty 传播 / 仅变更 chunk 重嵌）

- [ ] RED → Implement → GREEN → revert proof（摘重置逻辑 → 重跑不生效 RED）。
- [ ] Commit: `feat(rag): recaption endpoint for caption model upgrades`

## Task 9: 前端文档列表与上传面（spec §5）

**Files:**
- Modify: `frontend/src/components/workspace/knowledge/document-panel.tsx`（视频行胶片图标 + 时长 + 「N 镜头」；path_status hover 增 asr/segment/caption 芯片，degraded 琥珀色）
- Modify: `frontend/src/core/knowledge/{types,api,hooks}.ts`（payload 新字段类型）
- Modify: i18n 三文件（videoDuration/shotCount/legs.* 键）
- Test: `frontend/tests/unit/knowledge/document-panel.dom.test.tsx`（视频徽章/三芯片/degraded 色）

- [ ] RED → Implement → GREEN（`pnpm check` 双净）→ revert proof。
- [ ] Commit: `feat(frontend): video document badges and video leg status chips`

## Task 10: 切片抽屉时间码芯片 + 缩略图（spec §5）

**Files:**
- Modify: `frontend/src/components/workspace/knowledge/chunk-drawer.tsx`（视频 chunk：mono 时间码芯片 `#K · 00:01:12–00:01:40` + lazy 关键帧缩略图（404 降级图标）+「复制时间码」按钮走 kb-toast 中栏作用域；正文原样展示——`chunks.text` 即正文无重复头，spec §3 嵌入文本契约；**芯片/缩略图点击语义 = seek 播放，见 Task 10b**）
- Modify: i18n 三文件（timecodeChip/copyTimecode/frameMissing）
- Test: `frontend/tests/unit/knowledge/chunk-drawer.dom.test.tsx`（芯片文案/缩略图 404 降级/复制按钮 toast 带 toasterId 断言）

- [ ] RED → Implement → GREEN → revert proof。
- [ ] Commit: `feat(frontend): timecode chip and keyframe thumbnail in chunk drawer`

## Task 10b: 视频流端点 + 抽屉内嵌播放器（spec §4/§5，2026-09-09 评审提级）

**Files:**
- Create: `backend/packages/harness/deerflow/knowledge/video/streaming.py`（range 解析纯函数 `parse_range_header(header, size)` → (start, end) / 416 标记 + Content-Range 组装）
- Modify: `backend/app/gateway/routers/knowledge_bases.py`（`GET /{kb_id}/documents/{doc_id}/video/stream`：Range 206/416、鉴权对齐文档读取、Content-Type 按后缀映射；优先 Starlette `FileResponse` 原生 Range，不支持则手写 partial handler 异步读）
- Test: `backend/tests/knowledge/test_video_stream_api.py`（200 全量 / 206 部分 Content-Range 正确 / 416 越界 / 404 非视频 / 未授权）+ range 纯函数单测
- Modify: `frontend/src/components/workspace/knowledge/chunk-drawer.tsx`（抽屉顶部单例 `<video>`：原生 controls、`preload="metadata"`、不自动播放；芯片/缩略图点击 → seek(start_ms/1000)+play；引用闪环定位 → 载到 start_ms 保持暂停；timeupdate 节流 → 活动行边框高亮不抢滚动；窄抽屉宽随抽屉 16:9 限高）
- Modify: `frontend/src/core/knowledge/{api,types}.ts`（stream URL builder）
- Modify: i18n 三文件（playerHint）
- Test: `frontend/tests/unit/knowledge/chunk-drawer.dom.test.tsx`（HTMLMediaElement spy：点芯片 → currentTime 被设 + play() 被调；派发 timeupdate → 活动行高亮；引用定位 → 暂停加载）

- [ ] RED → Implement → GREEN → revert proof（摘 seek 接线 → 点芯片不播 RED）。
- [ ] Commit: `feat(rag): inline video player with range streaming for shot cards`

## Task 11: 评测接入与造题指引（spec §6）

**Files:**
- Create: `backend/docs/video-kb-question-authoring.md`（口述型/屏幕文字型/视觉描述型三类造题规范各 ≥1 例）
- Modify: `backend/tests/knowledge/eval/`（镜头卡作为 chunk 进 L1 检索的最小集成用例：fake 视频 KB → recall@k 有数）
- 消融开关 `card_text_mode` 在 Task 6 已落，此处补 recall-test 对比脚本说明进造题指引

- [ ] RED → Implement → GREEN。
- [ ] Commit: `docs(rag): video KB question authoring guide and eval integration test`

## Task 12: 收官——全量回归 + 浏览器实测 + 指南落档

- [ ] 后端 `pytest tests/knowledge -q` 全量 GREEN + ruff 双净；前端 check 双净 +
      knowledge 套件对基线（仅预存无关失败）。
- [ ] 浏览器实测：真实 2–5min 视频上传 → 腿进度 → 对话命中 → 引用时间码芯片 +
      缩略图 + **点芯片即播/区间高亮/引用定位暂停加载** → 检索测试命中镜头卡 →
      评测跑一轮视频 KB；截图落 `pr-build/`。
- [ ] Modify: `backend/AGENTS.md`（knowledge 小节补视频腿与 video_shots 契约）；
      `frontend/AGENTS.md` 无需改（表面层改动已在组件注释自载）。
- [ ] Commit: `docs(rag): sync agent guides for video ingest and smoke evidence`

## 风险登记（实施期新增即补此行下表）

| 风险 | 触发任务 | 缓解 |
|---|---|---|
| FunASR 依赖体积/安装失败 | T3 | provider 协议隔离；whisper 档兜底；CI 不装重依赖（fake 测试） |
| PySceneDetect 在沙箱阻塞事件循环 | T4/T7 | 腿内 `run_file_io` 线程池包裹（blocking-io-guard 技能先例） |
| 帧目录删除遗漏 | T7 | 级联删单测钉死 + 实测删文档核对磁盘 |
