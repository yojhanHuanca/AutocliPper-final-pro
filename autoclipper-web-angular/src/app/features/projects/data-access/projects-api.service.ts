import { Injectable, inject } from "@angular/core";
import type { Schema, Response } from "../../../core/contracts/api-types";
import { ApiTransport } from "../../../core/http/api-transport.service";
import { uploadContentType } from '../models/upload-file';
@Injectable({ providedIn: "root" })
export class ProjectsApi {
  private readonly api = inject(ApiTransport);
  list(workspaceId: string, search = "") {
    return this.api.get<Schema<"ProjectListDto">>(
      `/projects?workspaceId=${encodeURIComponent(workspaceId)}&limit=100${search ? "&search=" + encodeURIComponent(search) : ""}`,
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
  createPipeline(id: string, body: Schema<"PipelineSpecDto">, key: string) {
    return this.api.post<Schema<"PipelineStatusDto">>(
      `/uploads/${encodeURIComponent(id)}/pipelines`,
      body,
      key,
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
    progress: (stage: string) => void,
    remember: (id: string) => void,
  ): Promise<Schema<"UploadStatusDto">> {
    const contentType = uploadContentType(file);
    progress("Calculando SHA-256 del archivo…");
    const digest = await crypto.subtle.digest(
      "SHA-256",
      await file.arrayBuffer(),
    );
    const sha256 = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const body: Schema<"UploadDto"> = {
      bytes: file.size,
      sha256,
      contentType,
      mode: "put",
    };
    const intent = await this.api.post<Schema<"PutUploadIntentDto">>(
      `/projects/${encodeURIComponent(projectId)}/uploads`,
      body,
      crypto.randomUUID(),
    );
    remember(intent.id);
    progress("Enviando archivo al almacenamiento privado…");
    // Native fetch deliberately avoids API credentials, CSRF, and Angular interceptors.
    const result = await fetch(intent.url, {
      method: "PUT",
      body: file,
      headers: intent.headers,
      credentials: "omit",
      redirect: "error",
    });
    if (!result.ok)
      throw new Error(
        `La carga falló (${result.status}). Puedes consultar o abortar la intención creada.`,
      );
    progress("Confirmando archivo e iniciando inspección…");
    await this.api.post(`/uploads/${intent.id}/confirm`, {});
    return this.api.get<Schema<"UploadStatusDto">>(`/uploads/${intent.id}`);
  }
}
