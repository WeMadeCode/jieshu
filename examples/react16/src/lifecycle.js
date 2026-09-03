const lifecycles = {
  beforeLoad: (appWindow) => console.log(`${appWindow.__JIESHU.id} beforeLoad 生命周期`),
  beforeMount: (appWindow) => console.log(`${appWindow.__JIESHU.id} beforeMount 生命周期`),
  afterMount: (appWindow) => console.log(`${appWindow.__JIESHU.id} afterMount 生命周期`),
  beforeUnmount: (appWindow) => console.log(`${appWindow.__JIESHU.id} beforeUnmount 生命周期`),
  afterUnmount: (appWindow) => console.log(`${appWindow.__JIESHU.id} afterUnmount 生命周期`),
};

export default lifecycles;
