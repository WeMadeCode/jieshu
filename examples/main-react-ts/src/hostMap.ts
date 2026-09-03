const productionHosts = {
  "//localhost:7100/": "//wujie-micro.github.io/demo-react17/",
  "//localhost:7200/": "//wujie-micro.github.io/demo-vue2/",
  "//localhost:7300/": "//wujie-micro.github.io/demo-vue3/",
  "//localhost:7400/": "//wujie-micro.github.io/demo-angular12/",
  "//localhost:7500/": "//wujie-micro.github.io/demo-vite/",
  "//localhost:7600/": "//wujie-micro.github.io/demo-react16/",
} as const;

export type LocalAppHost = keyof typeof productionHosts;

export default function hostMap(host: LocalAppHost): string {
  return import.meta.env.PROD ? productionHosts[host] : host;
}
