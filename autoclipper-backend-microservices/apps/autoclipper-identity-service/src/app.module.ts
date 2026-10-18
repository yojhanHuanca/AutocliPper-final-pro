import { Module } from "@nestjs/common";
import { IdentityService } from "./application/identity.service.js";
import { IdentityController } from "./interfaces/identity.controller.js";
import {AdminController} from "./interfaces/admin.controller.js";
@Module({ providers: [IdentityService], controllers: [IdentityController,AdminController] })
export class AppModule {}
