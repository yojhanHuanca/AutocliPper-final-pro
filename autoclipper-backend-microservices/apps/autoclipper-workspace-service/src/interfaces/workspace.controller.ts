import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Req,
  Inject,
  HttpCode,
} from "@nestjs/common";
import type { Request } from "express";
import {
  ApiProperty,
  ApiBody,
  ApiTags,
  ApiExcludeEndpoint,
  ApiHeader,
  ApiOkResponse,
  ApiCreatedResponse,
} from "@nestjs/swagger";
import { uuid } from "@autoclipper/http-security";
import { WorkspaceService } from "../application/workspace.service.js";
import {
  WorkspaceListDto,
  MemberListDto,
  CreatedWorkspaceDto,
} from "@autoclipper/api-contracts";
class WorkspaceDto {
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ["personal", "team"], default: "personal" })
  kind!: string;
}
class RoleDto {
  @ApiProperty({ enum: ["admin", "editor", "reader"] }) role!: string;
}
class TransferDto {
  @ApiProperty({ format: "uuid" }) userId!: string;
}
class InvitationDto {
  @ApiProperty({ format: "email" }) email!: string;
  @ApiProperty({ enum: ["admin", "editor", "reader"] }) role!: string;
}
class AcceptInvitationDto {
  @ApiProperty() token!: string;
}
@ApiTags("workspaces")
@Controller()
export class WorkspaceController {
  @Post('internal/privacy-workspace-export')@HttpCode(200)@ApiExcludeEndpoint() privacyWorkspaceExport(@Req()req:Request,@Body()input:unknown){return this.service.privacyWorkspaceExport(req,input);}
  @Post("internal/admin-workspaces")@HttpCode(200)@ApiExcludeEndpoint() adminWorkspaces(@Req()req:Request,@Body()input:unknown){return this.service.adminWorkspaces(req,input);}
  constructor(@Inject(WorkspaceService) readonly service: WorkspaceService) {}
  @Post("workspaces/:id/invitations")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: InvitationDto })
  invite(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: InvitationDto,
  ) {
    return this.service.invite(req, uuid(id), input);
  }
  @Post("workspaces/invitations/accept")
  @HttpCode(200)
  @ApiBody({ type: AcceptInvitationDto })
  accept(@Req() req: Request, @Body() input: AcceptInvitationDto) {
    return this.service.acceptInvitation(req, input);
  }
  @Get("workspaces/:id/invitations")
  invitations(@Req() req: Request, @Param("id") id: string) {
    return this.service.invitations(req, uuid(id));
  }
  @Delete("workspaces/:id/invitations/:invitation")
  revokeInvitation(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("invitation") invitation: string,
  ) {
    return this.service.revokeInvitation(req, uuid(id), uuid(invitation));
  }
  @Get("health/live") live() {
    return { status: "ok" };
  }
  @Get("health/ready") async ready() {
    await this.service.pool.query("SELECT 1 FROM workspaces LIMIT 1");
    return { status: "ok" };
  }
  @Get("workspaces") @ApiOkResponse({ type: WorkspaceListDto }) list(
    @Req() req: Request,
  ) {
    return this.service.list(req);
  }
  @Post("workspaces")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: WorkspaceDto })
  @ApiCreatedResponse({ type: CreatedWorkspaceDto })
  create(@Req() req: Request, @Body() input: WorkspaceDto) {
    return this.service.create(req, input);
  }
  @Get("workspaces/:id/members")
  @ApiOkResponse({ type: MemberListDto })
  members(@Req() req: Request, @Param("id") id: string) {
    return this.service.members(req, uuid(id));
  }
  @Patch("workspaces/:id/members/:member") @ApiBody({ type: RoleDto }) role(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("member") member: string,
    @Body() input: RoleDto,
  ) {
    return this.service.setRole(req, uuid(id), uuid(member), input);
  }
  @Delete("workspaces/:id/members/:member") remove(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("member") member: string,
  ) {
    return this.service.remove(req, uuid(id), uuid(member));
  }
  @Post("workspaces/:id/ownership")
  @HttpCode(200)
  @ApiBody({ type: TransferDto })
  transfer(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: TransferDto,
  ) {
    return this.service.transfer(req, uuid(id), input);
  }
  @Post("internal/authorize") @HttpCode(200) @ApiExcludeEndpoint() internal(
    @Req() req: Request,
    @Body() input: unknown,
  ) {
    return this.service.internal(req, input);
  }
}
