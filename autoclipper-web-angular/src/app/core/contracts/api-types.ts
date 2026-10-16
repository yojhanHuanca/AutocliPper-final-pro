import type { components, paths } from "./gateway.generated";
export type Schema<K extends keyof components["schemas"]> =
  components["schemas"][K];
export type Response<
  P extends keyof paths,
  M extends keyof paths[P] = "get" & keyof paths[P],
> = paths[P][M] extends {
  responses: { 200: { content: { "application/json": infer R } } };
}
  ? R
  : never;
