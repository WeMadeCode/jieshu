// 子应用页面事件
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

const pageLiftEventConsoleLogList = [
  'vue2 document DOMContentLoaded trigger',
  'vue2 window DOMContentLoaded trigger',
  'vue2 document onreadystatechange trigger',
  'vue2 document readystatechange trigger',
  'vue2 window onload trigger',
  'vue2 window load trigger',
];

describe('main react pageEvent', () => {
  beforeAll(async () => {
    await page.addInitScript(() => {
      // 关闭预加载
      localStorage.clear();
      localStorage.setItem('preload', 'false');
    });
    await page.goto(reactMainUrl);
  });

  const vue2 = reactMainAppInfoMap.vue2;
  it(`${vue2.name} pageEvent trigger`, async () => {
    // vue2
    const vue2MountedPromise = awaitConsoleLogMessage(page, vue2.mountedMessage);
    await page.click(vue2.linkSelector);
    const pageLiftEventConsoleLogListPromise = pageLiftEventConsoleLogList.map((message) =>
      awaitConsoleLogMessage(page, message),
    );
    await vue2MountedPromise;
    await Promise.all(pageLiftEventConsoleLogListPromise);
  });
});

describe('main vue pageEvent', () => {
  beforeAll(async () => {
    await page.addInitScript(() => {
      // 关闭预加载
      localStorage.clear();
      localStorage.setItem('preload', 'false');
    });
    await page.goto(vueMainUrl);
  });

  const vue2 = vueMainAppInfoMap.vue2;
  it(`${vue2.name} pageEvent trigger`, async () => {
    // vue2
    const vue2MountedPromise = awaitConsoleLogMessage(page, vue2.mountedMessage);
    await page.click(vue2.linkSelector);
    const pageLiftEventConsoleLogListPromise = pageLiftEventConsoleLogList.map((message) =>
      awaitConsoleLogMessage(page, message),
    );
    await vue2MountedPromise;
    await Promise.all(pageLiftEventConsoleLogListPromise);
  });
});
