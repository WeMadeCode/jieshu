import { expect, test, type Page } from '@playwright/test';

import { reactMainAppInfoList, vueMainAppInfoList } from './common';
import { awaitConsoleLogMessage, getTextContentByJsSelector } from './utils';

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

describe('main react preload', () => {
  beforeAll(async () => {
    await page.addInitScript(() => {
      // 开启预加载
      localStorage.clear();
      localStorage.setItem('preload', 'true');
      localStorage.setItem('degrade', 'false');
    });
    let mountedPromiseList: Array<Promise<void>> = reactMainAppInfoList.map((appInfo) =>
      awaitConsoleLogMessage(page, appInfo.mountedMessage),
    );
    await page.goto('http://localhost:7700/');
    // 所有预加载完成加载
    await Promise.all(mountedPromiseList);
  });

  reactMainAppInfoList.forEach((appInfo) =>
    it(`${appInfo.name} preload`, async () => {
      expect(await getTextContentByJsSelector(page, appInfo.preloadTitleJsSelector)).toBe(appInfo.titleText);
    }),
  );
});

describe('main vue preload', () => {
  beforeAll(async () => {
    await page.addInitScript(() => {
      // 开启预加载
      localStorage.clear();
      localStorage.setItem('preload', 'true');
      localStorage.setItem('degrade', 'false');
    });
    let mountedPromiseList: Array<Promise<void>> = reactMainAppInfoList.map((appInfo) =>
      awaitConsoleLogMessage(page, appInfo.mountedMessage),
    );
    await page.goto('http://localhost:8000/');
    // 所有预加载完成加载
    await Promise.all(mountedPromiseList);
  });

  vueMainAppInfoList.forEach((appInfo) =>
    it(`${appInfo.name} preload`, async () => {
      expect(await getTextContentByJsSelector(page, appInfo.preloadTitleJsSelector)).toBe(appInfo.titleText);
    }),
  );
});
