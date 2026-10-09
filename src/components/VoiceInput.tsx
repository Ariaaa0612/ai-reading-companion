"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { MicIcon, SquareIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 语音输入组件
 * 使用 Web Speech API 将语音转为文字，实时追加到输入框中。
 * 支持 interimResults（中间结果实时输出），onend 自动重启。
 */

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function VoiceInput({ onTranscript, disabled }: VoiceInputProps) {
  const [isListening, setIsListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const recognitionRef = useRef<any>(null);
  const shouldListenRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);

  // 保持 callback ref 最新
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const SpeechRecognitionClass =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      setSupported(false);
      return;
    }

    const recognition = new SpeechRecognitionClass();
    recognition.lang = "zh-CN";
    recognition.continuous = true;
    recognition.interimResults = true; // 实时输出中间结果

    recognition.onresult = (event: any) => {
      let interimText = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalText += transcript;
        } else {
          interimText += transcript;
        }
      }
      // 实时输出中间结果（让用户看到正在识别的文字）
      if (interimText) {
        onTranscriptRef.current(interimText);
      }
      // 最终结果也输出
      if (finalText) {
        onTranscriptRef.current(finalText);
      }
    };

    recognition.onerror = (event: any) => {
      console.warn("语音识别错误:", event.error);
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        shouldListenRef.current = false;
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      // 如果用户还在 listening 状态但识别引擎自己停了，自动重启
      if (shouldListenRef.current) {
        try {
          recognition.start();
        } catch {
          // 重启失败，停止
          setIsListening(false);
          shouldListenRef.current = false;
        }
      } else {
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      shouldListenRef.current = false;
      try {
        recognition.abort();
      } catch {
        // ignore
      }
    };
  }, []);

  const toggleListening = useCallback(() => {
    if (!recognitionRef.current || disabled) return;

    if (isListening) {
      shouldListenRef.current = false;
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      setIsListening(false);
    } else {
      shouldListenRef.current = true;
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e) {
        console.warn("启动语音识别失败:", e);
        // 可能是上次还没完全停止，等一下再试
        setTimeout(() => {
          try {
            recognitionRef.current?.start();
            setIsListening(true);
          } catch {
            shouldListenRef.current = false;
          }
        }, 300);
      }
    }
  }, [isListening, disabled]);

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={toggleListening}
      disabled={disabled}
      aria-label={isListening ? "停止语音输入" : "语音输入"}
      className={cn(
        "flex items-center justify-center rounded-full p-2 transition-colors",
        isListening
          ? "bg-red-500 text-white animate-pulse"
          : "bg-muted text-muted-foreground hover:bg-muted/80",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      {isListening ? (
        <SquareIcon className="size-4" />
      ) : (
        <MicIcon className="size-4" />
      )}
    </button>
  );
}

export default VoiceInput;
