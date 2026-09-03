import { expect, test, type Page } from '@playwright/test';

import { awaitConsoleLogMessage, getTextContentByJsSelector, triggerClickByJsSelector } from './utils';
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

const generateTest = (AppInfoMap: typeof reactMainAppInfoMap | typeof vueMainAppInfoMap) => {
  it('react17 and vue3 alive test', async () => {
    // react17
    const react17MountedPromise = awaitConsoleLogMessage(page, AppInfoMap.react17.mountedMessage);
    await page.click(AppInfoMap.react17.linkSelector);
    await react17MountedPromise;
    const React17stateMountedPromise = awaitConsoleLogMessage(page, AppInfoMap.react17.stateMountedMessage);
    await triggerClickByJsSelector(page, AppInfoMap.react17.stateNavSelector);
    await React17stateMountedPromise;
    expect(await getTextContentByJsSelector(page, AppInfoMap.react17.stateNumberJsSelector)).toBe('10');

    // vue3
    const vue3MountedPromise = awaitConsoleLogMessage(page, AppInfoMap.vue3.mountedMessage);
    await triggerClickByJsSelector(page, AppInfoMap.react17.stateJumpVue3JsSelector);
    await vue3MountedPromise;
    const vue3StateMountedPromise = awaitConsoleLogMessage(page, AppInfoMap.vue3.stateMountedMessage);
    await triggerClickByJsSelector(page, AppInfoMap.vue3.stateNavSelector);
    await vue3StateMountedPromise;
    expect(await getTextContentByJsSelector(page, AppInfoMap.vue3.stateNumberJsSelector)).toBe('10');

    // react17
    const react17ActivatedPromise = awaitConsoleLogMessage(page, AppInfoMap.react17.mountedMessage);
    await triggerClickByJsSelector(page, AppInfoMap.vue3.stateJumpReact17JsSelector);
    await react17ActivatedPromise;
    expect(await getTextContentByJsSelector(page, AppInfoMap.react17.stateNumberJsSelector)).toBe('10');

    // vue3
    const vue3ActivatedPromise = awaitConsoleLogMessage(page, AppInfoMap.vue3.mountedMessage);
    await triggerClickByJsSelector(page, AppInfoMap.react17.stateJumpVue3JsSelector);
    await vue3ActivatedPromise;
    expect(await getTextContentByJsSelector(page, AppInfoMap.vue3.stateNumberJsSelector)).toBe('11');
  });
};

describe('main react alive', () => {
  beforeAll(async () => {
    await page.addInitScript(() => {
      // 关闭预加载
      localStorage.clear();
      localStorage.setItem('preload', 'false');
      localStorage.setItem('degrade', 'false');
    });
    await page.goto('http://localhost:7700/');
  });

  generateTest(reactMainAppInfoMap);
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

  generateTest(vueMainAppInfoMap);
});
