import {
  Body,
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Req,
  Res,
  Inject,
  HttpCode,
} from "@nestjs/common";
import type { Request, Response } from "express";
import {
  ApiProperty,
  ApiPropertyOptional,
  ApiBody,
  ApiTags,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiAcceptedResponse,
} from "@nestjs/swagger";
import { issueCsrf, uuid } from "@autoclipper/http-security";
import { IdentityService } from "../application/identity.service.js";
import {
  PublicUserDto,
  LoginResponseDto,
  MfaStatusResponseDto,
  MfaSetupResponseDto,
  MfaEnabledResponseDto,
  RecoveryCodesResponseDto,
  ProfileResponseDto,
  PrivacyRequestResponseDto,
  flagResponse,
  CsrfResponseDto,
  SessionListResponseDto,
  SecurityEventListResponseDto,
  PrivacyListResponseDto,
} from "@autoclipper/api-contracts";
class RegistrationDto {
  @ApiProperty({ format: "email" }) email!: string;
  @ApiProperty({ minLength: 12, maxLength: 128 }) password!: string;
  @ApiProperty({ maxLength: 100 }) name!: string;
}
class LoginDto {
  @ApiProperty({ format: "email" }) email!: string;
  @ApiProperty() password!: string;
  @ApiPropertyOptional({
    description:
      "TOTP (6 digits) or one-use recovery code when 2FA is enabled.",
  })
  factor?: string;
}
class GoogleChallengeDto {
  @ApiProperty({enum:["sign_in","link"]}) purpose!: string;
}
class GoogleCredentialDto {
  @ApiProperty({minLength:20,maxLength:12000}) credential!: string;
  @ApiPropertyOptional({description:"TOTP or one-use recovery code if enabled."}) factor?: string;
}
class LinkGoogleDto extends GoogleCredentialDto {
  @ApiProperty() password!: string;
}
class PasswordProofDto {
  @ApiProperty() password!: string;
}
class EnableMfaDto extends PasswordProofDto {
  @ApiProperty({ pattern: "^\\d{6}$" }) code!: string;
}
class FactorProofDto extends PasswordProofDto {
  @ApiPropertyOptional({ description: "TOTP or one-use recovery code." })
  factor?: string;
}
class RequiredFactorProofDto extends PasswordProofDto {
  @ApiProperty() factor!: string;
}
class PrivacyRequestDto extends FactorProofDto {
  @ApiProperty({ enum: ["export", "deletion"] }) kind!: string;
}
class PreferencesDto {
  @ApiPropertyOptional({ enum: ["es", "en"] }) locale?: string;
  @ApiPropertyOptional({ example: "America/Lima" }) timezone?: string;
  @ApiPropertyOptional() emailNotifications?: boolean;
  @ApiPropertyOptional({ enum: ["light", "dark", "system"] }) theme?: string;
}
class UpdateProfileDto {
  @ApiPropertyOptional() name?: string;
  @ApiPropertyOptional({ type: PreferencesDto }) preferences?: PreferencesDto;
  @ApiProperty({ minimum: 1 }) version!: number;
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
  @Get("auth/providers")
  @ApiOkResponse({schema:{type:"object",required:["google"],properties:{google:{type:"object",required:["configured"],properties:{configured:{type:"boolean"}}}}}})
  providers() { return this.service.providers(); }
  @Post("auth/google/challenge")
  @HttpCode(200)
  @ApiBody({type:GoogleChallengeDto})
  @ApiOkResponse({schema:{type:"object",required:["clientId","nonce","expiresInSeconds"],properties:{clientId:{type:"string"},nonce:{type:"string"},expiresInSeconds:{type:"integer",example:300}}}})
  googleChallenge(@Req() req:Request,@Res({passthrough:true}) res:Response,@Body() input:GoogleChallengeDto) { return this.service.googleChallenge(req,res,input); }
  @Post("auth/google")
  @HttpCode(200)
  @ApiBody({type:GoogleCredentialDto})
  @ApiOkResponse({schema:{oneOf:[{type:"object",required:["user"],properties:{user:{$ref:"#/components/schemas/PublicUserDto"}}},{type:"object",required:["verificationRequired"],properties:{verificationRequired:{type:"boolean",enum:[true]}}}]}})
  googleLogin(@Req() req:Request,@Res({passthrough:true}) res:Response,@Body() input:GoogleCredentialDto) { return this.service.googleSignIn(req,res,input); }
  @Post("auth/google/link")
  @HttpCode(200)
  @ApiBody({type:LinkGoogleDto})
  @ApiOkResponse({schema:flagResponse("linked")})
  linkGoogle(@Req() req:Request,@Res({passthrough:true}) res:Response,@Body() input:LinkGoogleDto) { return this.service.linkGoogle(req,res,input); }
  @Get("auth/2fa") @ApiOkResponse({ type: MfaStatusResponseDto }) statusMfa(
    @Req() req: Request,
  ) {
    return this.service.mfaStatus(req);
  }
  @Post("auth/2fa/setup")
  @HttpCode(200)
  @ApiBody({ type: PasswordProofDto })
  @ApiOkResponse({ type: MfaSetupResponseDto })
  setupMfa(@Req() req: Request, @Body() input: PasswordProofDto) {
    return this.service.setupMfa(req, input);
  }
  @Post("auth/2fa/enable")
  @HttpCode(200)
  @ApiBody({ type: EnableMfaDto })
  @ApiOkResponse({ type: MfaEnabledResponseDto })
  enableMfa(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() input: EnableMfaDto,
  ) {
    return this.service.enableMfa(req, res, input);
  }
  @Post("auth/2fa/disable")
  @HttpCode(200)
  @ApiBody({ type: FactorProofDto })
  @ApiOkResponse({ schema: flagResponse("enabled") })
  disableMfa(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() input: FactorProofDto,
  ) {
    return this.service.disableMfa(req, res, input);
  }
  @Post("auth/2fa/recovery/rotate")
  @HttpCode(200)
  @ApiBody({ type: RequiredFactorProofDto })
  @ApiOkResponse({ type: RecoveryCodesResponseDto })
  rotateRecovery(@Req() req: Request, @Body() input: RequiredFactorProofDto) {
    return this.service.rotateRecovery(req, input);
  }
  @Get("auth/profile") @ApiOkResponse({ type: ProfileResponseDto }) profile(
    @Req() req: Request,
  ) {
    return this.service.profile(req);
  }
  @Patch("auth/profile")
  @ApiBody({ type: UpdateProfileDto })
  @ApiOkResponse({
    schema: {
      type: "object",
      required: ["version"],
      properties: { version: { type: "integer", minimum: 1 } },
    },
  })
  updateProfile(@Req() req: Request, @Body() input: UpdateProfileDto) {
    return this.service.updateProfile(req, input);
  }
  @Post("auth/privacy-requests")
  @HttpCode(202)
  @ApiBody({ type: PrivacyRequestDto })
  @ApiAcceptedResponse({ type: PrivacyRequestResponseDto })
  privacy(@Req() req: Request, @Body() input: PrivacyRequestDto) {
    return this.service.privacy(req, input);
  }
  @Get("auth/privacy-requests")
  @ApiOkResponse({ type: PrivacyListResponseDto })
  privacyRequests(@Req() req: Request) {
    return this.service.privacyRequests(req);
  }
  @Get("auth/security-events")
  @ApiOkResponse({ type: SecurityEventListResponseDto })
  securityEvents(@Req() req: Request) {
    return this.service.securityEvents(req);
  }
  @Get("health/live") live() {
    return { status: "ok" };
  }
  @Get("health/ready") async ready() {
    await this.service.pool.query("SELECT 1 FROM users LIMIT 1");
    await this.service.redis.ping();
    return { status: "ok" };
  }
  @Get("auth/csrf") @ApiOkResponse({ type: CsrfResponseDto }) csrf(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return issueCsrf(req, res, this.service.config);
  }
  @Post("auth/register")
  @HttpCode(202)
  @ApiBody({ type: RegistrationDto })
  @ApiAcceptedResponse({ schema: flagResponse("accepted") })
  register(@Req() req: Request, @Body() input: RegistrationDto) {
    return this.service.register(req, input);
  }
  @Post("auth/verify")
  @HttpCode(200)
  @ApiBody({ type: TokenDto })
  @ApiOkResponse({ schema: flagResponse("verified") })
  verify(@Req() req: Request, @Body() input: TokenDto) {
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
  @Post("auth/refresh")
  @HttpCode(200)
  @ApiOkResponse({ schema: flagResponse("renewed") })
  refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.service.refresh(req, res);
  }
  @Post("auth/logout")
  @HttpCode(200)
  @ApiOkResponse({ schema: flagResponse("revoked") })
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.service.logout(req, res);
  }
  @Get("auth/me") @ApiOkResponse({ type: PublicUserDto }) me(
    @Req() req: Request,
  ) {
    return this.service.me(req);
  }
  @Get("auth/sessions")
  @ApiOkResponse({ type: SessionListResponseDto })
  sessions(@Req() req: Request) {
    return this.service.sessions(req);
  }
  @Delete("auth/sessions/:id")
  @ApiOkResponse({ schema: flagResponse("revoked") })
  revoke(@Req() req: Request, @Param("id") id: string) {
    return this.service.revoke(req, uuid(id));
  }
  @Post("auth/password/forgot")
  @HttpCode(202)
  @ApiBody({ type: ResetRequestDto })
  @ApiAcceptedResponse({ schema: flagResponse("accepted") })
  forgot(@Req() req: Request, @Body() input: ResetRequestDto) {
    return this.service.requestReset(req, input);
  }
  @Post("auth/password/reset")
  @HttpCode(200)
  @ApiBody({ type: ResetDto })
  @ApiOkResponse({ schema: flagResponse("reset") })
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
