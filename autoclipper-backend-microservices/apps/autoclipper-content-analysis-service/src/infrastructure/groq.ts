import { open } from "node:fs/promises";
import { z } from "zod";
import type { AnalysisSpec } from "@autoclipper/api-contracts";
import {
  AnalysisError,
  validateTranscript,
  type Transcript,
  type TranscriptionProvider,
} from "../domain/transcript.js";
import { validateSelection } from "../domain/selection.js";
import {
  SELECTION_PROMPT_VERSION,
  SELECTION_SYSTEM_PROMPT,
  selectionPromptRevision,
} from "./selection-prompt.js";
import { boundedText } from "./response.js";

/**
 * Groq (API compatible con OpenAI): Whisper large-v3 para transcribir y Llama 3.3 70B
 * para elegir clips. Se activa con GROQ_API_KEY; sin ella se usa la IA local.
 */
const apiKey = () => process.env["GROQ_API_KEY"] ?? "";
const baseUrl = () => (process.env["GROQ_BASE_URL"] ?? "https://api.groq.com/openai/v1").replace(/\/+$/, "");
export const groqEnabled = () => apiKey().length > 0;

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new AnalysisError("CANCELLED"));
      },
      { once: true },
    );
  });

/** Llama a Groq con reintentos ante límites de uso (429) y errores 5xx temporales. */
async function groqFetch(path: string, init: () => RequestInit, signal: AbortSignal, timeoutMs: number) {
  for (let attempt = 1; ; attempt++) {
    let response: Response;
    // El cuerpo (FormData) se rearma en cada intento: un stream ya enviado no se reutiliza.
    const request = init();
    try {
      response = await fetch(`${baseUrl()}${path}`, {
        ...request,
        headers: {
          authorization: `Bearer ${apiKey()}`,
          ...((request.headers as Record<string, string> | undefined) ?? {}),
        },
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      });
    } catch {
      if (signal.aborted) throw new AnalysisError("CANCELLED");
      if (attempt >= 4) throw new AnalysisError("GROQ_UNAVAILABLE", true);
      await wait(2000 * attempt, signal);
      continue;
    }
    if (response.ok) return response;
    if (response.status === 401 || response.status === 403)
      throw new AnalysisError("GROQ_API_KEY_INVALID");
    if ((response.status === 429 || response.status >= 500) && attempt < 6) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await response.body?.cancel().catch(() => {});
      await wait(
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter, 120) * 1000
          : 3000 * attempt,
        signal,
      );
      continue;
    }
    await response.body?.cancel().catch(() => {});
    throw new AnalysisError(response.status === 429 ? "GROQ_RATE_LIMITED" : "GROQ_REJECTED", true);
  }
}

const transcription = z.object({
  language: z.string().optional(),
  segments: z
    .array(z.object({ start: z.number().finite(), end: z.number().finite(), text: z.string() }))
    .default([]),
});
const languageCodes: Record<string, string> = {
  spanish: "es",
  english: "en",
  portuguese: "pt",
  french: "fr",
  italian: "it",
  german: "de",
};

