import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canInviteAs, canManageMember, canManageWorkspace, canTransferOwnership, hasWorkspaceLevel } from '../../.local/tests/client.mjs';

test('workspace capabilities follow the API role hierarchy', () => {
  assert.equal(hasWorkspaceLevel('editor', 'reader'), true);
  assert.equal(hasWorkspaceLevel('reader', 'editor'), false);
  assert.equal(canManageWorkspace('owner'), true);
  assert.equal(canManageWorkspace('admin'), true);
  assert.equal(canManageWorkspace('editor'), false);
  assert.equal(canManageWorkspace('reader'), false);
});

test('invitation roles and member changes enforce owner and administrator boundaries', () => {
  assert.equal(canInviteAs('admin', 'editor'), true);
  assert.equal(canInviteAs('admin', 'reader'), true);
  assert.equal(canInviteAs('admin', 'admin'), false);
  assert.equal(canInviteAs('owner', 'admin'), true);
  assert.equal(canInviteAs('editor', 'reader'), false);
  assert.equal(canManageMember('admin', 'editor'), true);
  assert.equal(canManageMember('admin', 'admin'), false);
  assert.equal(canManageMember('admin', 'owner'), false);
  assert.equal(canManageMember('owner', 'admin'), true);
  assert.equal(canManageMember('owner', 'owner'), false);
});

test('ownership transfer is limited to team owners', () => {
  assert.equal(canTransferOwnership('owner', 'team'), true);
  assert.equal(canTransferOwnership('owner', 'personal'), false);
  assert.equal(canTransferOwnership('admin', 'team'), false);
});
