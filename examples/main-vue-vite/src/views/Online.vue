<script setup>
import { ref } from 'vue';

const websites = [
  {
    name: 'Ant Design',
    url: 'https://ant.design/components/drawer-cn/',
  },
  {
    name: 'React',
    url: 'https://react.dev/',
  },
  {
    name: 'Webpack',
    url: 'https://webpack.js.org/',
  },
  {
    name: 'Vuetify',
    url: 'https://vuetifyjs.com/en/',
  },
  {
    name: 'Naive UI',
    url: 'https://www.naiveui.com/zh-CN/os-theme/components/button',
  },
];

const selectedIndex = ref(0);
const inputUrl = ref(websites[0].url);
const jieshuUrl = ref(websites[0].url);
const validationMessage = ref('');
const loading = document.createElement('div');

loading.className = 'online-loading';
loading.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="30" viewBox="0 0 24 30" aria-label="加载中">
  <rect x="0" y="13" width="4" height="5" fill="#f16b5f">
    <animate attributeName="height" values="5;21;5" begin="0s" dur="0.6s" repeatCount="indefinite" />
    <animate attributeName="y" values="13;5;13" begin="0s" dur="0.6s" repeatCount="indefinite" />
  </rect>
  <rect x="10" y="13" width="4" height="5" fill="#f16b5f">
    <animate attributeName="height" values="5;21;5" begin="0.15s" dur="0.6s" repeatCount="indefinite" />
    <animate attributeName="y" values="13;5;13" begin="0.15s" dur="0.6s" repeatCount="indefinite" />
  </rect>
  <rect x="20" y="13" width="4" height="5" fill="#f16b5f">
    <animate attributeName="height" values="5;21;5" begin="0.3s" dur="0.6s" repeatCount="indefinite" />
    <animate attributeName="y" values="13;5;13" begin="0.3s" dur="0.6s" repeatCount="indefinite" />
  </rect>
</svg>`;

function openWebsite(url, index = -1) {
  let parsedUrl;

  try {
    parsedUrl = new URL(url);
  } catch {
    validationMessage.value = '请输入完整、有效的 HTTPS 地址。';
    return;
  }

  if (parsedUrl.protocol !== 'https:') {
    validationMessage.value = '在线体验仅支持 HTTPS 地址。';
    return;
  }

  inputUrl.value = parsedUrl.href;
  jieshuUrl.value = parsedUrl.href;
  selectedIndex.value = index;
  validationMessage.value = '';
}
</script>

<template>
  <main class="online-page">
    <section class="online-intro">
      <h1><span>开箱即用</span>，用最简单的方式体验界枢</h1>

      <form class="url-form" @submit.prevent="openWebsite(inputUrl)">
        <label class="sr-only" for="online-url">需要加载的网站地址</label>
        <input
          id="online-url"
          v-model.trim="inputUrl"
          type="url"
          inputmode="url"
          placeholder="https://example.com/"
          required
        />
        <button type="submit">Magic</button>
      </form>

      <p class="help">请输入一个允许跨域访问的 HTTPS 网站。部分网站会因自身安全策略而无法加载。</p>
      <p v-if="validationMessage" class="validation-message" role="alert">{{ validationMessage }}</p>

      <div class="quick-links" aria-label="快速选择网站">
        <span>快速前往：</span>
        <button
          v-for="(website, index) in websites"
          :key="website.url"
          type="button"
          :class="{ selected: selectedIndex === index }"
          @click="openWebsite(website.url, index)"
        >
          {{ website.name }}
        </button>
      </div>
    </section>

    <section class="preview" aria-label="界枢在线体验预览">
      <JieshuVue
        v-if="jieshuUrl"
        :key="jieshuUrl"
        class="jieshu-container"
        :name="jieshuUrl"
        :url="jieshuUrl"
        :loading="loading"
        alive
      />
    </section>
  </main>
</template>

<style scoped>
.online-page {
  box-sizing: border-box;
  min-height: 100%;
  padding: 36px clamp(20px, 4vw, 64px) 48px;
  background: #f8fafc;
}

.online-intro {
  max-width: 920px;
  margin: 0 auto 28px;
  text-align: center;
}

h1 {
  margin: 0 0 24px;
  color: #2c3e50;
  font-size: clamp(24px, 3vw, 36px);
  font-weight: 500;
}

h1 span {
  color: var(--theme);
}

.url-form {
  display: flex;
  max-width: 680px;
  margin: 0 auto;
  padding: 6px;
  border: 2px solid #e2e8f0;
  border-radius: 12px;
  background: #fff;
  transition: border-color 0.2s ease;
}

.url-form:focus-within {
  border-color: var(--theme);
}

.url-form input {
  min-width: 0;
  flex: 1;
  padding: 9px 12px;
  border: 0;
  outline: 0;
  color: #2c3e50;
  font: inherit;
  font-size: 16px;
}

.url-form button,
.quick-links button {
  border: 1px solid var(--theme);
  border-radius: 8px;
  cursor: pointer;
  transition:
    color 0.2s ease,
    background-color 0.2s ease;
}

.url-form button {
  padding: 0 20px;
  color: #fff;
  background: var(--theme);
  font-weight: 600;
}

.url-form button:hover {
  background: #df5b50;
}

.help,
.validation-message {
  margin: 10px auto 0;
  font-size: 14px;
}

.help {
  color: #64748b;
}

.validation-message {
  color: #d4380d;
}

.quick-links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 20px;
  color: #64748b;
  font-size: 14px;
}

.quick-links button {
  padding: 4px 10px;
  color: #475569;
  background: #fff;
}

.quick-links button:hover,
.quick-links button.selected {
  color: #fff;
  background: var(--theme);
}

.preview {
  width: min(1200px, 100%);
  min-height: 560px;
  margin: 0 auto;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 16px 40px rgb(15 23 42 / 8%);
}

.jieshu-container {
  width: 100%;
  min-height: 560px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media screen and (max-width: 600px) {
  .online-page {
    padding: 72px 12px 24px;
  }

  .url-form button {
    padding: 0 12px;
  }

  .preview,
  .jieshu-container {
    min-height: 480px;
  }
}
</style>
