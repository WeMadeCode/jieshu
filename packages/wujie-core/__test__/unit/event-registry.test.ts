import type { EventObj } from '../../src/event';

describe('event registry bootstrap', () => {
  afterEach(() => {
    jest.resetModules();
    window.__POWERED_BY_WUJIE__ = false;
    Reflect.deleteProperty(window, '__WUJIE_INJECT');
  });

  it('reuses the canonical injected registry for host and nested applications', () => {
    const registry = new Map<string, EventObj>();
    window.__WUJIE_INJECT = { appEventObjMap: registry } as Window['__WUJIE_INJECT'];

    jest.isolateModules(() => {
      const eventModule = require('../../src/event') as typeof import('../../src/event');
      expect(eventModule.appEventObjMap).toBe(registry);
    });
  });

  it('publishes a newly created host registry on the canonical injection key', () => {
    Reflect.deleteProperty(window, '__WUJIE_INJECT');

    jest.isolateModules(() => {
      const eventModule = require('../../src/event') as typeof import('../../src/event');
      expect(window.__WUJIE_INJECT?.appEventObjMap).toBe(eventModule.appEventObjMap);
    });
  });
});
