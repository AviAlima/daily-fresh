(function () {
  interface UpdateRegistration {
    update(): Promise<unknown>;
    active?: UpdateWorker | null;
    installing?: UpdateWorker | null;
    waiting?: UpdateWorker | null;
  }
  interface UpdateWorker {
    state?: string;
    postMessage?(message: unknown): void;
    addEventListener?(type: 'statechange', listener: () => void): void;
    removeEventListener?(type: 'statechange', listener: () => void): void;
  }

  function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('update-timeout')), Math.max(0, timeoutMs));
      promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
    });
  }

  function waitForActivation(worker: UpdateWorker): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!worker.addEventListener || !worker.removeEventListener || worker.state === 'activated' || worker.state === 'redundant') {
        resolve();
        return;
      }
      const check = () => {
        if (worker.state === 'activated' || worker.state === 'redundant') {
          worker.removeEventListener!('statechange', check);
          resolve();
        }
      };
      worker.addEventListener!('statechange', check);
      check();
    });
  }

  async function refresh(options: {
    getRegistration(): Promise<UpdateRegistration | undefined>;
    reload(): void;
    timeoutMs?: number;
  }): Promise<void> {
    // Wait for a newly installed worker before reloading. The old 3s check
    // could reload the page while the new worker was still caching assets.
    const timeoutMs = options.timeoutMs ?? 15000;
    const deadline = Date.now() + timeoutMs;
    const remaining = () => Math.max(0, deadline - Date.now());
    try {
      const registration = await within(options.getRegistration(), remaining());
      if (registration) {
        const previousActive = registration.active;
        await within(registration.update(), remaining());
        const candidate = registration.installing || registration.waiting;
        if (registration.waiting && registration.waiting.postMessage) {
          try { registration.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (e) {}
        }
        if (candidate && candidate !== previousActive && candidate.addEventListener) {
          await within(waitForActivation(candidate), remaining());
        }
      }
    } catch (e) {
      // Refresh is still useful when update checks fail or time out.
    }
    options.reload();
  }

  const root: any = typeof window !== 'undefined' ? window : global;
  root.AppUpdates = { refresh };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AppUpdates;
})();
