<template>
  <JieshuVue
    width="100%"
    height="100%"
    name="react18"
    :url="url"
    :sync="!path"
    :alive="true"
    :props="props"
    :activated="activated"
  />
</template>

<script>
import JieshuVue from '@cloud/jieshu-vue3';
import hostMap from '../hostMap';
import lifecycles from '../lifecycle';

export default {
  computed: {
    path() {
      return this.$route.name === 'react18-sub' ? `/${this.$route.params.path}` : '';
    },
    url() {
      return hostMap('//localhost:7900/') + this.path.slice(1);
    },
    props() {
      return { route: this.path, jump: (name) => this.$router.push({ name }) };
    },
  },
  watch: {
    path: 'syncRoute',
  },
  mounted() {
    JieshuVue.bus.$on('react18-router-ready', this.syncRoute);
  },
  beforeUnmount() {
    JieshuVue.bus.$off('react18-router-ready', this.syncRoute);
  },
  methods: {
    syncRoute() {
      if (this.path) {
        JieshuVue.bus.$emit('react18-router-change', this.path);
      }
    },
    activated(appWindow) {
      lifecycles.activated(appWindow);
      this.syncRoute();
    },
  },
};
</script>
