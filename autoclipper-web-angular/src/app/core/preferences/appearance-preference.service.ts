import { Injectable } from '@angular/core';

export type AppearanceTheme = 'light' | 'dark' | 'system';

const isAppearanceTheme = (value: string | null): value is AppearanceTheme =>
  value === 'light' || value === 'dark' || value === 'system';

@Injectable({ providedIn: 'root' })
export class AppearancePreferenceService {
  private userId = '';
  private preference: AppearanceTheme = 'system';
  private readonly colorScheme = typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? null
    : window.matchMedia('(prefers-color-scheme: dark)');
  private readonly syncSystem = () => {
    if (this.preference === 'system') this.applyToDocument();
  };

  constructor() {
    this.colorScheme?.addEventListener('change', this.syncSystem);
  }

  restoreForUser(userId: string): void {
    if (!userId) return this.useDesignTheme();
    this.userId = userId;
    let cached: string | null = null;
    try { cached = localStorage.getItem(this.storageKey(userId)); } catch { /* Storage may be unavailable; the API remains authoritative. */ }
    this.preference = isAppearanceTheme(cached) ? cached : 'system';
    this.applyToDocument();
  }

  applyFromProfile(userId: string, theme: AppearanceTheme): void {
    this.userId = userId;
    this.preference = theme;
    try { localStorage.setItem(this.storageKey(userId), theme); } catch { /* A failed cache write does not undo the server preference. */ }
    this.applyToDocument();
  }

  useDesignTheme(): void {
    this.userId = '';
    this.preference = 'light';
    this.applyToDocument();
  }

  private storageKey(userId: string): string {
    return `autoclipper:theme:${encodeURIComponent(userId)}`;
  }

  private applyToDocument(): void {
    if (typeof document === 'undefined') return;
    const dark = this.preference === 'dark' || (this.preference === 'system' && !!this.colorScheme?.matches);
    document.documentElement.dataset['theme'] = dark ? 'dark' : 'light';
  }
}
