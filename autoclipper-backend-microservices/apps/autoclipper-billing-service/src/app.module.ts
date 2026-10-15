import {Module} from "@nestjs/common";
import {BillingService} from "./application/billing.service.js";
import {BillingController} from "./interfaces/billing.controller.js";
@Module({providers:[BillingService],controllers:[BillingController]})
export class AppModule {}
