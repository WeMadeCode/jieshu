import { test, type Page } from '@playwright/test';

import { awaitConsoleLogMessage } from './utils';
import { reactMainAppInfoMap, reactMainUrl, vueMainAppInfoMap, vueMainUrl } from './common';

const describe = test.describe;
const beforeAll = test.beforeAll;
const it = test;
let page: Page;

beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});

test.afterAll(async () => {
  await page.close();
});

const generateTest = (
  AppInfoMap: typeof reactMainAppInfoMap | typeof vueMainAppInfoMap,
  react16EntryLifecycles = AppInfoMap.react16.entryLifecycles,
) => {
  it(`react16 entry lifecycles`, async () => {
    const lifecyclePromiseList = react16EntryLifecycles.map((lifecycle) => awaitConsoleLogMessage(page, lifecycle));
    await page.click(AppInfoMap.react16.linkSelector);
    await Promise.all(lifecyclePromiseList);
  });
  it(`react17 entry lifecycles`, async () => {
    const lifecyclePromiseList = AppInfoMap.react16.leaveLifecycles
      .concat(AppInfoMap.react17.entryLifecycles)
      .map((lifecycle) => awaitConsoleLogMessage(page, lifecycle));
    await page.click(AppInfoMap.react17.linkSelector);
    await Promise.all(lifecyclePromiseList);
  });
  it(`vue2 entry lifecycles`, async () => {
    const lifecyclePromiseList = AppInfoMap.react17.leaveLifecycles
      .concat(AppInfoMap.vue2.entryLifecycles)
      .map((lifecycle) => awaitConsoleLogMessage(page, lifecycle));
    await page.click(AppInfoMap.vue2.linkSelector);
    await Promise.all(lifecyclePromiseList);
  });
  it(`vue3 entry lifecycles`, async () => {
    const lifecyclePromiseList = AppInfoMap.vue2.leaveLifecycles
      .concat(AppInfoMap.vue3.entryLifecycles)
      .map((lifecycle) => awaitConsoleLogMessage(page, lifecycle));
    await page.click(AppInfoMap.vue3.linkSelector);
    await Promise.all(lifecyclePromiseList);
  });

  it(`vite entry lifecycles`, async () => {
    const lifecyclePromiseList = AppInfoMap.vue3.leaveLifecycles
      .concat(AppInfoMap.vite.entryLifecycles)
      .map((lifecycle) => awaitConsoleLogMessage(page, lifecycle));
    await page.click(AppInfoMap.vite.linkSelector);
    await Promise.all(lifecyclePromiseList);
  });

  it(`react16 entry again lifecycles`, async () => {
    const lifecyclePromiseList = AppInfoMap.vite.leaveLifecycles
      .concat(react16EntryLifecycles.slice(1))
      .map((lifecycle) => awaitConsoleLogMessage(page, lifecycle));
    await page.click(AppInfoMap.react16.linkSelector);
    await Promise.all(lifecyclePromiseList);
  });
  it(`react17 entry again lifecycles`, async () => {
    const lifecyclePromiseList = AppInfoMap.react16.leaveLifecycles
      .concat(AppInfoMap.react17.entryLifecycles.slice(1))
      .map((lifecycle) => awaitConsoleLogMessage(page, lifecycle));
    await page.click(AppInfoMap.react17.linkSelector);
    await Promise.all(lifecyclePromiseList);
  });
  it(`vue2 entry again lifecycles`, async () => {
    const lifecyclePromiseList = AppInfoMap.react17.leaveLifecycles
      .concat(AppInfoMap.vue2.entryLifecycles.slice(1))
      .map((lifecycle) => awaitConsoleLogMessage(page, lifecycle));
    await page.click(AppInfoMap.vue2.linkSelector);
    await Promise.all(lifecyclePromiseList);
  });
  it(`vue3 entry again lifecycles`, async () => {
    const lifecyclePromiseList = AppInfoMap.vue2.leaveLifecycles
      .concat(AppInfoMap.vue3.entryLifecycles.slice(1))
      .map((lifecycle) => awaitConsoleLogMessage(page, lifecycle));
    await page.click(AppInfoMap.vue3.linkSelector);
    await Promise.all(lifecyclePromiseList);
  });

  it(`vite entry again lifecycles`, async () => {
    const lifecyclePromiseList = AppInfoMap.vue3.leaveLifecycles
      .concat(AppInfoMap.vite.entryLifecycles.slice(1))
      .map((lifecycle) => awaitConsoleLogMessage(page, lifecycle));
    await page.click(AppInfoMap.vite.linkSelector);
    await Promise.all(lifecyclePromiseList);
  });
};

describe('main react startApp', () => {
  beforeAll(async () => {
    await page.addInitScript(() => {
      // 关闭预加载
      localStorage.clear();
      localStorage.setItem('preload', 'false');
    });
    await page.goto(reactMainUrl);
  });
  // The Rspack example deliberately overrides these two hooks on its React16
  // page. Keep checking the hooks themselves using that example's messages.
  const { JIESHU_REACT_MAIN_WORKSPACE: reactMainWorkspace } = process.env;
  const react16EntryLifecycles =
    reactMainWorkspace === 'main-react-ts'
      ? ['react16 beforeLoad 生命周期', 'React 16 Before mount =  Window', 'React 16 After mount =  Window']
      : reactMainAppInfoMap.react16.entryLifecycles;
  generateTest(reactMainAppInfoMap, react16EntryLifecycles);
});

describe('main vue startApp', () => {
  beforeAll(async () => {
    await page.addInitScript(() => {
      // 关闭预加载
      localStorage.clear();
      localStorage.setItem('preload', 'false');
    });
    await page.goto(vueMainUrl);
  });

  generateTest(vueMainAppInfoMap);
});
