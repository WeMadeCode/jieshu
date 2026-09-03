import { HandlerPipeline } from '../../src/effect-pipeline';
import type { PipelineHandler } from '../../src/effect-pipeline';

type Tag = 'LINK' | 'STYLE' | 'UNKNOWN';
interface Context {
  readonly trace: string[];
}

function handler(key: Tag, marker: string): PipelineHandler<Tag, Context, string> {
  return {
    key,
    handle(context) {
      context.trace.push(marker);
      return marker;
    },
  };
}

describe('effect insertion handler pipeline', () => {
  it('dispatches only the handler registered for the requested tag', () => {
    const trace: string[] = [];
    const fallback = jest.fn(() => 'fallback');
    const pipeline = new HandlerPipeline<Tag, Context, string>([handler('LINK', 'link'), handler('STYLE', 'style')]);

    expect(pipeline.dispatch('STYLE', { trace }, fallback)).toBe('style');
    expect(trace).toEqual(['style']);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('uses the native-insertion fallback for an unregistered tag', () => {
    const trace: string[] = [];
    const pipeline = new HandlerPipeline<Tag, Context, string>([handler('LINK', 'link')]);

    const result = pipeline.dispatch('UNKNOWN', { trace }, (context) => {
      context.trace.push('fallback');
      return 'native';
    });

    expect(result).toBe('native');
    expect(trace).toEqual(['fallback']);
  });

  it('rejects duplicate registrations before insertion can run', () => {
    expect(
      () => new HandlerPipeline<Tag, Context, string>([handler('LINK', 'first'), handler('LINK', 'second')]),
    ).toThrow('Duplicate effect handler: LINK');
  });
});
