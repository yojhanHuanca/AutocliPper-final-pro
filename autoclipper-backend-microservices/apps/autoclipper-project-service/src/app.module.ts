import { Module } from "@nestjs/common";
import { ProjectService } from "./application/project.service.js";
import { ProjectController } from "./interfaces/project.controller.js";
@Module({ providers: [ProjectService], controllers: [ProjectController] })
export class AppModule {}
