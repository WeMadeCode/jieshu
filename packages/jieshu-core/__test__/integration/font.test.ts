import { expect, test, type Page } from '@playwright/test';

import { awaitConsoleLogMessage, triggerClickByJsSelector } from './utils';
import { reactMainAppInfoMap, vueMainAppInfoMap } from './common';

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

const hasInjectedFontRule = (): boolean =>
  document.querySelector('[data-jieshu-font-style-container]')?.textContent?.includes('@font-face') ?? false;

describe('main react startApp', () => {
  beforeAll(async () => {
    await page.addInitScript(() => {
      // 关闭预加载
      localStorage.clear();
      localStorage.setItem('preload', 'false');
      localStorage.setItem('degrade', 'false');
    });
    await page.goto('http://localhost:7700/');
  });
  it('check react16 font-face', async () => {
    const appInfo = reactMainAppInfoMap.react16;
    const appInfoMountedPromise = awaitConsoleLogMessage(page, appInfo.mountedMessage);
    expect(await page.evaluate(hasInjectedFontRule)).toBe(false);
    await page.click(appInfo.linkSelector);
    await appInfoMountedPromise;
    const appInfoFontMountedPromise = awaitConsoleLogMessage(page, appInfo.fontMountedMessage);
    await triggerClickByJsSelector(page, appInfo.fontNavSelector);
    await appInfoFontMountedPromise;
    // 等待字体加载
    await page.waitForResponse((response) => response.url().includes('https://tdesign.gtimg.com/icon/'));
    // FontFaceSet.check 在字体缺失时也可能因 fallback 返回 true；直接等待框架
    // 把子应用的 @font-face 规则提升到宿主容器，才能稳定验证隔离逻辑。
    await page.waitForFunction(hasInjectedFontRule, undefined, { timeout: 5000 });
    expect(await page.evaluate(hasInjectedFontRule)).toBe(true);
  });
});
describe('main vue startApp', () => {
  beforeAll(async () => {
    await page.addInitScript(() => {
      // 关闭预加载
      localStorage.clear();
      localStorage.setItem('preload', 'false');
      localStorage.setItem('degrade', 'false');
    });
    await page.goto('http://localhost:8000/');
  });
  it('check react16 font-face', async () => {
    const appInfo = vueMainAppInfoMap.react16;
    const appInfoMountedPromise = awaitConsoleLogMessage(page, appInfo.mountedMessage);
    expect(await page.evaluate(hasInjectedFontRule)).toBe(false);
    await page.click(appInfo.linkSelector);
    await appInfoMountedPromise;
    const appInfoFontMountedPromise = awaitConsoleLogMessage(page, appInfo.fontMountedMessage);
    await triggerClickByJsSelector(page, appInfo.fontNavSelector);
    await appInfoFontMountedPromise;
    // 等待字体加载
    await page.waitForResponse((response) => response.url().includes('https://tdesign.gtimg.com/icon/'));
    await page.waitForFunction(hasInjectedFontRule, undefined, { timeout: 5000 });
    expect(await page.evaluate(hasInjectedFontRule)).toBe(true);
  });
});
