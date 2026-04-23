import { useCallback, useRef, useState } from "react";
import { api } from "@/controllers/API/api";
import { getURL } from "@/controllers/API/helpers/constants";

type VoiceInputState = "idle" | "recording" | "transcribing" | "error";

interface UseVoiceInputOptions {
  onTranscript: (text: string) => void;
}

interface UseVoiceInputReturn {
  state: VoiceInputState;
  isSupported: boolean;
  toggle: () => void;
  errorMessage: string | null;
}

function getSupportedMimeType(): string {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

export function useVoiceInput({
  onTranscript,
}: UseVoiceInputOptions): UseVoiceInputReturn {
  const [state, setState] = useState<VoiceInputState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const isSupported =
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;

    // Resolve when recorder fires 'stop'
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  const toggle = useCallback(async () => {
    if (state === "recording") {
      setState("transcribing");
      await stopRecording();

      const chunks = chunksRef.current.splice(0);
      if (chunks.length === 0) {
        setState("idle");
        return;
      }

      const mimeType = getSupportedMimeType();
      const blob = new Blob(chunks, { type: mimeType || "audio/webm" });

      const formData = new FormData();
      formData.append("audio", blob, "recording.webm");

      try {
        const url = getURL("AGENTIC_TRANSCRIBE");
        const resp = await api.post<{ transcript: string }>(url, formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        const text = resp.data.transcript?.trim();
        if (text) onTranscript(text);
        setState("idle");
      } catch (err: unknown) {
        const detail =
          (err as { response?: { data?: { detail?: string } } })?.response?.data
            ?.detail ?? "Ошибка транскрипции";
        setErrorMessage(detail);
        setState("error");
        // Auto-clear error after 4 s
        setTimeout(() => setState("idle"), 4000);
      }
      return;
    }

    if (state === "transcribing") return;

    // Start recording
    setErrorMessage(null);
    chunksRef.current = [];

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setErrorMessage("Доступ к микрофону запрещён");
      setState("error");
      setTimeout(() => setState("idle"), 4000);
      return;
    }

    streamRef.current = stream;
    const mimeType = getSupportedMimeType();
    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined,
    );

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.start(250);
    recorderRef.current = recorder;
    setState("recording");
  }, [state, stopRecording, onTranscript]);

  return { state, isSupported, toggle, errorMessage };
}
