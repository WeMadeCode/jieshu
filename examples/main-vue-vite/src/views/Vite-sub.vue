<template>
  <!--单例模式，name相同则复用一个界枢实例，改变url则子应用重新渲染实例到对应路由 -->
  <JieshuVue width="100%" height="100%" name="vite" :url="viteUrl"></JieshuVue>
</template>

<script>
import hostMap from '../hostMap';

export default {
  computed: {
    viteUrl() {
      return hostMap('//localhost:7500/') + this.$route.params.path;
    },
  },
};
</script>

<style scoped></style>
