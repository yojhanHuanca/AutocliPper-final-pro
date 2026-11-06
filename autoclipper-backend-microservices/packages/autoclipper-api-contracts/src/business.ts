import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
export class PublicUserDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "email" }) email!: string;
  @ApiProperty() name!: string;
}
export class LoginResponseDto {
  @ApiProperty({ type: PublicUserDto }) user!: PublicUserDto;
}
export class CreatedWorkspaceDto {
  @ApiProperty({ format: "uuid" }) id!: string;
}
export class WorkspaceSummaryDto extends CreatedWorkspaceDto {
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ["personal", "team"] }) kind!: string;
  @ApiProperty({ enum: ["owner", "admin", "editor", "reader"] }) role!: string;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
}
export class WorkspaceListDto {
  @ApiProperty({ type: [WorkspaceSummaryDto] }) items!: WorkspaceSummaryDto[];
}
export class MemberDto {
  @ApiProperty({ format: "uuid" }) userId!: string;
  @ApiProperty({ enum: ["owner", "admin", "editor", "reader"] }) role!: string;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
}
export class MemberListDto {
  @ApiProperty({ type: [MemberDto] }) items!: MemberDto[];
}
export class CreatedProjectDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
}
export class ProjectResponseDto extends CreatedProjectDto {
  @ApiProperty({ format: "uuid" }) workspaceId!: string;
  @ApiProperty() name!: string;
}
export class ProjectSummaryDto extends ProjectResponseDto {
  @ApiProperty({ format: "date-time" }) createdAt!: string;
}
export class ProjectListDto {
  @ApiProperty({ type: [ProjectSummaryDto] }) items!: ProjectSummaryDto[];
}
export class YoutubeVideoMetadataDto {
  @ApiProperty({ enum: ["available", "unavailable"] }) state!: string;
  @ApiPropertyOptional({ enum: ["YOUTUBE_METADATA_NOT_CONFIGURED", "YOUTUBE_METADATA_NOT_FOUND", "YOUTUBE_METADATA_RATE_LIMITED", "YOUTUBE_METADATA_UNAVAILABLE"] }) reasonCode?: string;
  @ApiPropertyOptional() title?: string;
  @ApiPropertyOptional() channelTitle?: string;
  @ApiPropertyOptional() durationSeconds?: number;
  @ApiPropertyOptional({ format: "uri", nullable: true }) thumbnailUrl?: string | null;
  @ApiPropertyOptional({ nullable: true }) uploadStatus?: string | null;
  @ApiPropertyOptional({ nullable: true }) privacyStatus?: string | null;
  @ApiPropertyOptional({ nullable: true }) embeddable?: boolean | null;
}
export class SourceLinkResolutionDto {
  @ApiProperty({ enum: ["youtube", "kick", "twitch"] }) provider!: string;
  @ApiProperty({ enum: ["available", "unavailable", "unsupported", "input_required"] }) state!: string;
  @ApiProperty() importable!: boolean;
  @ApiPropertyOptional({ enum: ["YOUTUBE_DOWNLOAD_APPROVAL_REQUIRED", "KICK_MEDIA_API_UNAVAILABLE", "TWITCH_OAUTH_NOT_CONFIGURED", "TWITCH_ACCOUNT_NOT_LINKED", "TWITCH_CLIP_SCOPE_REQUIRED", "TWITCH_CHANNEL_EDITOR_REQUIRED", "TWITCH_RATE_LIMITED", "TWITCH_VOD_INTERVAL_REQUIRED", "TWITCH_VOD_OFFSET_OUT_OF_RANGE", "TWITCH_VOD_NOT_FOUND", "TWITCH_VOD_CLIP_OUTCOME_UNKNOWN"] }) reasonCode?: string;
  @ApiPropertyOptional({ enum: ["upload_authorized_file", "configure_twitch_oauth", "link_twitch_account", "connect_broadcaster_or_editor_account", "retry_after_rate_limit", "import_twitch_clip", "import_twitch_vod_clip", "import_youtube_video", "contact_support"] }) nextAction?: string;
  @ApiPropertyOptional() message?: string;
  @ApiPropertyOptional() nextStep?: string;
  @ApiPropertyOptional() kind?: string;
  @ApiPropertyOptional() clipId?: string;
  @ApiPropertyOptional() vodId?: string;
  @ApiPropertyOptional({ minimum: 5, maximum: Number.MAX_SAFE_INTEGER }) vodOffsetSeconds?: number;
  @ApiPropertyOptional({ format: "uri", description: "Official YouTube IFrame embed URL for preview only; never an import URL." }) previewUrl?: string;
  @ApiPropertyOptional() videoId?: string;
  @ApiPropertyOptional() title?: string;
  @ApiPropertyOptional() durationSeconds?: number;
  @ApiPropertyOptional({ type: YoutubeVideoMetadataDto, description: "YouTube Data API metadata only. Presence of metadata does not enable import." }) youtubeMetadata?: YoutubeVideoMetadataDto;
}
export class PutUploadIntentDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ enum: ["put"] }) mode!: string;
  @ApiProperty({
    format: "uri",
    description: "Temporary capability URL; expires after five minutes.",
  })
  url!: string;
  @ApiProperty({ type: "object", additionalProperties: { type: "string" } })
  headers!: Record<string, string>;
  @ApiProperty({ example: 300 }) expiresInSeconds!: number;
}
export class MultipartUploadIntentDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ enum: ["multipart"] }) mode!: string;
  @ApiProperty({ example: 8388608 }) partBytes!: number;
  @ApiProperty() parts!: number;
  @ApiProperty({ format: "date-time" }) expiresAt!: string;
}
export class SignedPartDto {
  @ApiProperty({ format: "uri" }) url!: string;
  @ApiProperty({ description: "Exact size of this part, in bytes." })
  bytes!: number;
  @ApiProperty({ type: "object", additionalProperties: { type: "string" } })
  headers!: Record<string, string>;
  @ApiProperty({ example: 300 }) expiresInSeconds!: number;
}
export class MetadataDto {
  @ApiProperty({ description: "Measured duration in seconds." })
  durationSeconds!: number;
  @ApiProperty() format!: string;
  @ApiProperty() width!: number;
  @ApiProperty() height!: number;
  @ApiProperty() videoCodec!: string;
  @ApiProperty({ type: String, nullable: true }) audioCodec!: string | null;
}
export class InspectionDto {
  @ApiProperty({ enum: ["queued", "running", "succeeded", "failed"] })
  status!: string;
  @ApiPropertyOptional({ format: "uuid" }) id?: string;
  @ApiPropertyOptional({ type: MetadataDto, nullable: true })
  result?: MetadataDto | null;
  @ApiPropertyOptional({ type: String, nullable: true }) errorCode?:
    string | null;
  @ApiPropertyOptional() attempts?: number;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  startedAt?: string | null;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  finishedAt?: string | null;
}
export class UploadStatusDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) projectId!: string;
  @ApiProperty({ enum: ["pending", "confirmed", "aborted"] }) state!: string;
  @ApiProperty({ description: "Declared and confirmed object size in bytes." })
  bytes!: number;
  @ApiProperty({ format: "date-time" }) expiresAt!: string;
  @ApiPropertyOptional({ type: InspectionDto }) inspection?: InspectionDto;
}
export class ConfirmedUploadDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ enum: ["confirmed"] }) state!: string;
}
export class SourcePlaybackDto {
  @ApiProperty({
    format: "uri",
    description:
      "Short-lived bearer capability for inline playback. Keep it out of logs and referrer headers. The URL accepts standard HTTP Range requests for seeking.",
  })
  url!: string;
  @ApiProperty({ minimum: 1, maximum: 120, example: 120 })
  expiresInSeconds!: number;
  @ApiProperty({ enum: ["video/mp4", "video/webm", "video/quicktime", "video/x-matroska"] })
  contentType!: string;
  @ApiProperty({ minimum: 1 }) bytes!: number;
  @ApiProperty({ pattern: "^[a-f0-9]{64}$" }) sha256!: string;
}
export class MfaStatusResponseDto {
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ minimum: 0, maximum: 10 }) recoveryCodesRemaining!: number;
}
export class MfaSetupResponseDto {
  @ApiProperty({
    format: "uri",
    description:
      "Sensitive authenticator enrollment URI; never log or persist in the browser.",
  })
  otpauthUri!: string;
  @ApiProperty({ example: 600 }) expiresInSeconds!: number;
}
export class RecoveryCodesResponseDto {
  @ApiProperty({
    type: [String],
    description:
      "Displayed once. Store offline; each code is accepted only once.",
  })
  recoveryCodes!: string[];
}
export class MfaEnabledResponseDto extends RecoveryCodesResponseDto {
  @ApiProperty({ enum: [true] }) enabled!: boolean;
}
export class PreferencesResponseDto {
  @ApiProperty({ enum: ["es", "en"] }) locale!: string;
  @ApiProperty({ example: "America/Lima" }) timezone!: string;
  @ApiProperty() emailNotifications!: boolean;
  @ApiProperty({ enum: ["light", "dark", "system"] }) theme!: string;
}
export class ProfileResponseDto extends PublicUserDto {
  @ApiProperty({ type: PreferencesResponseDto })
  preferences!: PreferencesResponseDto;
  @ApiProperty({ minimum: 1 }) version!: number;
}
export class PrivacyRequestResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ enum: ["export", "deletion"] }) kind!: string;
  @ApiProperty({ enum: ["requested"] }) state!: string;
  @ApiProperty({
    enum: ["pending"],
    description:
      "Request recorded; actual export/deletion is not performed by this endpoint.",
  })
  fulfillment!: string;
}
export const flagResponse = (field: string) => ({
  type: "object" as const,
  required: [field],
  additionalProperties: false,
  properties: { [field]: { type: "boolean" as const } },
});
export class CsrfResponseDto {
  @ApiProperty({
    description:
      "Signed double-submit token; keep in memory and send only to this API.",
  })
  csrfToken!: string;
}
export class SessionResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
  @ApiProperty({ format: "date-time" }) expiresAt!: string;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  revokedAt!: string | null;
}
export class SessionListResponseDto {
  @ApiProperty({ type: [SessionResponseDto] }) items!: SessionResponseDto[];
}
export class SecurityEventResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() action!: string;
  @ApiProperty({ format: "uuid" }) correlationId!: string;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
}
export class SecurityEventListResponseDto {
  @ApiProperty({ type: [SecurityEventResponseDto] })
  items!: SecurityEventResponseDto[];
}
export class PrivacyStatusResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ enum: ["export", "deletion"] }) kind!: string;
  @ApiProperty({ enum: ["requested", "processing", "completed", "rejected"] })
  state!: string;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  completedAt!: string | null;
}
export class PrivacyListResponseDto {
  @ApiProperty({ type: [PrivacyStatusResponseDto] })
  items!: PrivacyStatusResponseDto[];
}
export class PrivacyDeletionStatusDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ enum: ["deletion"] }) kind!: string;
  @ApiProperty({ enum: ["requested", "processing", "completed", "rejected"], description: "Stored request state; it does not establish that data was purged." }) requestState!: string;
  @ApiProperty({ enum: ["pending"], description: "Global deletion fulfillment is still pending." }) fulfillment!: string;
  @ApiProperty({ enum: [false], description: "This status endpoint never claims that a purge completed." }) purgeCompleted!: boolean;
  @ApiProperty({ enum: ["not_implemented"], description: "No global deletion executor is currently implemented." }) deletionExecutor!: string;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
}