/** Lee la cabecera WAV (PCM) y ubica el bloque de datos sin cargar el archivo en memoria. */
async function wavLayout(file: Awaited<ReturnType<typeof open>>) {
  const header = Buffer.alloc(12);
  await file.read(header, 0, 12, 0);
  if (header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== "WAVE")
    throw new AnalysisError("INVALID_AUDIO");
  let offset = 12;
  let fmt: Buffer | undefined;
  const { size } = await file.stat();
  while (offset + 8 <= size) {
    const chunk = Buffer.alloc(8);
    await file.read(chunk, 0, 8, offset);
    const id = chunk.toString("ascii", 0, 4);
    const length = chunk.readUInt32LE(4);
    if (id === "fmt ") {
      fmt = Buffer.alloc(length);
      await file.read(fmt, 0, length, offset + 8);
    } else if (id === "data") {
      if (!fmt) throw new AnalysisError("INVALID_AUDIO");
      const channels = fmt.readUInt16LE(2);
      const sampleRate = fmt.readUInt32LE(4);
      const bitsPerSample = fmt.readUInt16LE(14);
      const blockAlign = (channels * bitsPerSample) / 8;
      // ffmpeg en streaming puede dejar el tamaño en 0xFFFFFFFF: usar lo que hay en disco.
      const dataBytes = Math.min(length, size - offset - 8);
      return { channels, sampleRate, bitsPerSample, blockAlign, dataStart: offset + 8, dataBytes };
    }
    offset += 8 + length + (length % 2);
  }
  throw new AnalysisError("INVALID_AUDIO");
}
function wavHeader(layout: Awaited<ReturnType<typeof wavLayout>>, dataBytes: number) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(layout.channels, 22);
  header.writeUInt32LE(layout.sampleRate, 24);
  header.writeUInt32LE(layout.sampleRate * layout.blockAlign, 28);
  header.writeUInt16LE(layout.blockAlign, 32);
  header.writeUInt16LE(layout.bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

export class GroqTranscriber implements TranscriptionProvider {
  readonly name = "groq" as const;
  readonly model = process.env["GROQ_TRANSCRIBE_MODEL"] ?? "whisper-large-v3";
  /** Tramos de 10 min: un WAV 16 kHz mono ocupa ~19 MB, bajo el límite de 25 MB de Groq. */
  readonly chunkSeconds = Number(process.env["GROQ_CHUNK_SECONDS"] ?? 600);
  get revision() {
    return `groq:${this.model}`;
  }
  /** El runtime usa expectedHash como revisión del transcriptor local. */
  get expectedHash() {
    return this.revision;
  }
  async diagnostics() {
    return groqEnabled()
      ? { configured: true, status: "ready" as const, code: null, missingSettings: [] as string[], nextSteps: [] as string[] }
      : {
          configured: false,
          status: "missing_configuration" as const,
          code: "TRANSCRIPTION_NOT_CONFIGURED",
          missingSettings: ["GROQ_API_KEY"],
          nextSteps: ["Ejecuta iniciar-groq.cmd y pega tu API key de Groq (https://console.groq.com/keys)."],
        };
  }
  async configured() {
    return groqEnabled();
  }
  async transcribe(
    path: string,
    durationSeconds: number,
    language: "auto" | "es" | "en",
    signal: AbortSignal,
  ): Promise<Transcript> {
    if (!groqEnabled()) throw new AnalysisError("TRANSCRIPTION_NOT_CONFIGURED");
    const file = await open(path, "r");
    const segments: { startSeconds: number; endSeconds: number; text: string }[] = [];
    let detected: string | undefined;
    try {
      const layout = await wavLayout(file);
      const bytesPerSecond = layout.sampleRate * layout.blockAlign;
      const chunkBytes = Math.floor(this.chunkSeconds * bytesPerSecond / layout.blockAlign) * layout.blockAlign;
      for (let start = 0; start < layout.dataBytes; start += chunkBytes) {
        if (signal.aborted) throw new AnalysisError("CANCELLED");
        const length = Math.min(chunkBytes, layout.dataBytes - start);
        // Un resto de menos de 1 s no aporta texto y Groq rechaza audios tan cortos.
        if (length < bytesPerSecond && start > 0) break;
        const pcm = Buffer.alloc(length);
        await file.read(pcm, 0, length, layout.dataStart + start);
        const audio = Buffer.concat([wavHeader(layout, length), pcm]);
        const offsetSeconds = start / bytesPerSecond;
        const response = await groqFetch(
          "/audio/transcriptions",
          () => {
            const form = new FormData();
            form.append("file", new Blob([audio], { type: "audio/wav" }), "audio.wav");
            form.append("model", this.model);
            form.append("response_format", "verbose_json");
            form.append("temperature", "0");
            if (language !== "auto") form.append("language", language);
            else if (detected) form.append("language", detected);
            return { method: "POST", body: form };
          },
          signal,
          180000,
        );
        let parsed: z.infer<typeof transcription>;
        try {
          parsed = transcription.parse(JSON.parse(await boundedText(response, 16777216)));
        } catch (error) {
          if (error instanceof AnalysisError) throw error;
          throw new AnalysisError("INVALID_TRANSCRIPT");
        }
        if (!detected && parsed.language) {
          const name = parsed.language.toLowerCase();
          detected = languageCodes[name] ?? (name.length <= 3 ? name : undefined);
        }
        for (const segment of parsed.segments) {
          const text = segment.text.trim().slice(0, 2000);
          const previous = segments.at(-1)?.endSeconds ?? 0;
          // Groq a veces solapa segmentos por milésimas: ordenarlos estrictamente.
          const startSeconds = Math.max(previous, offsetSeconds + segment.start);
          const endSeconds = Math.min(durationSeconds, offsetSeconds + segment.end);
          if (text && endSeconds - startSeconds >= 0.05) segments.push({ startSeconds, endSeconds, text });
        }
      }
    } finally {
      await file.close();
    }
    if (!segments.length) throw new AnalysisError("NO_SPEECH_DETECTED");
    return validateTranscript(
      {
        language: language !== "auto" ? language : (detected ?? "auto"),
        languageSource: language === "auto" ? "detected" : "requested",
        durationSeconds,
        segments,
        provider: this.name,
        model: this.model,
        revision: this.revision,
        engineVersion: "groq-openai-v1",
        modelSha256: null,
        requestId: null,
        estimatedExternalCostUsd: 0,
        diarization: false,
      },
      durationSeconds,
    );
  }
}

const chat = z.object({
  model: z.string(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({ content: z.string().nullable() }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});
const proposal = z.object({ startSeconds: z.number(), endSeconds: z.number() }).passthrough();

/**
 * Llama a veces devuelve tiempos fuera de las frases o un clip de más: se ajustan a los
 * límites reales de la transcripción antes de la validación estricta del proyecto.
 */
function snapToCues(
  value: unknown,
  transcript: Transcript,
  spec: Extract<AnalysisSpec["selection"], { mode: "llm" }>,
) {
  const raw = (value as { segments?: unknown })?.segments;
  if (!Array.isArray(raw)) return value;
  const cues = transcript.segments;
  const fixed: Record<string, unknown>[] = [];
  let previous = 0;
  const items = raw
    .map((item) => proposal.safeParse(item))
    .filter((item) => item.success)
    .map((item) => ({ ...item.data }))
    .sort((a, b) => a.startSeconds - b.startSeconds);
  for (const item of items) {
    const startCue = cues.find((cue) => cue.endSeconds > Math.max(item.startSeconds, previous));
    if (!startCue) continue;
    const start = Math.max(startCue.startSeconds, previous);
    const wanted = Math.min(Math.max(item.endSeconds, start + spec.minSeconds), start + spec.maxSeconds);
    const ends = cues
      .filter((cue) => cue.endSeconds - start >= spec.minSeconds && cue.endSeconds - start <= spec.maxSeconds)
      .map((cue) => cue.endSeconds);
    if (!ends.length) continue;
    const end = ends.reduce((best, candidate) =>
      Math.abs(candidate - wanted) < Math.abs(best - wanted) ? candidate : best,
    );
    const hashtags = Array.isArray(item["hashtags"])
      ? (item["hashtags"] as unknown[])
          .filter((tag): tag is string => typeof tag === "string")
          .map((tag) => "#" + tag.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "").slice(0, 80))
          .filter((tag) => tag.length > 1)
          .slice(0, 12)
      : [];
    fixed.push({ ...item, startSeconds: start, endSeconds: end, hashtags });
    previous = end;
    if (fixed.length === spec.count) break;
  }
  return { segments: fixed };
}

/** Resume la transcripción en bloques para respetar el límite de tokens por minuto de Groq. */
function condensedPrompt(
  transcript: Transcript,
  spec: Extract<AnalysisSpec["selection"], { mode: "llm" }>,
  budget: number,
) {
  const blockSeconds = Math.max(
    Math.min(15, Math.max(4, spec.minSeconds / 2)),
    transcript.durationSeconds / Math.max(40, Math.floor(budget / 120)),
  );
  const blocks: { startSeconds: number; endSeconds: number; text: string }[] = [];
  for (const cue of transcript.segments) {
    const last = blocks.at(-1);
    if (last && cue.endSeconds - last.startSeconds <= blockSeconds) {
      last.endSeconds = cue.endSeconds;
      last.text += " " + cue.text;
    } else blocks.push({ startSeconds: cue.startSeconds, endSeconds: cue.endSeconds, text: cue.text });
  }
  let max = 2000;
  const render = () =>
    JSON.stringify({
      request: {
        count: spec.count,
        minSeconds: spec.minSeconds,
        maxSeconds: spec.maxSeconds,
        contentType: spec.contentType,
      },
      userInstructions: spec.instructions,
      sourceLanguage: transcript.language,
      durationSeconds: transcript.durationSeconds,
      untrustedTranscript: blocks.map((block) => ({
        startSeconds: block.startSeconds,
        endSeconds: block.endSeconds,
        text: block.text.replace(/\s+/g, " ").slice(0, max),
      })),
      responseFormat:
        '{"segments":[{"startSeconds":number,"endSeconds":number,"title":string,"description":string,"hashtags":["#tag"],"explanation":string,"score":number}]}',
    });
  let prompt = render();
  while (Buffer.byteLength(prompt) > budget && max > 20) {
    max = Math.floor(max * 0.8);
    prompt = render();
  }
  if (Buffer.byteLength(prompt) > budget) throw new AnalysisError("SELECTION_INPUT_LIMIT");
  return prompt;
}

export class GroqSelector {
  readonly provider = "groq" as const;
  readonly model = process.env["GROQ_SELECT_MODEL"]?.trim() || "llama-3.3-70b-versatile";
  readonly promptVersion = SELECTION_PROMPT_VERSION;
  /** El plan gratis de Groq limita tokens por minuto: ~30 KB de transcripción resumida. */
  readonly inputBudget = Number(process.env["GROQ_INPUT_BYTES"] ?? 30000);
  readonly revision = selectionPromptRevision(this.provider, this.model, 0, 0);
  maximumCostUsd(_inputBytes: number) {
    return 0;
  }
  async diagnostics() {
    if (!groqEnabled())
      return {
        configured: false,
        status: "missing_configuration" as const,
        code: "SELECTION_NOT_CONFIGURED",
        missingSettings: ["GROQ_API_KEY"],
        nextSteps: ["Ejecuta iniciar-groq.cmd y pega tu API key de Groq (https://console.groq.com/keys)."],
        model: this.model,
      };
    return {
      configured: true,
      status: "ready" as const,
      code: null,
      missingSettings: [] as string[],
      nextSteps: [] as string[],
      model: this.model,
    };
  }
  async configured() {
    return groqEnabled();
  }
  async select(
    transcript: Transcript,
    spec: Extract<AnalysisSpec["selection"], { mode: "llm" }>,
    signal: AbortSignal,
  ) {
    if (!groqEnabled()) throw new AnalysisError("SELECTION_NOT_CONFIGURED");
    if (spec.count * spec.minSeconds > transcript.durationSeconds)
      throw new AnalysisError("INVALID_SELECTION_REQUEST");
    const prompt = condensedPrompt(transcript, spec, this.inputBudget);
    const response = await groqFetch(
      "/chat/completions",
      () => ({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          max_tokens: 4096,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SELECTION_SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
        }),
      }),
      signal,
      120000,
    );
    let parsed: z.infer<typeof chat>;
    try {
      parsed = chat.parse(JSON.parse(await boundedText(response, 1048576)));
    } catch (error) {
      if (error instanceof AnalysisError) throw error;
      throw new AnalysisError("INVALID_SELECTION_RESPONSE", true);
    }
    const choice = parsed.choices[0]!;
    if (choice.finish_reason === "length" || !choice.message.content)
      throw new AnalysisError("INVALID_SELECTION_RESPONSE", true);
    let result: unknown;
    try {
      result = JSON.parse(choice.message.content) as unknown;
    } catch {
      throw new AnalysisError("INVALID_SEGMENT_SELECTION", true);
    }
    const selection = validateSelection(snapToCues(result, transcript, spec), transcript, spec);
    return {
      ...selection,
      provider: this.provider,
      model: this.model,
      revision: this.revision,
      promptVersion: this.promptVersion,
      usage: {
        inputTokens: parsed.usage?.prompt_tokens ?? 0,
        outputTokens: parsed.usage?.completion_tokens ?? 0,
      },
      estimatedExternalCostUsd: 0,
    };
  }
}
