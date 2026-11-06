import { Injectable, inject } from "@angular/core";
import type { Schema, Response } from "../../../core/contracts/api-types";
import type { paths } from "../../../core/contracts/gateway.generated";
import { ApiTransport } from "../../../core/http/api-transport.service";
import { uploadContentType, type UploadPhase } from '../models/upload-file';
import { Sha256 } from '../models/sha256-stream';
import type { SourceImportResolution } from '../models/source-link';

type SourceLinkImportResult =
  | { id: string; state: 'importing'; retryAfterSeconds: number }
  | { id: string; state: 'succeeded'; uploadId: string | null; duplicate?: boolean; inspection?: { status: string }; title?: string; durationSeconds?: number };

@Injectable({ providedIn: "root" })
export class ProjectsApi {
  private readonly api = inject(ApiTransport);
  analysisProviders() {
    return this.api.get<Response<"/v1/analyses/providers">>("/analyses/providers");
  }
  twitchLinkStatus() {
    return this.api.get<{ configured: boolean; linked: boolean; account: { id?: string; login?: string } | null }>("/auth/twitch/link");
  }
  linkTwitch() {
    return this.api.post<{ authorizationUrl: string; expiresInSeconds: number; scope: "editor:manage:clips" }>("/auth/twitch/link", {});
  }
  unlinkTwitch() {
    return this.api.delete<{ unlinked: boolean }>("/auth/twitch/link");
  }
  resolveSourceLink(projectId: string, url: string, options?: { signal?: AbortSignal; timeoutMs?: number; vodOffsetSeconds?: number; durationSeconds?: number; title?: string }) {
    const path = `/projects/${encodeURIComponent(projectId)}/source-links/resolve`;
    const body = {
      url,
      ...(options?.vodOffsetSeconds === undefined ? {} : { vodOffsetSeconds: options.vodOffsetSeconds }),
      ...(options?.durationSeconds === undefined ? {} : { durationSeconds: options.durationSeconds }),
      ...(options?.title?.trim() ? { title: options.title.trim() } : {}),
    };
    return options?.signal
      ? this.api.postCancelable<SourceImportResolution>(path, body, options.signal, options.timeoutMs ?? 7_000)
      : this.api.post<SourceImportResolution>(path, body);
  }
  sourceLinkCapabilities(projectId: string) {
    return this.api.get<Schema<'SourceLinkCapabilitiesDto'>>(`/projects/${encodeURIComponent(projectId)}/source-links/capabilities`);
  }
  importSourceLink(projectId: string, url: string, key: string, options?: { vodOffsetSeconds?: number; durationSeconds?: number; title?: string }) {
    return this.api.post<SourceLinkImportResult>(
      `/projects/${encodeURIComponent(projectId)}/source-links/import`, { url, ...options }, key,
    );
  }
  list(workspaceId: string, search = "") {
    return this.api.get<Schema<"ProjectListDto">>(
      `/projects?workspaceId=${encodeURIComponent(workspaceId)}&limit=100${search ? "&search=" + encodeURIComponent(search) : ""}`,
    );
  }
  updateProject(id: string, body: Schema<"UpdateProjectDto">) {
    return this.api.patch<void>(
      `/projects/${encodeURIComponent(id)}`,
      body,
    ).then(() => this.get(id));
  }
  trashProject(id: string): Promise<void> {
    return this.api.delete<void>(
      `/projects/${encodeURIComponent(id)}`,
    );
  }
  get(id: string) {
    return this.api.get<Schema<"ProjectResponseDto">>(
      `/projects/${encodeURIComponent(id)}`,
    );
  }
  create(body: Schema<"ProjectDto">, key: string) {
    return this.api.post<Schema<"CreatedProjectDto">>("/projects", body, key);
  }
  edits(id: string) {
    return this.api.get<Response<"/v1/projects/{id}/edits">>(
      `/projects/${encodeURIComponent(id)}/edits`,
    );
  }
  upload(id: string) {
    return this.api.get<Schema<"UploadStatusDto">>(
      `/uploads/${encodeURIComponent(id.trim())}`,
    );
  }
  abortUpload(id: string) {
    return this.api.delete(`/uploads/${encodeURIComponent(id)}`);
  }
  createPipeline(id: string, body: Schema<"PipelineSpecDto"> | Schema<'AutomaticPipelineSpecDto'>, key: string) {
    return this.api.post<Schema<"PipelineStatusDto">>(
      `/uploads/${encodeURIComponent(id)}/pipelines`,
      body,
      key,
    );
  }
  createProcessing(id: string, body: Schema<"ClipProcessingSpecDto">, key: string) {
    return this.api.post<paths['/v1/uploads/{id}/processing']['post']['responses'][201]['content']['application/json']>(
      `/uploads/${encodeURIComponent(id)}/processing`, body, key,
    );
  }
  processing(id: string) {
    return this.api.get<Schema<"ProcessingStatusDto">>(`/processing/${encodeURIComponent(id.trim())}`);
  }
  cancelProcessing(id: string) {
    return this.api.delete(`/processing/${encodeURIComponent(id)}`);
  }
  processingDownload(id: string, kind: Schema<"ProcessingArtifactDto">['kind']) {
    return this.api.get<Response<"/v1/processing/{id}/download">>(
      `/processing/${encodeURIComponent(id)}/download?kind=${encodeURIComponent(kind)}`,
    );
  }
  pipeline(id: string) {
    return this.api.get<Schema<"PipelineStatusDto">>(
      `/pipelines/${encodeURIComponent(id.trim())}`,
    );
  }
  cancelPipeline(id: string) {
    return this.api.delete(`/pipelines/${encodeURIComponent(id)}`);
  }
  pipelineDownload(id: string, kind: string) {
    return this.api.get<Response<"/v1/pipelines/{id}/download">>(
      `/pipelines/${encodeURIComponent(id)}/download?kind=${encodeURIComponent(kind)}`,
    );
  }
  pipelineClipDownload(id: string, index: number, kind: 'video' | 'srt' | 'vtt' = 'video') {
    return this.api.get<Response<"/v1/pipelines/{id}/clips/{index}/download">>(
      `/pipelines/${encodeURIComponent(id)}/clips/${encodeURIComponent(String(index))}/download?kind=${encodeURIComponent(kind)}`,
    );
  }
  createEdit(id: string, body: Schema<"CreateEditDto">, key: string) {
    return this.api.post<Schema<"EditorDraftDto">>(
      `/uploads/${encodeURIComponent(id)}/edits`,
      body,
      key,
    );
  }
  async uploadFile(
    projectId: string,
    file: File,
    progress: (stage: string, phase?: UploadPhase) => void,
    remember: (id: string) => void,
    signal?: AbortSignal,
  ): Promise<Schema<"UploadStatusDto">> {
    signal?.throwIfAborted();
    const contentType = uploadContentType(file);
    // Archivos grandes van por partes: un PUT único tiene tope de 5 GB y
    // el navegador no puede cargar decenas de GB en memoria.
    const multipart = file.size > SINGLE_PUT_MAX_BYTES;
    // Una sola lectura del disco: hash del archivo completo y de cada parte.
    const whole = new Sha256();
    const partHashes: string[] = [];
    for (let offset = 0; offset < file.size; offset += PART_BYTES) {
      signal?.throwIfAborted();
      const piece = file.size <= PART_BYTES ? file : file.slice(offset, offset + PART_BYTES);
      const chunk = new Uint8Array(await piece.arrayBuffer());
      whole.update(chunk);
      if (multipart) partHashes.push(toHex(await crypto.subtle.digest("SHA-256", chunk)));
      progress(
        `Preparando y verificando tu archivo… ${percent(offset + chunk.length, file.size)}`,
        'hashing',
      );
    }
    signal?.throwIfAborted();
    const body: Schema<"UploadDto"> = {
      bytes: file.size,
      sha256: whole.hex(),
      contentType,
      mode: multipart ? "multipart" : "put",
    };
    progress('Preparando la carga privada…', 'reserving');
    const intent = await this.api.post<
      Schema<"PutUploadIntentDto"> | Schema<"MultipartUploadIntentDto">
    >(
      `/projects/${encodeURIComponent(projectId)}/uploads`,
      body,
      crypto.randomUUID(),
    );
    remember(intent.id);
    if (signal?.aborted) {
      try { await this.abortUpload(intent.id); }
      catch { throw new Error(`Se canceló la transferencia, pero no pudimos liberar la carga ${intent.id}. Consulta su estado para reintentar la cancelación.`); }
      signal.throwIfAborted();
    }
    progress("Enviando archivo al almacenamiento privado…", 'transferring');
    if (intent.mode !== "multipart") {
      // Native fetch deliberately avoids API credentials, CSRF, and Angular interceptors.
      const result = await fetch(intent.url, {
        method: "PUT",
        body: file,
        headers: intent.headers,
        credentials: "omit",
        redirect: "error",
        signal,
      });
      if (!result.ok)
        throw new Error(
          `La carga falló (${result.status}). Puedes consultar o abortar la intención creada.`,
        );
    } else {
      if (intent.partBytes !== PART_BYTES || intent.parts !== partHashes.length)
        throw new Error("El servidor propuso un tamaño de partes inesperado. Aborta la carga e inténtalo de nuevo.");
      let next = 0;
      let sent = 0;
      const worker = async () => {
        while (next < intent.parts) {
          const partNumber = ++next;
          const start = (partNumber - 1) * PART_BYTES;
          const blob = file.slice(start, start + PART_BYTES);
          await this.uploadPart(intent.id, partNumber, blob, partHashes[partNumber - 1]!, signal);
          sent += blob.size;
          progress(
            `Enviando archivo al almacenamiento privado… ${percent(sent, file.size)}`,
            'transferring',
          );
        }
      };
      try {
        await Promise.all(
          Array.from({ length: Math.min(PART_CONCURRENCY, intent.parts) }, worker),
        );
      } catch (error) {
        signal?.throwIfAborted();
        throw new Error(
          `La carga se interrumpió (${error instanceof Error ? error.message : "error de red"}). Puedes consultar o abortar la intención creada.`,
        );
      }
    }
    signal?.throwIfAborted();
    progress("Confirmando archivo e iniciando inspección…", 'confirming');
    await this.confirmUpload(intent.id, signal);
    return this.api.get<Schema<"UploadStatusDto">>(`/uploads/${intent.id}`);
  }
  /** Sube una parte con reintentos: una carga de horas no debe morir por un corte breve. */
  private async uploadPart(
    id: string,
    partNumber: number,
    blob: Blob,
    sha256: string,
    signal?: AbortSignal,
  ) {
    for (let attempt = 1; ; attempt++) {
      signal?.throwIfAborted();
      try {
        const signed = await this.api.post<Schema<"SignedPartDto">>(
          `/uploads/${encodeURIComponent(id)}/parts`,
          { partNumber, sha256 },
        );
        const result = await fetch(signed.url, {
          method: "PUT",
          body: blob,
          headers: signed.headers,
          credentials: "omit",
          redirect: "error",
          signal,
        });
        if (result.ok) return;
        if (attempt >= PART_ATTEMPTS) throw new Error(`parte ${partNumber}: ${result.status}`);
      } catch (error) {
        if (signal?.aborted || attempt >= PART_ATTEMPTS) throw error;
      }
      await wait(1000 * 2 ** (attempt - 1), signal);
    }
  }
  /** Confirmar ensambla miles de partes y puede exceder el timeout: es idempotente, se reintenta. */
  private async confirmUpload(id: string, signal?: AbortSignal) {
    for (let attempt = 1; ; attempt++) {
      signal?.throwIfAborted();
      try {
        await this.api.post(`/uploads/${id}/confirm`, {});
        return;
      } catch (error) {
        const status = (error as { status?: number }).status ?? 0;
        if (attempt >= 6 || (status !== 0 && status < 500)) throw error;
      }
      await wait(5000 * attempt, signal);
    }
  }
}

const PART_BYTES = 8 * 1024 * 1024;
const SINGLE_PUT_MAX_BYTES = 100 * 1024 * 1024;
const PART_CONCURRENCY = 4;
const PART_ATTEMPTS = 5;
const toHex = (digest: ArrayBuffer) =>
  Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
const percent = (done: number, total: number) => `${Math.floor((done / total) * 100)}%`;
const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
