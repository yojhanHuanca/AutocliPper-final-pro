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
