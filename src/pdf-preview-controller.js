function createDefaultObserver(callback, options) {
  if (typeof IntersectionObserver === 'function') {
    return new IntersectionObserver(callback, options);
  }

  return {
    observe(element) {
      queueMicrotask(() => callback([{ target: element, isIntersecting: true }]));
    },
    unobserve() {},
    disconnect() {},
  };
}

export function createPdfPreviewController({
  renderPage,
  unloadPage = () => {},
  onError = () => {},
  concurrency = 2,
  rootMargin = '800px 0px',
  observerFactory = createDefaultObserver,
} = {}) {
  if (typeof renderPage !== 'function') throw new TypeError('renderPage is required');

  const items = new Map();
  const queue = [];
  const safeConcurrency = Math.max(1, Number.parseInt(concurrency, 10) || 1);
  let activeCount = 0;
  let disposed = false;

  const observer = observerFactory(handleEntries, { rootMargin, threshold: 0.01 });

  function observe(element, pageIndex) {
    if (disposed) return;
    const item = {
      element,
      pageIndex,
      visible: false,
      status: 'idle',
      controller: null,
      cleanup: null,
    };
    items.set(element, item);
    observer.observe(element);
  }

  function handleEntries(entries) {
    entries.forEach(entry => {
      const item = items.get(entry.target);
      if (!item) return;
      item.visible = entry.isIntersecting;
      if (item.visible) {
        enqueue(item);
      } else {
        release(item);
      }
    });
    pump();
  }

  function enqueue(item) {
    if (item.status !== 'idle' || queue.includes(item)) return;
    item.status = 'queued';
    queue.push(item);
  }

  function release(item) {
    if (item.status === 'queued') {
      const index = queue.indexOf(item);
      if (index >= 0) queue.splice(index, 1);
      item.status = 'idle';
    }
    if (item.status === 'rendering') item.controller?.abort();
    if (item.status === 'rendered') {
      item.cleanup?.();
      unloadPage(item.element, item.pageIndex);
      item.cleanup = null;
      item.status = 'idle';
    }
  }

  async function run(item) {
    activeCount += 1;
    item.status = 'rendering';
    const controller = new AbortController();
    item.controller = controller;

    try {
      const result = await renderPage({
        element: item.element,
        pageIndex: item.pageIndex,
        signal: controller.signal,
        registerCancel(cancel) {
          if (typeof cancel !== 'function') return;
          if (controller.signal.aborted) cancel();
          else controller.signal.addEventListener('abort', cancel, { once: true });
        },
      });
      const cleanup = typeof result?.cleanup === 'function' ? result.cleanup : null;
      if (controller.signal.aborted || !item.visible || disposed) {
        cleanup?.();
        unloadPage(item.element, item.pageIndex);
        item.status = 'idle';
      } else {
        item.cleanup = cleanup;
        item.status = 'rendered';
      }
    } catch (error) {
      item.status = 'idle';
      if (!controller.signal.aborted && !disposed) onError(error, item.pageIndex);
    } finally {
      item.controller = null;
      activeCount -= 1;
      pump();
    }
  }

  function pump() {
    if (disposed) return;
    while (activeCount < safeConcurrency && queue.length > 0) {
      const item = queue.shift();
      if (!item.visible || item.status !== 'queued') {
        if (item.status === 'queued') item.status = 'idle';
        continue;
      }
      void run(item);
    }
  }

  function clear() {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    queue.length = 0;
    items.forEach(item => {
      item.controller?.abort();
      item.cleanup?.();
      unloadPage(item.element, item.pageIndex);
    });
    items.clear();
  }

  return { observe, clear };
}
