(function () {
  interface UpdateRegistration {
    update(): Promise<unknown>;
    waiting?: { postMessage(message: unknown): void } | null;
  }

  async function refresh(options: {
    getRegistration(): Promise<UpdateRegistration | undefined>;
    reload(): void;
    timeoutMs?: number;
  }): Promise<void> {
    // Checking the worker is useful but must never gate a normal app reload.
    // Keep offline caches intact; the worker already revalidates network assets.
    await new Promise<void>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      function finish() {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      }
      timer = setTimeout(finish, options.timeoutMs ?? 3000);
      Promise.resolve().then(async () => {
        const registration = await options.getRegistration();
        if (!registration) return;
        await registration.update();
        if (!settled && registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }).then(finish, finish);
    });
    options.reload();
  }

  const root: any = typeof window !== 'undefined' ? window : global;
  root.AppUpdates = { refresh };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AppUpdates;
})();
