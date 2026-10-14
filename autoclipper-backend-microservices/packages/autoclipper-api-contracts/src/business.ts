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
