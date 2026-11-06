import { Injectable } from '@angular/core';

export type AppearanceTheme = 'light' | 'dark' | 'system';

const isAppearanceTheme = (value: string | null): value is AppearanceTheme =>
  value === 'light' || value === 'dark' || value === 'system';

@Injectable({ providedIn: 'root' })
export class AppearancePreferenceService {
  private userId = '';
  private preference: AppearanceTheme = 'system';
  private hasLocalChoice = false;

  restoreForUser(userId: string): void {
    if (!userId) return this.useDesignTheme();
    this.userId = userId;
    let cached: string | null = null;
    try { cached = localStorage.getItem(this.storageKey(userId)); } catch { /* Storage may be unavailable; the API remains authoritative. */ }
    this.hasLocalChoice = isAppearanceTheme(cached);
    this.preference = isAppearanceTheme(cached) ? cached : 'system';
    this.applyToDocument();
  }

  applyFromProfile(userId: string, theme: AppearanceTheme): void {
    if (this.userId !== userId) {
      this.userId = userId;
      this.hasLocalChoice = false;
    }
    if (!this.hasLocalChoice) this.preference = theme === 'dark' ? 'light' : theme;
    this.applyToDocument();
  }

  applyFromUserChoice(userId: string, theme: AppearanceTheme): void {
    this.userId = userId;
    this.preference = theme;
    this.hasLocalChoice = true;
    try { localStorage.setItem(this.storageKey(userId), theme); } catch { /* A failed cache write does not undo the server preference. */ }
    this.applyToDocument();
  }

  profileTheme(userId: string, theme: AppearanceTheme): AppearanceTheme {
    if (this.userId === userId && this.hasLocalChoice) return this.preference;
    return theme === 'dark' ? 'light' : theme;
  }

  useDesignTheme(): void {
    this.userId = '';
    this.preference = 'light';
    this.hasLocalChoice = false;
    this.applyToDocument();
  }

  private storageKey(userId: string): string {
    return `autoclipper:theme:v2:${encodeURIComponent(userId)}`;
  }

  private applyToDocument(): void {
    if (typeof document === 'undefined') return;
    // Default, system, and pre-existing profile dark values resolve to light.
    // Dark remains available when explicitly selected in the current UI.
    const dark = this.preference === 'dark';
    document.documentElement.dataset['theme'] = dark ? 'dark' : 'light';
  }
}
