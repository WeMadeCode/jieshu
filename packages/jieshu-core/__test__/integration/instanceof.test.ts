import { expect, test, type Page } from '@playwright/test';

import { vueMainAppInfoMap, vueMainUrl } from './common';
import { awaitConsoleLogMessage } from './utils';

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

describe('main vue instanceof patch', () => {
  beforeAll(async () => {
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem('preload', 'false');
    });
    await page.goto(vueMainUrl);
  });

  it('example 子应用中主应用 realm 的元素和事件应通过子应用构造函数的 instanceof 判断', async () => {
    const appInfo = vueMainAppInfoMap.vue3;
    const appInfoMountedPromise = awaitConsoleLogMessage(page, appInfo.mountedMessage);
    await page.click(appInfo.linkSelector);
    await appInfoMountedPromise;

    const result = await page.evaluate((childName) => {
      const childFrame = Array.from(document.getElementsByTagName('iframe')).find(
        (candidate) => candidate.name === childName,
      );
      const childWindow = childFrame?.contentWindow;
      const childRuntime = childWindow
        ? (Reflect.get(childWindow, '__JIESHU') as { proxy: Window & typeof globalThis } | undefined)
        : undefined;
      if (!childWindow || !childRuntime) throw new Error(`Cannot find child window for ${childName}`);
      const childProxyWindow = childRuntime.proxy;
      const mainElement = document.createElement('div');
      const mainMouseEvent = new MouseEvent('click');
      const childElement = childWindow.document.createElement('div');

      return {
        mainElementIsChildDiv: mainElement instanceof childProxyWindow.HTMLDivElement,
        mainElementIsChildHTMLElement: mainElement instanceof childProxyWindow.HTMLElement,
        mainEventIsChildMouseEvent: mainMouseEvent instanceof childProxyWindow.MouseEvent,
        mainEventIsChildEvent: mainMouseEvent instanceof childProxyWindow.Event,
        childElementStillWorks: childElement instanceof childProxyWindow.HTMLDivElement,
        avoidsLegacyPatchMark: Reflect.get(childProxyWindow.HTMLDivElement, '_hasPatch') !== true,
      };
    }, appInfo.name);

    expect(result).toEqual({
      mainElementIsChildDiv: true,
      mainElementIsChildHTMLElement: true,
      mainEventIsChildMouseEvent: true,
      mainEventIsChildEvent: true,
      childElementStillWorks: true,
      avoidsLegacyPatchMark: true,
    });
  });
});
