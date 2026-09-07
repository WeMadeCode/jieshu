import { test, type Page } from '@playwright/test';

import { awaitConsoleLogMessage, triggerClickByJsSelector } from './utils';
import { reactMainAppInfoList, reactMainUrl, vueMainAppInfoList, vueMainUrl } from './common';

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

describe('main react location href test', () => {
  beforeAll(async () => {
    await page.addInitScript(() => {
      // 关闭预加载
      localStorage.clear();
      localStorage.setItem('preload', 'false');
    });
    await page.goto(reactMainUrl);
  });

  reactMainAppInfoList.forEach((appInfo) =>
    it(`${appInfo.name} location href test`, async () => {
      const appInfoMountedPromise = awaitConsoleLogMessage(page, appInfo.mountedMessage);
      await page.click(appInfo.linkSelector);
      await appInfoMountedPromise;
      const appInfoRouteMountedPromise = awaitConsoleLogMessage(page, appInfo.routeMountedMessage);
      await triggerClickByJsSelector(page, appInfo.routeNavSelector);
      await appInfoRouteMountedPromise;
      await triggerClickByJsSelector(page, appInfo.routeJumpButtonSelector);
      await page.waitForSelector('iframe:not([name])');
      await page.goBack();
      await page.waitForSelector('jieshu-app');
    }),
  );
});

describe('main vue location href test', () => {
  beforeAll(async () => {
    await page.addInitScript(() => {
      // 关闭预加载
      localStorage.clear();
      localStorage.setItem('preload', 'false');
    });
    await page.goto(vueMainUrl);
  });

  vueMainAppInfoList.forEach((appInfo) =>
    it(`${appInfo.name} location href test`, async () => {
      const appInfoMountedPromise = awaitConsoleLogMessage(page, appInfo.mountedMessage);
      await page.click(appInfo.linkSelector);
      await appInfoMountedPromise;
      const appInfoRouteMountedPromise = awaitConsoleLogMessage(page, appInfo.routeMountedMessage);
      await triggerClickByJsSelector(page, appInfo.routeNavSelector);
      await appInfoRouteMountedPromise;
      await triggerClickByJsSelector(page, appInfo.routeJumpButtonSelector);
      await page.waitForSelector('iframe:not([name])');
      await page.goBack();
      await page.waitForSelector('jieshu-app');
    }),
  );
});
