import type { CacheOptions, Lifecycle, LoadErrorHandler } from '../../src/contracts';
import { assertResolvedStartOptions, resolveOptions } from '../../src/options';
import { getAnchorElementQueryMap, getSyncUrl, mergeOptions } from '../../src/utils';

describe('resolveOptions', () => {
  test('接受没有字符串索引签名的具名业务接口', () => {
    interface BusinessProps {
      userId: string;
      featureEnabled: boolean;
    }
    interface FrameAttributes {
      title: string;
      sandbox: string;
    }

    const props: BusinessProps = { userId: 'u-1', featureEnabled: true };
    const attrs: FrameAttributes = { title: 'catalog', sandbox: 'allow-scripts' };
    const resolved = resolveOptions({ name: 'app', props, attrs });

    expect(resolved.props).toBe(props);
    expect(resolved.attrs).toBe(attrs);
  });

  test('缺少缓存时提供稳定默认值', () => {
    const resolved = resolveOptions({ name: 'app' });

    expect(resolved).toMatchObject({
      name: 'app',
      attrs: {},
      degradeAttrs: {},
      fiber: true,
      iframeAddEventListeners: [],
      iframeOnEvents: [],
      lifecycles: {},
    });
  });

  test('启动所需字段在缓存合并后统一做运行时校验', () => {
    const missing = resolveOptions({ name: 'missing' });
    expect(() => assertResolvedStartOptions(missing)).toThrow('Wujie application "missing" requires a url');

    const cached = resolveOptions({ name: 'cached' }, { name: 'cached', url: 'https://child.example/', el: '#child' });
    expect(() => assertResolvedStartOptions(cached)).not.toThrow();
  });

  test('显式 false 覆盖缓存中的 true', () => {
    const cached: CacheOptions = {
      name: 'cached',
      exec: true,
      sync: true,
      fiber: true,
      alive: true,
      degrade: true,
    };

    const resolved = resolveOptions(
      {
        name: 'app',
        exec: false,
        sync: false,
        fiber: false,
        alive: false,
        degrade: false,
      },
      cached,
    );

    expect(resolved.exec).toBe(false);
    expect(resolved.sync).toBe(false);
    expect(resolved.fiber).toBe(false);
    expect(resolved.alive).toBe(false);
    expect(resolved.degrade).toBe(false);
  });

  test('显式空对象和空数组覆盖缓存值', () => {
    const props = {};
    const attrs = {};
    const degradeAttrs = {};
    const plugins: CacheOptions['plugins'] = [];
    const iframeAddEventListeners: Array<string> = [];
    const iframeOnEvents: Array<string> = [];
    const cached: CacheOptions = {
      name: 'cached',
      props: { source: 'cache' },
      attrs: { source: 'cache' },
      degradeAttrs: { source: 'cache' },
      plugins: [{}],
      iframeAddEventListeners: ['load'],
      iframeOnEvents: ['onload'],
    };

    const resolved = resolveOptions(
      { name: 'app', props, attrs, degradeAttrs, plugins, iframeAddEventListeners, iframeOnEvents },
      cached,
    );

    expect(resolved.props).toBe(props);
    expect(resolved.attrs).toBe(attrs);
    expect(resolved.degradeAttrs).toBe(degradeAttrs);
    expect(resolved.plugins).toBe(plugins);
    expect(resolved.iframeAddEventListeners).toBe(iframeAddEventListeners);
    expect(resolved.iframeOnEvents).toBe(iframeOnEvents);
  });

  test('当前配置优先，空字符串仍按既有语义回退缓存', () => {
    const cached: CacheOptions = {
      name: 'cached',
      el: '#cached',
      url: 'https://cached.test/',
      html: 'cached html',
      prefix: { cached: '/cached' },
    };
    const resolved = resolveOptions(
      {
        name: 'current',
        el: '',
        url: '',
        html: 'current html',
        prefix: { current: '/current' },
      },
      cached,
    );

    expect(resolved.name).toBe('current');
    expect(resolved.el).toBe('#cached');
    expect(resolved.url).toBe('https://cached.test/');
    expect(resolved.html).toBe('current html');
    expect(resolved.prefix).toEqual({ current: '/current' });
  });

  test('生命周期逐项合并而不是整组覆盖', () => {
    const currentBeforeLoad: Lifecycle = () => undefined;
    const cachedBeforeLoad: Lifecycle = () => undefined;
    const cachedAfterMount: Lifecycle = () => undefined;
    const currentDeactivated: Lifecycle = () => undefined;
    const cachedLoadError: LoadErrorHandler = () => undefined;
    const cached: CacheOptions = {
      name: 'cached',
      beforeLoad: cachedBeforeLoad,
      afterMount: cachedAfterMount,
      loadError: cachedLoadError,
    };

    const resolved = resolveOptions(
      { name: 'app', beforeLoad: currentBeforeLoad, deactivated: currentDeactivated },
      cached,
    );

    expect(resolved.lifecycles.beforeLoad).toBe(currentBeforeLoad);
    expect(resolved.lifecycles.afterMount).toBe(cachedAfterMount);
    expect(resolved.lifecycles.deactivated).toBe(currentDeactivated);
    expect(resolved.lifecycles.loadError).toBe(cachedLoadError);
  });

  test('utils.mergeOptions 保持兼容并委托给新 resolver', () => {
    const options: CacheOptions = { name: 'app', fiber: false };
    const cached: CacheOptions = { name: 'cached', url: 'https://cached.test/' };

    expect(mergeOptions(options, cached)).toEqual(resolveOptions(options, cached));
  });
});

describe('legacy route wrappers', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  test('getAnchorElementQueryMap 使用统一 URLSearchParams 解码', () => {
    const anchor = document.createElement('a');
    anchor.href = 'http://localhost/?app=%2F%23%2Fdialog&space=a+b&duplicate=first&duplicate=last';

    expect(getAnchorElementQueryMap(anchor)).toEqual({
      app: '/#/dialog',
      space: 'a b',
      duplicate: 'last',
    });
  });

  test('getSyncUrl 使用统一 prefix 展开且未知 prefix 保持原值', () => {
    window.history.replaceState(null, '', '/?known=%7Bdetail%7D%2Fitem&unknown=%7Bmissing%7D%2Fitem#/all');
    const prefix = { detail: '/products/special' };

    expect(getSyncUrl('known', prefix)).toBe('/products/special/item');
    expect(getSyncUrl('unknown', prefix)).toBe('{missing}/item');
    expect(window.location.hash).toBe('#/all');
  });
});
