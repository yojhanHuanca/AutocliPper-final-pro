import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Req,
  Res,
  Inject,
  HttpCode,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import {
  ApiProperty,
  ApiPropertyOptional,
  ApiBody,
  ApiTags,
  ApiHeader,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  getSchemaPath,
  ApiQuery,
  ApiExcludeEndpoint,
} from "@nestjs/swagger";
import {
  CreatedProjectDto,
  ProjectResponseDto,
  ProjectListDto,
  PutUploadIntentDto,
  MultipartUploadIntentDto,
  SignedPartDto,
  UploadStatusDto,
  ConfirmedUploadDto,
  SourceLinkResolutionDto,
  YoutubeVideoMetadataDto,
  SourceLinkCapabilitiesDto,
MAX_UPLOAD_BYTES } from "@autoclipper/api-contracts";
import { uuid } from "@autoclipper/http-security";
import { ProjectService } from "../application/project.service.js";
class ProjectDto {
  @ApiProperty({ format: "uuid" }) workspaceId!: string;
  @ApiProperty({ maxLength: 150 }) name!: string;
}
class UpdateProjectDto {
  @ApiProperty({ maxLength: 150 }) name!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
}
class UploadDto {
  @ApiProperty({ minimum: 1, maximum: MAX_UPLOAD_BYTES }) bytes!: number;
  @ApiProperty({ pattern: "^[a-f0-9]{64}$" }) sha256!: string;
  @ApiProperty({
    enum: ["video/mp4", "video/webm", "video/quicktime", "video/x-matroska"],
  })
  contentType!: string;
  @ApiProperty({ enum: ["put", "multipart"], default: "put" }) mode!: string;
}
class PartDto {
  @ApiProperty({ minimum: 1 }) partNumber!: number;
  @ApiProperty({ pattern: "^[a-f0-9]{64}$" }) sha256!: string;
}
class SourceLinkDto {
  @ApiProperty({maxLength:2048,format:"uri",description:"Twitch clip or VOD, YouTube, or Kick URL. Twitch VOD import requires an explicit interval and broadcaster/editor OAuth permission."}) url!:string;
  @ApiPropertyOptional({minimum:5,maximum:Number.MAX_SAFE_INTEGER,description:"Required for Twitch VOD imports: zero-based second in the VOD where the excerpt ends. The selected VOD duration is the effective upper bound."}) vodOffsetSeconds?:number;
  @ApiPropertyOptional({minimum:5,maximum:60,description:"Required for Twitch VOD imports: clip duration in seconds."}) durationSeconds?:number;
  @ApiPropertyOptional({minLength:1,maxLength:140,description:"Optional title for the Twitch clip created from a VOD."}) title?:string;
}
@ApiTags("projects")
@ApiExtraModels(PutUploadIntentDto, MultipartUploadIntentDto, SourceLinkResolutionDto, YoutubeVideoMetadataDto, SourceLinkCapabilitiesDto)
@Controller()
export class ProjectController {
  @Post("internal/admin-jobs")@HttpCode(200)@ApiExcludeEndpoint() adminJobs(@Req()req:Request,@Body()input:unknown){return this.service.adminJobs(req,input);}
  @Post("internal/privacy-project-export")@HttpCode(200)@ApiExcludeEndpoint() privacyProjectExport(@Req()req:Request,@Body()input:unknown){return this.service.privacyProjectExport(req,input);}
  constructor(@Inject(ProjectService) readonly service: ProjectService) {}
  @Get('projects/storage')@ApiOkResponse({schema:{type:'object',required:['workspaceId','usedBytes','reservedBytes','limitBytes'],properties:{workspaceId:{type:'string',format:'uuid'},usedBytes:{type:'integer'},reservedBytes:{type:'integer'},limitBytes:{type:'integer'}}}})
  storage(@Req()req:Request,@Query('workspaceId')workspaceId:string){return this.service.storage(req,uuid(workspaceId));}
  @Get("health/live") live() {
    return { status: "ok" };
  }
  @Get("health/ready") async ready() {
    await this.service.pool.query("SELECT 1 FROM projects LIMIT 1");
    return { status: "ok" };
  }
  @Post("projects")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: ProjectDto })
  @ApiCreatedResponse({ type: CreatedProjectDto })
  create(@Req() req: Request, @Body() input: ProjectDto) {
    return this.service.create(req, input);
  }
  @Get("projects")
  @ApiOkResponse({ type: ProjectListDto })
  @ApiQuery({
    name: "limit",
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
  })
  @ApiQuery({ name: "search", required: false, type: String, maxLength: 150 })
  list(
    @Req() req: Request,
    @Query("workspaceId") workspaceId: string,
    @Query("limit") limit: string | undefined,
    @Query("search") search: string | undefined,
  ) {
    return this.service.list(req, uuid(workspaceId), limit, search);
  }
  @Get("projects/:id") @ApiOkResponse({ type: ProjectResponseDto }) get(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    return this.service.get(req, uuid(id));
  }
  @Patch("projects/:id") @ApiBody({ type: UpdateProjectDto }) update(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: UpdateProjectDto,
  ) {
    return this.service.update(req, uuid(id), input);
  }
  @Delete("projects/:id") trash(@Req() req: Request, @Param("id") id: string) {
    return this.service.trash(req, uuid(id));
  }
  @Post("projects/:id/source-links/resolve") @HttpCode(200) @ApiBody({type:SourceLinkDto}) @ApiOkResponse({type:SourceLinkResolutionDto})
  resolveSourceLink(@Req()req:Request,@Param("id")id:string,@Body()input:SourceLinkDto){return this.service.resolveSourceLink(req,uuid(id),input);}
  @Get("projects/:id/source-links/capabilities") @ApiOkResponse({type:SourceLinkCapabilitiesDto,description:"Provider preview/import/processing capabilities for this project and user; never includes provider credentials."})
  sourceLinkCapabilities(@Req()req:Request,@Param("id")id:string){return this.service.sourceLinkCapabilities(req,uuid(id));}
  @Post("projects/:id/source-links/import") @HttpCode(200) @ApiHeader({name:"Idempotency-Key",required:true}) @ApiBody({type:SourceLinkDto})
  importSourceLink(@Req()req:Request,@Param("id")id:string,@Body()input:SourceLinkDto){return this.service.importSourceLink(req,uuid(id),input,String(req.res?.locals["correlationId"]??randomUUID()));}
  @Post("projects/:id/uploads")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: UploadDto })
  @ApiCreatedResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(PutUploadIntentDto) },
        { $ref: getSchemaPath(MultipartUploadIntentDto) },
      ],
    },
  })
  upload(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: UploadDto,
  ) {
    return this.service.beginUpload(req, uuid(id), input);
  }
  @Post("uploads/:id/parts")
  @HttpCode(200)
  @ApiBody({ type: PartDto })
  @ApiOkResponse({ type: SignedPartDto })
  part(@Req() req: Request, @Param("id") id: string, @Body() input: PartDto) {
    return this.service.part(req, uuid(id), input);
  }
  @Get("uploads/:id/parts") parts(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    return this.service.parts(req, uuid(id));
  }
  @Post("uploads/:id/confirm")
  @HttpCode(200)
  @ApiOkResponse({ type: ConfirmedUploadDto })
  confirm(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id") id: string,
  ) {
    return this.service.confirm(
      req,
      uuid(id),
      String(res.locals["correlationId"]),
    );
  }
  @Get("uploads/:id") @ApiOkResponse({ type: UploadStatusDto }) status(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    return this.service.status(req, uuid(id));
  }
  @Delete("uploads/:id") abort(@Req() req: Request, @Param("id") id: string) {
    return this.service.abort(req, uuid(id));
  }
}
