import { expect, test, type Locator, type Page } from '@playwright/test';
import { reactMainUrl, vueMainUrl } from '../../../packages/jieshu-core/__test__/integration/common';

const hosts = [
  { name: 'React Rspack', origin: new URL(reactMainUrl).origin, hash: true },
  { name: 'Vue Vite', origin: new URL(vueMainUrl).origin, hash: false },
];
const hostUrl = (host: (typeof hosts)[number], path: string) =>
  `${host.origin}/${host.hash ? '#' : ''}${path.replace(/^\//, host.hash ? '/' : '')}`;
const react18 = (page: Page) =>
  page.locator('jieshu-app').filter({ has: page.getByRole('heading', { name: 'React18 子应用', exact: true }) });
const childRoute = async (child: Locator, name: string) => {
  await child.getByRole('navigation', { name: 'React18 子应用导航' }).getByRole('link', { name, exact: true }).click();
};
const enter = async (page: Page, host: (typeof hosts)[number], path = '/react18', preload = false) => {
  await page.addInitScript((enabled) => window.localStorage.setItem('preload', String(enabled)), preload);
  await page.goto(hostUrl(host, path));
  await expect(react18(page)).toBeVisible();
  return react18(page);
};
const alertMessage = async (page: Page, button: Locator) => {
  const response = page.waitForEvent('dialog').then(async (dialog) => {
    const message = dialog.message();
    await dialog.accept();
    return message;
  });
  await button.click();
  return response;
};

test('独立运行：五个页面、版本、计数及通信边界', async ({ page }) => {
  await page.goto('http://localhost:7900/');
  await expect(page.getByText('Vite + TypeScript + React 18.3.1', { exact: true })).toBeVisible();
  await expect(page.getByText('当前为独立运行模式')).toBeVisible();
  await expect(page.getByRole('navigation').getByRole('link')).toHaveCount(5);
  await childRoute(page.locator('main'), '状态');
  await page.getByRole('button', { name: '增加计数' }).click();
  await expect(page.getByTestId('state-count')).toHaveText('11');
  await page.getByRole('button', { name: '减少计数' }).click();
  await expect(page.getByTestId('state-count')).toHaveText('10');
  await page.getByRole('button', { name: '减少计数' }).click();
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await expect(page.getByTestId('state-count')).toHaveText('10');
  await childRoute(page.locator('main'), '通信');
  await expect(page.getByRole('button', { name: '发送消息给主应用' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '调用主应用 alert' })).toBeDisabled();
});

