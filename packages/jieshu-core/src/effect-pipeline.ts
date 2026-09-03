export interface PipelineHandler<TKey extends string, TContext, TResult> {
  readonly key: TKey;
  handle(context: TContext): TResult;
}

/**
 * Small typed registry used by the DOM insertion effect pipeline.
 *
 * Registration is validated once so the hot insertion path only performs a
 * lookup. Unknown keys deliberately use the caller supplied fallback because
 * native DOM insertion remains the safe default for elements we do not own.
 */
export class HandlerPipeline<TKey extends string, TContext, TResult> {
  private readonly handlers = new Map<TKey, PipelineHandler<TKey, TContext, TResult>>();

  constructor(handlers: ReadonlyArray<PipelineHandler<TKey, TContext, TResult>>) {
    handlers.forEach((handler) => {
      if (this.handlers.has(handler.key)) {
        throw new Error(`Duplicate effect handler: ${handler.key}`);
      }
      this.handlers.set(handler.key, handler);
    });
  }

  dispatch(key: TKey, context: TContext, fallback: (context: TContext) => TResult): TResult {
    const handler = this.handlers.get(key);
    return handler ? handler.handle(context) : fallback(context);
  }
}
