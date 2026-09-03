import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Drives converter.js against a stand-in Worker. Cancellation tears the thread
// down rather than asking it to stop, so the regression that matters is whether
// the *next* conversion still gets a working worker.

class FakeWorker {
  static instances = [];
  constructor() {
    this.sent = [];
    this.terminated = false;
    FakeWorker.instances.push(this);
  }
  postMessage(msg) { this.sent.push(msg); }
  terminate() { this.terminated = true; }
  // Test-side helpers to play the worker's part.
  reply(data) { this.onmessage?.({ data }); }
  fail(message) { this.onerror?.({ message }); }
}

let convert, cancelAll;

beforeEach(async () => {
  FakeWorker.instances = [];
  globalThis.Worker = FakeWorker;
  // Fresh module instance per test so the cached worker does not leak across.
  ({ convert, cancelAll } = await import(`../src/lib/converter.js?t=${Math.random()}`));
});

afterEach(() => { delete globalThis.Worker; });

test('resolves with the svg the worker sends back', async () => {
  const p = convert(new Float32Array(9), { mode: 'projection' });
  const w = FakeWorker.instances[0];
  w.reply({ id: w.sent[0].id, svg: '<svg/>', stats: { paths: 1 } });
  const { svg, stats } = await p;
  assert.equal(svg, '<svg/>');
  assert.equal(stats.paths, 1);
});

test('forwards progress without settling the promise', async () => {
  const seen = [];
  const p = convert(new Float32Array(9), {}, (x) => seen.push(x));
  const w = FakeWorker.instances[0];
  w.reply({ id: w.sent[0].id, progress: { stage: 'Slicing', fraction: 0.25 } });
  w.reply({ id: w.sent[0].id, progress: { stage: 'Slicing', fraction: 0.5 } });
  assert.deepEqual(seen, [{ stage: 'Slicing', fraction: 0.25 }, { stage: 'Slicing', fraction: 0.5 }]);
  w.reply({ id: w.sent[0].id, svg: '<svg/>', stats: {} });
  await p;
});

test('rejects with the worker error message', async () => {
  const p = convert(new Float32Array(9), {});
  const w = FakeWorker.instances[0];
  w.reply({ id: w.sent[0].id, error: 'The plane does not intersect this model.' });
  await assert.rejects(p, /does not intersect/);
});

test('cancelling terminates the worker and rejects the pending job', async () => {
  const p = convert(new Float32Array(9), {});
  const first = FakeWorker.instances[0];
  cancelAll();
  assert.equal(first.terminated, true);
  await assert.rejects(p, (err) => err.cancelled === true && /cancelled/i.test(err.message));
});

test('a conversion after a cancel gets a fresh worker and still completes', async () => {
  const cancelled = convert(new Float32Array(9), {});
  cancelAll();
  await assert.rejects(cancelled);

  const p = convert(new Float32Array(9), {});
  assert.equal(FakeWorker.instances.length, 2, 'a new worker must replace the terminated one');
  const second = FakeWorker.instances[1];
  assert.equal(second.terminated, false);
  second.reply({ id: second.sent[0].id, svg: '<svg/>', stats: {} });
  assert.equal((await p).svg, '<svg/>');
});

test('cancelling with nothing running is harmless', () => {
  assert.doesNotThrow(() => cancelAll());
});

test('a worker that fails to start rejects every queued job', async () => {
  const a = convert(new Float32Array(9), {});
  const w = FakeWorker.instances[0];
  w.fail('Failed to load module script');
  await assert.rejects(a, /Failed to load module script/);
});
