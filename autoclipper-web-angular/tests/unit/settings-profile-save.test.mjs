import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal } from '@angular/core';
import { TestBed, TestComponentRenderer } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { ActivatedRoute } from '@angular/router';
import {
  DESIGN_MODE,
  SettingsApi,
  SettingsComponent,
  SessionStore,
  WorkspaceStore,
} from '../../.local/tests/client.mjs';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

test('profile settings save API-backed interface preferences from the version-only response', async () => {
  const profile = {
    id: 'user-1',
    email: 'creator@example.test',
    name: 'Creator',
    version: 2,
    preferences: {
      locale: 'es',
      timezone: 'America/Lima',
      emailNotifications: true,
      theme: 'dark',
    },
  };
  const sessionUser = signal({ id: profile.id, name: profile.name });
  let updateBody;
  const api = {
    profile: async () => profile,
    mfa: async () => ({ enabled: false, recoveryCodesRemaining: 0 }),
    privacy: async () => ({ items: [] }),
    sessions: async () => ({ items: [] }),
    saveProfile: async (body) => { updateBody = body; return { version: 3 }; },
  };

  TestBed.configureTestingModule({ providers: [
    SettingsComponent,
    { provide: SettingsApi, useValue: api },
    { provide: DESIGN_MODE, useValue: false },
    { provide: SessionStore, useValue: { user: sessionUser } },
    { provide: WorkspaceStore, useValue: { workspaces: signal([]), workspaceId: signal(''), loaded: signal(true) } },
    { provide: ActivatedRoute, useValue: { snapshot: {} } },
    { provide: TestComponentRenderer, useValue: { insertRootElement() {}, removeAllRootElements() {} } },
  ] });

  try {
    const state = TestBed.inject(SettingsComponent);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.theme, 'light', 'a legacy dark profile uses the restored white panel by default');
    assert.equal(state.profileThemeMatches(), true, 'legacy normalization is not presented as an unsaved edit');
    state.name = 'Updated creator';
    state.locale = 'en';
    state.theme = 'dark';
    state.timezone = 'UTC';
    state.emailNotifications = false;

    await state.saveProfile();

    assert.deepEqual(updateBody.preferences, {
      locale: 'en',
      timezone: 'UTC',
      emailNotifications: false,
      theme: 'dark',
    });
    assert.equal(updateBody.version, 2);
    assert.deepEqual(state.profile(), {
      ...profile,
      name: 'Updated creator',
      version: 3,
      preferences: { locale: 'en', timezone: 'UTC', emailNotifications: false, theme: 'dark' },
    });
    assert.equal(state.locale, 'en');
    assert.equal(state.theme, 'dark');
    assert.equal(sessionUser().name, 'Updated creator');
    assert.equal(state.message(), 'Perfil actualizado.');
    assert.equal(state.error(), '');
  } finally {
    TestBed.resetTestingModule();
  }
});
