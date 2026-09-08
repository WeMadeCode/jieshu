import { appEventObjMap, EventBus, type EventObj } from '../../src/event';

const eventNames = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'ordinary'];

describe('event names that also occur on object prototypes', () => {
  afterEach(() => {
    appEventObjMap.clear();
  });

  test.each(eventNames)('%s supports deduplication, once, removal and all-event subscriptions', (event) => {
    const subscriber = new EventBus('subscriber');
    const publisher = new EventBus('publisher');
    const listener = vi.fn();
    const once = vi.fn(() => publisher.$emit(event, 'nested'));
    const all = vi.fn();
    subscriber.$on(event, listener).$on(event, listener).$onAll(all);
    subscriber.$once(event, once);

    publisher.$emit(event, 'outer');
    expect(listener.mock.calls).toEqual([['outer'], ['nested']]);
    expect(once).toHaveBeenCalledOnce();
    expect(all.mock.calls).toEqual([
      [event, 'nested'],
      [event, 'outer'],
    ]);

    subscriber.$off(event, listener).$offAll(all);
    publisher.$emit(event, 'removed');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(all).toHaveBeenCalledTimes(2);
    subscriber.$on(event, listener).$clear();
    publisher.$emit(event, 'cleared');
    expect(listener).toHaveBeenCalledTimes(2);
    subscriber.$destroy();
    subscriber.$on(event, listener);
    publisher.$emit(event, 'destroyed');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(appEventObjMap.has('subscriber')).toBe(false);
  });

  test.each(eventNames)('%s preserves a stable dictionary when the same application is rebuilt', (event) => {
    const first = new EventBus('rebuild');
    const stale = vi.fn();
    first.$on(event, stale);
    const dictionary = appEventObjMap.get('rebuild');
    const second = new EventBus('rebuild');
    expect(appEventObjMap.get('rebuild')).toBe(dictionary);
    second.$emit(event);
    expect(stale).not.toHaveBeenCalled();

    const current = vi.fn();
    first.$on(event, current);
    second.$emit(event, 'rebuilt');
    expect(current).toHaveBeenCalledWith('rebuilt');
    second.$destroy();
    const replacement = new EventBus('rebuild');
    expect(appEventObjMap.get('rebuild')).not.toBe(dictionary);
    replacement.$on(event, current).$emit(event, 'replacement');
    expect(current).toHaveBeenCalledTimes(2);
  });

  test('a prototype-named event preserves emission snapshots during subscription changes', () => {
    const bus = new EventBus('snapshot');
    const late = vi.fn();
    const removed = vi.fn();
    const changing = vi.fn(() => {
      bus.$off('__proto__', removed);
      bus.$on('__proto__', late);
    });
    bus.$on('__proto__', changing).$on('__proto__', removed);
    bus.$emit('__proto__');
    expect(removed).toHaveBeenCalledOnce();
    expect(late).not.toHaveBeenCalled();
    bus.$emit('__proto__');
    expect(removed).toHaveBeenCalledOnce();
    expect(late).toHaveBeenCalledOnce();
  });

  test('plain dictionaries inherited from another core remain safe without changing their identity', () => {
    const legacy: EventObj = {};
    const inheritedListener = vi.fn();
    const prototype = { inherited: [inheritedListener] };
    Reflect.setPrototypeOf(legacy, prototype);
    appEventObjMap.set('legacy', legacy);
    const bus = new EventBus('legacy');
    expect(appEventObjMap.get('legacy')).toBe(legacy);
    const all = vi.fn();
    bus.$onAll(all);
    expect(() => bus.$emit('constructor')).not.toThrow();
    bus.$emit('inherited');
    expect(inheritedListener).not.toHaveBeenCalled();

    for (const event of eventNames) {
      const listener = vi.fn();
      bus.$on(event, listener).$emit(event).$off(event, listener);
      expect(listener).toHaveBeenCalledOnce();
    }
    expect(Reflect.getPrototypeOf(legacy)).toBe(prototype);
    bus.$clear();
    expect(Object.keys(legacy)).toEqual([]);
    expect(appEventObjMap.get('legacy')).toBe(legacy);
  });
});
