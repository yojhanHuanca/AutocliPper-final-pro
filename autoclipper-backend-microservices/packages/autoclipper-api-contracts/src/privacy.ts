import { z } from 'zod';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const privacyProfileProof=z.object({password:z.string().min(1).max(128),factor:z.string().regex(/^(\d{6}|[a-f0-9]{24})$/u).optional()}).strict();
const preferences=z.object({locale:z.enum(['es','en']),timezone:z.string().min(1).max(100),emailNotifications:z.boolean(),theme:z.enum(['system','light','dark'])}).strict();
export const privacyIdentityProfile=z.object({
  schemaVersion:z.literal(1),
  user:z.object({id:z.uuid(),email:z.email().max(254),name:z.string().max(100),createdAt:z.iso.datetime(),verifiedAt:z.iso.datetime().nullable(),profileVersion:z.number().int().positive(),preferences,mfaEnabled:z.boolean()}).strict(),
  externalIdentities:z.array(z.object({provider:z.literal('google'),subject:z.string().min(1).max(255),providerEmail:z.email().max(254),linkedAt:z.iso.datetime()}).strict()).max(1),
}).strict();
export const privacyProfileExport=z.object({requestId:z.uuid(),receiptId:z.uuid(),scope:z.literal('identity-profile-v1'),state:z.literal('prepared'),fulfillment:z.literal('partial'),globalFulfillment:z.literal('pending'),createdAt:z.iso.datetime(),sha256:z.string().regex(/^[a-f0-9]{64}$/u),data:privacyIdentityProfile}).strict();
export class PrivacyProfileProofDto {
  @ApiProperty({maxLength:128}) password!:string;
  @ApiPropertyOptional({description:'Fresh TOTP or one-use recovery code when MFA is enabled.'}) factor?:string;
}
export class PrivacyProfilePreferencesDto {
  @ApiProperty({enum:['es','en']}) locale!:string;
  @ApiProperty({maxLength:100}) timezone!:string;
  @ApiProperty() emailNotifications!:boolean;
  @ApiProperty({enum:['system','light','dark']}) theme!:string;
}
export class PrivacyProfileUserDto {
  @ApiProperty({format:'uuid'}) id!:string;
  @ApiProperty({format:'email',maxLength:254}) email!:string;
  @ApiProperty({maxLength:100}) name!:string;
  @ApiProperty({format:'date-time'}) createdAt!:string;
  @ApiProperty({type:String,format:'date-time',nullable:true}) verifiedAt!:string|null;
  @ApiProperty({minimum:1}) profileVersion!:number;
  @ApiProperty({type:PrivacyProfilePreferencesDto}) preferences!:PrivacyProfilePreferencesDto;
  @ApiProperty() mfaEnabled!:boolean;
}
export class PrivacyExternalIdentityDto {
  @ApiProperty({enum:['google']}) provider!:string;
  @ApiProperty({maxLength:255}) subject!:string;
  @ApiProperty({format:'email',maxLength:254}) providerEmail!:string;
  @ApiProperty({format:'date-time'}) linkedAt!:string;
}
export class PrivacyIdentityProfileDto {
  @ApiProperty({enum:[1]}) schemaVersion!:number;
  @ApiProperty({type:PrivacyProfileUserDto}) user!:PrivacyProfileUserDto;
  @ApiProperty({type:[PrivacyExternalIdentityDto],maxItems:1}) externalIdentities!:PrivacyExternalIdentityDto[];
}
export class PrivacyProfileExportDto {
  @ApiProperty({format:'uuid'}) requestId!:string;
  @ApiProperty({format:'uuid'}) receiptId!:string;
  @ApiProperty({enum:['identity-profile-v1']}) scope!:string;
  @ApiProperty({enum:['prepared']}) state!:string;
  @ApiProperty({enum:['partial']}) fulfillment!:string;
  @ApiProperty({enum:['pending']}) globalFulfillment!:string;
  @ApiProperty({format:'date-time'}) createdAt!:string;
  @ApiProperty({pattern:'^[a-f0-9]{64}$'}) sha256!:string;
  @ApiProperty({type:PrivacyIdentityProfileDto}) data!:PrivacyIdentityProfileDto;
}

