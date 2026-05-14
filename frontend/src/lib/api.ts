const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000";

export function getBackendBaseUrl(): string {
  return process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_BASE_URL || DEFAULT_BACKEND_URL;
}

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  // If this looks like a Next app API route, prefer same-origin relative URL
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (normalizedPath.startsWith("/api/")) {
    return normalizedPath;
  }

  return new URL(normalizedPath, getBackendBaseUrl()).toString();
}
