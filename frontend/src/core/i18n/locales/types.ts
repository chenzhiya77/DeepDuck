import type { LucideIcon } from "lucide-react";

export interface Translations {
  // Locale meta
  locale: {
    localName: string;
  };

  // Common
  common: {
    home: string;
    settings: string;
    delete: string;
    confirmDelete: string;
    edit: string;
    rename: string;
    renameFailed: string;
    share: string;
    openInNewWindow: string;
    close: string;
    more: string;
    search: string;
    loadMore: string;
    download: string;
    thinking: string;
    artifacts: string;
    public: string;
    custom: string;
    notAvailableInDemoMode: string;
    loading: string;
    version: string;
    lastUpdated: string;
    code: string;
    preview: string;
    cancel: string;
    save: string;
    install: string;
    create: string;
    import: string;
    export: string;
    exportAsMarkdown: string;
    exportAsJSON: string;
    exportSuccess: string;
    exportFailed: string;
    importToKnowledgeBase: string;
    noKnowledgeBasesYet: string;
    createKnowledgeBase: string;
    importToKbSuccess: (kbName: string) => string;
    importToKbFailed: string;
    /** Toast action that navigates to the knowledge page after an import. */
    viewKnowledgeBase: string;
    regenerate: string;
    editAndRerun: string;
    updateAndRerun: string;
    editRerunWarning: string;
    branch: string;
    showArtifacts: string;
    browser: string;
    showBrowser: string;
  };

  runDuration: {
    reasoning: string;
    working: string;
    completedIn: (duration: string) => string;
    description: string;
    lessThanSecond: string;
    hours: (value: number) => string;
    minutes: (value: number) => string;
    seconds: (value: number) => string;
    separator: string;
  };

  home: {
    docs: string;
    blog: string;
  };

  // Welcome
  welcome: {
    greeting: string;
    description: string;
    createYourOwnSkill: string;
    createYourOwnSkillDescription: string;
  };

  // Clipboard
  clipboard: {
    copyToClipboard: string;
    copiedToClipboard: string;
    failedToCopyToClipboard: string;
    linkCopied: string;
  };

  artifactEditing: {
    unsaved: string;
    saving: string;
    saved: string;
    exit: string;
    discard: string;
    discardChanges: string;
    conflict: string;
    conflictShort: string;
    runInProgress: string;
    saveFailed: string;
  };

  artifactPreview: {
    limited: (previewSize: string, totalSize?: string) => string;
    loadFullFile: string;
    loadingFullFile: string;
    previewFailed: string;
  };

  // Citations
  citations: {
    sourcesSummary: (count: number) => string;
    citeCount: (count: number) => string;
    copyReference: (title: string) => string;
    copiedReference: (title: string) => string;
  };

  // Workspace Changes
  workspaceChanges: {
    title: string;
    editedTitle: (count: number) => string;
    badge: (count: number, additions: number, deletions: number) => string;
    viewChanges: string;
    created: string;
    modified: string;
    deleted: string;
    openFile: string;
    loading: string;
    noChanges: string;
    diffUnavailable: string;
    binaryUnavailable: string;
    largeUnavailable: string;
    sensitiveUnavailable: string;
    truncatedUnavailable: string;
    symlinkUnavailable: string;
    truncatedSummary: string;
  };

  // Input Box
  inputBox: {
    placeholder: string;
    disclaimer: string;
    createSkillPrompt: string;
    addAttachments: string;
    inputPolish: string;
    inputPolishing: string;
    inputPolishNoChanges: string;
    inputPolishFailed: string;
    inputPolishUndo: string;
    inputPolishCancel: string;
    voiceInputStartLabel: string;
    voiceInputStopLabel: string;
    voiceInputStart: string;
    voiceInputStop: string;
    voiceInputListening: string;
    voiceInputUnsupported: string;
    voiceInputPermissionDenied: string;
    voiceInputMicrophoneUnavailable: string;
    voiceInputUnsupportedLanguage: string;
    voiceInputNetworkError: string;
    voiceInputNoSpeech: string;
    voiceInputFailed: string;
    mode: string;
    flashMode: string;
    flashModeDescription: string;
    reasoningMode: string;
    reasoningModeDescription: string;
    proMode: string;
    proModeDescription: string;
    ultraMode: string;
    ultraModeDescription: string;
    reasoningEffort: string;
    reasoningEffortMinimal: string;
    reasoningEffortMinimalDescription: string;
    reasoningEffortLow: string;
    reasoningEffortLowDescription: string;
    reasoningEffortMedium: string;
    reasoningEffortMediumDescription: string;
    reasoningEffortHigh: string;
    reasoningEffortHighDescription: string;
    searchModels: string;
    surpriseMe: string;
    surpriseMePrompt: string;
    followupLoading: string;
    followupConfirmTitle: string;
    followupConfirmDescription: string;
    followupConfirmAppend: string;
    followupConfirmReplace: string;
    suggestionPlaceholderRequired: string;
    goalCommandDescription: string;
    compactCommandDescription: string;
    goalLabel: string;
    goalContinuing: string;
    goalContinuationTooltip: string;
    goalSet: string;
    goalCleared: string;
    goalNone: string;
    goalActive: string;
    goalFailed: string;
    goalTooLong: string;
    goalLengthCounter: string;
    compactSuccess: string;
    compactSkipped: string;
    compactFailed: string;
    suggestions: {
      suggestion: string;
      prompt: string;
      icon: LucideIcon;
    }[];
    suggestionsCreate: (
      | {
          suggestion: string;
          prompt: string;
          icon: LucideIcon;
        }
      | {
          type: "separator";
        }
    )[];
    pleaseWaitStreaming: string;
  };

  // Sidebar
  sidebar: {
    recentChats: string;
    newChat: string;
    chats: string;
    demoChats: string;
    agents: string;
    scheduledTasks: string;
    agentsDisabledTooltip: string;
    channels: string;
    knowledge: string;
  };

