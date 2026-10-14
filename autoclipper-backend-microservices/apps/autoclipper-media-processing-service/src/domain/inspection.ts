import { z } from "zod";

export class InspectionError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}
const probeSchema = z.object({
  format: z.object({
    duration: z.coerce.number().finite().positive(),
    format_name: z.string(),
  }),
  streams: z
    .array(
      z.object({
        codec_type: z.string(),
        codec_name: z.string().optional(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
      }),
    )
    .max(32),
});
export type MediaMetadata = {
  durationSeconds: number;
  format: string;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string | null;
};

export function validateMetadata(
  input: unknown,
  maxSeconds: number,
): MediaMetadata {
  const parsed = probeSchema.safeParse(input);
  if (!parsed.success) throw new InspectionError("INVALID_MEDIA", false);
  const { format, streams } = parsed.data;
  const video = streams.find((s) => s.codec_type === "video");
  if (
    !video?.width ||
    !video.height ||
    !video.codec_name ||
    !format.format_name
      .split(",")
      .some((f) => ["mov", "mp4", "matroska", "webm"].includes(f))
  )
    throw new InspectionError("UNSUPPORTED_MEDIA", false);
  if (format.duration > maxSeconds || video.width > 7680 || video.height > 7680)
    throw new InspectionError("MEDIA_LIMIT_EXCEEDED", false);
  return {
    durationSeconds: format.duration,
    format: format.format_name,
    width: video.width,
    height: video.height,
    videoCodec: video.codec_name,
    audioCodec:
      streams.find((s) => s.codec_type === "audio")?.codec_name ?? null,
  };
}

export function validateObjectKey(key: string, workspaceId: string) {
  if (
    !z.uuid().safeParse(workspaceId).success ||
    !key.startsWith(`workspaces/${workspaceId}/media/`) ||
    !/^[a-zA-Z0-9/_.-]+$/.test(key) ||
    key.includes("..") ||
    key.length > 512
  )
    throw new InspectionError("INVALID_OBJECT_KEY", false);
}

export const transitions = {
  queued: ["running"],
  running: ["queued", "succeeded", "failed"],
  succeeded: [],
  failed: [],
} as const;
export type TaskStatus = keyof typeof transitions;
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return (transitions[from] as readonly TaskStatus[]).includes(to);
}
