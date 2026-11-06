import { z } from "zod";
import { ApiProperty } from "@nestjs/swagger";

const hasControlCharacter = (value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};

export const twitchSourceCapabilityRequest = z.object({ userId: z.uuid() }).strict();
export const twitchSourceCapabilityStatus = z.object({
  configured: z.boolean(),
  linked: z.boolean(),
  clipScopeReady: z.boolean(),
}).strict();
export const twitchVodClipCreateRequest = z.object({
  userId: z.uuid(),
  vodId: z.string().regex(/^\d{1,20}$/u),
  vodOffsetSeconds: z.number().int().min(5).max(Number.MAX_SAFE_INTEGER),
  durationSeconds: z.number().int().min(5).max(60),
  title: z.string().trim().min(1).max(140).refine(value=>!hasControlCharacter(value)),
}).strict().refine(value=>value.vodOffsetSeconds>=value.durationSeconds);
export const twitchVodClipCreateResult = z.discriminatedUnion("state",[
  z.object({state:z.literal("created"),clipId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),broadcasterId:z.string().regex(/^\d{1,20}$/u),title:z.string().max(140),durationSeconds:z.number().int().min(5).max(60)}).strict(),
  z.object({state:z.literal("rejected"),reasonCode:z.string().regex(/^[A-Z_]{1,100}$/u)}).strict(),
  z.object({state:z.literal("outcome_unknown"),reasonCode:z.literal("TWITCH_VOD_CLIP_CREATE_OUTCOME_UNKNOWN")}).strict(),
]);

export const sourceCapabilityConfigurationState = z.enum([
  "not_required",
  "ready",
  "oauth_not_configured",
  "account_not_linked",
  "clip_scope_missing",
]);
export const sourceImportCapabilityReasonCode = z.enum([
  "YOUTUBE_DOWNLOAD_APPROVAL_REQUIRED",
  "KICK_MEDIA_API_UNAVAILABLE",
  "TWITCH_OAUTH_NOT_CONFIGURED",
  "TWITCH_ACCOUNT_NOT_LINKED",
  "TWITCH_CLIP_SCOPE_REQUIRED",
]);
export const sourceProcessingCapabilityReasonCode = z.enum([
  "SOURCE_BYTES_UNAVAILABLE",
  "UPLOAD_CONFIRMATION_AND_INSPECTION_REQUIRED",
]);
export const sourceLinkProviderCapability = z.object({
  provider: z.enum(["youtube", "kick", "twitch"]),
  configurationState: sourceCapabilityConfigurationState,
  previewAvailable: z.literal(true),
  previewKinds: z.array(z.enum(["youtube_video", "kick_live_channel", "twitch_video", "twitch_clip"])).min(1).max(2),
  importAvailable: z.boolean(),
  importReasonCode: sourceImportCapabilityReasonCode.nullable(),
  requiresClipPermissionCheck: z.boolean(),
  processingAvailable: z.literal(false),
  processingReasonCode: sourceProcessingCapabilityReasonCode,
}).strict();
export const sourceLinkCapabilities = z.object({
  projectId: z.uuid(),
  providers: z.array(sourceLinkProviderCapability).length(3),
}).strict().superRefine((value, context) => {
  const providers = value.providers.map(provider => provider.provider);
  if (new Set(providers).size !== 3 || !["youtube", "kick", "twitch"].every(provider => providers.includes(provider as typeof providers[number]))) {
    context.addIssue({ code: "custom", message: "Each source provider must appear exactly once.", path: ["providers"] });
  }
});
export type TwitchSourceCapabilityRequest = z.infer<typeof twitchSourceCapabilityRequest>;
export type TwitchSourceCapabilityStatus = z.infer<typeof twitchSourceCapabilityStatus>;
export type SourceLinkCapabilities = z.infer<typeof sourceLinkCapabilities>;

export class SourceProviderCapabilityDto {
  @ApiProperty({ enum: ["youtube", "kick", "twitch"] }) provider!: string;
  @ApiProperty({ enum: ["not_required", "ready", "oauth_not_configured", "account_not_linked", "clip_scope_missing"] }) configurationState!: string;
  @ApiProperty({ enum: [true] }) previewAvailable!: boolean;
  @ApiProperty({ type: [String], enum: ["youtube_video", "kick_live_channel", "twitch_video", "twitch_clip"] }) previewKinds!: string[];
  @ApiProperty() importAvailable!: boolean;
  @ApiProperty({ type: String, nullable: true, enum: ["YOUTUBE_DOWNLOAD_APPROVAL_REQUIRED", "KICK_MEDIA_API_UNAVAILABLE", "TWITCH_OAUTH_NOT_CONFIGURED", "TWITCH_ACCOUNT_NOT_LINKED", "TWITCH_CLIP_SCOPE_REQUIRED"] }) importReasonCode!: string | null;
  @ApiProperty() requiresClipPermissionCheck!: boolean;
  @ApiProperty({ enum: [false] }) processingAvailable!: boolean;
  @ApiProperty({ enum: ["SOURCE_BYTES_UNAVAILABLE", "UPLOAD_CONFIRMATION_AND_INSPECTION_REQUIRED"] }) processingReasonCode!: string;
}
export class SourceLinkCapabilitiesDto {
  @ApiProperty({ format: "uuid" }) projectId!: string;
  @ApiProperty({ type: [SourceProviderCapabilityDto], minItems: 3, maxItems: 3 }) providers!: SourceProviderCapabilityDto[];
}
