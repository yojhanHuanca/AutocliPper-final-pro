import {S3Client} from "@aws-sdk/client-s3";
import {NodeHttpHandler} from "@smithy/node-http-handler";
import {z} from "zod";
import {loadServiceConfig} from "@autoclipper/http-security";
const schema=z.object({REDIS_URL:z.url(),S3_ENDPOINT:z.url(),S3_REGION:z.string().min(1).default("us-east-1"),S3_ACCESS_KEY:z.string().min(16),S3_SECRET_KEY:z.string().min(32),S3_BUCKET:z.string().min(3),TEMP_DIR:z.string().min(1).default("/tmp/analysis"),ANALYSIS_WORKER_ENABLED:z.enum(["true","false"]).default("true").transform(value=>value==="true")});
export function analysisConfig(){const base=loadServiceConfig(),extra=schema.safeParse(process.env);if(!extra.success)throw new Error(`Invalid configuration: ${extra.error.issues.map(issue=>issue.path.join(".")).join(",")}`);return{...base,...extra.data};}
export function redisConnection(value:string){const url=new URL(value);if(!["redis:","rediss:"].includes(url.protocol))throw new Error("Invalid REDIS_URL protocol");return{host:url.hostname,port:Number(url.port||6379),username:decodeURIComponent(url.username),password:decodeURIComponent(url.password),db:Number(url.pathname.slice(1)||0),connectTimeout:2000,...(url.protocol==="rediss:"?{tls:{}}:{})};}
export function analysisS3(config:ReturnType<typeof analysisConfig>){return new S3Client({endpoint:config.S3_ENDPOINT,region:config.S3_REGION,forcePathStyle:true,credentials:{accessKeyId:config.S3_ACCESS_KEY,secretAccessKey:config.S3_SECRET_KEY},maxAttempts:2,requestHandler:new NodeHttpHandler({connectionTimeout:2000,requestTimeout:5000})});}
