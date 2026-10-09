// Client for physics.worker.ts: runs the dice and throw pre-sims in a worker so Rapier never
// blocks a frame. Where a module worker can't start (old browsers, a failed load), every job —
// pending and later — runs on the main thread instead, through the same lazy chunks as before.
import type { PresimOptions, PresimResult } from './presim';
import type { PresimThrowInput, PresimThrowOutput } from './throwSim';

type Job = { kind: 'dice'; input: PresimOptions } | { kind: 'throw'; input: PresimThrowInput };

export type PhysicsRequest = Job & { id: number };

export type PhysicsReply =
  | { id: number; result: PresimResult | PresimThrowOutput; error?: undefined }
  | { id: number; error: string; result?: undefined };

interface Pending {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
  job: Job;
}

/** undefined: not started yet; null: unavailable (main-thread fallback from then on). */
let worker: Worker | null | undefined;
let nextId = 0;
const pending = new Map<number, Pending>();

function runLocally(job: Job): Promise<unknown> {
  return job.kind === 'dice'
    ? import('./presim').then((m) => m.presimulateThrow(job.input))
    : import('./throwSim').then((m) => m.presimThrow(job.input));
}

function giveUp(w: Worker): void {
  worker = null;
  w.terminate();
  const waiting = [...pending.values()];
  pending.clear();
  for (const p of waiting) runLocally(p.job).then(p.resolve, p.reject);
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof Worker === 'undefined') return (worker = null);
    const w = new Worker(new URL('./physics.worker.ts', import.meta.url), {
      type: 'module',
      name: 'physics',
    });
    w.onmessage = (e: MessageEvent<PhysicsReply>) => {
      const reply = e.data;
      const p = pending.get(reply.id);
      if (!p) return;
      pending.delete(reply.id);
      if (reply.error !== undefined) p.reject(new Error(reply.error));
      else p.resolve(reply.result);
    };
    // The script didn't load or the worker died: finish everything on the main thread.
    w.onerror = (e) => {
      console.warn('[physics] worker unavailable; simulating on the main thread', e.message);
      e.preventDefault();
      giveUp(w);
    };
    return (worker = w);
  } catch {
    return (worker = null);
  }
}

function run(job: Job): Promise<unknown> {
  const w = getWorker();
  if (!w) return runLocally(job);
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject, job });
    const req: PhysicsRequest = { id, ...job };
    w.postMessage(req);
  });
}

export const presimulateDice = (input: PresimOptions): Promise<PresimResult> =>
  run({ kind: 'dice', input }) as Promise<PresimResult>;

export const presimulateThrowInWorker = (input: PresimThrowInput): Promise<PresimThrowOutput> =>
  run({ kind: 'throw', input }) as Promise<PresimThrowOutput>;