  // Knowledge base (RAG workspace page, spec §5.2)
  knowledge: {
    personalKBs: string;
    createKB: string;
    kbNamePlaceholder: string;
    kbDescriptionPlaceholder: string;
    emptyKbList: string;
    selectKbTitle: string;
    selectKbHint: string;
    collapseKbList: string;
    expandKbList: string;
    uploadDocuments: string;
    uploadingDocuments: string;
    dropToUpload: string;
    /** 拖入的文件全部不在允许名单时，拖放遮罩的拦截提示。 */
    dropUnsupported: string;
    unsupportedFilesSkipped: (names: string) => string;
    duplicateUpload: {
      identicalTitle: string;
      identicalDescription: (name: string) => string;
      conflictTitle: string;
      conflictDescription: (name: string) => string;
      copyNamePreview: (name: string) => string;
      skipUpload: string;
      keepCopy: string;
      keepBoth: string;
      replaceOld: string;
      skippedDuplicate: (name: string) => string;
      uploadedAsCopy: (name: string) => string;
      replacedDocument: (name: string) => string;
    };
    searchDocuments: string;
    /** Unified search box of the wiki tab — filters both the AI entries and the manual cards sections. */
    searchWiki: string;
    clearSearch: string;
    noMatchingDocuments: string;
    selectAllDocuments: string;
    selectDocument: string;
    selectedCount: (count: number) => string;
    deleteSelected: string;
    cancelSelection: string;
    openChunks: string;
    generateQuestion: string;
    generateQuestionBatch: string;
    moreActions: string;
    sortDocuments: string;
    sort: {
      createdAt: string;
      name: string;
      size: string;
      chunks: string;
      asc: string;
      desc: string;
    };
    updateWiki: string;
    rebuildWiki: string;
    /** 百科 tab 内 ⋯ 菜单触发器文案（2026-08-30：与全局库菜单双入口）。 */
    wikiMoreOptions: string;
    rebuildWikiConfirmTitle: string;
    rebuildWikiConfirmDescription: string;
    rebuildWikiConfirmAction: string;
    wikiEnqueued: string;
    /** Wiki 更新状态可见 (2026-08-14): completion toast after a manually triggered run drains. */
    wikiUpdated: string;
    /** P1: trigger while a run is in flight — info toast, no duplicate queue. */
    wikiAlreadyRunning: string;
    /** P1 失败可见性: completion toast when the observed run crashed. */
    wikiUpdateFailed: string;
    settings: string;
    renameKb: string;
    deleteKb: string;
    deleteKbConfirmTitle: string;
    deleteKbConfirmDescription: string;
    statsDocuments: string;
    statsChunks: string;
    statsReady: string;
    statsIndexing: string;
    statsFailed: string;
    table: {
      name: string;
      uploader: string;
      size: string;
      chunks: string;
      status: string;
      createdAt: string;
      // 列显隐与格式切换（2026-09-02）。
      columnMenu: string;
      hideColumn: string;
      columns: string;
      showAllColumns: string;
      timeFormat: string;
      timeFormatAbsolute: string;
      timeFormatRelative: string;
      sizeUnit: string;
      sizeUnitKb: string;
      sizeUnitMb: string;
    };
    status: {
      uploaded: string;
      parsing: string;
      chunking: string;
      indexing: string;
      ready: string;
      failed: string;
    };
    pathStatus: {
      vector: string;
      graph: string;
      wiki: string;
      libraryHint: string;
      state: {
        pending: string;
        indexing: string;
        done: string;
        degraded: string;
        failed: string;
        generating: string;
        ready: string;
      };
    };
    deleteDocument: string;
    deleteDocumentConfirmTitle: string;
    deleteDocumentConfirmDescription: string;
    retryDocument: string;
    uploaderMe: string;
    dropzoneHint: string;
    emptyDocuments: string;
    chunkDrawer: {
      title: string;
      /** 计数单位（zh “个切片” / en “chunks”）。 */
      chunkUnit: string;
      /** sticky 头部的当前切片位置前缀。 */
      current: string;
      prevChunk: string;
      nextChunk: string;
      /** 刻度轨 aria 前缀（“切片 #N” / “Chunk #N”）。 */
      tickAria: string;
      /** 刻度弹窗中尚未加载行的占位文案。 */
      notLoaded: string;
      page: string;
      tokens: string;
      entities: string;
      empty: string;
      loadMore: string;
      loading: string;
      edit: string;
      delete: string;
      save: string;
      cancel: string;
      edited: string;
      viewRendered: string;
      viewRaw: string;
      editHint: string;
      deletePreviewTitle: string;
      orphanedEntities: string;
      affectedEntities: string;
      relationDeletions: string;
      deleteWarning: string;
      confirmDelete: string;
      deleteSuccess: string;
      deleteFailed: string;
      deleteProcessing: string;
      reExtract: string;
      reExtractCost: string;
      reExtracting: string;
      reExtractHint: string;
      /** 切片图片加载失败时的占位前缀（alt 图注紧随其后）。 */
      imageUnavailable: string;
    };
    tabs: {
      documents: string;
      wiki: string;
      recall: string;
      vectors: string;
      /** 知识图谱 tab（2026-08-19 spec）：实体关系力导向图。 */
      graph: string;
      /** 评测 tab（2026-08-24 spec §5，plan Task 4）。 */
      eval: string;
    };
    /** RAG 评测指标总览（spec 2026-08-24 §3.6/§3.7）：Layer 1/2 标题、表格列头、空态提示。*/
    eval: {
      layer1Title: string;
      layer2Title: string;
      /** 区块标题 ⓘ 的纯指标解释（2026-08-27 三轮：不再提内部 Layer 编号；\n 分行的四指标简述）。 */
      layer1Note: string;
      layer2Note: string;
      regressionBadge: string;
      ragasMissingBadge: string;
      ragasErrorBadge: string;
      citationPrecision: string;
      citationRecall: string;
      seedHitRate: string;
      /** RAGAS 卡片中文短标题（单行 nowrap，≤3 字）；全称进 cardNote tooltip。 */
      ragasCard: {
        faithfulness: string;
        answerRelevancy: string;
        contextPrecision: string;
        contextRecall: string;
      };
      /** 每张卡片 ⓘ tooltip 的一句话解释（中文全称 + English 名与量程）。 */
      cardNote: {
        faithfulness: string;
        answerRelevancy: string;
        contextPrecision: string;
        contextRecall: string;
        citationPrecision: string;
        citationRecall: string;
        seedHitRate: string;
      };
      /** Layer 2 内两行卡片的分组小标签（概率性 vs 确定性指标）。 */
      ragasGroupLabel: string;
      archGroupLabel: string;
      noGraphQuestions: string;
      emptyLayer1: string;
      emptyLayer2: string;
      viewTrace: string;
      tableCategory: string;
      tableHitRate: string;
      /** 召回率列名（2026-09-07 函数化）：k 有值显具体值（召回率@5），
          旧运行行无 top_k 回退符号 @k；趋势图例跨 run 仍用 trend.recallAtK 符号名。 */
      tableRecallAtK: (k: number | null) => string;
      tableMrr: string;
      tablePathAccuracy: string;
      /** category 显示名组（2026-08-26 补遗）：wire 键不外露，含汇总行。 */
      category: {
        fact: string;
        relation: string;
        concept: string;
        global: string;
        summary: string;
      };
      /** 二期三视图（spec 2026-08-27 §3，plan Task 4/5）：分段控件标签与 aria。 */
      views: { overview: string; questions: string; history: string };
      viewSwitchLabel: string;
      /** 常驻工具栏（§5）：主动词按钮 + 运行状态短文案（nowrap；长解释进 ⓘ）。 */
      /** 评测档位（2026-09-06 档位单选重设计）：主按钮恒显勾中档位名并执行该档；
       *  下拉为互斥单选（快速/完整）；选中题目不再改变主按钮动词（范围由确认
       *  弹窗承载）。 */
      tierQuick: string;
      tierFull: string;
      /** 运行进度（spec 2026-09-06 run-progress 修订）：按钮阶段文案（4 字阶段名
       *  + n/总段数，与「运行评测/完整评测」等 4 字按钮对齐）+ 三段 phase 词
       *  （按钮 + 进度线 aria）+ failed 后缀。k/N 不再进按钮，改由底缘定长细线
       *  填充 + progressbar aria-valuenow/max 承载。 */
      runningPhase: (phase: string, step: number, total: number) => string;
      phaseLayer1: string;
      phaseQuestions: string;
      phaseRagas: string;
      failedCount: (n: number) => string;
      /** 运行进度容器（spec 2026-09-06 §9）：右侧仅 ETA（warmup 不足时不给假数字），
       *  第二行单行日志由后端结构化 tail 事件驱动、文案在此按 locale 渲染。 */
      etaRemaining: (minutes: number) => string;
      /** 不足一分钟的 ETA 用秒——分钟粒度会说"~1 分钟"而撒谎。 */
      etaRemainingSeconds: (seconds: number) => string;
      etaEstimating: string;
      logPhase: (phase: string) => string;
      logItem: (phase: string, done: number, total: number) => string;
      logFail: (phase: string, done: number, total: number, failed: number) => string;
      logWaiting: string;
      bannerAria: (phase: string, percent: number) => string;
      /** 常驻状态槽（spec 2026-09-06 §10）：空闲态单行摘要（不放题数，检索质量卡
       *  已有 n=K）；时长结构件（durationParts）→ dur* 键文案。 */
      slotSummary: (tier: string, duration: string | null) => string;
      slotSummaryFailed: string;
      /** cancelled 行专属摘要文案（区别 failed，spec 2026-09-06 §11）。 */
      slotSummaryCancelled: string;
      slotViewHistory: string;
      durSeconds: (seconds: number) => string;
      durMinutes: (minutes: number) => string;
      durMinutesSeconds: (minutes: number, seconds: number) => string;
      neverRan: string;
      runStartedToast: string;
      alreadyRunningToast: string;
      runFailedToast: string;
      /** 终止评测（spec 2026-09-06 §11）：工具栏次槽两步 inline 确认 + toast。 */
      cancelRun: string;
      cancelConfirm: string;
      cancelToast: string;
      cancelFailedToast: string;
      /** 完整评测分档（2026-09-01 B 方案）：箭头菜单项 + 成本确认对话框。 */
      fullRun: {
        menuAria: string;
        dialogTitle: string;
        dialogBody: string;
        /** 范围提醒（2026-09-06）：确认弹窗标明本次完整档跑全库还是所选 N 题。 */
        dialogScopeAll: string;
        dialogScopeSelected: (count: number) => string;
        confirm: string;
        cancel: string;
      };
      /** 题库选题批量运行（2026-09-01 B 方案）：复选框列 + 批量栏。 */
      selection: {
        selectAllAria: string;
        rowSelectAria: (query: string) => string;
        selected: (count: number) => string;
        clear: string;
      };
      /** 题库视图（§4.3）：列头、参考文档摘要、行操作、空态与两个弹窗。 */
      questions: {
        columnQuery: string;
        columnCategory: string;
        /** 参考文档列（2026-09-07 表头重设计）：去重文档计数；空单元格 = 无锚定。 */
        columnRefDocs: string;
        refDocsCount: (count: number) => string;
        /** 召回率@k 列头 tooltip：时间口径（跨 run 合并的逐题最近结果）。 */
        columnRecallNote: string;
        /** 排序菜单首项（2026-09-07）：保持 golden.jsonl 原序，不参与排序。 */
        sortDefault: string;
        /** 召回列单元格 tooltip：召回百分比 + 实际路径（未命中时即分诊线索）。 */
        recallTip: (percent: string, path: string) => string;
        /** 召回列空值 aria（未测 / 上次 run 未包含）。 */
        recallUntested: string;
        unanchored: string;
        addQuestion: string;
        emptyBank: string;
        /** 空态双入口第二句（2026-08-28 spec §7，Task 8）：合成造题引导。 */
        emptyBankSynthesis: string;
        /** 题库搜索（2026-08-30：框在 eval-tab 常驻工具栏，纯前端过滤）。 */
        searchPlaceholder: string;
        searchClear: string;
        noMatch: string;
        rowReproduce: string;
        rowDelete: string;
        saveFailed: string;
        deleteFailed: string;
        addDialog: {
          title: string;
          queryLabel: string;
          categoryLabel: string;
          expectedPathLabel: string;
          referenceAnswerLabel: string;
          unanchoredNote: string;
          submit: string;
          cancel: string;
        };
        deleteConfirm: {
          title: string;
          description: string;
          confirm: string;
          cancel: string;
        };
        /** 详情 drawer 标题（§4.5）。 */
        drawerTitle: string;
        noReferenceAnswer: string;
        /** 详情抽屉参考答案卡 caption（2026-09-08 裸奔退役：去添加 dialog 的「（可选）」尾缀）。 */
        answerSection: string;
        /** 详情抽屉实体卡 caption（仅有值显卡）。 */
        entitiesSection: string;
        /** 详情抽屉参考文档卡切片计数徽章（下钻层词汇，区别于行级「N 篇」）。 */
        drawerChunksCount: (count: number) => string;
        addedToast: string;
        deletedToast: string;
      };
      /** 合成造题（2026-08-28 spec §6，plan Task 8–11）：触发/状态/审核全链路文案。 */
      synthesize: {
        entryButton: string;
        dialogTitle: string;
        docLabel: string;
        docPlaceholder: string;
        countLabel: string;
        generate: string;
        generating: string;
        reviewTitle: string;
        accept: string;
        reject: string;
        /** 批量采纳（2026-09-08）：逐条 accept，成功单条 toast。 */
        acceptAll: string;
        rejectAll: string;
        /** 元信息行：丢弃数（锚定越界/字段违例）——2026-09-07 起仅作丢弃芯片 tooltip。 */
        metaLine: (dropped: number) => string;
        /** 头部计数徽章（2026-09-07 底部停靠重设计）：带单位消歧义。 */
        reviewCount: (count: number) => string;
        /** 丢弃告警芯片（仅 >0 渲染，琥珀胶囊）；零值不显。 */
        droppedChip: (dropped: number) => string;
        /** 头部 ⓘ tooltip：来源文档标题 + 相对时间（元信息行退役后的 salvage 位）。 */
        reviewMetaTip: (docs: string, time: string) => string;
        empty: string;
        triggerFailed: string;
        acceptFailed: string;
        rejectFailed: string;
        /** 409 提示：文档不存在或无切片。 */
        docNotReady: string;
      };
      /** 历史视图（§6.2）：环境 badge、状态短文案与空态；回退复用 regressionBadge。 */
      history: {
        envLocal: string;
        envCi: string;
        envNightly: string;
        statusCompleted: string;
        statusError: string;
        statusSkipped: string;
        statusCancelled: string;
        emptyHistory: string;
      };
      trendTitle: string;
      /** 粒度按钮组 aria-label（窄面板降档收进 ⋯ 菜单）。 */
      granularityLabel: string;
      granularity: { day: string; week: string; month: string };
      moreOptions: string;
      /** 查询三态（plan Task 5）：加载中 / 加载失败。 */
      loading: string;
      loadFailed: string;
      /** 趋势图空态（has_data=false / trend 无数据）。 */
      emptyTrend: string;
      /** 趋势图 canvas 文案包（经 props 注入，canvas 不调 useI18n）。 */
      trend: {
        recallAtK: string;
        hitRate: string;
        mrr: string;
        faithfulness: string;
        answerRelevancy: string;
        contextPrecision: string;
        thresholdLine: string;
        thresholdLabel: (percent: number) => string;
        baselineUpdate: string;
        clickForDetail: string;
        regressionPrefix: string;
        /** picker 下拉触发器文案（趋势卡头，与粒度段控同档）。 */
        pickerTrigger: string;
        /** picker 触发器 aria-label。 */
        pickerAria: string;
        /** picker 中 L2 稀疏指标项尾注：仅完整档产出。 */
        fullTierOnly: string;
        /** tooltip 哑行：所选 picker 指标在该档未跑（null）。 */
        notRunInTier: string;
      };
      /** 单次运行详情 drawer（plan Task 6）：元信息 + 两层指标只读摘要。 */
      drawer: {
        title: string;
        runIdLabel: string;
        createdAtLabel: string;
        environmentLabel: string;
        statusLabel: string;
        statusCompleted: string;
        statusError: string;
        statusSkipped: string;
        statusCancelled: string;
        baselineBadge: string;
        layer1Section: string;
        layer2Section: string;
        contextRecallLabel: string;
        pathAccuracyLabel: string;
        pathAccuracyNote: string;
        notRun: string;
      };
    };
    /** 向量空间 tab（2026-08-15 spec §8）：工具栏 + 三态 + 索引中提示。 */
    vectorSpace: {
      loading: string;
      empty: string;
      loadFailed: string;
      indexingHint: (count: number) => string;
      chips: { chunks: string; entities: string; wiki: string; cards: string };
      algoLabel: string;
      recompute: string;
      /** 窄栏降级（2026-08-17）：⋯ 菜单收纳 2D/3D 与算法切换。 */
      moreOptions: string;
      /** ⋯ 菜单内维度分组标签。 */
      dimsLabel: string;
      /** 采样徽标（Task 7）：已抽样 shown/total 点。 */
      sampledBadge: (shown: number, total: number) => string;
      /** 全量搜索框（2026-09-05 泛化）：四类点 label 子串匹配 → 命中聚焦。 */
      searchAll: string;
      /** 搜索范围下拉（客户端过滤，不重拉投影）。 */
      searchScopeLabel: string;
      searchScopes: {
        all: string;
        chunks: string;
        entities: string;
        wiki: string;
        cards: string;
      };
      /** P6（spec §9）：「跟随对话」开关 + 联动禁用/失效提示。 */
      followChat: string;
      overlayPcaOnly: string;
      overlayStale: string;
      /** query 投影请求失败（409 缓存键错位 / embedder 故障）的统一提示。 */
      overlayFailed: string;
      /** 叠加徽标（2026-08-19 UX 迭代）：命中 m/n（n=上报命中数，m=在当前投影中可见数）。 */
      overlayHits: (matched: number, total: number) => string;
      /** 清除当前叠加层（徽标 × 按钮）。 */
      clearOverlay: string;
    };
    /** 知识图谱 tab（2026-08-19 spec §5）：三态 + 统计 + 实体钻取抽屉。 */
    graphSpace: {
      loading: string;
      loadFailed: string;
      empty: string;
      /** 状态栏统计：n 实体 · m 关系 · k 社区。 */
      stats: (nodes: number, edges: number, communities: number) => string;
      /** 实体抽屉：提及 n 次（= 关联切片数）。 */
      mentions: (count: number) => string;
      /** 实体抽屉的关联切片分组标题。 */
      relatedChunks: string;
      /** 实体抽屉（2026-09-05 身份卡/分组化）：描述分组头、社区胶囊、两类
          空态占位。行内位次复用 recallTest.slicePosition（单一词汇源）。 */
      entityDescription: string;
      entityCommunity: (community: number) => string;
      entityNoDescription: string;
      entityNoChunks: string;
      /** 切片所属文档已删除（chunk_id 里的 doc_id 不在当前文档列表）。 */
      unknownDoc: string;
      /** P3 搜索框：实体名模糊匹配（spec §6）。 */
      searchEntities: string;
      /** 搜索无命中提示（toast）。 */
      searchNoMatch: string;
      /** 着色切换 ToggleGroup。 */
      colorByType: string;
      colorByCommunity: string;
      /** 局部图模式面包屑：返回全局图。 */
      backToGlobal: string;
      /** 局部图面包屑焦点节点名展示。 */
      neighborhoodOf: (name: string) => string;
      /** LOD guide 层引导提示（实体超 2000 硬上限时显示）。 */
      guideHint: string;
      /** 跳数切换（1 跳 / 2 跳邻居）。 */
      hop1: string;
      hop2: string;
      /** P4 路径高亮（spec §7）：「跟随对话」开关（与向量空间共享语义）。 */
      followChat: string;
      /** 叠加徽标：种子/扩展/证据三层计数。 */
      overlayLayers: (
        seeds: number,
        expanded: number,
        evidence: number,
      ) => string;
      /** 图数据指纹漂移后叠加被清除的提示。 */
      overlayStale: string;
      /** 清除当前路径高亮（徽标 × 按钮）。 */
      clearOverlay: string;
    };
    wikiPanel: {
      empty: string;
      loading: string;
      dirty: string;
      updating: string;
      updatingHint: string;
      updatedAt: string;
      /** Collapsible section header title (wiki tab split-section layout). */
      sectionTitle: string;
      selectEntry: string;
      openEntry: string;
      editEntry: string;
      /** 局部更新（2026-09-02）：右键单条重生成 / 多选批量重生成。 */
      updateEntry: string;
      updateSelected: string;
      noMatches: string;
      deleteBatchTitle: (count: number) => string;
      deleteEntry: string;
      deleteConfirmTitle: string;
      deleteConfirmDescription: string;
    };
    /** Phase-3 Batch-1 P1: dual-mode wiki entry editor (main content + supplement layer). */
    wikiEdit: {
      title: string;
      description: string;
      mainContentLabel: string;
      mainContentPlaceholder: string;
      mainContentHint: string;
      supplementLabel: string;
      supplementPlaceholder: string;
      supplementHint: string;
      auditLastEdited: string;
      save: string;
      saving: string;
    };
    wikiDrawer: {
      openInTab: string;
      loading: string;
      notFound: string;
      /** 源切片计数单位（元信息行）。 */
      sourceChunks: string;
      /** 已删除源切片计数单位（血缘展开的数量差提示）。 */
      deletedSources: string;
    };
    /** Phase-3 Batch-1 P6: manual knowledge cards (spec §8). */
    manualCards: {
      sectionTitle: string;
      newCard: string;
      empty: string;
      loading: string;
      includeInSearch: string;
      includeHint: string;
      editCard: string;
      deleteCard: string;
      deleteConfirmTitle: string;
      deleteConfirmDescription: string;
      editorCreateTitle: string;
      editorEditTitle: string;
      editorDescription: string;
      titleLabel: string;
      titlePlaceholder: string;
      contentLabel: string;
      contentPlaceholder: string;
      tagsLabel: string;
      tagsPlaceholder: string;
      save: string;
      saving: string;
      createSuccess: string;
      updateSuccess: string;
      deleteSuccess: string;
      saveFailed: string;
      deleteFailed: string;
      updatedAt: string;
      selectCard: string;
      openCard: string;
      noMatches: string;
      /** Context-menu toggle labels for the include-in-search switch. */
      includeOn: string;
      includeOff: string;
      deleteBatchTitle: (count: number) => string;
      /** Card detail drawer (fix: recall-test card hits open this, not the wiki drawer). */
      drawerNotFound: string;
      /** User-defined card drawers (2026-09-04): partition groups inside 我的条目. */
      drawers: {
        new: string;
        edit: string;
        nameLabel: string;
        namePlaceholder: string;
        iconLabel: string;
        colorLabel: string;
        create: string;
        save: string;
        delete: string;
        close: string;
        allDrawers: string;
        moveTo: string;
        unfiled: string;
        newFromMenu: string;
      };
    };
    recallTest: {
      queryPlaceholder: string;
      run: string;
      running: string;
      costHint: string;
      topK: string;
      vectorPath: string;
      graphPath: string;
      wikiPath: string;
      entities: string;
      relations: string;
      evidence: string;
      empty: string;
      failed: string;
      /** P6 检索联动（spec §9 通道一）：结果区一键跳转向量空间叠加。 */
      viewInVectorSpace: string;
      /** 百科行人工卡片勾选语义提示（2026-09-05：仅记录预期路径，不产生锚定）。 */
      wikiAnchorTooltip: string;
      /** 切片文档内序号悬浮气泡（2026-09-05）：「切片 #K」与切片总览抽屉徽章同词汇；行内不挂数字。 */
      slicePosition: (position: number) => string;
      /** 图谱路容器视图切换段控（2026-09-05）：证据行 ↔ 实体/关系。 */
      evidenceView: (count: number) => string;
      entitiesView: (count: number) => string;
      /** 存为考题（2026-08-27 spec §7.1，plan Task 8）：勾选切片一键入题库。 */
      saveAsQuestion: {
        button: string;
        selectedCount: (count: number) => string;
        queryLabel: string;
        categoryLabel: string;
        expectedPathLabel: string;
        /** 多路化后的复数标签（2026-08-28，Task 9 切换；旧单数键过渡期保留）。 */
        expectedPathsLabel: string;
        /** 锚定辅助定位文案：勾选的切片/词条源切片进锚定集。 */
        anchorHint: string;
        referenceAnswerLabel: string;
        submit: string;
        cancel: string;
        savedToast: string;
        saveFailed: string;
      };
    };
    chat: {
      newChat: string;
      history: string;
      noHistory: string;
      deleteChat: string;
      deepResearch: string;
      deepResearchHint: string;
      sources: string;
      sourcesTitle: (count: number) => string;
      chunkSources: (count: number) => string;
      wikiSources: (count: number) => string;
      /** Phase-3 P6 (spec §8): manual cards cited through wiki_search. */
      manualSources: (count: number) => string;
      viewAllSources: string;
      sourceTypeChunk: string;
      sourceTypeWiki: string;
      /** Phase-3 P6: badge for manual knowledge card citations. */
      sourceTypeManual: string;
      sourceMarkAriaLabel: (index: number, name: string) => string;
      expandToFullPage: string;
      /** Tooltip on the expand link while it is disabled because the agents feature is off. */
      expandDisabledAgentsOff: string;
      pageLabel: (page: number) => string;
      inputPlaceholder: string;
      /** Composer model selector: trigger aria-label + dialog title. */
      selectModel: string;
      searchModels: string;
      send: string;
    };
    errors: {
      createFailed: string;
      renameFailed: string;
      deleteFailed: string;
      uploadFailed: string;
      deleteDocumentFailed: string;
      retryFailed: string;
      wikiFailed: string;
      deleteWikiEntryFailed: string;
    };
    /** 错误信息产品化（2026-08-30）：分类器 kind → 本地化友好文案，原始英文不外露。 */
    docErrors: {
      toastTitle: string;
      /** 关闭措辞（2026-08-31）：头部 ✕ = 总关闭，行内 ✕ = 单关闭。 */
      dismissAll: string;
      dismiss: string;
      empty: string;
      unsupported: string;
      retryLimit: string;
      serviceUnconfigured: string;
      timeout: string;
      unknown: string;
    };
  };

