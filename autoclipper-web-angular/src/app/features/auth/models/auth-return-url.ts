export function safeAuthReturnUrl(requested: string | null): string {
  if (!requested || !requested.startsWith("/") || requested.startsWith("//")) return "/app";
  const path = requested.split(/[?#]/, 1)[0];
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(path);
  } catch {
    return "/app";
  }
  const segments = decodedPath.split("/");
  if (decodedPath.includes("\\") || /[\u0000-\u001f\u007f]/.test(decodedPath) ||
      segments.some((segment) => segment === "." || segment === "..") ||
      segments.some((segment, index) => index > 0 && index < segments.length - 1 && segment === "")) {
    return "/app";
  }
  return decodedPath === "/app" || decodedPath.startsWith("/app/") || decodedPath === "/admin" || decodedPath.startsWith("/admin/")
    ? requested
    : "/app";
}
