import assert from 'node:assert/strict';

const PRIMARY = '#stability-primary';
const SECONDARY = '#stability-secondary';
const TIMEOUT_MS = 6000;

const check = (condition, message, observations) => {
  if (!condition) {
    const error = new Error(message);
    error.observations = observations;
    throw error;
  }
};

const start = (page, name, extra = {}) => {
  return page.evaluate(({ name, extra }) => window.bench.start(name, extra), {
    name,
    extra: { el: PRIMARY, ...extra },
  });
};

const state = (page, name) => page.evaluate((name) => window.bench.state(name), name);

const waitForState = async (page, name, key, value) => {
  await page.waitForFunction(
    ({ name, key, value }) => window.bench.state(name)?.[key] === value,
    { name, key, value },
    { timeout: TIMEOUT_MS },
  );
  return state(page, name);
};

const destroy = (page, name) => page.evaluate((name) => window.bench.destroy(name), name);

const countReady = (page, selector = PRIMARY) => page.locator(`${selector} #ready`).count();

const observeQuiescence = (page) => {
  // The delayed-resource fixture responds after 150 ms. This observation
  // window also catches queued fiber work after the API promises settle.
  return page.waitForTimeout(250);
};

const failureSnapshot = async (page) => {
  let timer;
  try {
    return await Promise.race([
      page.evaluate(() => {
        const names = [...new Set(window.bench.events.map((event) => event.name))];
        return {
          hostUrl: location.href,
          events: window.bench.events,
          states: names.map((name) => ({ name, state: window.bench.state(name) })),
          iframes: document.querySelectorAll('iframe').length,
          containers: ['stability-primary', 'stability-secondary'].map((id) => ({
            id,
            children: [...(document.getElementById(id)?.children ?? [])].map((element) => ({
              tag: element.tagName,
              attributes: [...element.attributes].map((attribute) => [attribute.name, attribute.value]),
              readyElements: element.shadowRoot?.querySelectorAll('#ready').length ?? 0,
            })),
          })),
        };
      }),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ unavailable: 'Snapshot exceeded 1 second.' }), 1000);
      }),
    ]);
  } catch (cause) {
    return { unavailable: String(cause) };
  } finally {
    clearTimeout(timer);
  }
};

