import {
  CompassIcon,
  GraduationCapIcon,
  ImageIcon,
  MicroscopeIcon,
  PenLineIcon,
  ShapesIcon,
  SparklesIcon,
  VideoIcon,
} from "lucide-react";

import type { Translations } from "./types";

export const enUS: Translations = {
  // Locale meta
  locale: {
    localName: "English",
  },

  // Common
  common: {
    home: "Home",
    settings: "Settings",
    delete: "Delete",
    confirmDelete: "Confirm delete",
    edit: "Edit",
    rename: "Rename",
    renameFailed: "Failed to rename thread.",
    share: "Share",
    openInNewWindow: "Open in new window",
    close: "Close",
    more: "More",
    search: "Search",
    loadMore: "Load more",
    download: "Download",
    thinking: "Thinking",
    artifacts: "Artifacts",
    public: "Public",
    custom: "Custom",
    notAvailableInDemoMode: "Not available in demo mode",
    loading: "Loading...",
    version: "Version",
    lastUpdated: "Last updated",
    code: "Code",
    preview: "Preview",
    cancel: "Cancel",
    save: "Save",
    install: "Install",
    create: "Create",
    import: "Import",
    export: "Export",
    exportAsMarkdown: "Export as Markdown",
    exportAsJSON: "Export as JSON",
    exportSuccess: "Conversation exported",
    exportFailed: "Failed to export conversation.",
    importToKnowledgeBase: "Import to knowledge base",
    noKnowledgeBasesYet: "No knowledge bases yet",
    createKnowledgeBase: "New knowledge base",
    importToKbSuccess: (kbName: string) =>
      `Imported to "${kbName}" — indexing…`,
    importToKbFailed: "Failed to import to knowledge base.",
    viewKnowledgeBase: "View",
    regenerate: "Regenerate",
    editAndRerun: "Edit and rerun",
    updateAndRerun: "Update and rerun",
    editRerunWarning:
      "Rerunning restores conversation state only. Files, memory, and external actions are not undone.",
    branch: "Branch conversation",
    showArtifacts: "Show artifacts of this conversation",
    browser: "Browser",
    showBrowser: "Open browser panel",
  },

  runDuration: {
    reasoning: "Reasoning",
    working: "Working…",
    completedIn: (duration) => `Completed in ${duration}`,
    description:
      "Total task time, including model reasoning, tool calls, and waiting.",
    lessThanSecond: "<1s",
    hours: (value) => `${value}h`,
    minutes: (value) => `${value}m`,
    seconds: (value) => `${value}s`,
    separator: " ",
  },

  // Home
  home: {
    docs: "Docs",
    blog: "Blog",
  },

  // Welcome
  welcome: {
    greeting: "Hello, again!",
    description:
      "Welcome to 🦌 DeerFlow, an open source super agent. With built-in and custom skills, DeerFlow helps you search on the web, analyze data, and generate artifacts like slides, web pages and do almost anything.",

    createYourOwnSkill: "Create Your Own Skill",
    createYourOwnSkillDescription:
      "Create your own skill to release the power of DeerFlow. With customized skills,\nDeerFlow can help you search on the web, analyze data, and generate\n artifacts like slides, web pages and do almost anything.",
  },

  // Clipboard
  clipboard: {
    copyToClipboard: "Copy to clipboard",
    copiedToClipboard: "Copied to clipboard",
    failedToCopyToClipboard: "Failed to copy to clipboard",
    linkCopied: "Link copied to clipboard",
  },

  artifactEditing: {
    unsaved: "Unsaved",
    saving: "Saving...",
    saved: "Artifact saved",
    exit: "Exit editing",
    discard: "Discard changes",
    discardChanges: "Discard the unsaved changes to this artifact?",
    conflict:
      "This artifact changed after you started editing. Discard your draft and reload before saving.",
    conflictShort: "Changed remotely",
    runInProgress: "Wait for the current agent run to finish before saving.",
    saveFailed: "Failed to save artifact",
  },

  artifactPreview: {
    limited: (previewSize, totalSize) =>
      totalSize
        ? `Showing the first ${previewSize} of ${totalSize}.`
        : `Showing the first ${previewSize}.`,
    loadFullFile: "Load full file",
    loadingFullFile: "Loading full file...",
    previewFailed:
      "This file could not be previewed. You can still download it.",
  },

  // Citations
  citations: {
    sourcesSummary: (count) =>
      `Used ${count} ${count === 1 ? "source" : "sources"}`,
    citeCount: (count) => `${count} ${count === 1 ? "cite" : "cites"}`,
    copyReference: (title) => `Copy ${title} reference`,
    copiedReference: (title) => `Copied ${title} reference`,
  },

  // Workspace Changes
  workspaceChanges: {
    title: "Workspace changes",
    editedTitle: (count) => `Edited ${count} ${count === 1 ? "file" : "files"}`,
    badge: (count, additions, deletions) =>
      `${count} ${count === 1 ? "file" : "files"} changed +${additions} -${deletions}`,
    viewChanges: "View changes",
    created: "Created",
    modified: "Modified",
    deleted: "Deleted",
    openFile: "Open file",
    loading: "Loading workspace changes...",
    noChanges: "No workspace changes recorded.",
    diffUnavailable: "Diff unavailable",
    binaryUnavailable: "Binary file. Diff unavailable.",
    largeUnavailable: "Large file. Diff omitted.",
    sensitiveUnavailable: "Sensitive path. Content hidden.",
    truncatedUnavailable: "Diff omitted because the change set is too large.",
    symlinkUnavailable: "Symlink change. Diff unavailable.",
    truncatedSummary: "Some changes were truncated.",
  },

  // Harness Constitution
  constitution: {
    stage: {
      intake: "Intake",
      context: "Context",
      model: "Model",
      tools: "Tools",
      epilogue: "Wrap-up",
      extension: "Extension",
    },
    activity: {
      intake: "Got your message",
      context: "Preparing context",
      model: "Thinking",
      tools: "Using tools",
      epilogue: "Wrapping up",
    },
    gate: {
      read_gate: "Blocked a write to a file that wasn't read first",
      tool_progress: "A tool kept returning nothing new, so it was disabled",
      subagent_limit: "Too many subtasks at once — trimmed",
      tool_promotion: "Released some previously hidden tools",
      sandbox_audit: "A command looked risky, so it didn't run",
      skill_policy: "The active skill doesn't allow that tool",
    },
    frequency: {
      once_per_run: "once per run",
      per_model_call: "per model call",
      per_tool_call: "per tool call",
    },
    kind: {
      member: "member",
      gate: "gate",
      handoff: "handoff",
    },
    a11y: {
      segment: (segment, total) => `Segment ${segment} of ${total}`,
      total: (count) => `${count} items`,
    },
    facts: {
      model: "Model",
      tools: "Mounted tools",
      deferred: "Deferred tools",
      removed: "Removed by authorization",
    },
    view: {
      user: "User view",
      developer: "Developer view",
    },
    title: "This run's harness",
    truncated: "The record was too large; some details are omitted",
    middleware: {
      ThreadDataMiddleware:
        "Creates this conversation's own working directories",
      UploadsMiddleware: "Notes the files you just uploaded",
      InputSanitizationMiddleware:
        "Sanitizes your input first, keeping the original aside",
      ToolOutputBudgetMiddleware:
        "Long tool output goes to a file; only a summary stays",
      ToolResultSanitizationMiddleware:
        "Strips fake system tags from fetched web content",
      DanglingToolCallMiddleware:
        "Backfills a placeholder for tool calls that got no reply",
      DynamicContextMiddleware: "Injects today's date and your memory",
      SkillActivationMiddleware:
        "Loads a skill's body when you type `/skill-name`",
      DurableContextMiddleware:
        "Keeps delegation and skill records visible through compaction",
      DeerFlowSummarizationMiddleware:
        "Compresses old turns into a summary near the context limit",
      TodoMiddleware: "Provides the todo list in plan mode",
      ViewImageMiddleware: "Converts images into something the model can see",
      SystemMessageCoalescingMiddleware:
        "Merges multiple system messages into one",
      DeepResearchMiddleware:
        "rag agent only: enforces the three-path retrieval",
      LLMErrorHandlingMiddleware:
        "Turns a provider failure into a recoverable message",
      TokenUsageMiddleware: "Records token usage",
      ModelLengthFinishReasonMiddleware:
        "Records why an answer was cut off by length",
      SubagentLimitMiddleware:
        "Drops subtask calls past the concurrency or per-run cap",
      LoopDetectionMiddleware:
        "Hard-stops the turn when identical tool calls repeat",
      TokenBudgetMiddleware: "Forces a wrap-up at the token budget",
      TerminalResponseMiddleware: "Retries once when the model returns nothing",
      SafetyFinishReasonMiddleware:
        "Suppresses tool calls after a content-filter stop",
      SandboxMiddleware: "Acquires the sandbox and releases it at the end",
      SkillToolPolicyMiddleware:
        "Narrows the toolset to the active skill's allowed tools",
      McpRoutingMiddleware:
        "Auto-releases matching MCP tools based on your message",
      DeferredToolFilterMiddleware:
        "Hides MCP tool schemas until they're released",
      GuardrailMiddleware:
        "Authorization and guardrail gates before any tool runs",
      SandboxAuditMiddleware: "Blocks command substitution in command position",
      ReadBeforeWriteMiddleware:
        "Won't let a file be modified before it's read",
      ToolProgressMiddleware:
        "Warns, then disables a tool that keeps returning nothing new",
      ToolErrorHandlingMiddleware:
        "Turns tool exceptions into messages so the run continues",
      ClarificationMiddleware:
        "Hands control back to you when it needs your input",
      TitleMiddleware: "Names the conversation after the first exchange",
      MemoryMiddleware: "Queues the conversation for async memory extraction",
    },
  },

  // Harness Delivery
  delivery: {
    presented: (matched, produced) =>
      `Handed over ${matched} of ${produced} artifacts`,
    mismatched: (presented) =>
      `Handed over ${presented}, none of which this run produced`,
    not_started: (produced) =>
      `Produced ${produced} artifacts but handed over none`,
  },

  // Harness run status and failure
  runOutcome: {
    busy: "This chat already has a run going — wait for it or stop it",
    modelNotAllowed: "That model isn't in the allowed list — pick another",
    threadGone: "This chat no longer exists — start again from the list",
    modeMismatch:
      "This chat's data uses another storage mode — restart the service and try again",
    runFailed: "This run didn't finish",
    runStopped: "Stopped",
    details: "Details",
  },

  // Live pulse
  pulse: {
    lap: (lap) => `Lap ${lap}`,
  },

  // Input Box
  inputBox: {
    placeholder: "How can I assist you today?",
    disclaimer: "Deerflow is AI and can make mistakes",
    createSkillPrompt:
      "We're going to build a new skill step by step with `skill-creator`. To start, what do you want this skill to do?",
    addAttachments: "Add attachments",
    inputPolish: "Polish input",
    inputPolishing: "Polishing input...",
    inputPolishNoChanges: "This input is already clear.",
    inputPolishFailed: "Failed to polish input.",
    inputPolishUndo: "Undo polish",
    inputPolishCancel: "Cancel polishing",
    voiceInputStartLabel: "Dictate with voice",
    voiceInputStopLabel: "Stop voice input",
    voiceInputStart:
      "Dictate with voice. DeerFlow receives only transcribed text; audio is handled by your browser or system speech service.",
    voiceInputStop: "Stop voice input",
    voiceInputListening: "Listening... Click to stop voice input.",
    voiceInputUnsupported:
      "Voice input is not supported in this browser. Try Chrome or Edge.",
    voiceInputPermissionDenied:
      "Microphone access was denied. Allow microphone access and try again.",
    voiceInputMicrophoneUnavailable:
      "No microphone was detected. Check your device input and try again.",
    voiceInputUnsupportedLanguage:
      "Voice input does not support the current language in this browser.",
    voiceInputNetworkError:
      "Voice input could not reach the browser speech service.",
    voiceInputNoSpeech: "No speech was detected. Please try again.",
    voiceInputFailed: "Voice input failed. Please try again.",
    mode: "Mode",
    flashMode: "Flash",
    flashModeDescription: "Fast and efficient, but may not be accurate",
    reasoningMode: "Reasoning",
    reasoningModeDescription:
      "Reasoning before action, balance between time and accuracy",
    proMode: "Pro",
    proModeDescription:
      "Reasoning, planning and executing, get more accurate results, may take more time",
    ultraMode: "Ultra",
    ultraModeDescription:
      "Pro mode with subagents to divide work; best for complex multi-step tasks",
    reasoningEffort: "Reasoning Effort",
    reasoningEffortMinimal: "Minimal",
    reasoningEffortMinimalDescription: "Retrieval + Direct Output",
    reasoningEffortLow: "Low",
    reasoningEffortLowDescription: "Simple Logic Check + Shallow Deduction",
    reasoningEffortMedium: "Medium",
    reasoningEffortMediumDescription:
      "Multi-layer Logic Analysis + Basic Verification",
    reasoningEffortHigh: "High",
    reasoningEffortHighDescription:
      "Full-dimensional Logic Deduction + Multi-path Verification + Backward Check",
    searchModels: "Search models...",
    surpriseMe: "Surprise",
    surpriseMePrompt: "Surprise me",
    followupLoading: "Generating follow-up questions...",
    followupConfirmTitle: "Send suggestion?",
    followupConfirmDescription:
      "You already have text in the input. Choose how to send it.",
    followupConfirmAppend: "Append & send",
    followupConfirmReplace: "Replace & send",
    suggestionPlaceholderRequired:
      "Replace the suggestion placeholder before sending.",
    goalCommandDescription: "Set, show, or clear an active goal",
    compactCommandDescription:
      "Compact earlier context while keeping the full chat visible",
    goalLabel: "Goal",
    goalContinuing: "Continuing {count}/{max}",
    goalContinuationTooltip:
      "Auto-continued {count}/{max} times toward the goal; stops at the limit.",
    goalSet: "Goal set.",
    goalCleared: "Goal cleared.",
    goalNone: "No active goal.",
    goalActive: "Active goal: {goal}",
    goalFailed: "Goal command failed.",
    goalTooLong: "Goal is too long. Keep it under {max} characters.",
    goalLengthCounter: "Goal length: {length}/{max} characters",
    compactSuccess:
      "Earlier context compacted. The full chat remains visible; future model calls will use the summary and recent messages.",
    compactSkipped: "The current context does not need compaction yet.",
    compactFailed: "Context compaction failed.",
    suggestions: [
      {
        suggestion: "Write",
        prompt: "Write a blog post about the latest trends on [topic]",
        icon: PenLineIcon,
      },
      {
        suggestion: "Research",
        prompt:
          "Conduct a deep dive research on [topic], and summarize the findings.",
        icon: MicroscopeIcon,
      },
      {
        suggestion: "Collect",
        prompt: "Collect data from [source] and create a report.",
        icon: ShapesIcon,
      },
      {
        suggestion: "Learn",
        prompt: "Learn about [topic] and create a tutorial.",
        icon: GraduationCapIcon,
      },
    ],
    suggestionsCreate: [
      {
        suggestion: "Webpage",
        prompt: "Create a webpage about [topic]",
        icon: CompassIcon,
      },
      {
        suggestion: "Image",
        prompt: "Create an image about [topic]",
        icon: ImageIcon,
      },
      {
        suggestion: "Video",
        prompt: "Create a video about [topic]",
        icon: VideoIcon,
      },
      {
        type: "separator",
      },
      {
        suggestion: "Skill",
        prompt:
          "We're going to build a new skill step by step with `skill-creator`. To start, what do you want this skill to do?",
        icon: SparklesIcon,
      },
    ],
    pleaseWaitStreaming: "Please wait for the current response to finish.",
  },

  // Sidebar
  sidebar: {
    newChat: "New chat",
    chats: "Chats",
    channels: "Channels",
    recentChats: "Recent chats",
    demoChats: "Demo chats",
    agents: "Agents",
    scheduledTasks: "Scheduled tasks",
    agentsDisabledTooltip: "Feature not enabled",
    knowledge: "Knowledge",
  },

  knowledge: {
    personalKBs: "Personal knowledge bases",
    sharedKBs: "Shared knowledge bases",
    sharedKbSamples: ["Team shared library", "Product public docs"],
    createKB: "New knowledge base",
    kbNamePlaceholder: "Knowledge base name",
    kbDescriptionPlaceholder: "Description (optional)",
    emptyKbList: 'No knowledge bases yet — click "+" above to create one',
    selectKbTitle: "No knowledge base selected",
    selectKbHint: "Select a knowledge base on the left to start asking",
    collapseKbList: "Collapse the list panel",
    expandKbList: "Expand the list panel",
    uploadDocuments: "Upload documents",
    uploadingDocuments: "Uploading…",
    dropToUpload: "Drop to upload into this knowledge base",
    dropUnsupported: "This format isn't supported yet",
    unsupportedFilesSkipped: (names: string) =>
      `Skipped unsupported files: ${names}`,
    duplicateUpload: {
      identicalTitle: "Identical content",
      identicalDescription: (name: string) =>
        `"${name}" is byte-identical to an existing document — no need to upload again.`,
      conflictTitle: "Same-name file exists",
      conflictDescription: (name: string) =>
        `"${name}" shares its name with an existing document but the content differs.`,
      copyNamePreview: (name: string) =>
        `Keeping both uploads it as "${name}".`,
      skipUpload: "Skip upload",
      keepCopy: "Upload copy anyway",
      keepBoth: "Keep both",
      replaceOld: "Replace old document",
      skippedDuplicate: (name: string) => `Skipped duplicate file: ${name}`,
      uploadedAsCopy: (name: string) => `Uploaded as copy: ${name}`,
      replacedDocument: (name: string) => `Replaced old document: ${name}`,
    },
    searchDocuments: "Search documents…",
    searchWiki: "Search entries and cards…",
    clearSearch: "Clear search",
    noMatchingDocuments: "No documents match",
    selectAllDocuments: "Select all",
    selectDocument: "Select document",
    selectedCount: (count: number) => `${count} selected`,
    deleteSelected: "Delete selected",
    cancelSelection: "Cancel selection",
    openChunks: "View chunks",
    downloadDocument: "Download original",
    generateQuestion: "Generate question",
    generateQuestionBatch: "Generate question (joint)",
    moreActions: "More actions",
    sortDocuments: "Sort documents",
    sort: {
      createdAt: "Upload time",
      name: "Name",
      size: "Size",
      chunks: "Chunks",
      asc: "Ascending",
      desc: "Descending",
    },
    updateWiki: "Update wiki",
    rebuildWiki: "Rebuild wiki",
    wikiMoreOptions: "Wiki actions",
    rebuildWikiConfirmTitle: "Rebuild all wiki entries?",
    rebuildWikiConfirmDescription:
      "This rewrites every eligible entry from the current graph — including unchanged ones — at full LLM cost. Use only after generation rules change (e.g. prompt or template upgrades).",
    rebuildWikiConfirmAction: "Rebuild",
    wikiEnqueued:
      "Wiki generation queued — entries become searchable when ready",
    wikiUpdated: "Wiki updated",
    wikiAlreadyRunning: "Wiki update already in progress",
    wikiUpdateFailed:
      "Wiki update failed — some entries may still be stale; please retry",
    settings: "Settings",
    renameKb: "Rename knowledge base",
    deleteKb: "Delete knowledge base",
    deleteKbConfirmTitle: "Delete this knowledge base?",
    deleteKbConfirmDescription:
      "All documents, chunks, vectors, graph data and wiki entries will be cascade-deleted. This cannot be undone.",
    statsDocuments: "Documents",
    statsChunks: "Chunks",
    // Video-row badge (spec 2026-09-08 §5): duration as title/aria (shot count removed — duplicates the chunks column).
    videoDuration: "Duration",
    table: {
      name: "Name",
      uploader: "Uploader",
      size: "Size",
      chunks: "Chunks",
      status: "Status",
      createdAt: "Uploaded",
      // Column visibility & format toggles (2026-09-02).
      columnMenu: "column options",
      hideColumn: "Hide column",
      columns: "Columns",
      showAllColumns: "Show all",
      timeFormat: "Date format",
      timeFormatAbsolute: "Absolute",
      timeFormatRelative: "Relative",
      sizeUnit: "Unit",
      sizeUnitKb: "KB",
      sizeUnitMb: "MB",
    },
    status: {
      uploaded: "Uploaded",
      parsing: "Parsing",
      chunking: "Chunking",
      indexing: "Indexing",
      ready: "Ready",
      failed: "Failed",
    },
    pathStatus: {
      vector: "Vector",
      graph: "Graph",
      wiki: "Wiki",
      // Video prep legs (spec 2026-09-08 §5): hover-only for video docs, lead the retrieval legs.
      asr: "Speech",
      segment: "Shots",
      caption: "Caption",
      libraryHint: " (library-wide)",
      state: {
        pending: "Pending",
        indexing: "Indexing",
        done: "Done",
        degraded: "Degraded",
        failed: "Failed",
        generating: "Generating",
        ready: "Ready",
      },
    },
    deleteDocument: "Delete",
    deleteDocumentConfirmTitle: "Delete this document?",
    deleteDocumentConfirmDescription:
      "Its chunks, vectors and graph contributions will be cascade-deleted. This cannot be undone.",
    retryDocument: "Retry",
    uploaderMe: "Me",
    dropzoneHint: "Drop files here to upload",
    emptyDocuments: "Upload or drop files to build the index",
    chunkDrawer: {
      title: "Chunk preview",
      chunkUnit: "chunks",
      current: "current",
      prevChunk: "Previous chunk",
      nextChunk: "Next chunk",
      tickAria: "Chunk",
      notLoaded: "not loaded",
      page: "Page",
      tokens: "tokens",
      entities: "Entities",
      empty: "No chunks for this document yet",
      loadMore: "Load more",
      loading: "Loading…",
      edit: "Edit",
      delete: "Delete",
      save: "Save",
      cancel: "Cancel",
      edited: "Edited",
      viewRendered: "Rendered view",
      viewRaw: "Raw text",
      editHint:
        "Entities and Wiki will not auto-update. Use 'Re-extract' to rebuild entities with new content",
      deletePreviewTitle: "Delete Preview",
      orphanedEntities: "Entities to be orphaned",
      affectedEntities: "Entities to be affected",
      relationDeletions: "Relations to be deleted",
      deleteWarning: "Deletion is irreversible",
      confirmDelete: "Confirm Delete",
      deleteSuccess: "Chunk deleted",
      deleteFailed: "Failed to delete chunk",
      deleteProcessing: "Document is being processed; cannot delete the chunk",
      reExtract: "Re-extract",
      reExtractCost: "Costs 1 LLM extraction call",
      reExtracting: "Extracting…",
      reExtractHint: "Extracting entities, please wait…",
      imageUnavailable: "Image unavailable",
      // Video shot timecode chip + thumbnail (spec 2026-09-08 §5, Task 10).
      timecodeChip: "Timecode",
      copyTimecode: "Copy timecode",
      copiedTimecode: "Timecode copied",
      copyTimecodeFailed: "Copy failed",
      frameMissing: "Keyframe missing",
      // Inline video player (spec 2026-09-08 §5, Task 10b).
      playerHint: "Click a shot's timecode or thumbnail to seek and play",
      playShot: "Play this shot",
    },
    tabs: {
      documents: "Documents",
      wiki: "Wiki",
      recall: "Recall test",
      vectors: "Vector space",
      graph: "Knowledge graph",
      eval: "Evaluation",
      more: "More tabs",
    },
    eval: {
      layer1Title: "Retrieval Quality",
      layer2Title: "Generation Quality",
      layer1Note:
        "Deterministic retrieval-stage metrics, reproducible.\nHit Rate: share of questions where correct content appears in retrieved results\nRecall@k: share of correct content covered by the top-k results\nMRR: higher when the first correct result ranks earlier\nPath Accuracy: share of graph retrieval paths chosen correctly",
      layer2Note:
        "Generation-stage metrics; RAGAS scores are probabilistic (judge variance) — reference only",
      regressionBadge: "Regression detected",
      ragasMissingBadge: "ragas not installed",
      ragasErrorBadge: "ragas error",
      citationPrecision: "Citation Precision",
      citationRecall: "Citation Recall",
      seedHitRate: "Seed Entity Hit Rate",
      routingHitRate: "Routing Hit Rate",
      ragasCard: {
        faithfulness: "Faithfulness",
        answerRelevancy: "Answer Relevancy",
        contextPrecision: "Context Precision",
        contextRecall: "Context Recall",
      },
      cardNote: {
        faithfulness:
          "Faithfulness: whether the answer is grounded in retrieved context, without fabrication (0–1, higher is better)",
        answerRelevancy:
          "Answer Relevancy: how relevant the answer is to the question (0–1, higher is better)",
        contextPrecision:
          "Context Precision: share of relevant chunks ranked near the top of retrieval results (0–1, higher is better)",
        contextRecall:
          "Context Recall: how much of the information needed by the answer is covered by retrieved context (0–1, higher is better)",
        citationPrecision:
          "Citation Precision: share of cited chunks that actually support the answer",
        citationRecall:
          "Citation Recall: share of content that should have been cited that actually was",
        seedHitRate:
          "Seed Entity Hit Rate: share of graph questions that hit the preset seed entities",
        routingHitRate:
          "Routing Hit Rate: share of questions whose expected paths were hit by the retrieval tools the agent actually called in the live conversation chain; different semantics from the retrieval-quality path accuracy (offline retrieval routing)",
      },
      ragasGroupLabel: "RAGAS probabilistic metrics",
      archGroupLabel: "Citation & graph metrics",
      noGraphQuestions: "No questions of this category in the batch",
      emptyLayer1: "No retrieval-quality data yet",
      emptyLayer2: "No generation-quality data yet",
      viewTrace: "View trace →",
      tableCategory: "Category",
      tableHitRate: "Hit Rate",
      tableRecallAtK: (k: number | null) => (k == null ? "Recall@k" : `Recall@${k}`),
      tableMrr: "MRR",
      tablePathAccuracy: "Path Accuracy",
      category: {
        fact: "Fact",
        relation: "Relation",
        concept: "Concept",
        global: "Global",
        summary: "Summary",
      },
      views: {
        overview: "Overview",
        questions: "Questions",
        history: "History",
      },
      viewSwitchLabel: "Switch eval view",
      tierQuick: "Quick evaluation",
      tierFull: "Full evaluation",
      runningPhase: (phase, step, total) => `${phase} ${step}/${total}`,
      phaseLayer1: "Retrieval",
      phaseQuestions: "Answering",
      phaseRagas: "RAGAS",
      failedCount: (n) => `${n} failed`,
      etaRemaining: (minutes) => `~${minutes} min left`,
      etaRemainingSeconds: (seconds) => `~${seconds} s left`,
      etaEstimating: "Estimating…",
      logPhase: (phase) => `Starting ${phase}`,
      logItem: (phase, done, total) => `${phase} ${done}/${total}`,
      logFail: (phase, done, total, failed) => `${phase} ${done}/${total}, ${failed} failed so far`,
      logWaiting: "Run started, waiting for the first progress event…",
      bannerAria: (phase, percent) => `${phase}, ${percent}% complete overall`,
      slotSummary: (tier, duration) => (duration ? `${tier} · took ${duration}` : tier),
      slotSummaryFailed: "Eval failed",
      slotSummaryCancelled: "Eval cancelled",
      slotViewHistory: "View history",
      durSeconds: (seconds) => `${seconds}s`,
      durMinutes: (minutes) => `${minutes}m`,
      durMinutesSeconds: (minutes, seconds) => `${minutes}m ${seconds}s`,
      neverRan: "Not yet evaluated",
      runStartedToast: "Evaluation started",
      alreadyRunningToast: "An evaluation is already running",
      runFailedToast: "Failed to start the evaluation",
      cancelRun: "Cancel run",
      cancelConfirm: "Confirm cancel?",
      cancelToast: "Eval run cancelled",
      cancelFailedToast: "Failed to cancel the run",
      fullRun: {
        menuAria: "Evaluation tier",
        dialogTitle: "Run full evaluation",
        dialogBody:
          "A full evaluation first runs the retrieval-quality metrics, then lets the agent answer every question with an independent judge scoring it (including RAGAS metrics). It takes much longer and costs far more tokens than the quick tier, and cannot be triggered again while running.",
        dialogScopeAll: "Scope: every question in the bank.",
        dialogScopeSelected: (count: number) => `Scope: the ${count} selected question(s).`,
        confirm: "Start full evaluation",
        cancel: "Cancel",
      },
      selection: {
        selectAllAria: "Select all",
        rowSelectAria: (query: string) => `Select "${query}"`,
        selected: (count: number) => `${count} selected`,
        clear: "Clear selection",
      },
      questions: {
        columnQuery: "Question",
        columnCategory: "Category",
        columnRefDocs: "Ref docs",
        refDocsCount: (count: number) => `${count} docs`,
        columnRecallNote:
          "Share of this question's reference chunks hit in the most recent run that included it (merged across runs); untested questions show —",
        sortDefault: "Default order",
        recallTip: (percent: string, path: string) => `Recall ${percent} · actual ${path}`,
        recallUntested: "Not tested or not in the latest run",
        unanchored: "Unanchored",
        addQuestion: "Add question",
        emptyBank:
          "No questions yet — tick the right chunks in the recall test panel to save one in a click",
        emptyBankSynthesis:
          "Or synthesize candidates from a document and accept them after review",
        searchPlaceholder: "Search questions…",
        searchClear: "Clear search",
        noMatch: "No matching questions — try another keyword",
        rowReproduce: "Reproduce in recall test panel",
        rowDelete: "Delete question",
        saveFailed: "Failed to save the question",
        deleteFailed: "Failed to delete the question",
        addDialog: {
          title: "Add question",
          queryLabel: "Question",
          categoryLabel: "Category",
          expectedPathLabel: "Expected path",
          referenceAnswerLabel: "Reference answer (optional)",
          unanchoredNote:
            "Questions without chunk anchors only contribute path selection and generation quality",
          submit: "Add",
          cancel: "Cancel",
        },
        deleteConfirm: {
          title: "Delete question",
          description: "This cannot be undone. Delete this question?",
          confirm: "Delete",
          cancel: "Cancel",
        },
        drawerTitle: "Question details",
        noReferenceAnswer: "Not provided",
        answerSection: "Reference answer",
        entitiesSection: "Entities",
        drawerChunksCount: (count: number) => `${count} chunks`,
        addedToast: "Question added",
        deletedToast: "Question deleted",
      },
      synthesize: {
        entryButton: "Generate questions",
        dialogTitle: "Synthesize questions",
        docLabel: "Source documents (multi-select)",
        docPlaceholder:
          "Pick indexed documents to draw from — several can be combined",
        countLabel: "Number of candidates",
        generate: "Generate",
        generating: "Generating…",
        reviewTitle: "Candidate review",
        accept: "Accept",
        reject: "Ignore",
        acceptAll: "Accept all",
        rejectAll: "Ignore all",
        metaLine: (dropped: number) =>
          `${dropped} candidate(s) dropped for invalid anchors or fields`,
        reviewCount: (count: number) => `${count} pending review`,
        droppedChip: (dropped: number) => `${dropped} dropped`,
        reviewMetaTip: (docs: string, time: string) => `From ${docs} · generated ${time}`,
        empty: "No candidates awaiting review",
        triggerFailed: "Failed to trigger synthesis",
        acceptFailed: "Failed to accept candidate",
        rejectFailed: "Failed to ignore candidate",
        docNotReady: "Document is missing or has no indexed chunks",
      },
      history: {
        envLocal: "Local",
        envCi: "CI",
        envNightly: "Nightly",
        statusCompleted: "Completed",
        statusError: "Failed",
        statusSkipped: "Skipped",
        statusCancelled: "Cancelled",
        emptyHistory:
          "No runs yet — click Run evaluation to start the first one",
        colTime: "Run time",
        colEnv: "Environment",
        colScope: "Eval content",
        colStatus: "Status",
        colDuration: "Duration",
        scopeQuick: "Quick",
        scopeFull: "Full",
        scopeGeneration: "Generation",
        rowSelectAria: (time) => `Select run ${time}`,
        rowDelete: "Delete this run",
        deleteConfirmTitle: "Delete run history",
        deleteConfirmDesc: (count) =>
          `This deletes ${count} run record(s). Overview, trends and the bank recall column converge accordingly; this cannot be undone`,
        baselineWarn:
          "Selection includes baseline runs: after deletion, later runs lose the regression-gate reference.",
        deletedToast: "Run history deleted",
        deleteFailed: "Failed to delete runs",
        sortDefault: "Default order",
        durFormatLabel: "Duration format",
        durFormatCompact: "Compact",
        durFormatSeconds: "Seconds",
      },
      trendTitle: "Metric Trends",
      granularityLabel: "Time window",
      granularity: { day: "Day", week: "Week", month: "Month" },
      moreOptions: "More options",
      loading: "Loading…",
      loadFailed: "Failed to load evaluation data",
      emptyTrend: "No evaluation trend data yet",
      trend: {
        recallAtK: "Recall@k",
        hitRate: "Hit Rate",
        mrr: "MRR",
        faithfulness: "Faithfulness",
        answerRelevancy: "Answer Relevancy",
        contextPrecision: "Context Precision",
        thresholdLine: "Regression threshold",
        thresholdLabel: (percent) => `Regression threshold -${percent}%`,
        baselineUpdate: "Baseline updated",
        clickForDetail: "Click for details",
        regressionPrefix: "Regressed categories",
        pickerTrigger: "Metrics",
        pickerAria: "Select trend metrics",
        fullTierOnly: "Full tier only",
        notRunInTier: "Not run in this tier",
      },
      drawer: {
        title: "Eval Run Details",
        runIdLabel: "Run ID",
        createdAtLabel: "Run time",
        environmentLabel: "Environment",
        statusLabel: "Status",
        statusCompleted: "Completed",
        statusError: "Failed",
        statusSkipped: "Skipped",
        statusCancelled: "Cancelled",
        baselineBadge: "Baseline",
        runInfoSection: "Run info",
        layer1Section: "Retrieval Quality",
        layer2Section: "Generation Quality",
        contextRecallLabel: "Context Recall",
        notRun: "This layer was not executed in this run",
      },
    },
    vectorSpace: {
      loading: "Computing projection…",
      empty: "No vectors in this knowledge base yet — upload documents first",
      loadFailed: "Failed to load projection",
      indexingHint: (count) =>
        `${count} document${count === 1 ? "" : "s"} still indexing — the projection may be incomplete`,
      chips: {
        chunks: "Chunks",
        entities: "Entities",
        wiki: "Wiki",
        cards: "Entries",
      },
      algoLabel: "Algorithm",
      recompute: "Recompute",
      moreOptions: "More options",
      dimsLabel: "Dimensions",
      sampledBadge: (shown, total) => `Sampled ${shown}/${total} points`,
      searchAll: "Search…",
      searchScopeLabel: "Search scope",
      searchScopes: {
        all: "All",
        chunks: "Documents",
        entities: "Entities",
        wiki: "Wiki",
        cards: "Entries",
      },
      followChat: "Follow chat",
      overlayPcaOnly:
        "Retrieval overlay requires the PCA projection — switch back to PCA",
      overlayStale:
        "Projection changed — the retrieval overlay was cleared, run the retrieval again",
      overlayFailed: "Failed to overlay the retrieval — please try again",
      overlayHits: (matched, total) => `${matched}/${total} hits shown`,
      clearOverlay: "Clear overlay",
    },
    graphSpace: {
      loading: "Loading the knowledge graph…",
      loadFailed: "Failed to load the knowledge graph — please try again",
      empty:
        "Nothing to visualize yet — entities appear after documents are indexed",
      stats: (nodes, edges, communities) =>
        `${nodes} entities · ${edges} relations · ${communities} communities`,
      mentions: (count) => `Mentioned by ${count} chunks`,
      relatedChunks: "Related chunks",
      entityDescription: "Description",
      entityCommunity: (community) => `Community #${community}`,
      entityNoDescription: "No description yet",
      entityNoChunks: "No linked chunks",
      unknownDoc: "(document deleted)",
      searchEntities: "Search entities",
      searchNoMatch: "No matching entity",
      colorByType: "By type",
      colorByCommunity: "By community",
      backToGlobal: "Back to full graph",
      neighborhoodOf: (name) => `Neighbors of ${name}`,
      guideHint:
        "Too many entities — details hidden; zoom in or double-click a node to drill in",
      hop1: "1 hop",
      hop2: "2 hops",
      followChat: "Follow chat",
      overlayLayers: (seeds, expanded, evidence) =>
        `Seeds ${seeds} · Expanded ${expanded} · Evidence ${evidence}`,
      overlayStale:
        "The graph changed — the retrieval path highlight was cleared",
      clearOverlay: "Clear path highlight",
    },
    wikiPanel: {
      empty: "Wiki entries accumulate automatically and appear over time",
      loading: "Loading…",
      dirty: "Stale",
      updating: "Updating",
      updatingHint: "Entries refresh one by one as they finish",
      updatedAt: "Updated",
      sectionTitle: "Generated Entries",
      selectEntry: "Select entry",
      openEntry: "Open details",
      editEntry: "Edit entry",
      updateEntry: "Update entry",
      updateSelected: "Update selected",
      noMatches: "No matching entries",
      deleteBatchTitle: (count: number) =>
        `Delete ${count} wiki ${count === 1 ? "entry" : "entries"}?`,
      deleteEntry: "Delete entry",
      deleteConfirmTitle: "Delete this wiki entry?",
      deleteConfirmDescription:
        "Deletes the entry text and its search vector; the entity itself stays. If the entity is still eligible, the next generation run recreates the entry from current material.",
    },
    /** Phase-3 Batch-1 P1 + spec 2026-09-12: main content is replaceable; the supplement layer steers generation. */
    wikiEdit: {
      title: "Edit Wiki Entry",
      description:
        "Main content can be replaced by regeneration; the supplement layer persists and steers every generation",
      mainContentLabel: "Main Content (Auto-generated)",
      mainContentPlaceholder:
        "AI-generated content will be displayed here, you can manually edit",
      mainContentHint: "⚠️ This content will be replaced on next regeneration",
      supplementLabel: "Supplement Layer (Generation Direction)",
      supplementPlaceholder:
        "Describe how you want the AI to rewrite this entry — it works like a prompt for generation. e.g. Keep the tone rigorous and cover more related concepts",
      supplementHint:
        "✅ Persists permanently; it is passed to the AI as your requirement on every regeneration",
      auditLastEdited: "Last edited",
      save: "Save",
      saving: "Saving…",
    },
    wikiDrawer: {
      openInTab: "Open in the Wiki tab",
      loading: "Loading…",
      notFound: "Entry missing or deleted",
      sourceChunks: "source chunks",
      deletedSources: "source chunks deleted",
    },
    /** Phase-3 Batch-1 P6: manual knowledge cards (spec §8). */
    manualCards: {
      sectionTitle: "My Entries",
      newCard: "New Card",
      empty: "Create a card to capture your own knowledge",
      loading: "Loading…",
      includeInSearch: "Mixed into search",
      includeHint:
        "When on, the card joins wiki retrieval and competes for the shared top-k slots purely by relevance",
      editCard: "Edit card",
      deleteCard: "Delete card",
      deleteConfirmTitle: "Delete this knowledge card?",
      deleteConfirmDescription:
        "The card content and its retrieval vector will be removed. This cannot be undone.",
      editorCreateTitle: "New Knowledge Card",
      editorEditTitle: "Edit Knowledge Card",
      editorDescription:
        "Manual cards never auto-update and stay isolated from AI-generated content",
      titleLabel: "Title",
      titlePlaceholder: "Sum up this piece of knowledge in one line",
      contentLabel: "Content",
      contentPlaceholder:
        "Capture your experience, conclusions, or caveats (Markdown supported)",
      tagsLabel: "Tags (optional)",
      tagsPlaceholder: "Comma-separated, e.g.: ops, release",
      save: "Save",
      saving: "Saving…",
      createSuccess: "Card created",
      updateSuccess: "Card updated",
      deleteSuccess: "Card deleted",
      saveFailed: "Failed to save the card",
      deleteFailed: "Failed to delete the card",
      updatedAt: "Updated",
      selectCard: "Select card",
      openCard: "Open details",
      noMatches: "No matching cards",
      includeOn: "Include in search",
      includeOff: "Exclude from search",
      deleteBatchTitle: (count: number) =>
        `Delete ${count} knowledge ${count === 1 ? "card" : "cards"}?`,
      drawerNotFound: "Card missing or deleted",
      drawers: {
        new: "New Drawer",
        edit: "Edit Drawer",
        nameLabel: "Name",
        namePlaceholder: "Enter a name…",
        iconLabel: "Icon",
        colorLabel: "Color",
        create: "Create",
        save: "Save",
        delete: "Delete Drawer",
        close: "Hide",
        allDrawers: "All drawers",
        moveTo: "Move to Drawer",
        unfiled: "Unfiled",
        newFromMenu: "New Drawer…",
      },
    },
    recallTest: {
      queryPlaceholder: "Enter a test query…",
      run: "Run",
      running: "Running…",
      costHint: "Hits the live retrieval chain — model calls are billed",
      topK: "Hits per path",
      vectorPath: "Vector",
      graphPath: "Graph",
      wikiPath: "Wiki",
      entities: "Entities",
      relations: "Relations",
      evidence: "Chunk evidence",
      empty: "Run a query to compare hits and scores across the three paths",
      failed: "Recall test failed",
      viewInVectorSpace: "View in vector space",
      wikiAnchorTooltip:
        "Manual cards have no source chunks: ticking records the expected path only, without chunk anchors",
      slicePosition: (position: number) => `Chunk #${position}`,
      evidenceView: (count: number) => `Evidence ${count}`,
      entitiesView: (count: number) => `Entities ${count}`,
      saveAsQuestion: {
        button: "Save as question",
        selectedCount: (count: number) => `${count} selected`,
        queryLabel: "Question",
        categoryLabel: "Category",
        expectedPathLabel: "Expected path",
        expectedPathsLabel: "Expected paths (multi-select)",
        anchorHint:
          "Ticked chunks and wiki entry source chunks are recorded as this question's anchors",
        referenceAnswerLabel: "Reference answer (optional)",
        submit: "Save",
        cancel: "Cancel",
        savedToast: "Saved as a question",
        saveFailed: "Failed to save as question",
      },
    },
    chat: {
      newChat: "New chat",
      history: "History",
      noHistory: "No conversations for this knowledge base yet",
      questionTickAria: "Question",
      questionTickEmpty: "(no text)",
      deleteChat: "Delete conversation",
      deepResearch: "Deep retrieval",
      deepResearchHint:
        "Query vector, graph and wiki paths together (slower but broader)",
      sources: "Sources",
      sourcesTitle: (count) => `Sources · ${count}`,
      chunkSources: (count) => `${count} doc${count === 1 ? "" : "s"}`,
      wikiSources: (count) => `${count} wiki`,
      manualSources: (count) => `${count} card${count === 1 ? "" : "s"}`,
      viewAllSources: "View all",
      sourceTypeChunk: "Doc",
      sourceTypeWiki: "Wiki",
      sourceTypeManual: "My Card",
      sourceMarkAriaLabel: (index, name) => `Source ${index}: ${name}`,
      expandToFullPage: "Open in full page",
      expandDisabledAgentsOff: "Agents feature is disabled on this server",
      pageLabel: (page) => `Page ${page}`,
      inputPlaceholder: "Ask this knowledge base…",
      selectModel: "Select model",
      searchModels: "Search models…",
      send: "Send",
    },
    errors: {
      createFailed: "Failed to create the knowledge base",
      renameFailed: "Failed to rename",
      deleteFailed: "Failed to delete the knowledge base",
      uploadFailed: "Upload failed",
      deleteDocumentFailed: "Failed to delete the document",
      retryFailed: "Retry failed",
      wikiFailed: "Failed to queue wiki generation",
      deleteWikiEntryFailed: "Failed to delete the wiki entry",
    },
    docErrors: {
      toastTitle: "Document processing failed",
      dismissAll: "Dismiss all",
      dismiss: "Dismiss",
      empty: "The file is empty",
      unsupported: "Unsupported file type",
      retryLimit:
        "The parsing service failed after several retries — check the file for corruption or try again later",
      serviceUnconfigured:
        "The document parsing service is not configured — contact your admin",
      timeout: "Parsing timed out — please retry",
      unknown: "Processing failed — please retry",
    },
  },

  // Scheduled tasks
  scheduledTasks: {
    scheduleType: {
      cron: "Recurring",
      once: "One-time",
    },
    preset: {
      label: "Repeat",
      hourly: "Hourly",
      daily: "Daily",
      weekly: "Weekly",
      monthly: "Monthly",
      custom: "Custom cron",
    },
    fields: {
      minute: "Minute",
      time: "Time",
      weekday: "On",
      dayOfMonth: "Day of month",
      cron: "Cron expression",
      cronPlaceholder: "0 9 * * *",
      runAt: "Run at",
      timezone: "Timezone",
    },
    weekdays: {
      mon: "Mon",
      tue: "Tue",
      wed: "Wed",
      thu: "Thu",
      fri: "Fri",
      sat: "Sat",
      sun: "Sun",
    },
    preview: "Preview",
    cronHelp: "Open crontab.guru",
    create: {
      title: "Create scheduled task",
      taskTitle: "Task title",
      prompt: "Prompt",
      submit: "Create",
      fillRequired: "Fill all required fields",
    },
    context: {
      fresh: "Fresh thread",
      reuse: "Reuse thread",
      threadIdPlaceholder: "Thread ID",
    },
    filters: {
      allStatuses: "All statuses",
      enabled: "Enabled",
      paused: "Paused",
      completed: "Completed",
      failed: "Failed",
      allTypes: "All types",
      cron: "Cron",
      once: "Once",
    },
    detail: {
      contextMode: "Context mode",
      thread: "Thread",
      lastThread: "Last thread",
      schedule: "Schedule",
      nextRun: "Next run",
      lastRun: "Last run",
      lastRunId: "Last run id",
      lastError: "Last error",
      runsCount: "{count} runs",
      runsCountOne: "{count} run",
      noRuns: "No runs yet",
      noSelection: "No scheduled task selected",
      filteredByThread: "Filtered by thread: {id}",
      loadFailed: "Failed to load scheduled tasks",
    },
    actions: {
      edit: "Edit",
      cancelEdit: "Cancel edit",
      pause: "Pause",
      resume: "Resume",
      trigger: "Trigger now",
      delete: "Delete",
    },
    deleteConfirm:
      "Are you sure you want to delete this scheduled task? This action cannot be undone.",
    errors: {
      create: "Failed to create scheduled task",
      update: "Failed to update scheduled task",
      pause: "Failed to pause scheduled task",
      resume: "Failed to resume scheduled task",
      trigger: "Failed to trigger scheduled task",
      delete: "Failed to delete scheduled task",
    },
    edit: {
      titlePlaceholder: "Edit title",
      promptPlaceholder: "Edit prompt",
      submit: "Save edit",
    },
    status: {
      enabled: "Enabled",
      paused: "Paused",
      running: "Running",
      completed: "Completed",
      failed: "Failed",
      cancelled: "Cancelled",
    },
    runTrigger: { scheduled: "scheduled", manual: "manual" },
    runStatus: {
      queued: "Queued",
      running: "Running",
      success: "Success",
      failed: "Failed",
      skipped: "Skipped",
      interrupted: "Interrupted",
    },
    recipes: {
      label: "Quick create",
      trending: {
        title: "GitHub Trending daily",
        desc: "Summarize today's top 10 trending repos",
      },
      news: {
        title: "Daily tech news digest",
        desc: "Collect and summarize the day's top tech news",
      },
      issues: {
        title: "GitHub Issue triage",
        desc: "Triage a repo's open issues (fill in {{repo}})",
      },
      weekly: {
        title: "Weekly report",
        desc: "Compile a weekly summary, every Monday",
      },
    },
  },

  // Agents
  agents: {
    title: "Agents",
    description:
      "Create and manage custom agents with specialized prompts and capabilities.",
    newAgent: "New Agent",
    emptyTitle: "No custom agents yet",
    emptyDescription:
      "Create your first custom agent with a specialized system prompt.",
    featureDisabledTitle: "Agents feature is not enabled",
    featureDisabledDescription:
      "This feature is not enabled on this server. Please contact your administrator.",
    chat: "Chat",
    delete: "Delete",
    deleteConfirm:
      "Are you sure you want to delete this agent? This action cannot be undone.",
    deleteSuccess: "Agent deleted",
    newChat: "New chat",
    createPageTitle: "Design your Agent",
    createPageSubtitle:
      "Describe the agent you want — I'll help you create it through conversation.",
    nameStepTitle: "Name your new Agent",
    nameStepHint:
      "Letters, digits, and hyphens only — stored lowercase (e.g. code-reviewer)",
    nameStepPlaceholder: "e.g. code-reviewer",
    nameStepContinue: "Continue",
    nameStepInvalidError:
      "Invalid name — use only letters, digits, and hyphens",
    nameStepAlreadyExistsError: "An agent with this name already exists",
    nameStepNetworkError:
      "Network request failed — check your network or backend connection",
    nameStepCheckError: "Could not verify name availability — please try again",
    nameStepCheckErrorWithDetail: "Name check failed: {detail}",
    nameStepApiDisabledError:
      "Custom agent management is not enabled on this server. Please contact your administrator.",
    nameStepBootstrapMessage:
      "The new custom agent name is {name}. Help me design its purpose, behavior, and SOUL.md before saving it.",
    save: "Save agent",
    saving: "Saving agent...",
    saveRequested:
      "Save requested. DeerFlow is generating and saving an initial version now.",
    saveHint:
      "You can save this agent at any time from the top-right menu, even if this is only a first draft.",
    saveCommandMessage:
      "Please save this custom agent now based on everything we have discussed so far. Treat this as my explicit confirmation to save. If some details are still missing, make reasonable assumptions, generate a concise first SOUL.md in English, and call setup_agent immediately without asking me for more confirmation.",
    agentCreatedPendingRefresh:
      "The agent was created, but DeerFlow could not load it yet. Please refresh this page in a moment.",
    more: "More actions",
    agentCreated: "Agent created!",
    startChatting: "Start chatting",
    backToGallery: "Back to Gallery",
    settings: "Model settings",
    settingsTitle: "Model settings",
    settingsDescription:
      "Choose the default model and generation parameters for this agent. Changes take effect on the next message.",
    settingsModel: "Default model",
    settingsModelDefault: "Use global default",
    settingsTemperature: "Temperature",
    settingsTemperatureHint: "0 = deterministic, higher = more creative (0–2).",
    settingsMaxTokens: "Max output tokens",
    settingsMaxTokensPlaceholder: "Inherit from model",
    settingsThinking: "Thinking mode",
    settingsThinkingOn: "On",
    settingsThinkingOff: "Off",
    settingsReasoningEffort: "Reasoning effort",
    settingsInherit: "Inherit",
    settingsSaved: "Model settings saved",
    settingsInvalidTemperature: "Temperature must be between 0 and 2",
    settingsInvalidMaxTokens:
      "Max output tokens must be a positive integer up to 200,000",
  },

  // Breadcrumb
  breadcrumb: {
    workspace: "Workspace",
    chats: "Chats",
  },

  // Workspace
  workspace: {
    officialWebsite: "DeerFlow's official website",
    githubTooltip: "DeerFlow on GitHub",
    settingsAndMore: "Settings and more",
    visitGithub: "DeerFlow on GitHub",
    reportIssue: "Report an issue",
    contactUs: "Contact us",
    about: "About DeerFlow",
    logout: "Log out",
    gatewayUnavailable: "Gateway is temporarily unavailable.",
    gatewayUnavailableRetrying: "Retrying in the background…",
  },

  // Conversation
  conversation: {
    noMessages: "No messages yet",
    startConversation: "Start a conversation to see messages here",
    branchCreated: "Conversation branch created",
    branchFailed: "Failed to branch conversation.",
    streamReplayGap:
      "Some live updates expired. The conversation was restored from saved state.",
  },

  // Chats
  chats: {
    searchChats: "Search chats",
    loadMoreToSearch: "Load more to search older conversations",
    loadingMore: "Loading more...",
    loadOlderChats: "Load older chats",
    pinChat: "Pin chat",
    unpinChat: "Unpin chat",
    pinChatFailed: "Failed to update pinned chat",
  },

  // Sidecar
  sidecar: {
    title: "Side chat",
    open: "Open side chat",
    close: "Close side chat",
    delete: "Delete side chat",
    deleteConfirm:
      "Are you sure you want to delete this side chat? This action cannot be undone. To simply hide it, use the side chat toggle in the header instead.",
    deleteSuccess: "Side chat deleted",
    deleteFailed: "Failed to delete side chat.",
    addToConversation: "Add to conversation",
    askInSideChat: "Ask in side chat",
    reference: "Reference",
    selectedTextFragment: "{count} selected text fragment",
    selectedTextFragments: "{count} selected text fragments",
    clearReferences: "Clear selected references",
    emptyTitle: "Ask a follow-up",
    emptyDescription: "Ask a follow-up grounded in the referenced text.",
    placeholder: "Ask a deeper follow-up...",
    send: "Send",
    sendFailed: "Failed to send side chat message.",
    noContext: "No context selected",
    continuing: "Continue in this side chat",
    selectionCrossesMessages:
      "Selection spans multiple messages. Select text within a single reply to quote it.",
  },

  // Channels
  channels: {
    title: "Channels",
    connect: "Connect",
    modify: "Modify",
    reconnect: "Reconnect",
    disconnect: "Disconnect",
    connected: "Connected",
    notConnected: "Not connected",
    pending: "Pending",
    revoked: "Disconnected",
    disabled: "Disabled",
    unconfigured: "Not configured",
    unavailable: "Channel connections are unavailable right now.",
    unavailableShort: "Unavailable",
    setupTitle: (name: string) => `Connect ${name}`,
    setupEditTitle: (name: string) => `Modify ${name}`,
    setupDescription:
      "Enter the values needed by this server process. They are not written to config.yaml.",
    saveAndConnect: "Save and connect",
    saveChanges: "Save changes",
    descriptions: {
      telegram: "Telegram direct messages through your DeerFlow bot.",
      slack: "Slack workspace messages and mentions.",
      discord: "Discord server messages through your DeerFlow bot.",
      feishu: "Feishu and Lark messages through your DeerFlow app.",
      dingtalk: "DingTalk Stream Push messages through your DeerFlow bot.",
      wechat: "WeChat iLink messages through your DeerFlow bot.",
      wecom: "WeCom messages through your DeerFlow AI bot.",
    },
    connectedAs: (name: string) => `Connected as ${name}.`,
  },

  // Page titles (document title)
  pages: {
    appName: "DeerFlow",
    chats: "Chats",
    newChat: "New chat",
    untitled: "Untitled",
  },

  // Tool calls
  toolCalls: {
    moreSteps: (count: number) => `${count} more step${count === 1 ? "" : "s"}`,
    lessSteps: "Less steps",
    executeCommand: "Execute command",
    presentFiles: "Present files",
    needYourHelp: "Need your help",
    useTool: (toolName: string) => `Use "${toolName}" tool`,
    searchFor: (query: string) => `Search for "${query}"`,
    searchForRelatedInfo: "Search for related information",
    searchForRelatedImages: "Search for related images",
    searchForRelatedImagesFor: (query: string) =>
      `Search for related images for "${query}"`,
    searchOnWebFor: (query: string) => `Search on the web for "${query}"`,
    viewWebPage: "View web page",
    listFolder: "List folder",
    readFile: "Read file",
    writeFile: "Write file",
    clickToViewContent: "Click to view file content",
    writeTodos: "Update to-do list",
    skillInstallTooltip: "Install skill and make it available to DeerFlow",
    browserNavigate: (url: string) => `Open ${url} in browser`,
    browserNavigateGeneric: "Open page in browser",
    browserClick: "Click element in browser",
    browserType: "Type into browser field",
    browserSnapshot: "Read page in browser",
    browserGetText: "Read page text in browser",
    browserBack: "Go back in browser",
    browserScreenshot: "Capture browser screenshot",
    browserClose: "Close browser",
  },

  humanInput: {
    answered: "Answered",
    pending: "Sending...",
    readOnly: "Read only",
    otherLabel: "Other answer",
    otherPlaceholder: "Type another answer...",
    submit: "Submit",
    emptyError: "Enter an answer before submitting.",
    requiredError: "Fill in all required fields before submitting.",
    requiredA11yLabel: "required",
    selectPlaceholder: "Select...",
    answeredValue: (value: string) => `Answered: ${value}`,
  },

  // Subtasks
  uploads: {
    uploading: "Uploading...",
    uploadingFiles: "Uploading files, please wait...",
    limitsHint: (maxFiles: number, maxFileSize: string, maxTotalSize: string) =>
      `Add attachments (up to ${maxFiles} files, ${maxFileSize} each, ${maxTotalSize} total). Most regular file types are supported; compress macOS .app bundles first.`,
    filesTooLarge: (files: string, maxFileSize: string) =>
      `Files exceeding the ${maxFileSize} per-file limit were not added: ${files}.`,
    tooManyFiles: (count: number, maxFiles: number) =>
      `${count} file${count === 1 ? " was" : "s were"} not added. You can attach up to ${maxFiles} files at once.`,
    totalSizeTooLarge: (count: number, maxTotalSize: string) =>
      `${count} file${count === 1 ? " was" : "s were"} not added. Attachments can total up to ${maxTotalSize}.`,
  },

  subtasks: {
    subtask: "Subtask",
    executing: (count: number) =>
      `Executing ${count === 1 ? "" : count + " "}subtask${count === 1 ? "" : "s in parallel"}`,
    in_progress: "Running subtask",
    completed: "Subtask completed",
    failed: "Subtask failed",
  },

  // Token Usage
  tokenUsage: {
    title: "Token Usage",
    label: "Tokens",
    input: "Input",
    output: "Output",
    total: "Total",
    view: "Display",
    unavailable:
      "No token usage yet. Usage appears only after a successful model response when the provider returns usage_metadata.",
    unavailableShort: "No usage returned",
    collecting: "Collecting tokens",
    note: "Header totals use persisted thread usage, plus visible in-flight usage while a run is still streaming. Per-turn and debug usage come from currently visible messages only. Totals may differ from provider billing pages.",
    presets: {
      off: "Off",
      summary: "Summary",
      perTurn: "Per turn",
      debug: "Debug",
    },
    presetDescriptions: {
      off: "Hide token usage in the header and conversation.",
      summary: "Show only the current conversation total in the header.",
      perTurn:
        "Show the header total and one token summary per assistant turn.",
      debug: "Show the header total and step-level token debugging details.",
    },
    finalAnswer: "Final answer",
    stepTotal: "Step total",
    sharedAttribution: "Shared across multiple actions in this step",
    subagent: (description: string) => `Subagent: ${description}`,
    startTodo: (content: string) => `Start To-do: ${content}`,
    completeTodo: (content: string) => `Complete To-do: ${content}`,
    updateTodo: (content: string) => `Update To-do: ${content}`,
    removeTodo: (content: string) => `Remove To-do: ${content}`,
  },

  contextUsage: {
    label: "Context",
    title: "Context window",
    badgeAriaLabel: (percentage: string) =>
      `Context window ${percentage}% full`,
  },

  // Shortcuts
  shortcuts: {
    searchActions: "Search actions...",
    noResults: "No results found.",
    actions: "Actions",
    keyboardShortcuts: "Keyboard Shortcuts",
    keyboardShortcutsDescription:
      "Navigate DeerFlow faster with keyboard shortcuts.",
    openCommandPalette: "Open Command Palette",
    toggleSidebar: "Toggle Sidebar",
  },

  // Settings
  settings: {
    title: "Settings",
    description: "Adjust how DeerFlow looks and behaves for you.",
    sections: {
      account: "Account",
      appearance: "Appearance",
      channels: "Channels",
      integrations: "Integrations",
      models: "Models",
      memory: "Memory",
      tools: "Tools",
      skills: "Skills",
      notification: "Notification",
      pet: "Pet",
      about: "About",
    },
    memory: {
      title: "Memory",
      description:
        "DeerFlow automatically learns from your conversations in the background. These memories help DeerFlow understand you better and deliver a more personalized experience.",
      empty: "No memory data to display.",
      rawJson: "Raw JSON",
      exportButton: "Export memory",
      exportSuccess: "Memory exported",
      importButton: "Import memory",
      importConfirmTitle: "Import memory?",
      importConfirmDescription:
        "This will overwrite your current memory with the selected JSON backup.",
      importFileLabel: "Selected file",
      importInvalidFile:
        "Failed to read the selected memory file. Please choose a valid JSON export.",
      importSuccess: "Memory imported",
      manualFactSource: "Manual",
      addFact: "Add fact",
      addFactTitle: "Add memory fact",
      editFactTitle: "Edit memory fact",
      addFactSuccess: "Fact created",
      editFactSuccess: "Fact updated",
      clearAll: "Clear all memory",
      clearAllConfirmTitle: "Clear all memory?",
      clearAllConfirmDescription:
        "This will remove all saved summaries and facts. This action cannot be undone.",
      clearAllSuccess: "All memory cleared",
      factDeleteConfirmTitle: "Delete this fact?",
      factDeleteConfirmDescription:
        "This fact will be removed from memory immediately. This action cannot be undone.",
      factDeleteSuccess: "Fact deleted",
      factContentLabel: "Content",
      factCategoryLabel: "Category",
      factConfidenceLabel: "Confidence",
      factContentPlaceholder: "Describe the memory fact you want to save",
      factCategoryPlaceholder: "context",
      factConfidenceHint: "Use a number between 0 and 1.",
      factSave: "Save fact",
      factValidationContent: "Fact content cannot be empty.",
      factValidationConfidence: "Confidence must be a number between 0 and 1.",
      noFacts: "No saved facts yet.",
      summaryReadOnly:
        "Summary sections are read-only for now. You can currently add, edit, or delete individual facts, or clear all memory.",
      memoryFullyEmpty: "No memory saved yet.",
      factPreviewLabel: "Fact to delete",
      searchPlaceholder: "Search memory",
      filterAll: "All",
      filterFacts: "Facts",
      filterSummaries: "Summaries",
      noMatches: "No matching memory found.",
      markdown: {
        overview: "Overview",
        userContext: "User context",
        work: "Work",
        personal: "Personal",
        topOfMind: "Top of mind",
        historyBackground: "History",
        recentMonths: "Recent months",
        earlierContext: "Earlier context",
        longTermBackground: "Long-term background",
        updatedAt: "Updated at",
        facts: "Facts",
        empty: "(empty)",
        table: {
          category: "Category",
          confidence: "Confidence",
          confidenceLevel: {
            veryHigh: "Very high",
            high: "High",
            normal: "Normal",
            unknown: "Unknown",
          },
          content: "Content",
          source: "Source",
          createdAt: "CreatedAt",
          view: "View",
        },
      },
    },
    appearance: {
      themeTitle: "Theme",
      themeDescription:
        "Choose how the interface follows your device or stays fixed.",
      system: "System",
      light: "Light",
      dark: "Dark",
      systemDescription: "Match the operating system preference automatically.",
      lightDescription: "Bright palette with higher contrast for daytime.",
      darkDescription: "Dim palette that reduces glare for focus.",
      languageTitle: "Language",
      languageDescription: "Switch between languages.",
    },
    tools: {
      title: "Tools",
      description: "Manage the configuration and enabled status of MCP tools.",
      adminRequired: "Admin privileges are required to manage MCP tools.",
      empty: "No MCP tools configured.",
    },
    models: {
      title: "Models",
      description:
        "Add or edit the model providers and API keys used for chat. Models from config.yaml are read-only here.",
      adminRequired: "Admin privileges are required to manage models.",
      empty: "No models configured yet.",
      add: "Add models",
      addTitle: "Add models",
      addSubmit: "Add",
      edit: "Edit",
      editTitle: "Edit model",
      delete: "Delete",
      sourceConfigFile: "config.yaml · read-only",
      sourceUi: "UI · editable",
      provider: "Provider",
      providerGroupGeneric: "Generic protocol",
      providerGroupVendor: "Vendors",
      providerOpenaiCompatible: "OpenAI-compatible",
      providerAnthropic: "Anthropic",
      providerDeepseek: "DeepSeek",
      customProvider: "Custom",
      apiType: "API type",
      apiTypeChat: "Chat Completions API",
      apiTypeResponses: "Responses API",
      thinkingShape: "Thinking switch format",
      thinkingShapeNone: "Not set",
      thinkingShapeGateway: "extra_body.thinking (OpenAI-compatible)",
      thinkingShapeVllm: "chat_template_kwargs (vLLM / SGLang)",
      endpoint: "Endpoint",
      apiKey: "API key",
      apiKeyPlaceholder: "Enter API key",
      apiKeyToggle: "Toggle API key visibility",
      defaultHeaders: "Request headers",
      headerNamePlaceholder: "Header name",
      headerValuePlaceholder: "Header value",
      addHeader: "Add header",
      removeHeader: "Remove",
      modelIds: "Model IDs",
      modelIdPlaceholder: "Enter the model ID",
      addModelId: "Add Model ID",
      removeModelId: "Remove",
      displayName: "Display name",
      thinking: "Thinking",
      vision: "Vision",
      maxTokens: "Max output tokens",
      saved: "Model configuration saved",
      deleted: "Model deleted",
      validationNoModelId: "Enter at least one Model ID",
      identityHint:
        "Provider, model and name are identity fields and cannot be changed after creation. Delete and re-add to switch.",
      next: "Next",
      back: "Back",
      validating: "Checking credentials...",
      validateFailed: "Could not validate the credentials:",
      validationEndpointRequired: "Enter the endpoint URL",
      validationApiKeyRequired: "Enter the API key",
      supportedWindows: "Context windows",
      subsetSelected: (count) => `${count} selected`,
      defaultWindow: "Default context window",
      capabilities: "Capabilities",
      supportedEfforts: "Reasoning effort levels",
      defaultEffort: "Default effort",
      suggested: "Suggested values — adjust as needed",
      window200k: "200K",
      window400k: "400K",
      window1m: "1M",
      viewChatModels: "Chat models",
      viewFunctionalModels: "Functional models",
      viewSwitchLabel: "Model configuration view",
    },
    functionalModels: {
      description:
        "Models the knowledge base uses for parsing, retrieval and profiling. They are configured separately from the chat models.",
      extractModel: "Graph extraction model",
      groupRetrieval: "Retrieval",
      groupRetrievalHint:
        "Used at retrieval time: the embedding model and the rerank model.",
      retrievalEndpointHint:
        "Required. Any of the three forms is accepted: the host (https://host), a base ending in /v1 (https://host/v1), or the full endpoint (https://host/v1/embeddings); a segment already covered by the leg's fixed path is never joined twice.",
      embeddingProvider: "Embedding provider",
      rerankProvider: "Rerank provider",
      providerDashscope: "Aliyun Bailian (DashScope)",
      providerVolcengineArk: "Volcengine Ark",
      providerOpenAIChat: "OpenAI-compatible",
      providerGenericRerank: "Generic rerank (Cohere / Jina shape)",
      providerTeiRerank: "TEI rerank",
      providerMineruCloud: "MinerU cloud API",
      providerMineruLocal: "Local MinerU service",
      embeddingBaseUrl: "Embedding endpoint",
      rerankBaseUrl: "Rerank endpoint",
      embeddingSparseSource: "Sparse vector source",
      sparseSourceProvider: "Follow the embedding model",
      sparseSourceExternal: "A separate sparse service",
      sparseSourceBm25: "Local BM25",
      sparseModelHint:
        "The value is stored in the configuration but is never sent with a request: a TEI instance serves one model, so the request carries no model field.",
      sparseSourceHint:
        "A Bailian embedding model returns both the dense and the sparse half in one call. After switching to a dense-only provider, set this to the separate sparse service or local BM25, or the configuration cannot be enabled.",
      sparseProbeHint:
        "Selecting “Follow the embedding model” makes one real embedding call (read-only, nothing is saved) to confirm the model actually returns the sparse half.",
      sparseProbing: "Checking…",
      sparseUnverified: "Unverified",
      sparseServiceUnreachable: "unreachable",
      sparseServiceEmpty: "no terms returned",
      dimensionLabel: "Dimension",
      dimensionHint:
        "This field sets the vector library's width (blank means 1024). Changing it triggers a full rebuild, and both sides of the change must use the same model.",
      dimensionProbeHint:
        "Editing the provider / model / endpoint probes the widths the model supports; no manual step is needed.",
      dimensionProbing: "Probing…",
      dimensionUnprobed: "Unknown",
      dimensionNativeHint: (width) => `This model is natively ${width} wide; any value up to it is accepted.`,
      dimensionNoTiers: "No common tier was detected. Enter a value manually; saving verifies it for real.",
      dimensionFixedHint: (width) => `This model ignores the dimension parameter; it is fixed at ${width} wide.`,
      dimensionTierHint: "Detected tiers:",
      dimensionConfirmTitle: "Changing the width rebuilds every library?",
      dimensionConfirmDescription:
        "The new width takes effect through a rebuild: every library's vectors are regenerated while search keeps using the old ones. The switch happens only after all of it is complete; a failure leaves everything unchanged.",
      dimensionConfirmAction: "Start migration",
      migrationRunning: "Migrating the width",
      migrationSucceeded: "The width migration finished; the new width is in force.",
      migrationFailed: "The width migration failed; the width is unchanged:",
      migrationCannotStart: "The width migration needs the knowledge service online. Try again in a moment.",
      legDotUntested: "Not tested yet. Click the heading to run a connectivity check.",
      legDotProbing: "Testing…",
      legDotOk: "Reachable",
      legDotUnreachable: "Unreachable",
      legDotDimension: "Requested width unavailable",
      legDotNeedsConfig: "Fill in provider / model / endpoint / key first",
      sparseProviderDenseOnly: "this embedding model emits dense vectors only",
      sparseProviderNone: "(not chosen)",
      parseProvider: "Parsing provider",
      parseBaseUrl: "Service address",
      parseBaseUrlHint:
        "Empty means the official https://mineru.net for the cloud API; the local MinerU service needs it — that service ships without auth, so keep it internal.",
      parseTier: "Parsing tier",
      parseTierAuto: "(let the service decide)",
      parseTierHint:
        "Tiers are defined by the MinerU service: flash / basic are light, while standard / advanced need torch installed on the service; empty means the service decides (its own default is standard).",
      parseLanguage: "Document language",
      parseLanguageHint:
        "The MinerU cloud API's document language pack; ch covers Chinese and English.",
      parseLanguageDefault: "(use the configured default)",
      parseModelVersion: "Model version",
      parseModelVersionHint:
        "The MinerU cloud API's model version; this deployment sends vlm by default.",
      parseModelVersionDefault: "(use the configured default)",
      groupExtraction: "Graph extraction",
      groupEvaluation: "Evaluation judge",
      groupEvaluationHint:
        "Evaluates retrieval quality with ragas, independently of the chat model in use. Leaving it empty withdraws this row's override, so a value set for it in the configuration still applies; only when neither is set does the RAG default model take over.",
      judgeModel: "Judge model",
      judgeModelNone: "(use the configured default)",
      synthesisModel: "Question synthesis model",
      synthesisModelHint:
        "Synthesizes candidate evaluation questions from documents. Leaving it empty withdraws this row's override, so a value set for it in the configuration still applies; only when neither is set does the RAG default model take over.",
      synthesisModelNone: "(use the configured default)",
      groupMultimodal: "Multimodal & video",
      groupMultimodalHint:
        "Image captioning turns images and keyframes into text; speech recognition serves video ingestion only.",
      groupServices: "Services & tokens",
      groupServicesHint: "Only change these when Qdrant or MinerU is not at its default location.",
      vlmNoVisionModel: "No configured model declares vision support — add a vision-capable model under Chat models first.",
      extractModelHint:
        "Builds the knowledge graph from documents. Prefer a model with a small parameter count, low cost and stable JSON output. Leaving it empty withdraws this row's override, so a value set for it in the configuration still applies; only when neither is set does the RAG default model take over.",
      extractModelNone: "(use the configured default)",
      wikiModel: "Wiki generation model",
      wikiModelHint:
        "Writes the knowledge-base wiki entries. Leaving it empty withdraws this row's override, so a value set for it in the configuration still applies; only when neither is set does the RAG default model take over.",
      wikiModelNone: "(use the configured default)",
      captionModel: "Caption model (VLM)",
      captionModelHint:
        "The endpoint and API key come from the selected model entry; leaving it empty withdraws this row's override, so a value set for it in the configuration still applies, and only when neither is set does the RAG default model take over. Only vision-capable entries are listed — an Anthropic entry is called over its Messages protocol, and every other entry over the OpenAI-compatible protocol.",
      vlmModelDefault: "(use the configured default)",
      thinkingMenuLabel: "Thinking · follows chat",
      thinkingMenuState: (count: number) =>
        count > 0
          ? `Thinking · follows chat (${count} selected)`
          : "Thinking · follows chat (click to enable)",
      defaultModel: "RAG default model",
      defaultModelNone: "(config default)",
      defaultModelHint:
        "Used when graph extraction, evaluation judging, image captioning or video captioning has no separate model selection. It does not affect chat models or other features. Leave this unset to inherit the configured RAG default, or the first model in the list if none is configured.",
      embeddingModel: "Embedding model",
      embeddingApiKey: "API key (embedding)",
      embeddingChangeWarning:
        "Changing the embedding model, provider, endpoint or sparse source requires re-indexing the knowledge bases already ingested with the previous one, or their retrieval quality will degrade.",
      sparseServiceUnconfigured:
        "A separate sparse service needs its provider chosen (TEI sparse service) — without one this configuration cannot be enabled.",
      sparseProviderUnsupported:
        "The selected embedding model cannot supply the sparse half. Set the sparse source to a separate sparse service or local BM25.",
      rerankModel: "Rerank model",
      rerankApiKey: "API key (rerank)",
      asrModelRow: "Speech recognition model",
      asrProvider: "Speech recognition (ASR)",
      asrProviderFunasr: "funasr (local)",
      asrProviderWhisper: "whisper (local)",
      asrProviderOpenaiAudio: "openai-audio (generic protocol)",
      asrProviderDashscope: "dashscope (Bailian)",
      asrGroupLocal: "Local engines",
      asrGroupProtocol: "Generic protocol",
      asrGroupNative: "Native protocol",
      asrModel: "ASR model",
      asrModelCandidates: "Common models:",
      asrModelFunasrHint:
        "A ModelScope model id, or a local directory. Sentence timestamps: paraformer-zh provides them, paraformer-en is unverified; speech is split per VAD segment across the shot cards, and continuous speech may still land on a single one.",
      asrModelWhisperHint:
        "Built-in tiers — larger is more accurate and slower; small is the common choice. Any valid name also works (large-v2, turbo, or a local .pt file).",
      asrModelServiceHint:
        "The model name the service itself uses (e.g. qwen-audio-3.1-asr-flash); the candidate menu is available for the local engines only.",
      asrApiKey: "ASR API key",
      asrBaseUrl: "ASR endpoint",
      asrProbe: "Check segment timestamps",
      asrProbeBlocksSave:
        "This service gave no usable segment timestamps: pick another service, or switch back to a local engine.",
      services: "Services & tokens",
      qdrantUrl: "Qdrant URL",
      mineruToken: "MinerU parsing token",
      secretHint:
        "Leaving it blank stops the override and falls back to the environment variable.",
      secretFromEnv: "Currently provided by an environment variable.",
      saved: "Functional model configuration saved",
      noChanges: "No changes to save",
      reindexTitle: "Rebuild index",
      reindexHint:
        "Changing the embedding provider or the dimension invalidates every stored vector — re-embed them from this entry: chunks, entities, wiki entries and manual cards are regenerated together. Only the library's existing text is read: source files are not re-parsed, and graph extraction is not re-run.",
      reindexKbLabel: "Target library",
      reindexKbPlaceholder: "Choose a library",
      reindexNoKb: "No library to rebuild yet.",
      reindexAction: "Rebuild index",
      reindexRunning: "Rebuilding",
      reindexChunksWritten: "vectors written",
      reindexLastSucceeded: "Last rebuild finished.",
      reindexLastFailed: "Last rebuild failed — see the server logs.",
      reindexEnqueued: "Rebuild started",
      reindexAlreadyRunning: "A rebuild is already running",
      reindexConfirmTitle: "Rebuild the index?",
      reindexConfirmDescription:
        "Every vector in this library will be re-embedded — chunks, entities, wiki entries and manual cards (source files are not re-parsed) — and retrieval may be unstable while it runs. Target library:",
      reindexConfirmAction: "Start rebuild",
      providerLabel: "Provider",
      modelLabel: "Model ID",
      endpointLabel: "Endpoint",
      apiKeyLabel: "API key",
      advancedSettings: (count) => `Advanced settings (${count})`,
      endpointRequired: "Enter the endpoint address",
      lockedCloudOnly: "Cloud API only",
      lockedServiceOnly: "Service tiers only",
      lockedLocalOnly: "Local service only",
      lockedExternalOnly: "Only when using a separate sparse service",
      secretFromEnvBadge: "From env",
      providerTeiSparse: "TEI sparse service",
      sparseProvider: "Sparse provider",
      sparseBaseUrl: "Sparse service endpoint",
      sparseModel: "Sparse model",
      sparseApiKey: "Sparse API key",
    },
    channels: {
      title: "Channels",
      description:
        "Connect IM accounts that can send messages to DeerFlow from outside the browser.",
      disabled:
        "Channel connections are not enabled on this server. Ask an administrator to enable channel_connections.",
    },
    integrations: {
      title: "Integrations",
      description:
        "Connect third-party tools and work platforms so agents can use them directly.",
      refresh: "Refresh",
      install: "Install",
      reinstall: "Reinstall",
      installing: "Installing...",
      ready: "Ready",
      pending: "Pending",
      available: "Available",
      unavailable: "Unavailable",
      connected: "Connected",
      loadFailed: "Failed to load integration status",
      adminRequired: "Admin privileges are required to install integrations.",
      lark: {
        title: "Lark / Feishu CLI",
        description:
          "Install the official Lark/Feishu agent skills and let agents use Lark after authorization.",
        skillPack: "Skill pack",
        gatewayCli: "Gateway CLI",
        auth: "Auth",
        sandboxRuntime: "Sandbox runtime",
        sandboxRuntimeInitContainer: "Provisioned by init container",
        sandboxRuntimeBroker: "Provisioned by broker sidecar",
        sandboxRuntimeGatewayDownload: "Provisioned by Gateway",
        sandboxRuntimeNotReady:
          "Not ready — lark-cli may be missing at chat time",
        notInstalled: "Not installed",
        skillsInstalled: (installed, expected) =>
          `${installed}/${expected} skills installed`,
        installedVersion: (version) => `Installed: ${version}`,
        updateAvailable: (version) =>
          `Update available: ${version} — admin reinstall updates the managed Gateway CLI and skill pack`,
        runtimeVersionMismatch:
          "Skill pack version differs from the Gateway runtime lark-cli; admin reinstall attempts to update the managed Gateway CLI and realign the skill pack",
        authNotConfigured: "Not connected",
        authConfigured: "Credentials configured (not live-verified)",
        authConfiguredFor: (user) =>
          `${user} · credentials configured (not live-verified)`,
        connect: "Connect Lark",
        authStarting: "Opening connection link...",
        checkingConnection: "Checking connection...",
        connectedAction: "Reconnect Lark",
        requestPermissions: "Request permissions",
        alreadyConnected:
          "Lark is already connected. If authorization expires, refresh the status and reconnect.",
        connectionStarted: "Connection link opened",
        connectionReady: "Connection is ready. Opening authorization...",
        authStarted:
          "Authorization page opened. DeerFlow will detect completion automatically.",
        authorizationStillPending:
          'Authorization is not complete yet. Finish it in the browser; DeerFlow keeps checking automatically. You can click "I completed authorization" if the page does not update.',
        permissionTitle: "Authorization scope",
        permissionDescription:
          "By default, DeerFlow only completes the base sign-in and does not request any business permissions. Select the domains you need here; connected users can re-authorize to add more (scopes accumulate).",
        authDomains: {
          calendar: {
            label: "Calendar",
            description:
              "Events, free/busy, RSVP, and meeting-room scheduling.",
          },
          im: {
            label: "Messenger",
            description:
              "Send/reply messages, manage group chats, search history, download media.",
          },
          docs: {
            label: "Docs",
            description: "Create, read, update, and search documents.",
          },
          drive: {
            label: "Drive",
            description:
              "Upload/download files, search docs & wiki, manage comments.",
          },
          sheets: {
            label: "Sheets",
            description: "Read, write, append, find, and export spreadsheets.",
          },
          base: {
            label: "Base",
            description:
              "Bitable tables, fields, records, views, dashboards, and workflows.",
          },
          wiki: {
            label: "Wiki",
            description: "Knowledge spaces, nodes, and wiki documents.",
          },
          task: {
            label: "Tasks",
            description:
              "Tasks, task lists, subtasks, comments, and reminders.",
          },
          mail: {
            label: "Mail",
            description:
              "Browse, search, read, send, reply, forward, and manage drafts.",
          },
          vc: {
            label: "Meetings",
            description: "Meeting records, minutes artifacts, and recordings.",
          },
          minutes: {
            label: "Minutes",
            description: "Meeting minutes content and transcripts.",
          },
          note: {
            label: "Notes",
            description: "Meeting notes and related content.",
          },
          slides: {
            label: "Slides",
            description: "Presentations and slide content.",
          },
          markdown: {
            label: "Markdown",
            description:
              "Create, fetch, patch, and overwrite Drive-native .md files.",
          },
          mindnotes: {
            label: "Mind notes",
            description: "Mind notes content.",
          },
          contact: {
            label: "Contacts",
            description: "Look up users by name/email/phone and read profiles.",
          },
          approval: {
            label: "Approval",
            description:
              "Query and act on approval tasks; cancel and CC instances.",
          },
          attendance: {
            label: "Attendance",
            description: "Query personal attendance check-in records.",
          },
          okr: {
            label: "OKR",
            description:
              "Objectives, key results, alignments, indicators, and progress.",
          },
          event: {
            label: "Events",
            description: "Subscribe to and consume real-time platform events.",
          },
          apps: {
            label: "Apps",
            description:
              "Create Spark/Miaoda apps, publish sites, and manage access scope.",
          },
          all: {
            label: "All",
            description:
              "Request every business domain supported by lark-cli. Use this only when the missing permission is unclear.",
          },
        },
        customScopeLabel: "Exact OAuth scope",
        customScopePlaceholder: "For example calendar:calendar.event:read",
        customScopeDescription:
          "Advanced: if an error reports a missing scope, paste it here. Examples: calendar:calendar.event:read, calendar:calendar.free_busy:read.",
        openConnectionLinkTitle: "Continue connecting Lark",
        openConnectionLinkDescription:
          "The first connection needs one browser confirmation from Lark. Open the link below and finish the prompt, then return here to continue authorization.",
        openAuthLinkTitle: "Authorize Lark in your browser",
        openAuthLinkDescription:
          "Open the link below to authorize. DeerFlow keeps checking automatically and will save the connection after approval.",
        waitingAuthTitle: "Waiting for Lark authorization",
        waitingAuthDescription:
          "Finish authorization in the browser page that just opened. DeerFlow will update this panel automatically; the button below is only a fallback.",
        openAuthLink: "Open link",
        copyAuthLink: "Copy link",
        completeAuth: "I completed authorization",
        continueAuth: "I completed browser confirmation, continue",
        preparingAuthorization: "Preparing authorization...",
        completingAuth: "Checking...",
        authExpiresIn: (seconds) =>
          `This link expires in about ${seconds} seconds.`,
        installingTitle: "Installing official skill pack",
        installingDescription:
          "This usually finishes within 30 seconds; slower networks may take about 1 minute. The status refreshes automatically when installation completes.",
        installNextTitle: "Install the official skill pack first",
        installNextDescription:
          "After installation, /lark-doc, /lark-im, /lark-sheets and related skills appear in the skill index.",
        cliNextTitle: "Install Gateway CLI",
        cliNextDescription:
          "The skill pack is installed, but the Gateway cannot find lark-cli. Admin reinstall attempts to download the managed Gateway CLI; offline deployments can use an image with @larksuite/cli built in.",
        configuredTitle: "Lark credentials are configured locally",
        configuredDescription:
          "Credentials are present, but their current validity has not been checked with Lark. Reconnect to refresh and live-verify authorization.",
        connectedTitle: "Lark authorization is live-verified",
        connectedDescription:
          "The current user's authorization was verified with Lark during this connection flow. Reconnect whenever you need to refresh it or add permissions.",
        authNextTitle: "Complete browser authorization next",
        authNextDescription:
          "Click “Connect Lark”; DeerFlow checks the current status first and opens browser authorization only when disconnected or expired.",
      },
    },
    skills: {
      title: "Agent Skills",
      description:
        "Manage the configuration and enabled status of the agent skills.",
      createSkill: "Create skill",
      emptyTitle: "No agent skill yet",
      emptyDescription:
        "Put your agent skill folders under the `/skills/custom` folder under the root folder of DeerFlow.",
      emptyButton: "Create Your First Skill",
      adminRequired: "Admin privileges are required to manage agent skills.",
      installAdminRequired:
        "Admin privileges are required to install agent skills.",
    },
    notification: {
      title: "Notification",
      description:
        "DeerFlow only sends a completion notification when the window is not active. This is especially useful for long-running tasks so you can switch to other work and get notified when done.",
      requestPermission: "Request notification permission",
      deniedHint:
        "Notification permission was denied. You can enable it in your browser's site settings to receive completion alerts.",
      testButton: "Send test notification",
      testTitle: "DeerFlow",
      testBody: "This is a test notification.",
      notSupported: "Your browser does not support notifications.",
      disableNotification: "Disable notification",
    },
    pet: {
      title: "Pet",
      description:
        "A small companion in the corner of the workspace that mirrors what the current run is doing. It never sends anything and never touches the conversation.",
      dragHint:
        "Hold Alt and drag to move it; Alt+click jumps back to the thread it stands for. A click without Alt passes straight through.",
      resetPosition: "Reset position",
      size: "Size",
      sizeHint:
        "Applied once you let go — resizing mid-drag makes the animation stutter. Past 340px the sheet is scaled up and softens.",
    },
    account: {
      profileTitle: "Profile",
      email: "Email",
      role: "Role",
      ssoProvider: "SSO",
      changePasswordTitle: "Change Password",
      changePasswordDescription: "Update your account password.",
      ssoPasswordDescription: "Password is managed by your SSO provider.",
      ssoPasswordMessage:
        "This account signs in with {provider}, so DeerFlow cannot manage or change its password here. Use your SSO provider's account settings instead.",
      currentPassword: "Current password",
      newPassword: "New password",
      confirmNewPassword: "Confirm new password",
      passwordMismatch: "New passwords do not match",
      passwordTooShort: "Password must be at least 8 characters",
      passwordChangedSuccess: "Password changed successfully",
      networkError: "Network error. Please try again.",
      updating: "Updating...",
      updatePassword: "Update Password",
      signOut: "Sign Out",
    },
    acknowledge: {
      emptyTitle: "Acknowledgements",
      emptyDescription: "Credits and acknowledgements will show here.",
    },
  },
  login: {
    signInTitle: "Sign in to your account",
    createAccountTitle: "Create a new account",
    email: "Email",
    emailPlaceholder: "you@example.com",
    password: "Password",
    passwordPlaceholder: "•••••••",
    rememberMe: "Keep me signed in",
    rememberMeDescription:
      "Keep this browser session when possible. DeerFlow stores only your email, never your password.",
    pleaseWait: "Please wait...",
    signIn: "Sign In",
    createAccount: "Create Account",
    createAdminAccount: "Create admin account",
    adminSetupRequiredTitle: "Administrator setup is required",
    adminSetupRequiredDescription:
      "DeerFlow needs an administrator account before new regular accounts can be created.",
    orContinueWith: "Or continue with",
    ssoHint:
      "If your account uses single sign-on, sign in with the option below instead.",
    continueWith: (provider: string) => `Continue with ${provider}`,
    noAccountSignUp: "Don't have an account? Sign up",
    haveAccountSignIn: "Already have an account? Sign in",
    backToHome: "← Back to home",
    networkError: "Network error. Please try again.",
    serviceUnavailableTitle: "Service temporarily unavailable",
    serviceUnavailableDescription:
      "The Gateway is taking too long to respond. Check that it is running, then try again.",
    retry: "Try again",
    authFailed: "Authentication failed.",
    errors: {
      sso_failed: "SSO login failed. Please try again or use email login.",
      sso_cancelled: "SSO login was cancelled.",
      sso_account_exists:
        "An account with this email already exists. Please sign in with your password or contact your administrator.",
      sso_not_allowed:
        "SSO login is not allowed for your account. Contact your administrator.",
    },
  },
};
