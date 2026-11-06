/** Espacio total por workspace. Por defecto 500 GiB para admitir varios videos largos. */
export const WORKSPACE_STORAGE_LIMIT_BYTES = Number(
  process.env["WORKSPACE_STORAGE_LIMIT_BYTES"] ?? 536870912000,
);
