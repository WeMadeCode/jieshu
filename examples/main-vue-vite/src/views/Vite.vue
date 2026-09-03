<template>
  <!--单例模式，name相同则复用一个界枢实例，改变url则子应用重新渲染实例到对应路由 -->
  <JieshuVue width="100%" height="100%" name="vite" :url="viteUrl" :sync="true"></JieshuVue>
</template>

<script>
import hostMap from '../hostMap';

export default {
  name: 'ViteView',
  data() {
    return {
      viteUrl: hostMap('//localhost:7500/'),
    };
  },
};
</script>

<style scoped></style>
