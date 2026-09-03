---
layout: page
---

<script setup>
import { ref } from "vue";
import JieshuOnline from "./components/jieshu-online.vue";
import JieshuConnect from "./components/jieshu-connect.vue";
const url = ref("");
const flag = ref(null)
function changeUrl(value) {
  url.value = value[0];
  flag.value = value[1]
}
</script>

<ClientOnly>
    <JieshuConnect @changeUrl="changeUrl" :baseUrl="url" />
    <JieshuOnline v-model:url="url" :flag=flag />
</ClientOnly>
