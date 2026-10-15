import {ApiProperty,ApiPropertyOptional,OmitType} from "@nestjs/swagger";
import {ClipProcessingSpecDto,SplitScreenDto,SubtitleCueDto,SubtitleStyleDto} from "./processing.js";
export class ReviewVersionDto {
  @ApiProperty({minimum:1,description:"Current editor revision; an obsolete revision returns 412."}) version!:number;
  @ApiProperty({minimum:1,description:"Current review state version, independent of content revision."}) reviewVersion!:number;
}
export class ApprovalDto {
  @ApiProperty({format:"uuid"}) id!:string;
  @ApiProperty({minimum:1}) revisionVersion!:number;
  @ApiProperty({minimum:1}) reviewVersion!:number;
  @ApiProperty({format:"uuid"}) approverId!:string;
  @ApiProperty({format:"date-time"}) createdAt!:string;
}
export class ReviewStateDto extends ReviewVersionDto {
  @ApiProperty({enum:["draft","review","approved"]}) status!:string;
  @ApiProperty({type:Number,nullable:true}) approvedRevisionVersion!:number|null;
}
export class ReviewHistoryDto extends ReviewStateDto {@ApiProperty({type:[ApprovalDto],maxItems:50}) approvals!:ApprovalDto[];}
export class CreateCommentDto {
  @ApiProperty({minimum:1}) revisionVersion!:number;
  @ApiProperty({minimum:0,maximum:120,description:"Seconds relative to the selected clip, bounded by its actual duration."}) timeSeconds!:number;
  @ApiProperty({minLength:1,maxLength:2000}) text!:string;
}
export class EditorCommentDto {
  @ApiProperty({format:"uuid"}) id!:string;
  @ApiProperty({minimum:1}) revisionVersion!:number;
  @ApiProperty({format:"uuid"}) authorId!:string;
  @ApiProperty({minimum:0,maximum:120}) timeSeconds!:number;
  @ApiProperty({type:String,nullable:true,maxLength:2000}) text!:string|null;
  @ApiProperty({minimum:1}) version!:number;
  @ApiProperty({format:"date-time"}) createdAt!:string;
  @ApiProperty({type:String,format:"date-time",nullable:true}) deletedAt!:string|null;
}
export class PublicReviewCommentDto extends OmitType(EditorCommentDto,["authorId"] as const){}
export class EditorCommentPageDto {
  @ApiProperty({type:[EditorCommentDto],maxItems:50}) items!:EditorCommentDto[];
  @ApiProperty({type:String,format:"uuid",nullable:true}) nextBeforeId!:string|null;
}
export class PublicReviewCommentPageDto extends OmitType(EditorCommentPageDto,["items"] as const){@ApiProperty({type:[PublicReviewCommentDto],maxItems:50}) items!:PublicReviewCommentDto[];}
export class DeleteCommentDto {@ApiProperty({minimum:1}) version!:number;}
export class CreateReviewLinkDto {
  @ApiProperty({minimum:1}) revisionVersion!:number;
  @ApiPropertyOptional({format:"uuid",description:"Opt-in to only this revision's completed video export. Omit for text-only review."}) processingId?:string;
  @ApiPropertyOptional({minimum:60,maximum:604800,default:86400}) expiresInSeconds?:number;
}
export class ReviewLinkDto {
  @ApiProperty({format:"uuid"}) id!:string;
  @ApiProperty({minimum:1}) revisionVersion!:number;
  @ApiProperty({type:String,format:"uuid",nullable:true}) processingId!:string|null;
  @ApiProperty({format:"date-time"}) createdAt!:string;
  @ApiProperty({format:"date-time"}) expiresAt!:string;
  @ApiProperty({type:String,format:"date-time",nullable:true}) revokedAt!:string|null;
}
export class CreatedReviewLinkDto extends ReviewLinkDto {
  @ApiProperty({description:"Random bearer token returned only on creation. Only its SHA-256 is persisted."}) token!:string;
  @ApiProperty({description:"Relative API path for this limited read-only review grant."}) path!:string;
}
export class ReviewLinkPageDto {@ApiProperty({type:[ReviewLinkDto],maxItems:50}) items!:ReviewLinkDto[];}
export class PublicReviewCaptionsDto {
  @ApiProperty({type:[SubtitleCueDto],maxItems:200}) cues!:SubtitleCueDto[];
  @ApiPropertyOptional({type:SubtitleStyleDto}) style?:SubtitleStyleDto;
}
export class PublicSplitScreenDto extends OmitType(SplitScreenDto,["secondaryUploadId"] as const){}
export class PublicReviewSpecDto extends OmitType(ClipProcessingSpecDto,["subtitles"] as const){@ApiPropertyOptional({type:PublicReviewCaptionsDto}) subtitles?:PublicReviewCaptionsDto;@ApiPropertyOptional({type:PublicSplitScreenDto}) splitScreen?:PublicSplitScreenDto;}
export class PublicReviewDto {
  @ApiProperty() name!:string;
  @ApiProperty({minimum:1}) revisionVersion!:number;
  @ApiProperty({enum:["draft","review","approved","superseded"]}) status!:string;
  @ApiProperty({type:PublicReviewSpecDto}) spec!:PublicReviewSpecDto;
  @ApiProperty() videoEnabled!:boolean;
  @ApiProperty({format:"date-time"}) expiresAt!:string;
  @ApiProperty({type:PublicReviewCommentPageDto}) comments!:PublicReviewCommentPageDto;
}
export class EditorAuditDto {
  @ApiProperty({format:"uuid"}) id!:string;
  @ApiProperty({format:"uuid"}) actorId!:string;
  @ApiProperty({enum:["revision.created","revision.updated","revision.restored","comment.created","comment.deleted","review.requested","review.returned","review.approved","link.created","link.revoked"]}) action!:string;
  @ApiProperty({type:"object",additionalProperties:true,description:"Server-generated identifiers/versions only; no comment text, emails, tokens or credentials."}) details!:Record<string,unknown>;
  @ApiProperty({format:"uuid"}) correlationId!:string;
  @ApiProperty({format:"date-time"}) createdAt!:string;
}
export class EditorAuditPageDto {
  @ApiProperty({type:[EditorAuditDto],maxItems:50}) items!:EditorAuditDto[];
  @ApiProperty({type:String,format:"uuid",nullable:true}) nextBeforeId!:string|null;
}
