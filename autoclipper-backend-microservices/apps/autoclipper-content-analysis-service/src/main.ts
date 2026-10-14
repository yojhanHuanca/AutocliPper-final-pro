import "reflect-metadata";
import {NestFactory} from "@nestjs/core";
import {ApplicationLogger,configureHttp,logger} from "@autoclipper/observability";
import {analysisConfig} from "./infrastructure/connections.js";
import {AppModule} from "./app.module.js";
async function start(){const config=analysisConfig();const app=await NestFactory.create(AppModule,{logger:new ApplicationLogger()});try{configureHttp(app,config,"content-analysis-service");await app.listen(config.PORT,config.HOST);}catch(error){await app.close();throw error;}}
start().catch(()=>{logger.error({code:"ANALYSIS_STARTUP_FAILED"});process.exitCode=1;});
