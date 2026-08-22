export async function runBatch(items, handler, options = {}) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('批处理队列不能为空');
  if (typeof handler !== 'function') throw new TypeError('handler is required');

  const results = [];
  for (let index = 0; index < items.length; index += 1) {
    if (options.signal?.aborted) return { results, cancelled: true };
    const item = items[index];
    options.onItemStart?.({ item, index, total: items.length });

    try {
      const value = await handler(item, index, {
        signal: options.signal,
        onProgress(progress) {
          options.onProgress?.({ ...progress, item, index, totalItems: items.length });
        },
      });
      if (options.signal?.aborted) return { results, cancelled: true };
      const result = { item, index, status: 'success', value };
      results.push(result);
      await options.onItemComplete?.(result);
    } catch (error) {
      if (options.signal?.aborted) return { results, cancelled: true };
      const result = { item, index, status: 'failed', error };
      results.push(result);
      await options.onItemComplete?.(result);
    }
  }

  return { results, cancelled: false };
}

export function summarizeBatchResults(results) {
  return results.reduce((summary, result) => {
    summary.total += 1;
    if (result.status === 'success') summary.success += 1;
    else summary.failed += 1;
    return summary;
  }, { total: 0, success: 0, failed: 0 });
}
