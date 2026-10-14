import { timingSafeEqual } from 'node:crypto';
import { Controller, Get, Headers, Inject, Res, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse, ApiProduces } from '@nestjs/swagger';
import type { Response } from 'express';
import { HealthResponse, ReadinessResponse, ErrorResponse } from '@autoclipper/api-contracts';
import { registry } from '@autoclipper/observability';
import { InspectionRuntime } from '../application/inspection-runtime.js';

@ApiTags('operations')
@Controller()
export class OperationsController {
  constructor(@Inject(InspectionRuntime) private readonly runtime: InspectionRuntime) {}
  @Get('health/live') @ApiOkResponse({ type: HealthResponse })
  live(): HealthResponse { return { status: 'ok' }; }
  @Get('health/ready') @ApiOkResponse({ type: ReadinessResponse }) @ApiServiceUnavailableResponse({ type: ReadinessResponse })
  async ready(@Res({ passthrough: true }) response: Response): Promise<ReadinessResponse> {
    const result = await this.runtime.readiness();
    if (result.status !== 'ok') response.status(503);
    return result;
  }
  @Get('metrics') @ApiBearerAuth() @ApiProduces('text/plain') @ApiOkResponse({ schema: { type: 'string' } }) @ApiUnauthorizedResponse({ type: ErrorResponse })
  async metrics(@Headers('authorization') authorization: string | undefined, @Res() response: Response) {
    const received = Buffer.from(authorization ?? '');
    const expected = Buffer.from(`Bearer ${this.runtime.config.INTERNAL_TOKEN}`);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new UnauthorizedException();
    if ((await this.runtime.readiness()).status !== 'ok') throw new ServiceUnavailableException();
    response.type(registry.contentType).send(await registry.metrics());
  }
}
