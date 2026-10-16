import { Injectable, inject } from "@angular/core";
import type { Schema, Response } from "../../../core/contracts/api-types";
import { ApiTransport } from "../../../core/http/api-transport.service";
@Injectable({ providedIn: "root" })
export class EditorApi {
  private readonly api = inject(ApiTransport);
  async edit(id: string) {
    const result = await this.api.getResponse<Schema<"EditorDraftDto">>(
      `/edits/${encodeURIComponent(id)}`,
    );
    if (!result.body) throw new Error("El servidor no devolvió la revisión.");
    return { draft: result.body, etag: result.headers.get("ETag") };
  }
  save(id: string, body: Schema<"UpdateEditDto">, etag?: string) {
    return this.api.patch<Schema<"EditorDraftDto">>(
      `/edits/${encodeURIComponent(id)}`,
      body,
      etag,
    );
  }
  history(id: string, before?: number | null) {
    return this.api.get<Response<"/v1/edits/{id}/revisions">>(
      `/edits/${encodeURIComponent(id)}/revisions${before ? "?beforeVersion=" + before : ""}`,
    );
  }
  restore(id: string, body: Schema<"RestoreRevisionDto">) {
    return this.api.post<Schema<"EditorDraftDto">>(
      `/edits/${encodeURIComponent(id)}/restore`,
      body,
    );
  }
  review(id: string) {
    return this.api.get<Schema<"ReviewHistoryDto">>(
      `/edits/${encodeURIComponent(id)}/review`,
    );
  }
  changeReview(
    id: string,
    action: "review" | "approvals",
    body: Schema<"ReviewVersionDto">,
  ) {
    return this.api.post<Schema<"ReviewStateDto">>(
      `/edits/${encodeURIComponent(id)}/${action}`,
      body,
    );
  }
  comments(id: string, before?: string | null) {
    return this.api.get<Schema<"EditorCommentPageDto">>(
      `/edits/${encodeURIComponent(id)}/comments${before ? "?beforeId=" + encodeURIComponent(before) : ""}`,
    );
  }
  comment(id: string, body: Schema<"CreateCommentDto">, key: string) {
    return this.api.post(
      `/edits/${encodeURIComponent(id)}/comments`,
      body,
      key,
    );
  }
  exports(id: string) {
    return this.api.get<Response<"/v1/edits/{id}/exports">>(
      `/edits/${encodeURIComponent(id)}/exports`,
    );
  }
  render(id: string, version: number, key: string) {
    return this.api.post(
      `/edits/${encodeURIComponent(id)}/renders`,
      { revisionVersion: version },
      key,
    );
  }
  cancelRender(id: string) {
    return this.api.delete(`/processing/${encodeURIComponent(id)}`);
  }
  download(id: string, kind: string) {
    return this.api.get<Response<"/v1/processing/{id}/download">>(
      `/processing/${encodeURIComponent(id)}/download?kind=${encodeURIComponent(kind)}`,
    );
  }
}
