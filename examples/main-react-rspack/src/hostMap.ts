const productionHosts = {
  '//localhost:7100/': '/demo-react17/',
  '//localhost:7200/': '/demo-vue2/',
  '//localhost:7300/': '/demo-vue3/',
  '//localhost:7400/': '/demo-angular12/',
  '//localhost:7500/': '/demo-vite/',
  '//localhost:7600/': '/demo-react16/',
  '//localhost:7700/': '/demo-main-react/',
  '//localhost:8000/': '/demo-main-vue/',
  '//localhost:5173/doc/': '/doc/',
} as const;

export type LocalAppHost = keyof typeof productionHosts;

export default function hostMap(host: LocalAppHost): string {
  return __PRODUCTION__ ? productionHosts[host] : host;
}
