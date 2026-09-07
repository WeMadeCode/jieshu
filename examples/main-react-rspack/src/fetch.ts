export default function credentialsFetch(input: RequestInfo | URL, init?: RequestInit) {
  return window.fetch(input, { ...init, credentials: 'omit' });
}
