import { enableProdMode } from '@angular/core';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';

import { AppModule } from './app/app.module';
import { environment } from './environments/environment';

declare global {
  interface Window {
    // 是否存在界枢
    __POWERED_BY_JIESHU__?: boolean;
    // 子应用公共加载路径
    __JIESHU_PUBLIC_PATH__: string;
    // 子应用mount函数
    __JIESHU_MOUNT: () => void;
    // 子应用unmount函数
    __JIESHU_UNMOUNT: () => void | Promise<void>;
  }
}

if (environment.production) {
  enableProdMode();
}

if (window.__POWERED_BY_JIESHU__) {
  let instance: any;
  window.__JIESHU_MOUNT = async () => {
    instance = await platformBrowserDynamic().bootstrapModule(AppModule);
  };
  window.__JIESHU_UNMOUNT = () => {
    instance.destroy();
  };
} else {
  platformBrowserDynamic()
    .bootstrapModule(AppModule)
    .catch((err) => console.error(err));
}
