import {Module} from "@nestjs/common";
import {AnalysisRuntime} from "./application/analysis-runtime.js";
import {AnalysisController} from "./interfaces/analysis.controller.js";
@Module({providers:[AnalysisRuntime],controllers:[AnalysisController]})
export class AppModule{}
