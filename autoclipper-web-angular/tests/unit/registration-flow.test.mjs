import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthComponent } from '../../.local/tests/client.mjs';

function registerComponent(register) {
  const component = Object.create(AuthComponent.prototype);
  component.route = { snapshot: { data: { mode: 'register' }, queryParamMap: { get: () => null } } };
  component.api = { register };
  component.busy = signal(false);
  component.error = signal('');
  component.message = signal('');
  component.registerAccepted = signal(false);
  component.authCompleted = signal(false);
  component.registeredEmail = signal('');
  component.name = '  Yojhan Huanca  ';
  component.email = ' yojhan@example.com ';
  component.password = 'long-enough-pass';
  component.passwordConfirmation = 'long-enough-pass';
  return component;
}

function authComponent(mode, api) {
  const component = Object.create(AuthComponent.prototype);
  component.route = { snapshot: { data: { mode }, queryParamMap: { get: () => null } } };
  component.api = api;
  component.busy = signal(false);
  component.error = signal('');
  component.message = signal('');
  component.authCompleted = signal(false);
  component.registerAccepted = signal(false);
  component.email = 'person@example.test';
  component.password = 'long-enough-password';
  component.token = 'one-use-token';
  return component;
}

test('registration validates only documented client requirements and masks the address after acceptance', async () => {
  let submitted;
  const component = registerComponent(async body => { submitted = body; return { accepted: true }; });
  assert.equal(component.registrationValid(), true);
  assert.equal(component.registrationPasswordFeedback(), 'Longitud válida; el rango es 12–128.');
  await component.submit();
  assert.deepEqual(submitted, { name: 'Yojhan Huanca', email: 'yojhan@example.com', password: 'long-enough-pass' });
  assert.equal(component.registerAccepted(), true);
  assert.equal(component.password, '');
  assert.equal(component.passwordConfirmation, '');
  assert.equal(component.registeredEmail(), 'yojhan@example.com');
  assert.equal(component.maskedRegistrationEmail(), 'y•••@e•••.com');
  assert.equal(component.error(), '');
});

test('accepted duplicate and new registration responses share the same anti-enumeration state', async () => {
  const acceptedMessage = async email => {
    const component = registerComponent(async () => ({ accepted: true }));
    component.email = email;
    await component.submit();
    return { state: component.registerAccepted(), email: component.registeredEmail(), message: component.message() };
  };
  assert.deepEqual(await acceptedMessage('new@example.com'), { state: true, email: 'new@example.com', message: '' });
  assert.deepEqual(await acceptedMessage('existing@example.com'), { state: true, email: 'existing@example.com', message: '' });
});

test('network failure does not expose account existence or return server detail', async () => {
  const component = registerComponent(async () => { throw new HttpErrorResponse({ status: 0, statusText: 'Network Error' }); });
  await component.submit();
  assert.equal(component.registerAccepted(), false);
  assert.match(component.error(), /por privacidad, no confirmamos si existe una cuenta asociada/);
  assert.doesNotMatch(component.error(), /yojhan@example\.com|Network Error/);
});

test('invalid client values do not call the registration endpoint', async () => {
  let calls = 0;
  const component = registerComponent(async () => { calls++; return { accepted: true }; });
  component.name = '   ';
  component.password = 'short';
  component.passwordConfirmation = 'different';
  assert.equal(component.registrationValid(), false);
  assert.match(component.registrationPasswordFeedback(), /Añade 7; el rango es 12–128/);
  await component.submit();
  assert.equal(calls, 0);
  assert.match(component.error(), /Revisa los campos/);
});

test('verification, recovery and reset success become final states and cannot be submitted twice', async () => {
  for (const [mode, method, message] of [
    ['verify', 'verify', 'Correo verificado. Ya puedes iniciar sesión.'],
    ['forgot', 'forgot', 'Si la cuenta corresponde, recibirás las instrucciones por correo.'],
    ['reset', 'reset', 'Contraseña actualizada. Inicia sesión de nuevo.'],
  ]) {
    let calls = 0;
    const api = { [method]: async () => { calls++; return {}; } };
    const component = authComponent(mode, api);
    await component.submit();
    assert.equal(component.authCompleted(), true, `${mode} presents a terminal success state`);
    assert.equal(component.message(), message);
    assert.equal(component.completionTitle().length > 0, true);
    await component.submit();
    assert.equal(calls, 1, `${mode} cannot replay after success`);
  }
});

test('verification and recovery errors are actionable without exposing backend codes or account existence', async () => {
  const verify = authComponent('verify', { verify: async () => { throw new HttpErrorResponse({ status: 400, error: { code: 'TOKEN_EXPIRED' } }); } });
  await verify.submit();
  assert.match(verify.error(), /puede haber vencido/i);
  assert.match(verify.error(), /no puede reenviar/);
  assert.doesNotMatch(verify.error(), /TOKEN_EXPIRED/);
  const forgot = authComponent('forgot', { forgot: async () => { throw new HttpErrorResponse({ status: 400, error: { code: 'EMAIL_UNKNOWN' } }); } });
  await forgot.submit();
  assert.match(forgot.error(), /por privacidad no confirmamos cuentas/);
  assert.doesNotMatch(forgot.error(), /EMAIL_UNKNOWN|person@example\.test/);
});
