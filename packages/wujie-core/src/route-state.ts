export type RouteQuery = Record<string, string>;
export type RoutePrefix = Readonly<Record<string, string>>;

export interface RouteState {
  /** 浏览器标准化后的完整主应用地址。 */
  href: string;
  /** URLSearchParams 解码后的查询参数。 */
  query: RouteQuery;
}

/**
 * 按 URLSearchParams 语义读取查询参数。
 * 重复 key 与旧实现一致：保留最后一个值，同时保留首次出现时的 key 顺序。
 */
export function decodeRouteQuery(search: string): RouteQuery {
  // Application ids are public input. A null-prototype record keeps names
  // such as __proto__, constructor and toString as ordinary own keys.
  const query = Object.create(null) as RouteQuery;
  new URLSearchParams(search).forEach((value, key) => {
    query[key] = value;
  });
  return query;
}

/**
 * 保持原有 encodeURIComponent 编码语义：空格编码为 %20，而不是 URLSearchParams 的 +。
 * 空集合仍返回 "?"，以维持既有 history 地址行为。
 */
export function encodeRouteQuery(query: Readonly<RouteQuery>): string {
  return (
    "?" +
    Object.keys(query)
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`)
      .join("&")
  );
}

export function readRouteState(href: string): RouteState {
  const url = new URL(href);
  return {
    href: url.href,
    query: decodeRouteQuery(url.search),
  };
}

/** 将查询参数写回完整地址；URL 会原样保留主应用 hash。 */
export function writeRouteState(state: RouteState): string {
  const url = new URL(state.href);
  url.search = encodeRouteQuery(state.query);
  return url.href;
}

/** 使用最长的路径前缀生成分享用短路径。长度相同时保留配置中的第一个匹配项。 */
export function compactRoutePath(routePath: string, prefix?: RoutePrefix): string {
  if (!prefix) return routePath;

  let matchedName = "";
  let matchedPath = "";
  Object.keys(prefix).forEach((shortPath) => {
    const longPath = prefix[shortPath];
    if (routePath.startsWith(longPath) && (!matchedName || longPath.length > matchedPath.length)) {
      matchedName = shortPath;
      matchedPath = longPath;
    }
  });

  return matchedName ? routePath.replace(matchedPath, `{${matchedName}}`) : routePath;
}

/** 将查询参数开头的 {short-name} 还原为配置的真实路径。 */
export function expandRoutePath(routePath: string, prefix?: RoutePrefix): string {
  const matchedName = routePath.match(/^{([^}]*)}/)?.[1];
  if (!prefix || !matchedName) return routePath;
  if (!Object.prototype.hasOwnProperty.call(prefix, matchedName)) return routePath;
  const expandedPrefix = prefix[matchedName];
  return expandedPrefix === undefined ? routePath : routePath.replace(`{${matchedName}}`, expandedPrefix);
}

export function getAppRoute(state: RouteState, id: string, prefix?: RoutePrefix): string {
  return expandRoutePath(state.query[id] || "", prefix);
}
