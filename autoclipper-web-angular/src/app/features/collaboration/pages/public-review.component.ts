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
  readonly review = signal<Schema<"PublicReviewDto"> | null>(null);
  readonly nextBeforeId = signal<string | null>(null);
  readonly videoUrl = signal("");
  readonly videoExpiresIn = signal<number | null>(null);
  readonly busy = signal(false);
  readonly loadingVideo = signal(false);
  readonly error = signal("");
  readonly videoError = signal("");

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroy)).subscribe((params) => {
      this.generation++;
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
    const generation = this.generation;
    this.busy.set(true);
    this.error.set("");
    try {
      const result = await this.api.publicReview(this.token, beforeId);
      if (generation !== this.generation) return;
      if (beforeId && this.review()) {
        const current = this.review()!;
        this.review.set({ ...current, comments: {
          items: [...current.comments.items, ...result.comments.items],
          nextBeforeId: result.comments.nextBeforeId,
        } });
      } else {
        this.review.set(result);
      }
      this.nextBeforeId.set(result.comments.nextBeforeId);
      if (!beforeId) {
        this.videoUrl.set("");
        this.videoExpiresIn.set(null);
      }
    } catch (error) {
      if (generation !== this.generation) return;
      this.error.set(this.publicError(error));
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }
  async loadVideo(): Promise<void> {
    const review = this.review();
    if (!review?.videoEnabled || this.loadingVideo()) return;
    if (Date.parse(review.expiresAt) <= Date.now()) {
      this.videoError.set("Este enlace de revisión venció.");
      return;
    }
    this.loadingVideo.set(true);
    const generation = this.generation;
    this.videoError.set("");
    this.videoUrl.set("");
    try {
      const grant = await this.api.publicVideo(this.token);
      if (generation !== this.generation) return;
      const url = new URL(grant.url);
      if (!(["https:", "http:"].includes(url.protocol)) || !grant.contentType.startsWith("video/"))
        throw new Error("El servidor no devolvió un permiso de video válido.");
      this.videoUrl.set(url.href);
      this.videoExpiresIn.set(grant.expiresInSeconds);
    } catch (error) {
      if (generation !== this.generation) return;
      this.videoError.set(this.publicError(error));
    } finally {
      if (generation === this.generation) this.loadingVideo.set(false);
    }
  }
  canLoadVideo(): boolean {
    const review = this.review();
    return !!review?.videoEnabled && Date.parse(review.expiresAt) > Date.now();
  }
  isExpired(): boolean {
    const expiresAt = this.review()?.expiresAt;
    return !!expiresAt && Date.parse(expiresAt) <= Date.now();
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
}
