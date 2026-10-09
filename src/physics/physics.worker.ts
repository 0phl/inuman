// The Rapier pre-simulations, off the main thread: a dice roll's pre-sim is ~50 ms of solid work on
// a mid phone (and up to 5 re-throws), which used to freeze the frame the player tapped in.
// Requests come from physicsWorker.ts; the recorded frames are transferred back, not copied.
import { presimulateThrow } from './presim.ts';
import { presimThrow } from './throwSim.ts';
import type { PhysicsReply, PhysicsRequest } from './physicsWorker.ts';

interface WorkerScope {
  onmessage: ((e: MessageEvent<PhysicsRequest>) => void) | null;
  postMessage(message: PhysicsReply, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  const req = e.data;
  const job = req.kind === 'dice' ? presimulateThrow(req.input) : presimThrow(req.input);
  job.then(
    (result) => scope.postMessage({ id: req.id, result }, [result.frames.buffer]),
    (err: unknown) => scope.postMessage({ id: req.id, error: String(err) }),
  );
};