const scenarios = [
  {
    name: 'mount-interaction-lifecycle',
    expected: 'A visible child handles a click and invokes mount/unmount lifecycle hooks in order.',
    run: async (page) => {
      const name = 'lifecycle';
      const timing = await start(page, name);
      assert.equal(await countReady(page), 1);
      await page.locator(`${PRIMARY} #counter`).click();
      const clicked = await waitForState(page, name, 'count', 1);
      await destroy(page, name);
      const events = await page.evaluate(
        (name) => window.bench.events.filter((event) => event.name === name).map((event) => event.type),
        name,
      );
      const ordered = ['beforeLoad', 'beforeMount', 'mount', 'afterMount', 'beforeUnmount', 'unmount', 'afterUnmount'];
      const positions = ordered.map((type) => events.indexOf(type));
      check(
        positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])),
        'Mount/unmount lifecycle order differs from the expected order.',
        { events, ordered },
      );
      assert.equal(await countReady(page), 0);
      return { timing, clicked, events };
    },
  },
  {
    name: 'props-and-event-bus',
    expected: 'Props reach the child and a targeted host ping receives exactly one child pong.',
    run: async (page) => {
      const name = 'communication';
      await start(page, name, { props: { marker: 'host-marker' } });
      const initial = await state(page, name);
      assert.equal(initial.propsValue, 'host-marker');
      await page.evaluate((name) => {
        window.__stabilityPongs = [];
        window.bench.core.bus.$on('bench:pong', (payload) => window.__stabilityPongs.push(payload));
        window.bench.core.bus.$emit('bench:ping', { name, value: 'round-trip' });
      }, name);
      const current = await waitForState(page, name, 'pongCount', 1);
      const pongs = await page.evaluate(() => window.__stabilityPongs);
      assert.deepEqual(pongs, [{ name, value: 'round-trip' }]);
      return { propsValue: initial.propsValue, current, pongs };
    },
  },
  {
    name: 'javascript-global-isolation',
    expected: 'Child global writes do not mutate the host global with the same name.',
    run: async (page) => {
      await page.evaluate(() => {
        window.__BENCH_CHILD_GLOBAL__ = 'host-sentinel';
      });
      await start(page, 'global-a');
      await start(page, 'global-b', { el: SECONDARY });
      const observed = await page.evaluate(() => ({
        host: window.__BENCH_CHILD_GLOBAL__,
        children: [...document.querySelectorAll('iframe')]
          .map((frame) => frame.contentWindow?.__BENCH_CHILD_GLOBAL__)
          .filter((value) => typeof value === 'string' && value !== 'host-sentinel'),
      }));
      assert.equal(observed.host, 'host-sentinel');
      check(
        observed.children.includes('global-a') && observed.children.includes('global-b'),
        'Each iframe must retain its own child global.',
        observed,
      );
      return observed;
    },
  },
  {
    name: 'stylesheet-isolation',
    expected: 'Child CSS applies inside the child and cannot recolor a matching host element.',
    run: async (page) => {
      await page.evaluate(() => {
        const style = document.createElement('style');
        style.textContent = '.bench-isolation-target { color: rgb(19, 37, 53); }';
        document.head.append(style);
        const target = document.createElement('div');
        target.id = 'host-isolation-target';
        target.className = 'bench-isolation-target';
        target.textContent = 'Host CSS target';
        document.body.append(target);
      });
      await start(page, 'styles');
      const hostColor = await page
        .locator('#host-isolation-target')
        .evaluate((element) => getComputedStyle(element).color);
      const childColor = await page
        .locator(`${PRIMARY} .bench-isolation-target`)
        .first()
        .evaluate((element) => getComputedStyle(element).color);
      assert.equal(hostColor, 'rgb(19, 37, 53)');
      assert.equal(childColor, 'rgb(211, 17, 29)');
      return { hostColor, childColor };
    },
  },
  {
    name: 'two-apps-independent-state',
    expected: 'Two concurrent apps render and keep click state and targeted bus messages independent.',
    run: async (page) => {
      await Promise.all([start(page, 'parallel-a'), start(page, 'parallel-b', { el: SECONDARY })]);
      assert.equal(await countReady(page), 1);
      assert.equal(await countReady(page, SECONDARY), 1);
      await page.locator(`${PRIMARY} #counter`).click();
      await waitForState(page, 'parallel-a', 'count', 1);
      await page.evaluate(() => window.bench.core.bus.$emit('bench:ping', { name: 'parallel-b', value: 2 }));
      await waitForState(page, 'parallel-b', 'pongCount', 1);
      const states = await page.evaluate(() => ({
        first: window.bench.state('parallel-a'),
        second: window.bench.state('parallel-b'),
      }));
      assert.equal(states.first.count, 1);
      assert.equal(states.second.count, 0);
      assert.equal(states.first.pongCount, 0);
      assert.equal(states.second.pongCount, 1);
      return states;
    },
  },
  {
    name: 'destroy-and-recreate',
    expected: 'Explicit destroy removes the child; a new instance resets state and has one bus subscription.',
    run: async (page) => {
      const name = 'recreated';
      await start(page, name);
      await page.locator(`${PRIMARY} #counter`).click();
      await waitForState(page, name, 'count', 1);
      await destroy(page, name);
      assert.equal(await countReady(page), 0);
      await start(page, name);
      assert.equal(await countReady(page), 1);
      const recreated = await state(page, name);
      assert.equal(recreated.count, 0);
      await page.evaluate((name) => {
        window.__stabilityPongs = [];
        window.bench.core.bus.$on('bench:pong', (payload) => window.__stabilityPongs.push(payload));
        window.bench.core.bus.$emit('bench:ping', { name, value: 'after-recreate' });
      }, name);
      await waitForState(page, name, 'pongCount', 1);
      const pongs = await page.evaluate(() => window.__stabilityPongs);
      assert.equal(pongs.length, 1);
      return { recreated, pongs };
    },
  },
  {
    name: 'keep-alive-switch',
    expected: 'Switching away from a kept-alive app and back preserves its DOM state without remount.',
    run: async (page) => {
      const name = 'kept-alive';
      await start(page, name, { alive: true });
      await page.locator(`${PRIMARY} #counter`).click();
      const before = await waitForState(page, name, 'count', 1);
      await start(page, 'temporary');
      await page.waitForFunction(
        (name) => window.bench.events.some((event) => event.name === name && event.type === 'deactivated'),
        name,
        { timeout: TIMEOUT_MS },
      );
      await start(page, name, { alive: true });
      assert.equal(await countReady(page), 1);
      const after = await state(page, name);
      assert.equal(after.count, 1);
      assert.equal(after.mounts, before.mounts);
      assert.equal(after.unmounts, before.unmounts);
      await page.locator(`${PRIMARY} #counter`).click();
      await waitForState(page, name, 'count', 2);
      return { before, after };
    },
  },
  ...[false, true].map((sync) => ({
    name: `route-sync-${sync ? 'enabled' : 'disabled'}`,
    expected: sync
      ? 'Child pushState updates its route and the named host query parameter without changing host pathname.'
      : 'Child pushState updates its own route while the host URL stays unchanged.',
    run: async (page) => {
      const name = 'route';
      await start(page, name, { sync });
      const hostBefore = page.url();
      await page.locator(`${PRIMARY} #navigate`).click();
      await page.waitForFunction((name) => window.bench.state(name)?.route?.includes('/child/next?step=1'), name, {
        timeout: TIMEOUT_MS,
      });
      const hostAfter = page.url();
      const child = await state(page, name);
      if (sync) {
        assert.equal(new URL(hostAfter).searchParams.get(name), '/child/next?step=1');
        assert.equal(new URL(hostAfter).pathname, new URL(hostBefore).pathname);
      } else {
        assert.equal(hostAfter, hostBefore);
      }
      return { hostBefore, hostAfter, childRoute: child.route };
    },
  })),
  {
    name: 'async-unmount-completion',
    expected: 'The destroy Promise completes only after the 80 ms async unmount hook and afterUnmount event.',
    run: async (page) => {
      const name = 'async-unmount';
      await start(page, name, { variant: 'async-unmount' });
      const observed = await page.evaluate(async (name) => {
        const before = performance.now();
        await window.bench.core.destroyApp(name);
        return {
          elapsedMs: performance.now() - before,
          stateAtResolution: window.bench.state(name),
          eventsAtResolution: window.bench.events.filter((event) => event.name === name).map((event) => event.type),
        };
      }, name);
      check(observed.stateAtResolution.unmounts === 1, 'Destroy resolved before async unmount finished.', observed);
      check(observed.eventsAtResolution.includes('afterUnmount'), 'Destroy resolved before afterUnmount.', observed);
      const types = observed.eventsAtResolution;
      check(
        types.indexOf('unmount-start') < types.indexOf('unmount'),
        'Async unmount start/end order is invalid.',
        observed,
      );
      assert.equal(await countReady(page), 0);
      return observed;
    },
  },
  {
    name: 'start-destroy-race',
    contract: 'robustness-observation',
    expected: 'Destroy during resource loading leaves no late mounted child or uncaught error after work settles.',
    run: async (page) => {
      const name = 'cancelled-start';
      await page.evaluate(
        ({ name, el }) => {
          window.__stabilityPending = Promise.allSettled([
            window.bench.core.startApp(window.bench.options(name, { variant: 'slow', el })),
          ]);
        },
        { name, el: PRIMARY },
      );
      await page.waitForFunction(
        (name) => window.bench.events.some((event) => event.name === name && event.type === 'beforeLoad'),
        name,
        { timeout: TIMEOUT_MS },
      );
      const observed = await page.evaluate(async (name) => {
        const destruction = await Promise.allSettled([window.bench.core.destroyApp(name)]);
        const starting = await window.__stabilityPending;
        const serialize = (result) => ({
          status: result.status,
          reason: String(result.reason ?? ''),
          errorName: result.reason?.name,
        });
        return { destruction: destruction.map(serialize), starting: starting.map(serialize) };
      }, name);
      await observeQuiescence(page);
      const readyCount = await countReady(page);
      const loadingCount = await page.locator(`${PRIMARY} [data-loading-flag]`).count();
      const completeObservation = { ...observed, readyCount, loadingCount, observationWindowMs: 250 };
      check(readyCount === 0, 'A child remained or mounted after a later destroy.', completeObservation);
      check(observed.destruction[0].status === 'fulfilled', 'Destroy rejected during startup.', completeObservation);
      check(
        observed.starting[0].status === 'fulfilled' || observed.starting[0].errorName === 'AbortError',
        'Unexpected startup rejection during cancellation.',
        completeObservation,
      );
      check(loadingCount === 0, 'The cancelled start left a loading overlay in its container.', completeObservation);
      return completeObservation;
    },
  },
  {
    name: 'same-name-concurrent-containers',
    contract: 'robustness-observation',
    expected: 'Two overlapping starts for one name leave at most one live DOM; the latest request owns its container.',
    run: async (page) => {
      const name = 'same-name';
      await page.evaluate(
        ({ name, first, second }) => {
          const firstStart = window.bench.core.startApp(window.bench.options(name, { variant: 'slow', el: first }));
          const secondStart = window.bench.core.startApp(window.bench.options(name, { el: second }));
          window.__stabilityPending = Promise.allSettled([firstStart, secondStart]);
        },
        { name, first: PRIMARY, second: SECONDARY },
      );
      const outcomes = await page.evaluate(async () => {
        return (await window.__stabilityPending).map((result) => ({
          status: result.status,
          reason: String(result.reason ?? ''),
          errorName: result.reason?.name,
        }));
      });
      await page.locator(`${SECONDARY} #ready`).waitFor({ state: 'visible', timeout: TIMEOUT_MS });
      await observeQuiescence(page);
      const observed = {
        outcomes,
        firstReady: await countReady(page),
        secondReady: await countReady(page, SECONDARY),
        loadingCount: await page.locator(`${PRIMARY} [data-loading-flag]`).count(),
      };
      check(
        outcomes[0].status === 'fulfilled' || outcomes[0].errorName === 'AbortError',
        'Unexpected startup rejection in the superseded request.',
        observed,
      );
      check(outcomes[1].status === 'fulfilled', 'The latest start rejected.', observed);
      check(
        observed.firstReady === 0 && observed.secondReady === 1,
        'Concurrent starts have duplicate or stale DOM ownership.',
        observed,
      );
      check(observed.loadingCount === 0, 'The superseded start left a loading overlay in its container.', observed);
      await page.locator(`${SECONDARY} #counter`).click();
      await waitForState(page, name, 'count', 1);
      return observed;
    },
  },
  {
    name: 'preload-execute-then-activate',
    expected: 'An executed preload can be activated, rendered in the requested container and interacted with.',
    run: async (page) => {
      const name = 'preloaded';
      await page.evaluate((name) => {
        window.bench.core.preloadApp(window.bench.options(name, { exec: true, alive: true }));
      }, name);
      await page.evaluate((name) => window.bench.waitReady(name), name);
      const preloaded = await state(page, name);
      const timing = await start(page, name, { alive: true });
      assert.equal(await countReady(page), 1);
      await page.locator(`${PRIMARY} #counter`).click();
      const activated = await waitForState(page, name, 'count', 1);
      assert.equal(activated.mounts, preloaded.mounts);
      return { preloaded, activated, timing };
    },
  },
  {
    name: 'dynamic-script-and-stylesheet',
    expected: 'Dynamically appended script and stylesheet finish loading and survive a kept-alive switch.',
    run: async (page) => {
      const name = 'dynamic';
      await start(page, name, { variant: 'dynamic', alive: true });
      await waitForState(page, name, 'dynamicLoaded', true);
      const before = await waitForState(page, name, 'dynamicStyleLoaded', true);
      const colorBefore = await page
        .locator(`${PRIMARY} #dynamic-target`)
        .evaluate((element) => getComputedStyle(element).backgroundColor);
      assert.equal(colorBefore, 'rgb(31, 97, 173)');
      await start(page, 'dynamic-away');
      await start(page, name, { variant: 'dynamic', alive: true });
      assert.equal(await countReady(page), 1);
      await page.locator(`${PRIMARY} #counter`).click();
      const after = await waitForState(page, name, 'count', 1);
      assert.equal(after.dynamicLoaded, true);
      assert.equal(after.dynamicStyleLoaded, true);
      const colorAfter = await page
        .locator(`${PRIMARY} #dynamic-target`)
        .evaluate((element) => getComputedStyle(element).backgroundColor);
      assert.equal(colorAfter, 'rgb(31, 97, 173)');
      return { before, after, colorBefore, colorAfter };
    },
  },
  {
    name: 'missing-script-error-and-recovery',
    expected:
      'A script HTTP 404 is observable; after explicit cleanup, the same name starts successfully with a valid URL.',
    run: async (page, errors) => {
      const name = 'recoverable';
      await page.evaluate(
        ({ name, el }) => {
          window.__stabilityFailure = { status: 'pending' };
          void window.bench.core.startApp(window.bench.options(name, { variant: 'missing-script', el })).then(
            () => {
              window.__stabilityFailure = { status: 'fulfilled' };
            },
            (error) => {
              window.__stabilityFailure = { status: 'rejected', reason: String(error) };
            },
          );
        },
        { name, el: PRIMARY },
      );
      await page.waitForFunction(
        (name) => window.bench.events.some((event) => event.name === name && event.type === 'loadError'),
        name,
        { timeout: TIMEOUT_MS },
      );
      await observeQuiescence(page);
      const failure = await page.evaluate(
        (name) => ({
          outcome: window.__stabilityFailure,
          events: window.bench.events.filter((event) => event.name === name),
        }),
        name,
      );
      assert.equal(await countReady(page), 0);
      const expectedPageErrorCount = errors.length;
      await destroy(page, name);
      await start(page, name);
      assert.equal(await countReady(page), 1);
      await page.locator(`${PRIMARY} #counter`).click();
      const recovered = await waitForState(page, name, 'count', 1);
      return {
        failure,
        recovered,
        expectedPageErrorCount,
        expectedFailure: 'HTTP 404 while loading the missing-script fixture',
      };
    },
  },
  {
    name: 'fiber-enabled-interaction',
    expected: 'With fiber scheduling enabled, rendering, interaction and destroy still complete correctly.',
    run: async (page) => {
      const name = 'with-fiber';
      const timing = await start(page, name, { fiber: true });
      assert.equal(await countReady(page), 1);
      await page.locator(`${PRIMARY} #counter`).click();
      const clicked = await waitForState(page, name, 'count', 1);
      await destroy(page, name);
      assert.equal(await countReady(page), 0);
      return { timing, clicked };
    },
  },
];

