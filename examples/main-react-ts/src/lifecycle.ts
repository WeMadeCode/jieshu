interface WujieRuntimeWindow extends Window {
  __WUJIE: {
    id: string;
  };
}

function getAppId(appWindow: Window): string {
  return (appWindow as WujieRuntimeWindow).__WUJIE.id;
}

const lifecycles = {
  beforeLoad: (appWindow: Window): void => console.log(`${getAppId(appWindow)} beforeLoad 生命周期`),
  beforeMount: (appWindow: Window): void => console.log(`${getAppId(appWindow)} beforeMount 生命周期`),
  afterMount: (appWindow: Window): void => console.log(`${getAppId(appWindow)} afterMount 生命周期`),
  beforeUnmount: (appWindow: Window): void => console.log(`${getAppId(appWindow)} beforeUnmount 生命周期`),
  afterUnmount: (appWindow: Window): void => console.log(`${getAppId(appWindow)} afterUnmount 生命周期`),
  activated: (appWindow: Window): void => console.log(`${getAppId(appWindow)} activated 生命周期`),
  deactivated: (appWindow: Window): void => console.log(`${getAppId(appWindow)} deactivated 生命周期`),
  loadError: (url: string, error: Error): void => console.log(`${url} 加载失败`, error),
};

export default lifecycles;
