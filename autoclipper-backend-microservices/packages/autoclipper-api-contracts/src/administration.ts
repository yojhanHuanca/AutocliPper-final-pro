import {z} from "zod";
import {ApiProperty,ApiPropertyOptional} from "@nestjs/swagger";

export const adminPermission=z.enum(["users.read","workspaces.read","jobs.read","consumption.read"]);
export type AdminPermission=z.infer<typeof adminPermission>;
export const adminPage=z.object({beforeId:z.uuid().optional(),workspaceId:z.uuid().optional(),limit:z.coerce.number().int().min(1).max(50).default(25)}).strict();
export const adminSessionToken=z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
export const adminOwnerRequest=z.object({token:adminSessionToken,query:adminPage,correlationId:z.uuid()}).strict();
export const adminAuthority=z.object({actorId:z.uuid(),grantRevision:z.number().int().positive(),workspaceIds:z.array(z.uuid()).min(1).max(50).nullable()}).strict();
export const adminReauth=z.object({password:z.string().min(1).max(128),factor:z.string().regex(/^(\d{6}|[a-f0-9]{24})$/u)}).strict();
export const adminScope=z.array(z.uuid()).min(1).max(50).nullable();
export const adminGrant=z.object({userId:z.uuid(),permissions:z.array(adminPermission).min(1).max(4),workspaceIds:adminScope,operatorReference:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u)}).strict().refine(value=>value.workspaceIds===null||!value.permissions.includes("users.read"),"User enumeration requires an explicit global grant");
const date=z.iso.datetime();
const user=z.object({id:z.uuid(),verified:z.boolean(),mfaEnabled:z.boolean(),createdAt:date}).strict();
const workspace=z.object({id:z.uuid(),kind:z.enum(["personal","team"]),memberCount:z.number().int().nonnegative(),createdAt:date}).strict();
const job=z.object({id:z.uuid(),workspaceId:z.uuid(),kind:z.enum(["audio","render","analysis","pipeline"]),status:z.enum(["queued","running","transcribing","selecting","audio","analysis","render","stopping","succeeded","failed","cancelled"]),createdAt:date,finishedAt:date.nullable(),errorCode:z.string().regex(/^[A-Z_]{1,100}$/u).nullable()}).strict();
const consumption=z.object({id:z.uuid(),unit:z.literal("material_seconds_per_stage"),planKind:z.literal("development"),planVersion:z.string().regex(/^[a-f0-9]{64}$/u),periodStart:date,periodEnd:date,budgetSeconds:z.number().int().nonnegative(),consumedSeconds:z.number().int().nonnegative(),reservedSeconds:z.number().int().nonnegative()}).strict();
const page=<T extends z.ZodType>(item:T)=>z.object({items:z.array(item).max(50),nextBeforeId:z.uuid().nullable()}).strict();
export const adminUsersPage=page(user),adminWorkspacesPage=page(workspace),adminJobsPage=page(job),adminConsumptionPage=page(consumption);
export class AdminQueryDto {
  @ApiPropertyOptional({format:"uuid",description:"Exclusive UUID keyset cursor, in descending ID order."}) beforeId?:string;
  @ApiPropertyOptional({format:"uuid",description:"Optional exact workspace filter; the server enforces the operator grant scope."}) workspaceId?:string;
  @ApiPropertyOptional({type:"integer",minimum:1,maximum:50,default:25}) limit?:number;
}
export class AdminUserDto {
  @ApiProperty({format:"uuid"}) id!:string;
  @ApiProperty() verified!:boolean;
  @ApiProperty() mfaEnabled!:boolean;
  @ApiProperty({format:"date-time"}) createdAt!:string;
}
export class AdminWorkspaceDto {
  @ApiProperty({format:"uuid"}) id!:string;
  @ApiProperty({enum:["personal","team"]}) kind!:string;
  @ApiProperty({minimum:0}) memberCount!:number;
  @ApiProperty({format:"date-time"}) createdAt!:string;
}
export class AdminJobDto {
  @ApiProperty({format:"uuid"}) id!:string;
  @ApiProperty({format:"uuid"}) workspaceId!:string;
  @ApiProperty({enum:["audio","render","analysis","pipeline"]}) kind!:string;
  @ApiProperty({enum:["queued","running","transcribing","selecting","audio","analysis","render","stopping","succeeded","failed","cancelled"]}) status!:string;
  @ApiProperty({format:"date-time"}) createdAt!:string;
  @ApiProperty({type:String,format:"date-time",nullable:true}) finishedAt!:string|null;
  @ApiProperty({type:String,nullable:true,description:"Classified code only; no provider response, source, transcript or payload."}) errorCode!:string|null;
}
export class AdminConsumptionDto {
  @ApiProperty({format:"uuid",description:"Workspace ID."}) id!:string;
  @ApiProperty({enum:["material_seconds_per_stage"]}) unit!:string;
  @ApiProperty({enum:["development"]}) planKind!:string;
  @ApiProperty() planVersion!:string;
  @ApiProperty({format:"date-time"}) periodStart!:string;
  @ApiProperty({format:"date-time"}) periodEnd!:string;
  @ApiProperty({minimum:0}) budgetSeconds!:number;
  @ApiProperty({minimum:0}) consumedSeconds!:number;
  @ApiProperty({minimum:0}) reservedSeconds!:number;
}
export class AdminUsersPageDto {@ApiProperty({type:[AdminUserDto],maxItems:50}) items!:AdminUserDto[];@ApiProperty({type:String,format:"uuid",nullable:true}) nextBeforeId!:string|null;}
export class AdminWorkspacesPageDto {@ApiProperty({type:[AdminWorkspaceDto],maxItems:50}) items!:AdminWorkspaceDto[];@ApiProperty({type:String,format:"uuid",nullable:true}) nextBeforeId!:string|null;}
export class AdminJobsPageDto {@ApiProperty({type:[AdminJobDto],maxItems:50}) items!:AdminJobDto[];@ApiProperty({type:String,format:"uuid",nullable:true}) nextBeforeId!:string|null;}
export class AdminConsumptionPageDto {@ApiProperty({type:[AdminConsumptionDto],maxItems:50}) items!:AdminConsumptionDto[];@ApiProperty({type:String,format:"uuid",nullable:true}) nextBeforeId!:string|null;}
export class AdminAccessDto {
  @ApiProperty() granted!:boolean;
  @ApiProperty() mfaEnabled!:boolean;
  @ApiProperty({type:[String],enum:adminPermission.options}) permissions!:string[];
  @ApiProperty({type:[String],nullable:true,description:"Null means explicitly global. An empty array with granted=false grants nothing."}) workspaceIds!:string[]|null;
  @ApiProperty({type:String,format:"date-time",nullable:true}) elevatedUntil!:string|null;
}
export class AdminReauthDto {@ApiProperty() password!:string;@ApiProperty({description:"Fresh TOTP or one-use recovery code; MFA must be enabled."}) factor!:string;}
export class AdminElevatedDto {@ApiProperty({format:"date-time"}) elevatedUntil!:string;}
