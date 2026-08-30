// Audit ledger tests — tamper-evidence is the point.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAudit } from '../server/audit.js';

function tmpAudit() {
  return createAudit(fs.mkdtempSync(path.join(os.tmpdir(), 'audit-')));
}

test('hash chain verifies over a clean ledger', () => {
  const a = tmpAudit();
  a.append({ sessionId: 's', actor: 'agent', tool: 't', action: 'cart.add', explanation: 'x' });
  a.append({ sessionId: 's', actor: 'agent', tool: 't', action: 'cart.add', explanation: 'y' });
  a.append({ sessionId: 's', actor: 'user', tool: 'u', action: 'money.payment_captured', explanation: 'z' });
  const v = a.verify();
  assert.equal(v.valid, true);
  assert.equal(v.count, 3);
});

test('tampering breaks verification at the right position', () => {
  const a = tmpAudit();
  a.append({ sessionId: 's', actor: 'agent', tool: 't', action: 'cart.add', explanation: 'honest' });
  a.append({ sessionId: 's', actor: 'agent', tool: 't', action: 'cart.add', explanation: 'also honest' });
  a.tamperLast();
  const v = a.verify();
  assert.equal(v.valid, false);
  assert.equal(v.brokenAt, 2);
});

test('events persist to the JSONL mirror', () => {
  const a = tmpAudit();
  a.append({ sessionId: 'sX', actor: 'agent', tool: 't', action: 'catalog.search', explanation: 'q' });
  const lines = fs.readFileSync(a.file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).sessionId, 'sX');
});

test('session scoping filters the listing', () => {
  const a = tmpAudit();
  a.append({ sessionId: 'sA', actor: 'agent', tool: 't', action: 'a', explanation: '' });
  a.append({ sessionId: 'sB', actor: 'agent', tool: 't', action: 'b', explanation: '' });
  assert.equal(a.list('sA').length, 1);
  assert.equal(a.list().length, 2);
});
