let tokenProvider: (() => Promise<string | null>) | undefined
export function setTokenProvider(provider: () => Promise<string | null>) {
  tokenProvider = provider
}
export async function getAuthToken(): Promise<string | null> {
  return tokenProvider ? tokenProvider() : null
}