  // Scheduled tasks
  scheduledTasks: {
    scheduleType: { cron: string; once: string };
    preset: {
      label: string;
      hourly: string;
      daily: string;
      weekly: string;
      monthly: string;
      custom: string;
    };
    fields: {
      minute: string;
      time: string;
      weekday: string;
      dayOfMonth: string;
      cron: string;
      cronPlaceholder: string;
      runAt: string;
      timezone: string;
    };
    weekdays: {
      mon: string;
      tue: string;
      wed: string;
      thu: string;
      fri: string;
      sat: string;
      sun: string;
    };
    preview: string;
    cronHelp: string;
    create: {
      title: string;
      taskTitle: string;
      prompt: string;
      submit: string;
      fillRequired: string;
    };
    context: {
      fresh: string;
      reuse: string;
      threadIdPlaceholder: string;
    };
    filters: {
      allStatuses: string;
      enabled: string;
      paused: string;
      completed: string;
      failed: string;
      allTypes: string;
      cron: string;
      once: string;
    };
    detail: {
      contextMode: string;
      thread: string;
      lastThread: string;
      schedule: string;
      nextRun: string;
      lastRun: string;
      lastRunId: string;
      lastError: string;
      runsCount: string;
      runsCountOne: string;
      noRuns: string;
      noSelection: string;
      filteredByThread: string;
      loadFailed: string;
    };
    actions: {
      edit: string;
      cancelEdit: string;
      pause: string;
      resume: string;
      trigger: string;
      delete: string;
    };
    deleteConfirm: string;
    errors: {
      create: string;
      update: string;
      pause: string;
      resume: string;
      trigger: string;
      delete: string;
    };
    edit: {
      titlePlaceholder: string;
      promptPlaceholder: string;
      submit: string;
    };
    status: {
      enabled: string;
      paused: string;
      running: string;
      completed: string;
      failed: string;
      cancelled: string;
    };
    runTrigger: { scheduled: string; manual: string };
    runStatus: {
      queued: string;
      running: string;
      success: string;
      failed: string;
      skipped: string;
      interrupted: string;
    };
    recipes: {
      label: string;
      trending: { title: string; desc: string };
      news: { title: string; desc: string };
      issues: { title: string; desc: string };
      weekly: { title: string; desc: string };
    };
  };

