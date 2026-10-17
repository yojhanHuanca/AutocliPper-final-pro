export function safeAuthReturnUrl(requested: string | null): string {
  if (!requested || !requested.startsWith("/") || requested.startsWith("//")) return "/app";
  const path = requested.split(/[?#]/, 1)[0];
  return path === "/app" || path.startsWith("/app/") || path === "/admin" || path.startsWith("/admin/")
    ? requested
    : "/app";
}
