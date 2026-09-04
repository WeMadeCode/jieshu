import { expect, test, type Page } from '@playwright/test';

import { awaitConsoleLogMessage, getTextContentByJsSelector } from './utils';
import { reactMainAppInfoList, vueMainAppInfoList } from './common';

const describe = test.describe;
const beforeAll = test.beforeAll;
const it = test;
let page: Page;
const reactMainUrl = process.env['JIESHU_REACT_MAIN_URL'] ?? 'http://localhost:7700/';
const vueMainUrl = process.env['JIESHU_VUE_MAIN_URL'] ?? 'http://localhost:8000/';

beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});

test.afterAll(async () => {
  await page.close();
});

describe('main react startApp', () => {
  beforeAll(async () => {
    await page.addInitScript(() => {
      // 关闭预加载
      localStorage.clear();
      localStorage.setItem('preload', 'false');
      localStorage.setItem('degrade', 'false');
    });
    await page.goto(reactMainUrl);
  });

  reactMainAppInfoList.forEach((appInfo) =>
    it(`${appInfo.name} startApp`, async () => {
      const appInfoMountedPromise = awaitConsoleLogMessage(page, appInfo.mountedMessage);
      await page.click(appInfo.linkSelector);
      await appInfoMountedPromise;
      expect(await getTextContentByJsSelector(page, appInfo.titleJsSelector)).toBe(appInfo.titleText);
    }),
  );
});

describe('main vue startApp', () => {
  beforeAll(async () => {
    await page.addInitScript(() => {
      // 关闭预加载
      localStorage.clear();
      localStorage.setItem('preload', 'false');
      localStorage.setItem('degrade', 'false');
    });
    await page.goto(vueMainUrl);
  });

  vueMainAppInfoList.forEach((appInfo) =>
    it(`${appInfo.name} startApp`, async () => {
      const appInfoMountedPromise = awaitConsoleLogMessage(page, appInfo.mountedMessage);
      await page.click(appInfo.linkSelector);
      await appInfoMountedPromise;
      expect(await getTextContentByJsSelector(page, appInfo.titleJsSelector)).toBe(appInfo.titleText);
    }),
  );
});
