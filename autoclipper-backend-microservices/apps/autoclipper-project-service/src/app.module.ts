import { Module } from "@nestjs/common";
import { ProjectService } from "./application/project.service.js";
import { ProjectController } from "./interfaces/project.controller.js";
import { DerivativesController } from "./interfaces/derivatives.controller.js";
import { AnalysisController } from "./interfaces/analysis.controller.js";
@Module({ providers: [ProjectService], controllers: [ProjectController,DerivativesController,AnalysisController] })
export class AppModule {}
