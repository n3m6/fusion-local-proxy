import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePort } from './main.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('resolvePort returns 3000 when PORT is not set', () => {
  const oldPort = process.env.PORT;
  delete process.env.PORT;

  try {
    assert.equal(resolvePort(), 3000);
  } finally {
    if (oldPort !== undefined) {
      process.env.PORT = oldPort;
    }
  }
});

test('resolvePort returns custom value when PORT is set', () => {
  const oldPort = process.env.PORT;
  process.env.PORT = '4000';

  try {
    assert.equal(resolvePort(), 4000);
  } finally {
    if (oldPort !== undefined) {
      process.env.PORT = oldPort;
    } else {
      delete process.env.PORT;
    }
  }
});
