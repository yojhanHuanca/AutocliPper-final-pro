import { Module } from "@nestjs/common";
import { InspectionRuntime } from "./application/inspection-runtime.js";
import { OperationsController } from "./interfaces/operations.controller.js";
import { InspectionController } from "./interfaces/inspection.controller.js";

@Module({
  providers: [InspectionRuntime],
  controllers: [OperationsController, InspectionController],
})
export class AppModule {}
