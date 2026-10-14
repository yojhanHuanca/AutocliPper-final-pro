import { Module } from "@nestjs/common";
import { WorkspaceService } from "./application/workspace.service.js";
import { WorkspaceController } from "./interfaces/workspace.controller.js";
@Module({ providers: [WorkspaceService], controllers: [WorkspaceController] })
export class AppModule {}
