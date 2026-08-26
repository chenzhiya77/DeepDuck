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
      actions: string;
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
      layer2Note: string;
      regressionBadge: string;
      ragasMissingBadge: string;
      ragasErrorBadge: string;
      citationPrecision: string;
      citationRecall: string;
      seedHitRate: string;
      noGraphQuestions: string;
      emptyLayer1: string;
      emptyLayer2: string;
      viewTrace: string;
      tableCategory: string;
      tableHitRate: string;
      tableRecallAtK: string;
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
      noQuestionsInBatch: string;
      /** 评测 tab（plan Task 4）：运行配置区说明文案（§9 触发按钮落地前占位）。 */
      runConfigNote: string;
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
      /** 文档搜索框（聚焦交互）：按文档名过滤并锁定切片聚焦。 */
      searchDocs: string;
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
      overlayLayers: (seeds: number, expanded: number, evidence: number) => string;
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