export const privacyWorkspaceOwnerRequest=z.object({capability:z.string().regex(/^[A-Za-z0-9_-]{43}$/u),idempotencyKey:z.uuid(),correlationId:z.uuid()}).strict();
export const privacyWorkspaceAuthorityRequest=privacyWorkspaceOwnerRequest.extend({scope:z.literal('workspace-memberships-v1')}).strict();
export const privacyWorkspaceAuthority=z.object({userId:z.uuid(),requestId:z.uuid(),scope:z.literal('workspace-memberships-v1')}).strict();
export const privacyWorkspaceMembership=z.object({workspaceId:z.uuid(),kind:z.enum(['personal','team']),role:z.enum(['owner','admin','editor','reader']),isOwner:z.boolean(),workspaceCreatedAt:z.iso.datetime(),joinedAt:z.iso.datetime()}).strict().refine(value=>value.isOwner===(value.role==='owner'));
export const privacyWorkspaceData=z.object({schemaVersion:z.literal(1),subjectId:z.uuid(),memberships:z.array(privacyWorkspaceMembership).max(500)}).strict();
export const privacyWorkspaceExport=z.object({requestId:z.uuid(),receiptId:z.uuid(),scope:z.literal('workspace-memberships-v1'),state:z.literal('prepared'),fulfillment:z.literal('partial'),globalFulfillment:z.literal('pending'),createdAt:z.iso.datetime(),capturedAt:z.iso.datetime(),sha256:z.string().regex(/^[a-f0-9]{64}$/u),data:privacyWorkspaceData}).strict();
export const privacyWorkspaceResult=z.union([privacyWorkspaceExport,z.object({state:z.literal('snapshot_changed'),requestId:z.uuid()}).strict(),z.object({state:z.literal('limit_exceeded'),requestId:z.uuid()}).strict()]);
export class PrivacyWorkspaceMembershipDto {
  @ApiProperty({format:'uuid'}) workspaceId!:string;
  @ApiProperty({enum:['personal','team']}) kind!:string;
  @ApiProperty({enum:['owner','admin','editor','reader']}) role!:string;
  @ApiProperty() isOwner!:boolean;
  @ApiProperty({format:'date-time'}) workspaceCreatedAt!:string;
  @ApiProperty({format:'date-time'}) joinedAt!:string;
}
export class PrivacyWorkspaceDataDto {
  @ApiProperty({enum:[1]}) schemaVersion!:number;
  @ApiProperty({format:'uuid'}) subjectId!:string;
  @ApiProperty({type:[PrivacyWorkspaceMembershipDto],maxItems:500}) memberships!:PrivacyWorkspaceMembershipDto[];
}
export class PrivacyWorkspaceExportDto {
  @ApiProperty({format:'uuid'}) requestId!:string;
  @ApiProperty({format:'uuid'}) receiptId!:string;
  @ApiProperty({enum:['workspace-memberships-v1']}) scope!:string;
  @ApiProperty({enum:['prepared']}) state!:string;
  @ApiProperty({enum:['partial']}) fulfillment!:string;
  @ApiProperty({enum:['pending']}) globalFulfillment!:string;
  @ApiProperty({format:'date-time'}) createdAt!:string;
  @ApiProperty({format:'date-time'}) capturedAt!:string;
  @ApiProperty({pattern:'^[a-f0-9]{64}$'}) sha256!:string;
  @ApiProperty({type:PrivacyWorkspaceDataDto}) data!:PrivacyWorkspaceDataDto;
}

