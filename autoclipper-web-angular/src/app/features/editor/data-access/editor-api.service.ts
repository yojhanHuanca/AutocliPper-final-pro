import { Injectable, inject } from "@angular/core";
import type { Schema, Response } from "../../../core/contracts/api-types";
import type { paths } from '../../../core/contracts/gateway.generated';
import { ApiTransport } from "../../../core/http/api-transport.service";
import type { HttpResponse } from "@angular/common/http";

function currentEtag(
  response: HttpResponse<Schema<"EditorDraftDto">>,
): string {
  const draft = response.body;
  if (!draft) throw new Error("El servidor no devolvió la revisión.");
  // The public contract defines ETag as the quoted current draft version;
  // PATCH/restore responses do not currently document the response header.
  return response.headers.get("ETag") ?? `"${draft.version}"`;
}

@Injectable({ providedIn: "root" })
export class EditorApi {
  private readonly api = inject(ApiTransport);
  project(id: string) {
    return this.api.get<Schema<"ProjectResponseDto">>(
      `/projects/${encodeURIComponent(id)}`,
    );
  }
  analysis(id: string) {
    return this.api.get<Schema<"AnalysisStatusDto">>(
      `/analyses/${encodeURIComponent(id)}`,
    );
  }
  async edit(id: string) {
    const result = await this.api.getResponse<Schema<"EditorDraftDto">>(
      `/edits/${encodeURIComponent(id)}`,
    );
    if (!result.body) throw new Error("El servidor no devolvió la revisión.");
    return {
      draft: result.body,
      etag: result.headers.get("ETag") ?? `"${result.body.version}"`,
    };
  }
  async save(id: string, body: Schema<"UpdateEditDto">, etag?: string) {
    const result = await this.api.patchResponse<Schema<"EditorDraftDto">>(
      `/edits/${encodeURIComponent(id)}`,
      body,
      etag,
    );
    if (!result.body) throw new Error("El servidor no devolvió la revisión.");
    return { draft: result.body, etag: currentEtag(result) };
  }
  history(id: string, before?: number | null) {
    return this.api.get<Response<"/v1/edits/{id}/revisions">>(
      `/edits/${encodeURIComponent(id)}/revisions${before ? "?beforeVersion=" + before : ""}`,
    );
  }
  async restore(id: string, body: Schema<"RestoreRevisionDto">, etag?: string) {
    const result = await this.api.postResponse<Schema<"EditorDraftDto">>(
      `/edits/${encodeURIComponent(id)}/restore`,
      body,
      etag,
    );
    if (!result.body) throw new Error("El servidor no devolvió la revisión.");
    return { draft: result.body, etag: currentEtag(result) };
  }
  exports(id: string) {
    return this.api.get<Response<"/v1/edits/{id}/exports">>(
      `/edits/${encodeURIComponent(id)}/exports`,
    );
  }
  render(id: string, version: number, key: string) {
    return this.api.post<paths['/v1/edits/{id}/renders']['post']['responses'][201]['content']['application/json']>(
      `/edits/${encodeURIComponent(id)}/renders`,
      { revisionVersion: version },
      key,
    );
  }
  cancelRender(id: string) {
    return this.api.delete(`/processing/${encodeURIComponent(id)}`);
  }
  download(id: string, kind: Schema<'ProcessingArtifactDto'>['kind']) {
    return this.api.get<Response<"/v1/processing/{id}/download">>(
      `/processing/${encodeURIComponent(id)}/download?kind=${encodeURIComponent(kind)}`,
    );
  }
}