  // Agents
  agents: {
    title: string;
    description: string;
    newAgent: string;
    emptyTitle: string;
    emptyDescription: string;
    featureDisabledTitle: string;
    featureDisabledDescription: string;
    chat: string;
    delete: string;
    deleteConfirm: string;
    deleteSuccess: string;
    newChat: string;
    createPageTitle: string;
    createPageSubtitle: string;
    nameStepTitle: string;
    nameStepHint: string;
    nameStepPlaceholder: string;
    nameStepContinue: string;
    nameStepInvalidError: string;
    nameStepAlreadyExistsError: string;
    nameStepNetworkError: string;
    nameStepCheckError: string;
    nameStepCheckErrorWithDetail: string;
    nameStepApiDisabledError: string;
    nameStepBootstrapMessage: string;
    save: string;
    saving: string;
    saveRequested: string;
    saveHint: string;
    saveCommandMessage: string;
    agentCreatedPendingRefresh: string;
    more: string;
    agentCreated: string;
    startChatting: string;
    backToGallery: string;
    settings: string;
    settingsTitle: string;
    settingsDescription: string;
    settingsModel: string;
    settingsModelDefault: string;
    settingsTemperature: string;
    settingsTemperatureHint: string;
    settingsMaxTokens: string;
    settingsMaxTokensPlaceholder: string;
    settingsThinking: string;
    settingsThinkingOn: string;
    settingsThinkingOff: string;
    settingsReasoningEffort: string;
    settingsInherit: string;
    settingsSaved: string;
    settingsInvalidTemperature: string;
    settingsInvalidMaxTokens: string;
  };

