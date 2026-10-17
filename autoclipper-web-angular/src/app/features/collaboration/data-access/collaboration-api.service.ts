import { Injectable, inject } from "@angular/core";
import type { Schema } from "../../../core/contracts/api-types";
import { ApiTransport } from "../../../core/http/api-transport.service";

export interface PublicReviewVideoGrant {
  url: string;
  expiresInSeconds: number;
  contentType: string;
  bytes: number;
  sha256: string;
}

@Injectable({ providedIn: "root" })
export class CollaborationApi {
  private readonly api = inject(ApiTransport);

  review(editId: string) {
    return this.api.get<Schema<"ReviewHistoryDto">>(
      `/edits/${encodeURIComponent(editId)}/review`,
    );
  }
  requestReview(editId: string, body: Schema<"ReviewVersionDto">) {
    return this.api.post<Schema<"ReviewStateDto">>(
      `/edits/${encodeURIComponent(editId)}/review`, body,
    );
  }
  returnReview(editId: string, body: Schema<"ReviewVersionDto">) {
    return this.api.deleteWithBody<Schema<"ReviewStateDto">>(
      `/edits/${encodeURIComponent(editId)}/review`, body,
    );
  }
  approve(editId: string, body: Schema<"ReviewVersionDto">) {
    return this.api.post<Schema<"ReviewStateDto">>(
      `/edits/${encodeURIComponent(editId)}/approvals`, body,
    );
  }
  comments(editId: string, options: { beforeId?: string | null; revisionVersion?: number } = {}) {
    const query = new URLSearchParams();
    if (options.beforeId) query.set("beforeId", options.beforeId);
    if (options.revisionVersion) query.set("revisionVersion", String(options.revisionVersion));
    const suffix = query.size ? `?${query}` : "";
    return this.api.get<Schema<"EditorCommentPageDto">>(
      `/edits/${encodeURIComponent(editId)}/comments${suffix}`,
    );
  }
  createComment(editId: string, body: Schema<"CreateCommentDto">, key: string) {
    return this.api.post<Schema<"EditorCommentDto">>(
      `/edits/${encodeURIComponent(editId)}/comments`, body, key,
    );
  }
  deleteComment(editId: string, commentId: string, body: Schema<"DeleteCommentDto">) {
    return this.api.deleteWithBody<Schema<"EditorCommentDto">>(
      `/edits/${encodeURIComponent(editId)}/comments/${encodeURIComponent(commentId)}`,
      body,
    );
  }
  links(editId: string) {
    return this.api.get<Schema<"ReviewLinkPageDto">>(
      `/edits/${encodeURIComponent(editId)}/review-links`,
    );
  }
  createLink(editId: string, body: Schema<"CreateReviewLinkDto">) {
    return this.api.post<Schema<"CreatedReviewLinkDto">>(
      `/edits/${encodeURIComponent(editId)}/review-links`, body,
    );
  }
  revokeLink(editId: string, linkId: string) {
    return this.api.delete(
      `/edits/${encodeURIComponent(editId)}/review-links/${encodeURIComponent(linkId)}`,
    );
  }
  audit(editId: string, beforeId?: string | null) {
    const query = beforeId ? `?beforeId=${encodeURIComponent(beforeId)}` : "";
    return this.api.get<Schema<"EditorAuditPageDto">>(
      `/edits/${encodeURIComponent(editId)}/audit${query}`,
    );
  }
  publicReview(token: string, beforeId?: string | null) {
    const query = beforeId ? `?beforeId=${encodeURIComponent(beforeId)}` : "";
    return this.api.getPublic<Schema<"PublicReviewDto">>(
      `/review-links/${encodeURIComponent(token)}${query}`,
    );
  }
  publicVideo(token: string) {
    return this.api.getPublic<PublicReviewVideoGrant>(
      `/review-links/${encodeURIComponent(token)}/video`,
    );
  }
}
