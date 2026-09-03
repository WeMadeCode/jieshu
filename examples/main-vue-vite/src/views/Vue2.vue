<template>
  <!--单例模式，name相同则复用一个界枢实例，改变url则子应用重新渲染实例到对应路由 -->
  <JieshuVue width="100%" height="100%" name="vue2" :url="vue2Url" :sync="true"></JieshuVue>
</template>

<script>
import hostMap from '../hostMap';

export default {
  name: 'Vue2View',
  data() {
    return {
      vue2Url: hostMap('//localhost:7200/'),
    };
  },
  methods: {
    jump(name) {
      this.$router.push({ name });
    },
  },
};
</script>

<style scoped></style>
