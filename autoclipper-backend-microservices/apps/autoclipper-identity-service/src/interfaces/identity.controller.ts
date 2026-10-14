import {
  Body,
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Req,
  Res,
  Inject,
  HttpCode,
} from "@nestjs/common";
import type { Request, Response } from "express";
import {
  ApiProperty,
  ApiBody,
  ApiTags,
  ApiExcludeEndpoint,
  ApiOkResponse,
} from "@nestjs/swagger";
import { issueCsrf, uuid } from "@autoclipper/http-security";
import { IdentityService } from "../application/identity.service.js";
import { PublicUserDto, LoginResponseDto } from "@autoclipper/api-contracts";
class RegistrationDto {
  @ApiProperty({ format: "email" }) email!: string;
  @ApiProperty({ minLength: 12, maxLength: 128 }) password!: string;
  @ApiProperty({ maxLength: 100 }) name!: string;
}
class LoginDto {
  @ApiProperty({ format: "email" }) email!: string;
  @ApiProperty() password!: string;
}
class TokenDto {
  @ApiProperty() token!: string;
}
class ResetRequestDto {
  @ApiProperty({ format: "email" }) email!: string;
}
class ResetDto extends TokenDto {
  @ApiProperty({ minLength: 12, maxLength: 128 }) password!: string;
}
@ApiTags("identity")
@Controller()
export class IdentityController {
  constructor(@Inject(IdentityService) readonly service: IdentityService) {}
  @Get("health/live") live() {
    return { status: "ok" };
  }
  @Get("health/ready") async ready() {
    await this.service.pool.query("SELECT 1 FROM users LIMIT 1");
    await this.service.redis.ping();
    return { status: "ok" };
  }
  @Get("auth/csrf") csrf(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return issueCsrf(req, res, this.service.config);
  }
  @Post("auth/register")
  @HttpCode(202)
  @ApiBody({ type: RegistrationDto })
  register(@Req() req: Request, @Body() input: RegistrationDto) {
    return this.service.register(req, input);
  }
  @Post("auth/verify") @HttpCode(200) @ApiBody({ type: TokenDto }) verify(
    @Req() req: Request,
    @Body() input: TokenDto,
  ) {
    return this.service.verify(req, input);
  }
  @Post("auth/login")
  @HttpCode(200)
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({ type: LoginResponseDto })
  login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() input: LoginDto,
  ) {
    return this.service.signIn(req, res, input);
  }
  @Post("auth/refresh") @HttpCode(200) refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.service.refresh(req, res);
  }
  @Post("auth/logout") @HttpCode(200) logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.service.logout(req, res);
  }
  @Get("auth/me") @ApiOkResponse({ type: PublicUserDto }) me(
    @Req() req: Request,
  ) {
    return this.service.me(req);
  }
  @Get("auth/sessions") sessions(@Req() req: Request) {
    return this.service.sessions(req);
  }
  @Delete("auth/sessions/:id") revoke(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    return this.service.revoke(req, uuid(id));
  }
  @Post("auth/password/forgot")
  @HttpCode(202)
  @ApiBody({ type: ResetRequestDto })
  forgot(@Req() req: Request, @Body() input: ResetRequestDto) {
    return this.service.requestReset(req, input);
  }
  @Post("auth/password/reset")
  @HttpCode(200)
  @ApiBody({ type: ResetDto })
  reset(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() input: ResetDto,
  ) {
    return this.service.resetPassword(req, res, input);
  }
  @Post("internal/authenticate") @HttpCode(200) @ApiExcludeEndpoint() internal(
    @Req() req: Request,
    @Body() input: unknown,
  ) {
    return this.service.internal(req, input);
  }
  @Post("internal/send-invitation")
  @HttpCode(200)
  @ApiExcludeEndpoint()
  invitation(@Req() req: Request, @Body() input: unknown) {
    return this.service.sendInvitation(req, input);
  }
}
