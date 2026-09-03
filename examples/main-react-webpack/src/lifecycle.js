const lifecycles = {
  beforeLoad: (appWindow) => console.log(`${appWindow.__JIESHU.id} beforeLoad 生命周期`),
  beforeMount: (appWindow) => console.log(`${appWindow.__JIESHU.id} beforeMount 生命周期`),
  afterMount: (appWindow) => console.log(`${appWindow.__JIESHU.id} afterMount 生命周期`),
  beforeUnmount: (appWindow) => console.log(`${appWindow.__JIESHU.id} beforeUnmount 生命周期`),
  afterUnmount: (appWindow) => console.log(`${appWindow.__JIESHU.id} afterUnmount 生命周期`),
  activated: (appWindow) => console.log(`${appWindow.__JIESHU.id} activated 生命周期`),
  deactivated: (appWindow) => console.log(`${appWindow.__JIESHU.id} deactivated 生命周期`),
  loadError: (url, e) => console.log(`${url} 加载失败`, e),
};

export default lifecycles;