  // Breadcrumb
  breadcrumb: {
    workspace: string;
    chats: string;
  };

  // Workspace
  workspace: {
    officialWebsite: string;
    githubTooltip: string;
    settingsAndMore: string;
    visitGithub: string;
    reportIssue: string;
    contactUs: string;
    about: string;
    logout: string;
    gatewayUnavailable: string;
    gatewayUnavailableRetrying: string;
  };

  // Conversation
  conversation: {
    noMessages: string;
    startConversation: string;
    branchCreated: string;
    branchFailed: string;
    streamReplayGap: string;
  };

  // Chats
  chats: {
    searchChats: string;
    loadMoreToSearch: string;
    loadingMore: string;
    loadOlderChats: string;
    pinChat: string;
    unpinChat: string;
    pinChatFailed: string;
  };

  // Sidecar
  sidecar: {
    title: string;
    open: string;
    close: string;
    delete: string;
    deleteConfirm: string;
    deleteSuccess: string;
    deleteFailed: string;
    addToConversation: string;
    askInSideChat: string;
    reference: string;
    selectedTextFragment: string;
    selectedTextFragments: string;
    clearReferences: string;
    emptyTitle: string;
    emptyDescription: string;
    placeholder: string;
    send: string;
    sendFailed: string;
    noContext: string;
    continuing: string;
    selectionCrossesMessages: string;
  };

