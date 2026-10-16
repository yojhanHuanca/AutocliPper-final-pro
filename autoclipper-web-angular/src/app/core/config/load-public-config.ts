export async function loadPublicConfig(): Promise<{ apiBaseUrl: string }> {
  const response = await fetch("/config.json", { cache: "no-store" });
  if (!response.ok)
    throw new Error("No se pudo cargar la configuración pública.");
  const config: unknown = await response.json();
  if (
    !config ||
    typeof config !== "object" ||
    !("apiBaseUrl" in config) ||
    typeof config.apiBaseUrl !== "string"
  ) {
    throw new Error("Configuración de API inválida.");
  }
  const url = new URL(config.apiBaseUrl, window.location.origin);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("URL pública de API inválida.");
  }
  return { apiBaseUrl: url.href.replace(/\/$/, "") };
}
