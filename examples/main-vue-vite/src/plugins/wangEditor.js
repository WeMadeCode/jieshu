/**
 * wangEditor 在界枢下的兼容插件（Issue #479）。
 *
 * 子应用 UI 在主应用 shadowRoot 中渲染，paste 事件的 clipboardData 来自主应用 realm，
 * 子应用内 `clipboardData instanceof DataTransfer` 会为 false，导致粘贴无响应。
 *
 * @cloud/jieshu-core 会修复跨 realm instanceof，这里同时显式对齐编辑器依赖的构造函数。
 */
export const wangEditorPlugin = {
  jsBeforeLoaders: [
    {
      callback(appWindow) {
        Object.defineProperties(appWindow, {
          Selection: {
            configurable: true,
            get() {
              return appWindow.parent.Selection;
            },
          },
          DataTransfer: {
            configurable: true,
            get() {
              return appWindow.parent.DataTransfer;
            },
          },
        });
      },
    },
  ],
};