  // Channels
  channels: {
    title: string;
    connect: string;
    modify: string;
    reconnect: string;
    disconnect: string;
    connected: string;
    notConnected: string;
    pending: string;
    revoked: string;
    disabled: string;
    unconfigured: string;
    unavailable: string;
    unavailableShort: string;
    setupTitle: (name: string) => string;
    setupEditTitle: (name: string) => string;
    setupDescription: string;
    saveAndConnect: string;
    saveChanges: string;
    descriptions: Record<string, string>;
    connectedAs: (name: string) => string;
  };

  // Page titles (document title)
  pages: {
    appName: string;
    chats: string;
    newChat: string;
    untitled: string;
  };

  // Tool calls
  toolCalls: {
    moreSteps: (count: number) => string;
    lessSteps: string;
    executeCommand: string;
    presentFiles: string;
    needYourHelp: string;
    useTool: (toolName: string) => string;
    searchForRelatedInfo: string;
    searchForRelatedImages: string;
    searchFor: (query: string) => string;
    searchForRelatedImagesFor: (query: string) => string;
    searchOnWebFor: (query: string) => string;
    viewWebPage: string;
    listFolder: string;
    readFile: string;
    writeFile: string;
    clickToViewContent: string;
    writeTodos: string;
    skillInstallTooltip: string;
    browserNavigate: (url: string) => string;
    browserNavigateGeneric: string;
    browserClick: string;
    browserType: string;
    browserSnapshot: string;
    browserGetText: string;
    browserBack: string;
    browserScreenshot: string;
    browserClose: string;
  };

