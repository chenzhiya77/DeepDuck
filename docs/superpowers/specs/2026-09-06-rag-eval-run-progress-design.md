# RAG 评测运行进度设计(轮询自锁修复 + 工具栏进度)

- 日期:2026-09-06
- 状态:定稿(表面选择:仅工具栏);**2026-09-06 修订**——验收缺口修复推翻 §2 修复手法与 §4 按钮文案,见各处「修订(2026-09-06)」标注;plan 尾注「验收缺口修复」记录根因与回归。
- 关联:plan `docs/superpowers/plans/2026-09-06-rag-eval-run-progress.md`

## 1. 背景:两个问题

1. **Bug(用户实测)**:点击运行评测后,总览/题库视图起初无运行态;切到历史视图再切回才出现。
2. **可见性缺口**:完整评测 20–40 分钟,运行期间 UI 仅有 in_flight 布尔,零中间进度。

## 2. Bug 根因与修复定案

根因三连环:
1. 轮询开关 = 缓存数据里的 `in_flight`(`evalRunsRefetchInterval`),挂载首查 false → 不轮询;
2. POST 触发按设计不 invalidate("避免与首次轮询双请求")——但首次轮询前提永不成立 → 死锁;
3. 历史视图自带第二个 `useEvalRuns` observer,挂载 refetch(staleTime=0)打破死锁 → 全域复活。

修复定案:trigger onSuccess 且 `status==="enqueued"` 时**乐观置位**
`setQueryData(knowledgeEvalRunsKey(kbId), old => old && {...old, in_flight: true})`;
无缓存数据时退化为 invalidate。轮询立即启动、三视图同步亮运行态;零额外请求;
drain 边 invalidate 与"POST 不 invalidate"其余语义保留。

**修订(2026-09-06)**:上述"无缓存退化 invalidate"是残留缺陷——空缓存时该即时 refetch
撞后端竞态(`trigger_eval_run` 用 `asyncio.create_task` 延迟启动 runner,`_IN_FLIGHT` 在
runner 内 `await load_questions` 之后才 +1,见 `ondemand.py`),refetch 命中窗口拿回
`in_flight=false` → 按钮不亮、`refetchInterval` 不启动 → 仍死锁,非切历史(挂第二个
observer 再 refetch)不复活——即 §1 问题 1 未真正修复。新定案:乐观置位改**无条件**
`setQueryData(key, old => ({runs:[], total:0, progress:null, ...(old ?? {}), in_flight:true}))`,
空缓存则**创建**最小条目而非 invalidate。但实测仍复现(按钮不亮/不推进/跳过 2/3),进一步
定位到**后端根因**:`_IN_FLIGHT` 原在 runner 内 `await load_questions` **之后**才 +1,
create_task 调度到 load 完成之间存在窗口,触发后早期 poll(3s)读到 in_flight=false →
覆盖前端乐观值、杀死轮询(refetchInterval 变 false)。终版修复:**后端**把 `_IN_FLIGHT`
自增前移到 runner 第一行(任何 await 之前,`ondemand.py`),空题库提前 raise 时先
`_release_run`;前端保留无条件乐观置位。窗口关闭后早期 poll 即见 true,乐观值不被
覆盖、轮询存活,按钮立即亮且随 progress 推进 1/3→2/3→3/3。

**触发入口统一纪律(缺口 3 追加)**:所有评测触发入口(头部运行按钮/右键菜单/行⋮菜单/
批量选择)必须委托 eval-tab 的 `handleTrigger`(bank 经必填 `onTrigger` prop 上收),
**禁止子组件自持 trigger mutation**——自持 mutation 的 onSuccess 会绕过乐观置位与
档位记档(pendingFullRun),导致该入口触发后头部按钮不转运行态、非切历史不复活。

## 3. 进度模型(后端,内存级)

- `ondemand._PROGRESS: dict[kb_id, Progress]`,单进程模块级(_IN_FLIGHT 同款模式);
  进程重启时运行任务本身亦丢,进度同丢,语义自洽,**不落库**。
- phase 三段:`layer1`(检索指标,不定长,秒级)→ `questions`(答题与判分,
  **determinate k/N**,耗时主体)→ `ragas`(RAGAS 指标,不定长,分钟级);落库/finally 清除。
- 更新点:`run_full_eval_for_kb` 每题(agent run + 引用 judge 完成)done++;单题失败
  failed++ 且 done 仍计(降级契约:单题不沉全 run);`run_layer1_for_kb` 仅 layer1 段瞬过。
- 透出:`GET /eval-runs` 响应顶层加 `progress`,**复用现有 3s 轮询,零新端点零新轮询**。

