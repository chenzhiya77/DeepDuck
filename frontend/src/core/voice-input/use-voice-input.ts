"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useI18n } from "@/core/i18n/hooks";

import {
  appendSpeechTranscript,
  getSpeechRecognitionConstructor,
  getSpeechRecognitionLanguage,
  mapSpeechRecognitionError,
  readSpeechRecognitionTranscript,
  shouldRestartSpeechRecognition,
  type BrowserSpeechRecognition,
  type SpeechRecognitionErrorKind,
} from "./speech-recognition";

/**
 * Shared browser speech-dictation state machine (extracted from the home-page
 * InputBox, 2026-10-10 spec D1 甲): continuous recognition, auto-restart with
 * a short delay, honest per-kind error toasts, and the transcript streamed
 * into the host's composer text. The host supplies the text sink (`setInput` /
 * `getInput`) plus optional hooks for its own transient state (`onBeforeStart`)
 * and focus behavior (`onStarted`) — the hook itself owns everything else.
 */
export type VoiceInputOptions = {
  /** Write the live transcript into the composer text. */
  setInput: (value: string) => void;
  /** Current composer text — the base each dictation session appends to. */
  getInput: () => string;
  /** Blocks starting while the composer is unavailable. */
  disabled?: boolean;
  /** Runs before a fresh session starts (host resets unrelated transient state). */
  onBeforeStart?: () => void;
  /** Runs after recognition.start() succeeded (host focuses its input). */
  onStarted?: () => void;
};

const VOICE_RESTART_DELAY_MS = 150;