  humanInput: {
    answered: string;
    pending: string;
    readOnly: string;
    otherLabel: string;
    otherPlaceholder: string;
    submit: string;
    emptyError: string;
    requiredError: string;
    requiredA11yLabel: string;
    selectPlaceholder: string;
    answeredValue: (value: string) => string;
  };

  // Uploads
  uploads: {
    uploading: string;
    uploadingFiles: string;
    limitsHint: (
      maxFiles: number,
      maxFileSize: string,
      maxTotalSize: string,
    ) => string;
    filesTooLarge: (files: string, maxFileSize: string) => string;
    tooManyFiles: (count: number, maxFiles: number) => string;
    totalSizeTooLarge: (count: number, maxTotalSize: string) => string;
  };

  // Subtasks
  subtasks: {
    subtask: string;
    executing: (count: number) => string;
    in_progress: string;
    completed: string;
    failed: string;
  };

  // Token Usage
  tokenUsage: {
    title: string;
    label: string;
    input: string;
    output: string;
    total: string;
    view: string;
    unavailable: string;
    unavailableShort: string;
    collecting: string;
    note: string;
    presets: {
      off: string;
      summary: string;
      perTurn: string;
      debug: string;
    };
    presetDescriptions: {
      off: string;
      summary: string;
      perTurn: string;
      debug: string;
    };
    finalAnswer: string;
    stepTotal: string;
    sharedAttribution: string;
    subagent: (description: string) => string;
    startTodo: (content: string) => string;
    completeTodo: (content: string) => string;
    updateTodo: (content: string) => string;
    removeTodo: (content: string) => string;
  };

  contextUsage: {
    label: string;
    title: string;
    badgeAriaLabel: (percentage: string) => string;
  };

  // Shortcuts
  shortcuts: {
    searchActions: string;
    noResults: string;
    actions: string;
    keyboardShortcuts: string;
    keyboardShortcutsDescription: string;
    openCommandPalette: string;
    toggleSidebar: string;
  };

