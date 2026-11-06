import { Body, Controller, Delete, Get, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { uuid } from '@autoclipper/http-security';
import { SocialPublishingService } from '../application/social-publishing.service.js';

@ApiTags('social')
@Controller()
export class SocialController {
  constructor(@Inject(SocialPublishingService) private readonly social: SocialPublishingService) {}
  @Get('social/connections')
  @ApiOkResponse({ description: 'Configured and connected publishing accounts. Never contains credentials.' })
  connections(@Req() req: Request) { return this.social.connections(req); }
  @Post('social/:provider/connect')
  connect(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('provider') provider: string) { return this.social.connect(req, res, provider); }
  @Get('social/:provider/callback')
  callback(@Req() req: Request, @Res() res: Response, @Param('provider') provider: string) { return this.social.callback(req, res, provider); }
  @Delete('social/:provider/connection')
  disconnect(@Req() req: Request, @Param('provider') provider: string) { return this.social.disconnect(req, provider); }
  @Post('processing/:id/publications')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ schema: { type: 'object', required: ['provider', 'title', 'madeForKids', 'consent'], additionalProperties: false, properties: { provider: { type: 'string', enum: ['youtube', 'tiktok'] }, title: { type: 'string', minLength: 1, maxLength: 100 }, description: { type: 'string', maxLength: 5000 }, privacy: { type: 'string', enum: ['private', 'unlisted', 'public'], default: 'private' }, madeForKids: { type: 'boolean' }, consent: { type: 'boolean', enum: [true] } } } })
  begin(@Req() req: Request, @Param('id') id: string, @Body() input: unknown) { return this.social.begin(req, uuid(id), input); }
  @Get('social/publications/:id')
  status(@Req() req: Request, @Param('id') id: string) { return this.social.status(req, uuid(id)); }
}
