import type { EventObj } from '../../src/event';

describe('event registry bootstrap', () => {
  afterEach(() => {
    vi.resetModules();
    window.__POWERED_BY_JIESHU__ = false;
    Reflect.deleteProperty(window, '__JIESHU_INJECT');
  });

  it('reuses the canonical injected registry for host and nested applications', async () => {
    const registry = new Map<string, EventObj>();
    window.__JIESHU_INJECT = { appEventObjMap: registry } as Window['__JIESHU_INJECT'];

    const eventModule = await import('../../src/event');
    expect(eventModule.appEventObjMap).toBe(registry);
  });

  it('publishes a newly created host registry on the canonical injection key', async () => {
    Reflect.deleteProperty(window, '__JIESHU_INJECT');

    const eventModule = await import('../../src/event');
    expect(window.__JIESHU_INJECT?.appEventObjMap).toBe(eventModule.appEventObjMap);
  });
});
