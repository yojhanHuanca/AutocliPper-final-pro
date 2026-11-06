import { DatePipe, DecimalPipe } from "@angular/common";
import { HttpErrorResponse } from "@angular/common/http";
import { Component, DestroyRef, inject, signal } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { ActivatedRoute, RouterLink } from "@angular/router";
import type { Schema } from "../../../core/contracts/api-types";
import { CollaborationApi } from "../data-access/collaboration-api.service";

@Component({
  selector: "ac-public-review",
  imports: [DatePipe, DecimalPipe, RouterLink],
  templateUrl: "./public-review.component.html",
  styleUrl: "./public-review.component.css",
})
export class PublicReviewComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly destroy = inject(DestroyRef);
  private readonly api = inject(CollaborationApi);
  private token = "";
  private generation = 0;
  private videoGeneration = 0;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private videoGrantExpiresAt: number | null = null;
  private readonly expiryCheck = signal(0);
  private seenCommentCursors = new Set<string>();
  readonly review = signal<Schema<"PublicReviewDto"> | null>(null);
  readonly nextBeforeId = signal<string | null>(null);
  readonly videoUrl = signal("");
  readonly videoExpiresIn = signal<number | null>(null);
  readonly busy = signal(false);
  readonly loadingVideo = signal(false);
  readonly error = signal("");
  readonly videoError = signal("");

  constructor() {
    this.destroy.onDestroy(() => this.clearExpiryTimer());
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroy)).subscribe((params) => {
      this.generation++;
      this.videoGeneration++;
      this.clearExpiryTimer();
      this.videoGrantExpiresAt = null;
      this.seenCommentCursors.clear();
      this.token = params.get("token") ?? "";
      this.review.set(null);
      this.nextBeforeId.set(null);
      this.videoUrl.set("");
      this.error.set("");
      this.videoError.set("");
      this.busy.set(false);
      this.loadingVideo.set(false);
      if (this.token) void this.load();
    });
  }
  async load(beforeId?: string | null): Promise<void> {
    if (!this.token || this.busy()) return;
    if (!beforeId) this.seenCommentCursors.clear();
    const generation = this.generation;
    this.busy.set(true);
    this.error.set("");
    try {
      const result = await this.api.publicReview(this.token, beforeId);
      if (generation !== this.generation) return;
      if (beforeId && this.review()) {
        const current = this.review()!;
        const knownIds = new Set(current.comments.items.map((comment) => comment.id));
        const freshComments = result.comments.items.filter((comment) => {
          if (knownIds.has(comment.id)) return false;
          knownIds.add(comment.id);
          return true;
        });
        this.review.set({ ...current, comments: {
          items: [...current.comments.items, ...freshComments],
          nextBeforeId: result.comments.nextBeforeId,
        } });
        this.seenCommentCursors.add(beforeId);
        if (result.comments.nextBeforeId && this.seenCommentCursors.has(result.comments.nextBeforeId)) {
          this.nextBeforeId.set(null);
          this.error.set("La consulta devolvió un cursor repetido. Se detuvo la paginación para evitar repetir observaciones.");
        } else {
          this.nextBeforeId.set(result.comments.nextBeforeId);
        }
      } else {
        this.review.set(result);
        this.seenCommentCursors.clear();
        this.nextBeforeId.set(result.comments.nextBeforeId);
      }
      if (!beforeId) {
        this.videoGeneration++;
        this.loadingVideo.set(false);
        this.videoUrl.set("");
        this.videoExpiresIn.set(null);
        this.videoGrantExpiresAt = null;
        this.scheduleExpiryCheck();
      }
    } catch (error) {
      if (generation !== this.generation) return;
      if (this.reviewLinkRevoked(error)) {
        this.videoGeneration++;
        this.loadingVideo.set(false);
        this.review.set(null);
        this.nextBeforeId.set(null);
        this.videoUrl.set("");
        this.videoExpiresIn.set(null);
        this.videoGrantExpiresAt = null;
        this.clearExpiryTimer();
      }
      this.error.set(this.publicError(error));
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }
  async loadVideo(): Promise<void> {
    const review = this.review();
    if (!review?.videoEnabled || this.loadingVideo()) return;
    if (this.isExpired()) {
      this.videoError.set("Este enlace venció o no tiene una vigencia válida.");
      return;
    }
    this.loadingVideo.set(true);
    const generation = this.generation;
    const videoGeneration = ++this.videoGeneration;
    this.videoError.set("");
    this.videoUrl.set("");
    this.videoExpiresIn.set(null);
    this.videoGrantExpiresAt = null;
    this.clearExpiryTimer();
    try {
      const grant = await this.api.publicVideo(this.token);
      if (generation !== this.generation || videoGeneration !== this.videoGeneration) return;
      if (this.isExpired() || !this.review()?.videoEnabled) {
        this.videoError.set("Este enlace venció o dejó de autorizar el video.");
        return;
      }
      const url = new URL(grant.url);
      if (!(["https:", "http:"].includes(url.protocol)) || url.username || url.password || !grant.contentType.trim().toLowerCase().startsWith("video/"))
        throw new Error("El servidor no devolvió un permiso de video válido.");
      if (!Number.isFinite(grant.expiresInSeconds) || grant.expiresInSeconds <= 0)
        throw new Error("El servidor no devolvió un permiso de video válido.");
      this.videoUrl.set(url.href);
      this.videoExpiresIn.set(grant.expiresInSeconds);
      this.videoGrantExpiresAt = Date.now() + grant.expiresInSeconds * 1000;
      this.scheduleExpiryCheck();
    } catch (error) {
      if (generation !== this.generation || videoGeneration !== this.videoGeneration) return;
      if (this.reviewLinkRevoked(error)) {
        this.videoGeneration++;
        this.loadingVideo.set(false);
        this.review.set(null);
        this.nextBeforeId.set(null);
        this.videoUrl.set("");
        this.videoExpiresIn.set(null);
        this.videoGrantExpiresAt = null;
        this.clearExpiryTimer();
        this.error.set(this.publicError(error));
      } else this.videoError.set(this.publicError(error));
    } finally {
      if (generation === this.generation && videoGeneration === this.videoGeneration) this.loadingVideo.set(false);
    }
  }
  canLoadVideo(): boolean {
    const review = this.review();
    return !!review?.videoEnabled && !this.isExpired();
  }
  isExpired(): boolean {
    this.expiryCheck?.();
    const expiresAt = this.review()?.expiresAt;
    if (!expiresAt) return true;
    const timestamp = Date.parse(expiresAt);
    return !Number.isFinite(timestamp) || timestamp <= Date.now();
  }
  private scheduleExpiryCheck(): void {
    this.clearExpiryTimer();
    const reviewExpiry = Date.parse(this.review()?.expiresAt ?? "");
    const deadlines = [reviewExpiry, this.videoGrantExpiresAt].filter((value): value is number => Number.isFinite(value));
    if (!deadlines.length) return;
    const remaining = Math.max(0, Math.min(...deadlines) - Date.now());
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null;
      this.expiryCheck.update((value) => value + 1);
      if (this.videoGrantExpiresAt !== null && this.videoGrantExpiresAt <= Date.now()) {
        this.videoGrantExpiresAt = null;
        this.videoUrl.set("");
        this.videoExpiresIn.set(null);
        this.videoError.set("El permiso temporal de video venció. Puedes solicitar uno nuevo mientras el enlace siga vigente.");
      }
      if (this.isExpired()) {
        this.videoGeneration++;
        this.loadingVideo.set(false);
        this.videoUrl.set("");
        this.videoExpiresIn.set(null);
        this.videoGrantExpiresAt = null;
      } else this.scheduleExpiryCheck();
    }, Math.min(remaining, 24 * 60 * 60 * 1000));
  }
  private clearExpiryTimer(): void {
    if (this.expiryTimer !== null) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
  }
  statusLabel(status: Schema<"PublicReviewDto">["status"]): string {
    return { draft: "Borrador", review: "En revisión", approved: "Aprobada", superseded: "Sustituida" }[status];
  }
  private publicError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if ([400, 401, 403, 404, 410].includes(error.status))
        return "Este enlace no está disponible: pudo vencer, ser revocado o dejar de autorizar esta revisión.";
      if (error.status === 0 || error.status === 503)
        return "No se pudo conectar con el servicio de revisión. Comprueba la conexión e inténtalo de nuevo.";
      return `No se pudo cargar esta revisión (respuesta ${error.status}).`;
    }
    return error instanceof Error ? error.message : "No se pudo abrir esta revisión.";
  }
  private reviewLinkRevoked(error: unknown): boolean {
    return error instanceof HttpErrorResponse && [401, 403, 404, 410].includes(error.status);
  }
}
