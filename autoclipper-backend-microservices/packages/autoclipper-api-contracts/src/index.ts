import { ApiProperty } from '@nestjs/swagger';
export type { paths, components, operations } from './generated.js';

export class HealthResponse {
  @ApiProperty({ enum: ['ok'] }) status!: 'ok';
}
export class ErrorResponse {
  @ApiProperty({ example: 'RESOURCE_NOT_FOUND' }) code!: string;
  @ApiProperty({ example: 'Request could not be completed' }) message!: string;
  @ApiProperty({ format: 'uuid' }) correlationId!: string;
}
export class ReadinessResponse {
  @ApiProperty({ enum: ['ok', 'unavailable'] }) status!: 'ok' | 'unavailable';
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string', enum: ['ok', 'unavailable'] } }) checks!: Record<string, 'ok' | 'unavailable'>;
}