  // Settings
  settings: {
    title: string;
    description: string;
    sections: {
      account: string;
      appearance: string;
      channels: string;
      integrations: string;
      memory: string;
      tools: string;
      skills: string;
      notification: string;
      about: string;
    };
    memory: {
      title: string;
      description: string;
      empty: string;
      rawJson: string;
      exportButton: string;
      exportSuccess: string;
      importButton: string;
      importConfirmTitle: string;
      importConfirmDescription: string;
      importFileLabel: string;
      importInvalidFile: string;
      importSuccess: string;
      manualFactSource: string;
      addFact: string;
      addFactTitle: string;
      editFactTitle: string;
      addFactSuccess: string;
      editFactSuccess: string;
      clearAll: string;
      clearAllConfirmTitle: string;
      clearAllConfirmDescription: string;
      clearAllSuccess: string;
      factDeleteConfirmTitle: string;
      factDeleteConfirmDescription: string;
      factDeleteSuccess: string;
      factContentLabel: string;
      factCategoryLabel: string;
      factConfidenceLabel: string;
      factContentPlaceholder: string;
      factCategoryPlaceholder: string;
      factConfidenceHint: string;
      factSave: string;
      factValidationContent: string;
      factValidationConfidence: string;
      noFacts: string;
      summaryReadOnly: string;
      memoryFullyEmpty: string;
      factPreviewLabel: string;
      searchPlaceholder: string;
      filterAll: string;
      filterFacts: string;
      filterSummaries: string;
      noMatches: string;
      markdown: {
        overview: string;
        userContext: string;
        work: string;
        personal: string;
        topOfMind: string;
        historyBackground: string;
        recentMonths: string;
        earlierContext: string;
        longTermBackground: string;
        updatedAt: string;
        facts: string;
        empty: string;
        table: {
          category: string;
          confidence: string;
          confidenceLevel: {
            veryHigh: string;
            high: string;
            normal: string;
            unknown: string;
          };
          content: string;
          source: string;
          createdAt: string;
          view: string;
        };
      };
    };
    appearance: {
      themeTitle: string;
      themeDescription: string;
      system: string;
      light: string;
      dark: string;
      systemDescription: string;
      lightDescription: string;
      darkDescription: string;
      languageTitle: string;
      languageDescription: string;
    };
    tools: {
      title: string;
      description: string;
      adminRequired: string;
      empty: string;
    };
    channels: {
      title: string;
      description: string;
      disabled: string;
    };
    integrations: {
      title: string;
      description: string;
      refresh: string;
      install: string;
      reinstall: string;
      installing: string;
      ready: string;
      pending: string;
      available: string;
      unavailable: string;
      connected: string;
      loadFailed: string;
      adminRequired: string;
      lark: {
        title: string;
        description: string;
        skillPack: string;
        gatewayCli: string;
        auth: string;
        sandboxRuntime: string;
        sandboxRuntimeInitContainer: string;
        sandboxRuntimeBroker: string;
        sandboxRuntimeGatewayDownload: string;
        sandboxRuntimeNotReady: string;
        notInstalled: string;
        skillsInstalled: (installed: number, expected: number) => string;
        installedVersion: (version: string) => string;
        updateAvailable: (version: string) => string;
        runtimeVersionMismatch: string;
        authNotConfigured: string;
        authConfigured: string;
        authConfiguredFor: (user: string) => string;
        connect: string;
        authStarting: string;
        checkingConnection: string;
        connectedAction: string;
        requestPermissions: string;
        alreadyConnected: string;
        connectionStarted: string;
        connectionReady: string;
        authStarted: string;
        authorizationStillPending: string;
        permissionTitle: string;
        permissionDescription: string;
        authDomains: Record<
          | "approval"
          | "apps"
          | "attendance"
          | "base"
          | "calendar"
          | "contact"
          | "docs"
          | "drive"
          | "event"
          | "im"
          | "mail"
          | "markdown"
          | "mindnotes"
          | "minutes"
          | "note"
          | "okr"
          | "sheets"
          | "slides"
          | "task"
          | "vc"
          | "wiki"
          | "all",
          { label: string; description: string }
        >;
        customScopeLabel: string;
        customScopePlaceholder: string;
        customScopeDescription: string;
        openConnectionLinkTitle: string;
        openConnectionLinkDescription: string;
        openAuthLinkTitle: string;
        openAuthLinkDescription: string;
        waitingAuthTitle: string;
        waitingAuthDescription: string;
        openAuthLink: string;
        copyAuthLink: string;
        completeAuth: string;
        continueAuth: string;
        preparingAuthorization: string;
        completingAuth: string;
        authExpiresIn: (seconds: number) => string;
        installingTitle: string;
        installingDescription: string;
        installNextTitle: string;
        installNextDescription: string;
        cliNextTitle: string;
        cliNextDescription: string;
        configuredTitle: string;
        configuredDescription: string;
        connectedTitle: string;
        connectedDescription: string;
        authNextTitle: string;
        authNextDescription: string;
      };
    };
    skills: {
      title: string;
      description: string;
      createSkill: string;
      emptyTitle: string;
      emptyDescription: string;
      emptyButton: string;
      adminRequired: string;
      installAdminRequired: string;
    };
    notification: {
      title: string;
      description: string;
      requestPermission: string;
      deniedHint: string;
      testButton: string;
      testTitle: string;
      testBody: string;
      notSupported: string;
      disableNotification: string;
    };
    account: {
      profileTitle: string;
      email: string;
      role: string;
      changePasswordTitle: string;
      changePasswordDescription: string;
      ssoProvider: string;
      ssoPasswordDescription: string;
      ssoPasswordMessage: string;
      currentPassword: string;
      newPassword: string;
      confirmNewPassword: string;
      passwordMismatch: string;
      passwordTooShort: string;
      passwordChangedSuccess: string;
      networkError: string;
      updating: string;
      updatePassword: string;
      signOut: string;
    };
    acknowledge: {
      emptyTitle: string;
      emptyDescription: string;
    };
  };

  // Login / Auth
  login: {
    signInTitle: string;
    createAccountTitle: string;
    email: string;
    emailPlaceholder: string;
    password: string;
    passwordPlaceholder: string;
    rememberMe: string;
    rememberMeDescription: string;
    pleaseWait: string;
    signIn: string;
    createAccount: string;
    createAdminAccount: string;
    adminSetupRequiredTitle: string;
    adminSetupRequiredDescription: string;
    orContinueWith: string;
    ssoHint: string;
    continueWith: (provider: string) => string;
    noAccountSignUp: string;
    haveAccountSignIn: string;
    backToHome: string;
    networkError: string;
    serviceUnavailableTitle: string;
    serviceUnavailableDescription: string;
    retry: string;
    authFailed: string;
    errors: {
      sso_failed: string;
      sso_cancelled: string;
      sso_account_exists: string;
      sso_not_allowed: string;
    };
  };
}