契约(冻结):

```json
"progress": {"run_id": "rag-…", "phase": "layer1|questions|ragas",
             "done": 7, "total": 17, "failed": 0,
             "started_at": "ISO8601", "updated_at": "ISO8601"}   // 非 in_flight 时 null
```

## 4. UI 表面(定稿:仅工具栏)

- **按钮文案**:questions 段 = "运行中… 7/17"(tabular-nums);layer1/ragas 段 = "运行中…"
  (不假数字);phase 词与 k/N 进按钮 aria-label(屏幕阅读器与悬浮可读)。
- **工具栏底缘细进度线**:`absolute bottom-0 inset-x-0 h-0.5`;questions 段 determinate
  (done/total 宽);layer1/ragas 段 indeterminate(pulse 动画);非运行态不渲染。
- 总览状态条 / 历史进度卡:**本期不做**(用户定案仅工具栏);趋势卡不加(无部分数据)。

**修订(2026-09-06)**:原按钮文案是"假状态"——layer1 与 ragas 都显裸"运行中…",用户
无法区分(§1 问题 2 观感缺口);phase 词只进 aria-label,肉眼不可见。新定案(用户拍板:
**4 字阶段名 + n/3**,与「运行评测/完整评测」等 4 字按钮对齐):
- **按钮文案**:`检索评测 1/3` → `答题评测 2/3` → `质量评估 3/3`(zh 三段 phase 词统一 4 字)。
  快速档(L1 单阶段)不显计数(只`检索评测`),避免"1/3 却到不了 3/3"的新假状态;完整档
  layer1 显 1/3,questions/ragas 恒显 2/3、3/3(step>1 与档位无关);档位由 `pendingFullRun`
  ref(触发时按 `input.layers==="l1_l2"` 置位)判定。
- **k/N 移出按钮**(破坏 4 字对齐)→ 保留在底缘 determinate 细线填充(视觉)+ progressbar
  `aria-valuenow/max`(读屏)。
- **纯函数**:`phaseStep(progress)`(layer1/null→1、questions→2、ragas→3)+ `EVAL_PHASE_COUNT=3`
  in `eval-run-status.ts`;i18n `runningPhase(phase,step,total)`,退役 `runningButton`/`runningProgress`。
- **底缘细线**:语义不变(questions determinate、layer1/ragas pulse,绝不假百分比)。注:n/3 是
  真实阶段序号,非假百分比,与 §6"ragas 段假百分比"被否方案不冲突。

## 5. 降级与边界

- `progress=null` 且 in_flight(旧进程窗口/竞态)→ 按钮按 layer1 降级(修订后:完整档
  `检索评测 1/3`、快速档`检索评测`)+ 不定长细线 pulse;(原:按钮裸"运行中…");
- `already_running` 触发不改写 progress;error 行落库时 finally 清除;
- L1 快速档:layer1 段秒级闪过 → drain,细线 pulse 一下即消,不扰;
- 选题运行:total = 过滤后题数(与运行口径一致)。

## 6. 被否替代方案

- 总览状态条 / 历史 in-progress 卡(表面扩散,用户本期仅选工具栏);
- 进度落库(重启语义复杂化,与 _IN_FLIGHT 内存模式分裂);
- 新端点 / 新轮询循环(复用 /eval-runs 3s 轮询已足);
- ragas 段假百分比(不定长阶段给确定进度条=撒谎)。

## 7. 实施切分与测试

1. 后端 ondemand:_PROGRESS + 三段更新点 + finally 清除;unit(递增/failed/清除/layer1-only)。
2. 后端 router:/eval-runs 响应 +progress;API test(in-flight mock 带 progress;idle 为 null)。
3. 前端 bug 修复:enqueued 乐观置位;eval-tab dom(触发后**不切视图**三视图运行态立现)。
4. 前端工具栏:按钮 k/N 文案 + aria + 底缘细线(determinate/indeterminate);
   eval-run-status 纯函数(progress 标签/不定长判定)unit;i18n 三处
   (`runningProgress(done,total)` / phase 词)。
5. 回归:knowledge 套件 + pnpm check + ruff。

验收:点击完整评测 → 工具栏立即"运行中…" + pulse 细线(无需切历史);进入答题段变
"运行中… k/N" + 定长细线随 3s 轮询推进;ragas 段回 pulse;落库瞬间按钮复原、细线消失。

