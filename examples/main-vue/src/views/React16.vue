<template>
  <!--单例模式，name相同则复用一个界枢实例，改变url则子应用重新渲染实例到对应路由 -->
  <JieshuVue width="100%" height="100%" name="react16" :url="react16Url" :sync="true"></JieshuVue>
</template>

<script>
import hostMap from '../hostMap';

export default {
  name: 'React16View',
  data() {
    return {
      react16Url: hostMap('//localhost:7600/'),
    };
  },
};
</script>

<style scoped></style>
