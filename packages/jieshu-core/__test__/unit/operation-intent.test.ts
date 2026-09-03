import { beginOperation, isOperationCurrent, observeOperation } from '../../src/operation-intent';

describe('operation intents', () => {
  beforeEach(() => {
    window.__JIESHU_CORE_INTENTS = undefined;
  });

  test('a newer same-name operation supersedes the previous intent', () => {
    const first = beginOperation('catalog');
    const second = beginOperation('catalog');

    expect(isOperationCurrent(first)).toBe(false);
    expect(isOperationCurrent(second)).toBe(true);
  });

  test('a newer intent resolves the previous cancellation signal', async () => {
    const first = beginOperation('catalog');
    beginOperation('catalog');

    await expect(first.cancelled).resolves.toBeUndefined();
  });

  test('different application names remain independent', () => {
    const catalog = beginOperation('catalog');
    beginOperation('checkout');

    expect(isOperationCurrent(catalog)).toBe(true);
  });

  test('an observation detects work issued after an idle preload request', () => {
    const preload = observeOperation('catalog');
    beginOperation('catalog');

    expect(isOperationCurrent(preload)).toBe(false);
  });
});