export const runStability = async ({ openPage, record, rounds = 3 }) => {
  for (let round = 0; round < rounds; round += 1) {
    const frameworks = round % 2 === 0 ? ['wujie', 'jieshu'] : ['jieshu', 'wujie'];
    for (const scenario of scenarios) {
      for (const framework of frameworks) {
        let opened;
        let passed = false;
        let error;
        let timer;
        let observations;
        try {
          opened = await openPage(framework);
          opened.page.setDefaultTimeout(TIMEOUT_MS);
          await opened.page.evaluate(() => {
            for (const id of ['stability-primary', 'stability-secondary']) {
              const container = document.createElement('div');
              container.id = id;
              document.body.append(container);
            }
          });
          observations = await Promise.race([
            scenario.run(opened.page, opened.errors),
            new Promise((unused, reject) => {
              timer = setTimeout(() => reject(new Error('Scenario exceeded the 15 second deadline.')), 15000);
            }),
          ]);
          const unexpectedErrors = opened.errors.slice(observations?.expectedPageErrorCount ?? 0);
          check(unexpectedErrors.length === 0, 'The browser reported uncaught JavaScript errors.', {
            scenarioObservations: observations,
            unexpectedErrors,
          });
          passed = true;
        } catch (cause) {
          error = { message: String(cause?.message ?? cause), stack: String(cause?.stack ?? '') };
          observations = {
            failureObservations: cause?.observations ?? observations,
            browserState: opened ? await failureSnapshot(opened.page) : undefined,
          };
        } finally {
          clearTimeout(timer);
          if (opened) {
            try {
              await opened.context.close();
            } catch (cause) {
              passed = false;
              error = { ...error, cleanupError: String(cause) };
            }
          }
        }
        await record({
          kind: 'stability',
          framework,
          scenario: scenario.name,
          round,
          passed,
          details: {
            contract: scenario.contract ?? 'shared-public-behavior',
            expected: scenario.expected,
            observations,
          },
          error,
          pageErrors: opened?.errors ?? [],
          diagnostics: opened?.diagnostics,
        });
      }
    }
  }
};
