// Hash-chained audit ledger — the spine of the "every money action
// explainable" bar. Every agent/user/system action that touches money (and
// every blocked attempt) is appended here with its reasoning, the bounds that
// were checked, and a tamper-evident link to the previous event.
//
// The in-memory array is the live ledger; data/audit.jsonl is a durable
// mirror. /api/audit/verify recomputes the chain over the live ledger.

import fs from 'node:fs';
import path from 'node:path';
import { sha256hex, stableStringify, uid, nowISO } from './util.js';

export function createAudit(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'audit.jsonl');
  const events = [];
  let prevHash = 'GENESIS';

  function append({ sessionId, actor, tool, action, status = 'ok', explanation, reasoning = '', payload = {}, bounds = [] }) {
    const event = {
      id: uid('evt'),
      seq: events.length + 1,
      ts: nowISO(),
      sessionId: sessionId || '*',
      actor, // 'agent' | 'user' | 'system'
      tool, // agent tool or endpoint that initiated it
      action, // e.g. money.coupon_applied, cart.add, money.payment_captured
      status, // ok | blocked | gate_denied | failed | recovered | replay
      explanation, // one line, shown in UI + readable by auditors
      reasoning,
      payload,
      bounds, // [{name, detail, pass}]
    };
    event.prevHash = prevHash;
    event.hash = sha256hex(prevHash + stableStringify({ ...event, hash: undefined }));
    prevHash = event.hash;
    events.push(event);
    fs.appendFileSync(file, JSON.stringify(event) + '\n');
    return event;
  }

  function list(sessionId) {
    return sessionId ? events.filter((e) => e.sessionId === sessionId) : events;
  }

  function verify() {
    let p = 'GENESIS';
    for (const e of events) {
      const expected = sha256hex(p + stableStringify({ ...e, hash: undefined }));
      if (e.prevHash !== p || e.hash !== expected) {
        return { valid: false, count: events.length, brokenAt: e.seq, id: e.id };
      }
      p = e.hash;
    }
    return { valid: true, count: events.length };
  }

  // Demo-only: corrupt the newest event in the ledger so judges can watch
  // /api/audit/verify flip to invalid. Clearly labeled as a dev action.
  function tamperLast() {
    const e = events[events.length - 1];
    if (!e) return null;
    e.explanation = `[TAMPERED] ${e.explanation}`;
    fs.writeFileSync(file, events.map((x) => JSON.stringify(x)).join('\n') + '\n');
    return e.id;
  }

  return { append, list, verify, tamperLast, file };
}
