import { expect, test } from '@playwright/test';

test('独立运行 React18，更新和重置组件状态', async ({ page }) => {
  await page.goto('http://localhost:7900/');
  await expect(page.getByRole('heading', { name: 'React18 子应用' })).toBeVisible();
  await expect(page.getByText('Vite + TypeScript + React 18.3.1', { exact: true })).toBeVisible();
  await expect(page.getByText('当前为独立运行模式')).toBeVisible();
  await page.getByRole('button', { name: '计数：0', exact: true }).click();
  await expect(page.getByRole('button', { name: '计数：1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await expect(page.getByRole('button', { name: '计数：0', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '发送消息给主应用' })).toBeDisabled();
});

const hosts = [
  { name: 'React Webpack', url: 'http://localhost:7700/#/home', all: '#/all' },
  { name: 'React Rspack', url: 'http://localhost:7801/#/home', all: '#/all' },
  { name: 'Vue Vite', url: 'http://localhost:8000/home', all: '/all' },
];

for (const host of hosts) {
  for (const preload of [false, true]) {
    test(`${host.name}：预加载 ${preload}，挂载、通信和重新挂载`, async ({ page }) => {
      await page.addInitScript((enabled) => {
        window.localStorage.setItem('preload', String(enabled));
      }, preload);
      await page.goto(host.url);
      await page.getByRole('link', { name: 'React18', exact: true }).click();
      const child = page.locator('jieshu-app');
      await expect(child.getByRole('heading', { name: 'React18 子应用' })).toBeVisible();
      await expect(child.getByText('当前运行在界枢微前端环境中')).toBeVisible();
      await child.getByRole('button', { name: '计数：0', exact: true }).click();
      await expect(child.getByRole('button', { name: '计数：1', exact: true })).toBeVisible();

      const message = page.waitForEvent('dialog').then(async (dialog) => {
        const text = dialog.message();
        await dialog.accept();
        return text;
      });
      await child.getByRole('button', { name: '发送消息给主应用' }).click();
      expect(await message).toBe('来自 React18 的消息');

      await child.getByRole('button', { name: '返回主应用首页' }).click();
      await expect(page).toHaveURL(host.url);
      await expect(child.getByRole('heading', { name: 'React18 子应用' })).toHaveCount(0);
      await page.getByRole('link', { name: 'React18', exact: true }).click();
      await expect(child.getByRole('button', { name: '计数：0', exact: true })).toBeVisible();
    });
  }

  test(`${host.name}：all 页面同时挂载 React18`, async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('preload', 'false'));
    await page.goto(new URL(host.all, host.url).href);
    const child = page.locator('jieshu-app').filter({ has: page.getByRole('heading', { name: 'React18 子应用' }) });
    await expect(child).toHaveCount(1);
    await child.getByRole('button', { name: '计数：0', exact: true }).click();
    await expect(child.getByRole('button', { name: '计数：1', exact: true })).toBeVisible();
  });
}