**修订(2026-09-06)验收口径**:点击完整评测 → 按钮**立即**`检索评测 1/3` + pulse 细线
(无需切历史,验证无条件乐观置位);答题段 → `答题评测 2/3` + 底缘定长细线按 k/N 推进;
ragas 段 → `质量评估 3/3` + 细线回 pulse;落库瞬间按钮复原`运行评测`、细线消失;快速评测
(L1)→ `检索评测`(无计数)pulse 一下即消。自动化已覆盖(eval-tab 47/47、eval-run-status
10/10、knowledge 877 passed | 1 预存无关失败);仍需用户 UI 复核真实 LLM 链路观感。

## 8. 档位单选重设计(2026-09-06 追加,取代 §4 分体按钮的不对称结构)
- 动机:旧结构主键硬编码 L1、下拉仅完整档,且选中题目会把主按钮动词变脸为
  「快速评测/完整评测」(selection.runSelected/fullRunSelected)——一个动词同时编码
  "档位×范围"两个正交维度,反直觉。
- 新模型:chevron 下拉=**档位互斥单选**(快速评测/完整评测,勾中项尾置 Check,点选只
  勾选不运行);主按钮恒显**勾中档位名**并执行该档(运行态仍优先显阶段名+n/3);档位为
  会话内 state(默认快速档,不持久)。**完整档一律收口确认弹窗**(头部/⋯/题库右键·行⋮),
  弹窗新增范围行(全库/所选 N 题)作为"只跑所选"的唯一提醒器,主按钮不附加范围后缀。
- 退役文案:runButton(运行评测)、fullRun.menuItem、selection.runSelected/
  fullRunSelected;新增 tierQuick/tierFull 与 fullRun.dialogScopeAll/dialogScopeSelected。
  上文"落库复原`运行评测`"的表述由"复原为勾中档位名"取代。
- 连带简化:完整档 n/3 计数改由 tier state 判定(showCounter = tier==="l1_l2" || step>1),
  删除 pendingFullRun 触发瞬间推断。
- 追加工具栏收玫(2026-09-06):造题入口(添加考题/生成考题)从内联按钮收进档位下拉,
  以分割线与档位单选隔离(仅题库视图;窄栏 ⋯ 菜单仍保留);下拉 min-w-0 覆盖 ui 默认
  min-w-[8rem] 贴合内容宽度;弹窗与口径标注去用户不可懂代号(Layer 1 → 检索质量)。
- 回归:eval-tab 50/50、bank 28/28、knowledge 880 passed|1 预存无关、check 双净。

## 9. 进度表面重设计:运行进度容器(2026-09-06 追加,取代底缘细线)
- 动机:底缘细线只表征 questions 段(与旧按钮文案同款"假状态"),且视觉粗糙;用户定案**直接删除**,不修。
- 新表面:**总览视图**检索质量卡上方的进度容器(用户定案仅总览;题库/历史仍由按钮 4 字阶段名
  承载紧凑表面)。仅 in_flight 渲染,drain 后卸载。
- 第一行=**单轨时长加权整体条** + 右侧仅 ETA:轨道内按各段预计时长占比划跨度(短段窄/
  长段宽),phase 边界 1px 刻线,当前段跨度提亮,填充连续。权重=先验(完整档 10/35/55,
  快速档 100)+ 本 run 实测自适应(段完成后用实测时长替换先验并按先验比例重归一剩余段);
  无需历史字段/迁移。整体分数 f = 已完成段权重和 + 当前段权重×(段内 done/total)。
- ETA(主流速率外推共识):`ETA = elapsed×(1−f)/f`;warmup 门控(f>6% 且 elapsed>20s,
  否则"估算中…");取整到分钟防跳变;右侧文案仅 ETA(用户定案)。
- 第二行=**单行实时日志**:后端 progress 新增结构化 `tail` 事件({kind:phase|item|fail,
  phase,done,total,failed}),前端按 i18n 渲染单行 truncate、新事件淡入替换;failed>0 挂
  失败徽标;aria-live=polite。选结构化事件而非后端拼中文,保住 en locale。
- 后端契约增量:progress 增 `phase_started_at`/`phase_durations`/`tail`;ragas_eval 补
  **逐样本** progress_hook(现仅进入时报一次,第三段拿不到真实 k/N)。
- 退役:底缘细线 JSX 与 progressFraction/isIndeterminatePhase 的细线用途;按钮阶段文案保留。
- i18n 增量:etaRemaining/etaEstimating + 日志句模板(logPhase/logItem/logFail);三处同步。
- 测试:eval-run-status 增 f/ETA 纯函数单测;eval-tab 删细线断言、增容器断言(总览运行态);
  后端增 ragas 逐样本 hook 与 tail/durations 单测。