const privacyProjectTimestamp=z.iso.datetime();
const privacyProjectId=z.uuid();
const privacyProjectError=z.string().regex(/^[A-Z0-9_]{1,100}$/u).nullable();
export const privacyProjectData=z.object({
  schemaVersion:z.literal(1),subjectId:z.uuid(),
  projects:z.array(z.object({id:privacyProjectId,version:z.number().int().positive(),createdAt:privacyProjectTimestamp,deleted:z.boolean()}).strict()).max(500),
  uploads:z.array(z.object({id:privacyProjectId,projectId:privacyProjectId,bytes:z.number().int().positive(),contentType:z.enum(['video/mp4','video/webm','video/quicktime','video/x-matroska']),state:z.enum(['pending','confirmed','aborted']),createdAt:privacyProjectTimestamp,cleaned:z.boolean()}).strict()).max(500),
  processing:z.array(z.object({id:privacyProjectId,uploadId:privacyProjectId,projectId:privacyProjectId,status:z.enum(['queued','running','succeeded','failed','cancelled']),createdAt:privacyProjectTimestamp,finishedAt:privacyProjectTimestamp.nullable(),errorCode:privacyProjectError}).strict()).max(500),
  analyses:z.array(z.object({id:privacyProjectId,uploadId:privacyProjectId,projectId:privacyProjectId,finishedAt:privacyProjectTimestamp.nullable(),createdAt:privacyProjectTimestamp}).strict()).max(500),
  pipelines:z.array(z.object({id:privacyProjectId,uploadId:privacyProjectId,projectId:privacyProjectId,status:z.enum(['queued','audio','analysis','render','stopping','succeeded','failed','cancelled']),createdAt:privacyProjectTimestamp,finishedAt:privacyProjectTimestamp.nullable(),errorCode:privacyProjectError}).strict()).max(500),
  revisions:z.array(z.object({id:privacyProjectId,draftId:privacyProjectId,version:z.number().int().positive(),action:z.enum(['created','updated','restored']),createdAt:privacyProjectTimestamp,restoredFromVersion:z.number().int().positive().nullable()}).strict()).max(500),
}).strict().superRefine((data,ctx)=>{
  const total=data.projects.length+data.uploads.length+data.processing.length+data.analyses.length+data.pipelines.length+data.revisions.length;
  if(total>500)ctx.addIssue({code:'custom',message:'Project privacy export exceeds 500 referenced rows'});
});
export const privacyProjectExport=z.object({requestId:z.uuid(),receiptId:z.uuid(),scope:z.literal('project-attribution-v1'),state:z.literal('prepared'),fulfillment:z.literal('partial'),globalFulfillment:z.literal('pending'),createdAt:z.iso.datetime(),capturedAt:z.iso.datetime(),sha256:z.string().regex(/^[a-f0-9]{64}$/u),data:privacyProjectData}).strict();
export const privacyProjectResult=z.union([privacyProjectExport,z.object({state:z.literal('snapshot_changed'),requestId:z.uuid()}).strict(),z.object({state:z.literal('limit_exceeded'),requestId:z.uuid()}).strict()]);
export const privacyProjectOwnerRequest=z.object({capability:z.string().regex(/^[A-Za-z0-9_-]{43}$/u),idempotencyKey:z.uuid(),correlationId:z.uuid()}).strict();
export const privacyProjectAuthorityRequest=privacyProjectOwnerRequest.extend({scope:z.literal('project-attribution-v1')}).strict();
export const privacyProjectAuthority=z.object({userId:z.uuid(),requestId:z.uuid(),scope:z.literal('project-attribution-v1')}).strict();
export class PrivacyProjectReferenceDto {
  @ApiProperty({format:'uuid'}) id!:string;
  @ApiPropertyOptional({format:'uuid'}) projectId?:string;
  @ApiPropertyOptional({format:'uuid'}) uploadId?:string;
  @ApiPropertyOptional({format:'uuid'}) draftId?:string;
  @ApiPropertyOptional({minimum:1}) version?:number;
  @ApiPropertyOptional() status?:string;
  @ApiPropertyOptional({format:'date-time'}) createdAt?:string;
  @ApiPropertyOptional({type:String,format:'date-time',nullable:true}) finishedAt?:string|null;
  @ApiPropertyOptional({type:String,nullable:true}) errorCode?:string|null;
  @ApiPropertyOptional() deleted?:boolean;
  @ApiPropertyOptional() cleaned?:boolean;
  @ApiPropertyOptional({minimum:1}) bytes?:number;
  @ApiPropertyOptional() contentType?:string;
  @ApiPropertyOptional({enum:['created','updated','restored']}) action?:string;
  @ApiPropertyOptional({type:Number,nullable:true}) restoredFromVersion?:number|null;
}
export class PrivacyProjectDataDto {
  @ApiProperty({enum:[1]}) schemaVersion!:number;
  @ApiProperty({format:'uuid'}) subjectId!:string;
  @ApiProperty({type:[PrivacyProjectReferenceDto],maxItems:500}) projects!:PrivacyProjectReferenceDto[];
  @ApiProperty({type:[PrivacyProjectReferenceDto],maxItems:500}) uploads!:PrivacyProjectReferenceDto[];
  @ApiProperty({type:[PrivacyProjectReferenceDto],maxItems:500}) processing!:PrivacyProjectReferenceDto[];
  @ApiProperty({type:[PrivacyProjectReferenceDto],maxItems:500}) analyses!:PrivacyProjectReferenceDto[];
  @ApiProperty({type:[PrivacyProjectReferenceDto],maxItems:500}) pipelines!:PrivacyProjectReferenceDto[];
  @ApiProperty({type:[PrivacyProjectReferenceDto],maxItems:500}) revisions!:PrivacyProjectReferenceDto[];
}
export class PrivacyProjectExportDto {
  @ApiProperty({format:'uuid'}) requestId!:string;
  @ApiProperty({format:'uuid'}) receiptId!:string;
  @ApiProperty({enum:['project-attribution-v1']}) scope!:string;
  @ApiProperty({enum:['prepared']}) state!:string;
  @ApiProperty({enum:['partial']}) fulfillment!:string;
  @ApiProperty({enum:['pending']}) globalFulfillment!:string;
  @ApiProperty({format:'date-time'}) createdAt!:string;
  @ApiProperty({format:'date-time'}) capturedAt!:string;
  @ApiProperty({pattern:'^[a-f0-9]{64}$'}) sha256!:string;
  @ApiProperty({type:PrivacyProjectDataDto}) data!:PrivacyProjectDataDto;
}
