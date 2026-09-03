const map = {
  '//localhost:7100/': '/demo-react17/',
  '//localhost:7200/': '/demo-vue2/',
  '//localhost:7300/': '/demo-vue3/',
  '//localhost:7400/': '/demo-angular12/',
  '//localhost:7500/': '/demo-vite/',
  '//localhost:7600/': '/demo-react16/',
};

export default function hostMap(host) {
  if (process.env.NODE_ENV === 'production') return map[host];
  return host;
}
