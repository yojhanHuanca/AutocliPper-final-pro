import { Module } from '@nestjs/common';
import { InspectionRuntime } from './application/inspection-runtime.js';
import { OperationsController } from './interfaces/operations.controller.js';

@Module({ providers: [InspectionRuntime], controllers: [OperationsController] })
export class AppModule {}
