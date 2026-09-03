export default function credentialsFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return window.fetch(input, { ...init, credentials: "omit" });
}
