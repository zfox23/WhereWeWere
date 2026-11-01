/**
 * Work a plugin keeps running for the signed-in user while the app is open
 * (e.g. getting locally stored recordings to the server). Each task starts
 * when an account is signed in and returns a function that stops it.
 */

export type BackgroundTask = (userId: string) => () => void;

const tasks = new Set<BackgroundTask>();

export function registerBackgroundTask(task: BackgroundTask): void {
  tasks.add(task);
}

/** Start every registered task for `userId`; returns a function that stops them all. */
export function startBackgroundTasks(userId: string): () => void {
  const stops: (() => void)[] = [];
  for (const task of tasks) {
    try {
      stops.push(task(userId));
    } catch (err) {
      console.error('Background task failed to start:', err);
    }
  }
  return () => stops.forEach((stop) => stop());
}
