import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('active session revocation is visually distinct while revoked actions stay disabled', async () => {
  const css = await readFile(new URL('../../src/app/features/settings/pages/settings.component.css', import.meta.url), 'utf8');

  assert.match(css, /\.account-studio \.session-row \.button:not\(:disabled\)\s*\{[^}]*color:\s*#a62b2b;[^}]*border-color:\s*#e8c7c7;[^}]*background:\s*#fffafa;/s);
  assert.match(css, /\.account-studio \.session-row \.button:not\(:disabled\):hover\s*\{[^}]*background:\s*#fff1f1;/s);
});

test('account preferences are separated from workspace access and use the existing team route', async () => {
  const html = await readFile(new URL('../../src/app/features/settings/pages/settings.component.html', import.meta.url), 'utf8');

  assert.match(html, /Perfil y preferencias/);
  assert.match(html, /<legend>Preferencias de interfaz y cuenta<\/legend>/);
  assert.match(html, /name="locale"[\s\S]*name="theme"/);
  assert.match(html, /aria-orientation="vertical"/);
  assert.match(html, /name="timezone"[\s\S]*name="emailNotifications"/);
  assert.match(html, /El contrato del servidor no ofrece preferencias por espacio/);
  assert.match(html, /routerLink\]="design \? '\/design\/team' : '\/app\/team'"/);
  assert.match(html, /Sesiones activas y revocadas/);
  assert.match(html, /no informa nombre del dispositivo ni ubicación/);
});

test('workspace settings summarize only the confirmed active membership and route management to the team page', async () => {
  const html = await readFile(new URL('../../src/app/features/settings/pages/settings.component.html', import.meta.url), 'utf8');
  const component = await readFile(new URL('../../src/app/features/settings/pages/settings.component.ts', import.meta.url), 'utf8');

  assert.match(component, /\["Perfil", "Espacio de trabajo", "Seguridad", "Privacidad"\]/);
  assert.match(component, /workspaces\(\)\.find\(\(workspace\) => workspace\.id === this\.workspaceStore\.workspaceId\(\)\)/);
  assert.match(html, /@if \(tab\(\) === "Espacio de trabajo"\)/);
  assert.match(html, /workspace\.name/);
  assert.match(html, /workspaceRoleLabel\(workspace\.role\)/);
  assert.match(html, /workspace\.kind === 'team'/);
  assert.match(html, /routerLink\]="'\/app\/team'"/);
  assert.match(html, /El contrato del servidor no ofrece preferencias por espacio/);
  assert.match(html, /no consulta ni inventa membresías/);
});

test('authenticated navigation stays expanded outside the clip editor and icon-only inside it', async () => {
  const css = await readFile(new URL('../../src/app/layouts/workspace/workspace-layout.component.css', import.meta.url), 'utf8');

  assert.match(css, /\.app-shell\s*\{[^}]*grid-template-columns:\s*242px\s+minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.app-shell\.editor-mode\s*\{\s*grid-template-columns:\s*68px\s+minmax\(0,1fr\)/s);
  assert.match(css, /\.app-shell\.editor-mode \.sidebar nav > a\s*\{[^}]*font-size:\s*0/);
});
