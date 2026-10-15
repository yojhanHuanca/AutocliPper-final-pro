import { Module } from "@nestjs/common";
import { ProjectService } from "./application/project.service.js";
import { ProjectController } from "./interfaces/project.controller.js";
import { DerivativesController } from "./interfaces/derivatives.controller.js";
import { AnalysisController } from "./interfaces/analysis.controller.js";
import { EditorController } from "./interfaces/editor.controller.js";
import { CollaborationController } from "./interfaces/collaboration.controller.js";
import { PipelineController } from "./interfaces/pipeline.controller.js";
@Module({ providers: [ProjectService], controllers: [ProjectController,DerivativesController,AnalysisController,EditorController,CollaborationController,PipelineController] })
export class AppModule {}
