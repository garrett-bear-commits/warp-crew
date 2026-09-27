import assert from 'node:assert/strict';
import * as bridge from '../src/ui/bridge.js';
import { createNewPlayer } from '../src/systems/player.js';

// A tester must find restart in Settings, not a hidden unconfirmed Shop action.
assert.equal(typeof bridge.renderQaSettings, 'function');
const settings = bridge.renderQaSettings();
assert.match(settings, /<h2>Settings<\/h2>/);
assert.match(settings, /data-act="restart-save"/);
assert.doesNotMatch(settings, /data-act="qa-reset"/);
assert.equal(typeof bridge.renderLog, 'function');
const log = bridge.renderLog(createNewPlayer({ now: 1 }), [], { goals: [] });
assert.match(log, /<h2>Settings<\/h2>/);
assert.match(log, /data-act="restart-save"/);

// The destructive action must require a second, explicit choice.
assert.equal(typeof bridge.renderRestartSaveConfirm, 'function');
const confirm = bridge.renderRestartSaveConfirm();
assert.match(confirm, /role="dialog"[^>]*aria-modal="true"/);
assert.match(confirm, /data-act="restart-save-cancel"/);
assert.match(confirm, /data-act="restart-save-confirm"/);
assert.match(confirm, /cannot be undone/i);

console.log('qa_restart_save.test.mjs OK');
