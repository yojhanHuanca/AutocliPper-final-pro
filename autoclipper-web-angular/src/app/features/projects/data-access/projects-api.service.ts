import { Injectable, inject } from "@angular/core";
import type { Schema, Response } from "../../../core/contracts/api-types";
import type { paths } from "../../../core/contracts/gateway.generated";
import { ApiTransport } from "../../../core/http/api-transport.service";
import { uploadContentType, type UploadPhase } from '../models/upload-file';
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
    progress("Preparando y verificando tu archivo…", 'hashing');
    const digest = await crypto.subtle.digest(
      "SHA-256",
      await file.arrayBuffer(),
    );
    signal?.throwIfAborted();
    const sha256 = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const body: Schema<"UploadDto"> = {
      bytes: file.size,
      sha256,
      contentType,
      mode: "put",
    };
    progress('Preparando la carga privada…', 'reserving');
    const intent = await this.api.post<Schema<"PutUploadIntentDto">>(
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
    signal?.throwIfAborted();
    progress("Confirmando archivo e iniciando inspección…", 'confirming');
    await this.api.post(`/uploads/${intent.id}/confirm`, {});
    return this.api.get<Schema<"UploadStatusDto">>(`/uploads/${intent.id}`);
  }
}
