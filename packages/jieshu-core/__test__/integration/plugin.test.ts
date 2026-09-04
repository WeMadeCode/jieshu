import { expect, test, type Page } from '@playwright/test';

import { awaitConsoleLogMessage, triggerClickByJsSelector } from './utils';
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

const generateTest = (AppInfoMap: typeof reactMainAppInfoMap | typeof vueMainAppInfoMap) => {
  it('react16 plugin test', async () => {
    const htmlLoaderPromise = awaitConsoleLogMessage(page, 'html-loader');
    const cssLoaderPromise = awaitConsoleLogMessage(page, 'css-loader  img{width: 300px}...');
    const jsBeforeLoaderPromise = awaitConsoleLogMessage(page, 'js-before-loader-callback react16');
    const jsLoaderPromise = awaitConsoleLogMessage(page, 'js-loader http://localhost:7600/static/js/bundle.js');
    const jsAfterLoaderPromise = awaitConsoleLogMessage(page, 'js-after-loader-callback react16');
    const mountPromise = awaitConsoleLogMessage(page, AppInfoMap.react16.mountedMessage);
    await page.click(AppInfoMap.react16.linkSelector);
    await Promise.all([
      htmlLoaderPromise,
      cssLoaderPromise,
      jsBeforeLoaderPromise,
      jsLoaderPromise,
      jsAfterLoaderPromise,
      mountPromise,
    ]);
    const title = await page.evaluateHandle<Element>(AppInfoMap.react16.titleJsSelector);
    expect(await title.asElement()!.evaluate((el) => window.getComputedStyle(el).color)).toBe('rgb(241, 107, 95)');
    const dialogMountedPromise = awaitConsoleLogMessage(page, AppInfoMap.react16.dialogMountedMessage);
    await triggerClickByJsSelector(page, AppInfoMap.react16.dialogNavSelector);
    await dialogMountedPromise;
    const dialogTitle = await page.evaluateHandle<Element>(AppInfoMap.react16.titleJsSelector);
    expect(await dialogTitle.asElement()!.evaluate((el) => window.getComputedStyle(el).color)).toBe(
      'rgb(241, 107, 95)',
    );
  });
};
describe('main react plugin', () => {
  beforeAll(async () => {
    await page.addInitScript(() => {
      // 关闭预加载
      localStorage.clear();
      localStorage.setItem('preload', 'false');
    });
    await page.goto(reactMainUrl);
  });

  generateTest(reactMainAppInfoMap);
});

describe('main vue plugin', () => {
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
