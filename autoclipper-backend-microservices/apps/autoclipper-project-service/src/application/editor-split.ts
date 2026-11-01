import { createHash } from "node:crypto";
import { editorSpec, type EditorSpec } from "@autoclipper/api-contracts";

const minimumCueSeconds = 0.01;

function splitUserCaptions(spec: EditorSpec, cutSeconds: number) {
  if (spec.subtitles.source !== "user") return [spec.subtitles, spec.subtitles] as const;

  const left: typeof spec.subtitles.cues = [];
  const right: typeof spec.subtitles.cues = [];
  for (const cue of spec.subtitles.cues) {
    if(cue.startSeconds<cutSeconds&&cue.endSeconds>cutSeconds&&Math.min(cutSeconds-cue.startSeconds,cue.endSeconds-cutSeconds)<minimumCueSeconds)return null;
    const leftEnd = Math.min(cue.endSeconds, cutSeconds);
    if (leftEnd - cue.startSeconds >= minimumCueSeconds) {
      left.push({ ...cue, endSeconds: leftEnd });
    }
    const rightStart = Math.max(cue.startSeconds, cutSeconds);
    if (cue.endSeconds - rightStart >= minimumCueSeconds) {
      right.push({ ...cue, startSeconds: rightStart });
    }
  }

  return [
    left.length > 0 ? { ...spec.subtitles, cues: left } : { source: "none" as const },
    right.length > 0 ? { ...spec.subtitles, cues: right } : { source: "none" as const },
  ] as const;
}

export function splitEditorSpec(spec: EditorSpec, cutSeconds: number): [EditorSpec, EditorSpec] | null {
  if (!Number.isFinite(cutSeconds) || cutSeconds <= spec.startSeconds || cutSeconds >= spec.endSeconds) return null;
  const subtitles = splitUserCaptions(spec, cutSeconds);
  if(!subtitles)return null;
  const [leftSubtitles, rightSubtitles] = subtitles;
  const left = editorSpec.safeParse({ ...spec, endSeconds: cutSeconds, subtitles: leftSubtitles });
  const right = editorSpec.safeParse({ ...spec, startSeconds: cutSeconds, subtitles: rightSubtitles });
  if (!left.success || !right.success) return null;
  return [left.data, right.data];
}

export function editorSplitIdempotencyKeys(creatorId: string, requestKey: string): [string, string] {
  return (["left", "right"] as const).map((side) => {
    const bytes = createHash("sha256")
      .update(`autoclipper:editor-split:v1:${creatorId}:${requestKey}:${side}`)
      .digest()
      .subarray(0, 16);
    bytes[6] = (bytes[6]! & 0x0f) | 0x80;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }) as [string, string];
}
