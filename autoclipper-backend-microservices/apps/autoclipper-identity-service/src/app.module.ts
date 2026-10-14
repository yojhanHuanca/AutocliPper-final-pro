import { Module } from "@nestjs/common";
import { IdentityService } from "./application/identity.service.js";
import { IdentityController } from "./interfaces/identity.controller.js";
@Module({ providers: [IdentityService], controllers: [IdentityController] })
export class AppModule {}
