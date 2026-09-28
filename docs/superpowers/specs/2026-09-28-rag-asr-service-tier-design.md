# 视频 ASR 的「服务档」（HTTP）—— 设计草案（**暂停中，未立项**）

**Status:** 🟡 **草案（2026-09-28 立；2026-09-29 追加 §2 三行留档）**——**未立项、未开工**。2026-09-28 他明说「先不做这些，先把当前的问题解决」⇒ 本线按令暂停，**别当下一步主动推**。
**来源**：侧聊产出；与 [2026-09-28-video-asr-output-shape-design.md](2026-09-28-video-asr-output-shape-design.md)（本地档：只补 VAD、放弃分段）是同一架构的**两条来源面**——本文记"服务来源"，那份记"本地来源"。

## 1. 设想（**按协议分档，不按引擎分**）

- **一档 `openai-audio`**：一个"转写服务" = **协议 + 地址 + 钥匙**（模型名复用 `asr_model`，填服务侧的名字），指向任何说 OpenAI audio 协议的服务——远端云或**本机服务**都算。
- **返回形状三条硬要求**：① **段级起止时间**（硬卡点——镜头卡按时间投影，没有它就没法落卡）② 需要 `verbose_json`（OpenAI 协议里 `segments` 只挂在它下面）③ 空/单段要能被识别成"没答案"。
- **探针**：内置短 wav + 四态；**只有 `no_timestamps` 拦保存**（其余三态只报告、不阻塞——同探测族"只报不拦"的原则）。
- **已实测（2026-09-28，用他的 key）**：`qwen-audio-3.1-asr-flash` ⇒ 200、**毫秒级段级 + 词级**时间戳；`speaker_diarization_enabled: true` 才返回 `sentences[]`（24 s 音频 → 3 段）；filetrans 那一档要公网 URL（已划掉）；10 MB base64 ≈ 4–5 分钟；成本外推 **¥0.06/小时**（filetrans ¥0.79）；**协议非 OpenAI 兼容 ⇒ 属第二档**。

## 2. 追加三行（2026-09-29）

1. **加"B 本机形态"**：同一档协议也覆盖**本机服务**——funasr 自带 `funasr-server`（**OpenAI 兼容** `POST /v1/audio/transcriptions`，另有 REST `/asr`；`--device cpu/cuda0 --port 8000`，模型用**服务侧短名**：`paraformer` / `sensevoice` / `fun-asr-nano` / `moss-transcribe-diarize`）⇒ 地址填 `127.0.0.1:8000` 即可。**收益**：GPU/vLLM 依赖关在服务进程里，我们只发 HTTP；"我们进程里跑不动的模型"（LLM 型那三个）由此可用。**若立项，B 应是第一个用例**（不需要外网凭据就能验通）。
2. **把"合成段"写进硬要求**：`funasr-server` 在 `verbose_json` 路径下，若后端只给文本，会**自己造段**——`build_openai_fallback_segments()` 把文本每 80 字切一块、**时间按字符数等比摊开**（`funasr/bin/_server_app.py:94-116`，用在 `:446`）⇒ **"返回里有 segments" ≠ "真时间戳"**，且这种错法在卡片上更难发现（看着正常）。**探针必须能识破它。**
3. **探针要基线对照**：同一段音频先在**本地 A 形态**（进程内、真时间戳）跑一份基线，再比 B/C 的段边界；判据 = 段边界是否与真实语音吻合（**等分特征**：与字符数严格成比例）。

## 3. 相关实测（2026-09-29，属本地档的候选，记此备查）

`OpenMOSS-Team/MOSS-Transcribe-Diarize`（**1.83 GB**、走 `hf-mirror`、需 `trust_remote_code`；缓存落 `E:\app-model\hf-cache\hub`）：**能给出段级结果**——键 `['key','raw_text','sentence_info','text','timestamp']`，`sentence_info` = `{start:1030, end:4470, text:"…。", spk:"S01", timestamp:[[1030,4470]]}`（`sentence` 键为 `null`，键名是 `sentence_info`）。代价：**CPU 上加载 628 s、4.52 s 音频推理 66 s（RTF ≈ 14.6）** ⇒ 每个视频都跑不现实；它的价值在"证明进程内形态也能拿段"，以及给"要不要 GPU / 服务档"提供一个量级参照。
