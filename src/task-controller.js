export class TaskCancelledError extends Error {
  constructor(message = '任务已取消') {
    super(message);
    this.name = 'TaskCancelledError';
  }
}

export function createTaskRun({ onProgress = () => {} } = {}) {
  const controller = new AbortController();

  return {
    signal: controller.signal,
    cancel() {
      controller.abort();
    },
    report(completed, total, message = '') {
      throwIfAborted(controller.signal);
      const safeTotal = Math.max(1, total || 1);
      const ratio = Math.min(1, Math.max(0, completed / safeTotal));
      onProgress({ completed, total, ratio, message });
    },
    async checkpoint(completed, total, message = '') {
      this.report(completed, total, message);
      await yieldToMainThread();
      throwIfAborted(controller.signal);
    },
    throwIfCancelled() {
      throwIfAborted(controller.signal);
    },
  };
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw new TaskCancelledError();
}

function yieldToMainThread() {
  return new Promise(resolve => setTimeout(resolve, 0));
}
