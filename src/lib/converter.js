// Thin promise wrapper around the conversion worker. One worker is reused for
// the whole session; jobs are queued so a batch converts sequentially without
// spawning a thread per file.
//
// Cancellation works by terminating the worker outright. A long boolean union
// cannot be interrupted cooperatively, so tearing the thread down is the only
// way to actually stop it; the next job spins up a fresh one.

let worker = null;
let seq = 0;
const pending = new Map();

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./convert.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const { id, svg, stats, error, progress } = e.data;
    const job = pending.get(id);
    if (!job) return;
    if (progress) {
      job.onProgress?.(progress);
      return;
    }
    pending.delete(id);
    if (error) job.reject(new Error(error));
    else job.resolve({ svg, stats });
  };
  worker.onerror = (e) => {
    const message = e.message || 'The conversion worker failed to start.';
    for (const job of pending.values()) job.reject(new Error(message));
    pending.clear();
  };
  // A module worker that fails to load reports here rather than via onerror.
  worker.onmessageerror = () => {
    for (const job of pending.values()) job.reject(new Error('The conversion worker sent an unreadable message.'));
    pending.clear();
  };
  return worker;
}

export function convert(positions, settings, onProgress) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    ensureWorker().postMessage({ id, positions, settings });
  });
}

export function cancelAll() {
  if (!worker) return;
  worker.terminate();
  worker = null;
  for (const job of pending.values()) {
    job.reject(Object.assign(new Error('Conversion cancelled.'), { cancelled: true }));
  }
  pending.clear();
}
