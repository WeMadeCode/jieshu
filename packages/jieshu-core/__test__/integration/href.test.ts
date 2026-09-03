import { test, type Page } from '@playwright/test';

import { awaitConsoleLogMessage, triggerClickByJsSelector } from './utils';
import { reactMainAppInfoList, vueMainAppInfoList } from './common';

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

interface LooseObject {
  [key: string]: any;
}
describe('main react location href test', () => {
  beforeAll(async () => {
    await page.addInitScript(() => {
      // 关闭预加载
      localStorage.clear();
      localStorage.setItem('preload', 'false');
      localStorage.setItem('degrade', 'false');
    });
    await page.goto('http://localhost:7700/');
  });

  reactMainAppInfoList.slice(0, 5).forEach((appInfo) =>
    it(`${appInfo.name} location href test`, async () => {
      const appInfoMountedPromise = awaitConsoleLogMessage(page, appInfo.mountedMessage);
      await page.click(appInfo.linkSelector);
      await appInfoMountedPromise;
      const appInfoRouteMountedPromise = awaitConsoleLogMessage(page, (appInfo as LooseObject)['routeMountedMessage']);
      await triggerClickByJsSelector(page, (appInfo as LooseObject)['routeNavSelector']);
      await appInfoRouteMountedPromise;
      await triggerClickByJsSelector(page, (appInfo as LooseObject)['routeJumpButtonSelector']);
      await page.waitForSelector("iframe[src='https://wujicode.cn/xy/app/prod/official/index']");
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
      localStorage.setItem('degrade', 'false');
    });
    await page.goto('http://localhost:8000/');
  });

  vueMainAppInfoList.slice(0, 5).forEach((appInfo) =>
    it(`${appInfo.name} location href test`, async () => {
      const appInfoMountedPromise = awaitConsoleLogMessage(page, appInfo.mountedMessage);
      await page.click(appInfo.linkSelector);
      await appInfoMountedPromise;
      const appInfoRouteMountedPromise = awaitConsoleLogMessage(page, (appInfo as LooseObject)['routeMountedMessage']);
      await triggerClickByJsSelector(page, (appInfo as LooseObject)['routeNavSelector']);
      await appInfoRouteMountedPromise;
      await triggerClickByJsSelector(page, (appInfo as LooseObject)['routeJumpButtonSelector']);
      await page.waitForSelector("iframe[src='https://wujicode.cn/xy/app/prod/official/index']");
      await page.goBack();
      await page.waitForSelector('jieshu-app');
    }),
  );
});
