import { Injectable } from "@angular/core";

@Injectable({ providedIn: "root" })
export class EditorNavigationService {
  private active: { id: string; confirmDiscard: () => boolean } | null = null;
  private approvedId: string | null = null;

  register(id: string, confirmDiscard: () => boolean): () => void {
    const entry = { id, confirmDiscard };
    this.active = entry;
    return () => {
      if (this.active === entry) this.active = null;
    };
  }

  allowEdit(id: string): boolean {
    const current = this.active;
    if (!current || current.id === id) return true;
    if (!current.confirmDiscard()) return false;
    this.approvedId = id;
    return true;
  }

  consumeApproval(id: string): boolean {
    if (this.approvedId !== id) return false;
    this.approvedId = null;
    return true;
  }
}
