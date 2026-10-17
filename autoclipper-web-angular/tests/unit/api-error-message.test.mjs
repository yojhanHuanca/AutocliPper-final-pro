import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorMessage, HttpErrorResponse } from '../../.local/tests/client.mjs';

test('API errors distinguish unavailable service, expired session, login rejection and CSRF failure', () => {
  const unavailable=new HttpErrorResponse({status:0,url:'http://localhost:3000/v1/auth/csrf'});
  const login=new HttpErrorResponse({status:401,url:'http://localhost:3000/v1/auth/login'});
  const expired=new HttpErrorResponse({status:401,url:'http://localhost:3000/v1/projects'});
  const csrf=new HttpErrorResponse({status:403,url:'http://localhost:3000/v1/projects',error:{code:'CSRF_TOKEN_INVALID'}});
  assert.match(errorMessage(unavailable),/conectar con el servidor/);
  assert.match(errorMessage(login),/correo, la contraseña/);
  assert.match(errorMessage(expired),/sesión venció/);
  assert.match(errorMessage(csrf),/verificación de seguridad/);
});