for (const host of hosts) {
  for (const preload of [false, true]) {
    test(`${host.name}：预加载 ${preload}，保留路由和状态，刷新重建`, async ({ page }) => {
      const logs: string[] = [];
      page.on('console', (message) => logs.push(message.text()));
      const child = await enter(page, host, '/react18', preload);
      await childRoute(child, '状态');
      await child.getByRole('button', { name: '增加计数' }).click();
      await child.getByRole('button', { name: '离开后测试保活' }).click();
      await expect(child).toHaveCount(0);
      await page.locator(`a[href="${host.hash ? '#' : ''}/react18"]`).click();
      await expect(child.getByTestId('state-count')).toHaveText('11');
      expect(logs).toContain('react18 activated 生命周期');
      expect(logs).toContain('react18 deactivated 生命周期');
      await page.reload();
      await expect(react18(page).getByTestId('state-count')).toHaveText('10');
    });

    test(`${host.name}：预加载 ${preload}，子菜单首次进入和双向路由同步`, async ({ page }) => {
      const child = await enter(page, host, '/react18-sub/dialog', preload);
      await expect(child.getByRole('heading', { name: '弹窗处理' })).toBeVisible();
      await page.locator(`a[href="${host.hash ? '#' : ''}/react18-sub/location"]`).click();
      await expect(child.getByRole('heading', { name: '路由处理' })).toBeVisible();
      await childRoute(child, '通信');
      await expect(page).toHaveURL(hostUrl(host, '/react18-sub/communication'));
      await page.goBack();
      await expect(child.getByRole('heading', { name: '路由处理' })).toBeVisible();
      await page.reload();
      await expect(react18(page).getByRole('heading', { name: '路由处理' })).toBeVisible();
    });
  }

  test(`${host.name}：弹窗、内外选择器、气泡卡片与滚动`, async ({ page }) => {
    const child = await enter(page, host);
    await childRoute(child, '弹窗');
    await child.getByRole('combobox', { name: '页面选择器' }).fill('luc');
    await child.locator('.ant-select-dropdown:visible').getByText('Lucy', { exact: true }).click();
    await expect(child.locator('.ant-select-selection-item')).toHaveText('Lucy');
    await child.getByRole('button', { name: 'Hover me', exact: true }).hover();
    await expect(child.getByText('Content（页面）', { exact: true })).toBeVisible();
    await child.getByRole('button', { name: 'Open Modal', exact: true }).click();
    const modal = child.getByRole('dialog', { name: 'Basic Modal' });
    await expect(modal).toBeVisible();
    await modal.getByRole('combobox', { name: '弹窗内选择器' }).fill('tom');
    await child.locator('.ant-select-dropdown:visible').getByText('Tom', { exact: true }).click();
    await expect(modal.locator('.ant-select-selection-item')).toHaveText('Tom');
    await modal.getByRole('button', { name: 'Hover me（弹窗内）' }).hover();
    await expect(child.getByText('Content（弹窗内）', { exact: true })).toBeVisible();
    const scroll = modal.locator('.react18-modal-scroll');
    await scroll.evaluate((element) => {
      element.scrollTop = 250;
    });
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(modal).toBeHidden();
    await child.getByRole('button', { name: 'Open Modal', exact: true }).click();
    await modal.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(modal).toBeHidden();
  });

  test(`${host.name}：路由 query/hash、刷新及前进后退`, async ({ page }) => {
    const child = await enter(page, host);
    await childRoute(child, '路由');
    await expect(child.getByTestId('child-host')).toHaveText('localhost:7900');
    await child.getByRole('button', { name: '添加 query 和 hash' }).click();
    await expect(child.getByTestId('child-location')).toHaveText('/location?from=react18#detail');
    await expect.poll(() => new URL(page.url()).searchParams.get('react18')).toBe('/location?from=react18#detail');
    await page.reload();
    await expect(react18(page).getByTestId('child-location')).toHaveText('/location?from=react18#detail');
    await childRoute(react18(page), '首页');
    await page.goBack();
    await expect(react18(page).getByRole('heading', { name: '路由处理' })).toBeVisible();
    await page.goForward();
    await expect(react18(page).getByRole('heading', { name: 'React18 示例' })).toBeVisible();
  });

  test(`${host.name}：代理 location 外跳及浏览器后退恢复`, async ({ page }) => {
    await page.route('https://wujicode.cn/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<h1>外部页面测试</h1>',
      }),
    );
    const child = await enter(page, host);
    await childRoute(child, '路由');
    await child.getByRole('button', { name: '跳转无极' }).click();
    await expect(
      page.frameLocator('iframe[src^="https://wujicode.cn/"]').getByRole('heading', { name: '外部页面测试' }),
    ).toBeVisible();
    await page.goBack();
    await expect(react18(page).getByRole('heading', { name: '路由处理' })).toBeVisible();
  });

  test(`${host.name}：向 Vue3 状态页发送 add 事件并跳转`, async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('preload', 'false'));
    await page.goto(hostUrl(host, '/vue3'));
    const vue3 = page.locator('jieshu-app[data-jieshu-id="vue3"]');
    await vue3.getByRole('link', { name: '状态', exact: true }).click();
    await expect(vue3.locator('.number')).toHaveText('10');
    await page.locator(`a[href="${host.hash ? '#' : ''}/react18"]`).click();
    await childRoute(react18(page), '状态');
    await react18(page).getByRole('button', { name: 'Vue3 state +1 并跳转' }).click();
    await expect(vue3.locator('.number')).toHaveText('11');
  });

  test(`${host.name}：props 跳转、parent alert 和事件总线`, async ({ page }) => {
    const child = await enter(page, host);
    await childRoute(child, '通信');
    expect(await alertMessage(page, child.getByRole('button', { name: '调用主应用 alert' }))).toBe(
      '主应用 alert：来自 React18',
    );
    expect(await alertMessage(page, child.getByRole('button', { name: '发送消息给主应用' }))).toBe(
      '来自 React18 的消息',
    );
    await child.getByRole('button', { name: '发送测试消息' }).click();
    await expect(child.getByTestId('received-message')).toHaveText('React18 事件接收成功');
    await child.getByRole('button', { name: '跳转 Vue3', exact: true }).click();
    await expect
      .poll(() => (host.hash ? new URL(page.url()).hash : new URL(page.url()).pathname))
      .toBe(host.hash ? '#/vue3' : '/vue3');
    await page.locator(`a[href="${host.hash ? '#' : ''}/react18"]`).click();
    await child.getByRole('button', { name: '跳转 React17', exact: true }).click();
    await expect
      .poll(() => (host.hash ? new URL(page.url()).hash : new URL(page.url()).pathname))
      .toBe(host.hash ? '#/react17' : '/react17');
  });

  test(`${host.name}：all 页面跨应用消息、计数与监听清理`, async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('preload', 'false'));
    await page.goto(hostUrl(host, '/all'));
    const child = react18(page);
    await expect(child).toBeVisible();
    await childRoute(child, '通信');
    // 从另一个子应用的总线发送，验证真实的跨应用广播。
    const emit = async (event: string, message?: string) => {
      await page.evaluate(
        ({ event, message }) => {
          const sibling = Array.from(document.querySelectorAll('iframe')).find((frame) => frame.name === 'vue3');
          const bus = sibling?.contentWindow?.$jieshu?.bus;
          if (!bus) {
            throw new Error('Vue3 event bus is not ready');
          }
          if (message === undefined) {
            bus.$emit(event);
          } else {
            bus.$emit(event, message);
          }
        },
        { event, message },
      );
    };
    await expect
      .poll(() =>
        page.evaluate(() =>
          Array.from(document.querySelectorAll('iframe')).some(
            (frame) => frame.name === 'vue3' && Boolean(frame.contentWindow?.$jieshu),
          ),
        ),
      )
      .toBe(true);
    await emit('react18-message', '来自 Vue3 的广播');
    await expect(child.getByTestId('received-message')).toHaveText('来自 Vue3 的广播');
    await childRoute(child, '状态');
    await emit('react18-add');
    await expect(child.getByTestId('state-count')).toHaveText('11');
    await childRoute(child, '首页');
    await childRoute(child, '状态');
    await emit('react18-add');
    await expect(child.getByTestId('state-count')).toHaveText('11');
  });
}
