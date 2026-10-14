import { Module } from "@nestjs/common";
import { InspectionRuntime } from "./application/inspection-runtime.js";
import { OperationsController } from "./interfaces/operations.controller.js";
import { InspectionController } from "./interfaces/inspection.controller.js";
import { ProcessingRuntime } from "./application/processing-runtime.js";
import { ProcessingController } from "./interfaces/processing.controller.js";

@Module({
  providers: [InspectionRuntime, ProcessingRuntime],
  controllers: [OperationsController, InspectionController, ProcessingController],
})
export class AppModule {}
