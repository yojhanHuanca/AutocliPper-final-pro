import { Controller, Get, Module } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { HealthResponse, ReadinessResponse } from '@autoclipper/api-contracts';

@ApiTags('operations')
@Controller('health')
export class HealthController {
  @Get('live') @ApiOkResponse({ type: HealthResponse })
  live(): HealthResponse { return { status: 'ok' }; }
  // Stateless gateway currently has no upstream business routes or credentials.
  @Get('ready') @ApiOkResponse({ type: ReadinessResponse })
  ready(): ReadinessResponse { return { status: 'ok', checks: {} }; }
}
@Module({ controllers: [HealthController] })
export class AppModule {}
