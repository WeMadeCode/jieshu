import { expect, test, type Page } from '@playwright/test';

import { getTextContentByJsSelector } from './utils';
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

describe('main react startApp', () => {
  beforeAll(async () => {
    await page.addInitScript(() => {
      // 关闭预加载
      localStorage.clear();
      localStorage.setItem('preload', 'false');
    });
    await page.goto(reactMainUrl);
  });

  reactMainAppInfoList.forEach((appInfo) =>
    it(`${appInfo.name} startApp`, async () => {
      await page.click(appInfo.linkSelector);
      await expect(page.getByText(appInfo.titleText, { exact: true })).toBeVisible();
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
    });
    await page.goto(vueMainUrl);
  });

  vueMainAppInfoList.forEach((appInfo) =>
    it(`${appInfo.name} startApp`, async () => {
      await page.click(appInfo.linkSelector);
      await expect(page.getByText(appInfo.titleText, { exact: true })).toBeVisible();
      expect(await getTextContentByJsSelector(page, appInfo.titleJsSelector)).toBe(appInfo.titleText);
    }),
  );
});