export function useVoiceInput(options: VoiceInputOptions) {
  const { t, locale } = useI18n();
  const { disabled = false } = options;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const speechRecognitionConstructor = useMemo(
    () =>
      typeof window === "undefined"
        ? null
        : getSpeechRecognitionConstructor(window),
    [],
  );
  const supported = speechRecognitionConstructor !== null;

  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const baseTextRef = useRef("");
  const latestTextRef = useRef("");
  const lastErrorKindRef = useRef<SpeechRecognitionErrorKind | null>(null);
  const stopRequestedRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<
    ((startOptions?: { focusAfterStart?: boolean }) => boolean) | null
  >(null);

  const [listening, setListening] = useState(false);

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current === null) {
      return;
    }
    clearTimeout(restartTimerRef.current);
    restartTimerRef.current = null;
  }, []);

  const cleanupRecognition = useCallback(
    (
      recognition: BrowserSpeechRecognition | null,
      settings: { keepListening?: boolean } = {},
    ) => {
      clearRestartTimer();
      if (!recognition) {
        if (!settings.keepListening) {
          lastErrorKindRef.current = null;
          stopRequestedRef.current = false;
          setListening(false);
        }
        return;
      }
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
      }
      if (!settings.keepListening) {
        lastErrorKindRef.current = null;
        stopRequestedRef.current = false;
        setListening(false);
      }
    },
    [clearRestartTimer],
  );

  const abortVoiceInput = useCallback(() => {
    const recognition = recognitionRef.current;
    stopRequestedRef.current = true;
    if (!recognition) {
      cleanupRecognition(null);
      return;
    }
    cleanupRecognition(recognition);
    try {
      recognition.abort();
    } catch {
      // Browser implementations can throw when the recognizer already ended.
    }
  }, [cleanupRecognition]);

  const getErrorMessage = useCallback(
    (kind: SpeechRecognitionErrorKind) => {
      switch (kind) {
        case "permission_denied":
          return t.inputBox.voiceInputPermissionDenied;
        case "microphone_unavailable":
          return t.inputBox.voiceInputMicrophoneUnavailable;
        case "unsupported_language":
          return t.inputBox.voiceInputUnsupportedLanguage;
        case "network":
          return t.inputBox.voiceInputNetworkError;
        case "no_speech":
          return t.inputBox.voiceInputNoSpeech;
        case "cancelled":
          return null;
        default:
          return t.inputBox.voiceInputFailed;
      }
    },
    [t],
  );

  const startVoiceRecognition = useCallback(
    (startOptions: { focusAfterStart?: boolean } = {}) => {
      if (optionsRef.current.disabled || !speechRecognitionConstructor) {
        return false;
      }

      const recognition = new speechRecognitionConstructor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = getSpeechRecognitionLanguage(locale);
      recognition.maxAlternatives = 1;
      lastErrorKindRef.current = null;
      latestTextRef.current = baseTextRef.current;
      recognitionRef.current = recognition;

      recognition.onresult = (event) => {
        if (recognitionRef.current !== recognition) {
          return;
        }
        const transcript = readSpeechRecognitionTranscript(event.results).text;
        const nextValue = appendSpeechTranscript(
          baseTextRef.current,
          transcript,
        );
        latestTextRef.current = nextValue;
        optionsRef.current.setInput(nextValue);
      };
      recognition.onerror = (event) => {
        const errorKind = mapSpeechRecognitionError(event.error);
        lastErrorKindRef.current = errorKind;
        if (
          !stopRequestedRef.current &&
          shouldRestartSpeechRecognition(errorKind)
        ) {
          return;
        }

        const message = getErrorMessage(errorKind);
        if (message) {
          toast.error(message);
        }
      };
      recognition.onend = () => {
        const shouldRestart =
          recognitionRef.current === recognition &&
          !stopRequestedRef.current &&
          shouldRestartSpeechRecognition(lastErrorKindRef.current);
        if (shouldRestart) {
          baseTextRef.current = latestTextRef.current;
          cleanupRecognition(recognition, { keepListening: true });
          restartTimerRef.current = setTimeout(() => {
            restartTimerRef.current = null;
            if (stopRequestedRef.current) {
              cleanupRecognition(null);
              return;
            }
            const restarted = startRef.current?.() ?? false;
            if (!restarted) {
              cleanupRecognition(null);
            }
          }, VOICE_RESTART_DELAY_MS);
          return;
        }
        cleanupRecognition(recognition);
      };

      setListening(true);
      try {
        recognition.start();
        if (startOptions.focusAfterStart) {
          requestAnimationFrame(() => {
            optionsRef.current.onStarted?.();
          });
        }
        return true;
      } catch {
        cleanupRecognition(recognition);
        toast.error(t.inputBox.voiceInputFailed);
        return false;
      }
    },
    [
      cleanupRecognition,
      getErrorMessage,
      locale,
      speechRecognitionConstructor,
      t.inputBox.voiceInputFailed,
    ],
  );

  useEffect(() => {
    startRef.current = startVoiceRecognition;
  }, [startVoiceRecognition]);

  const stopVoiceInput = useCallback(() => {
    const recognition = recognitionRef.current;
    stopRequestedRef.current = true;
    if (!recognition) {
      cleanupRecognition(null);
      return;
    }
    try {
      recognition.stop();
    } catch {
      cleanupRecognition(recognition);
    }
  }, [cleanupRecognition]);

  const toggleVoiceInput = useCallback(() => {
    if (listening) {
      stopVoiceInput();
      return;
    }
    if (disabled) {
      return;
    }
    if (!speechRecognitionConstructor) {
      toast.error(t.inputBox.voiceInputUnsupported);
      return;
    }

    optionsRef.current.onBeforeStart?.();
    stopRequestedRef.current = false;
    baseTextRef.current = optionsRef.current.getInput() ?? "";
    latestTextRef.current = baseTextRef.current;
    startVoiceRecognition({ focusAfterStart: true });
  }, [
    disabled,
    listening,
    speechRecognitionConstructor,
    startVoiceRecognition,
    stopVoiceInput,
    t.inputBox.voiceInputUnsupported,
  ]);

  useEffect(() => {
    if (disabled && listening) {
      stopVoiceInput();
    }
  }, [disabled, listening, stopVoiceInput]);

  useEffect(() => {
    return () => abortVoiceInput();
  }, [abortVoiceInput]);

  return {
    supported,
    listening,
    toggle: toggleVoiceInput,
    stop: stopVoiceInput,
    abort: abortVoiceInput,
  };
}
