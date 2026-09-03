import { decodeRouteQuery, getAppRoute, readRouteState } from './route-state';
import type { RouteQuery } from './route-state';

export function anchorElementGenerator(url: string): HTMLAnchorElement {
  const element = window.document.createElement('a');
  element.href = url;
  element.href = element.href;
  return element;
}

export function getAnchorElementQueryMap(anchorElement: HTMLAnchorElement): RouteQuery {
  return decodeRouteQuery(anchorElement.search || '');
}

export function isMatchSyncQueryById(id: string): boolean {
  return Object.keys(getAnchorElementQueryMap(anchorElementGenerator(window.location.href))).includes(id);
}

export function getCurUrl(proxyLocation: object): string {
  const location = proxyLocation as Location;
  return location.protocol + '//' + location.host + location.pathname;
}

export function getAbsolutePath(url: string, base: string, hash?: boolean): string {
  try {
    if (!url || (hash && url.startsWith('#'))) return url;
    return new URL(url, base).href;
  } catch (_error) {
    return url;
  }
}

export function getSyncUrl(id: string, prefix: Record<string, string>): string {
  return getAppRoute(readRouteState(window.location.href), id, prefix);
}

export function defaultGetPublicPath(entry: string | object): string {
  if (typeof entry === 'object') return '/';

  try {
    const { origin, pathname } = new URL(entry, location.href);
    const paths = pathname.split('/');
    paths.pop();
    return `${origin}${paths.join('/')}/`;
  } catch (error) {
    console.warn(error);
    return '';
  }
}
