import { CreateBucketCommand, HeadBucketCommand, PutBucketLifecycleConfigurationCommand,PutBucketCorsCommand } from '@aws-sdk/client-s3';
import { loadMediaConfig } from '@autoclipper/configuration';
import { createS3 } from '../apps/autoclipper-media-processing-service/dist/infrastructure/connections.js';

const config = loadMediaConfig();
const s3 = createS3(config);
try {
  let available = false;
  for (let attempt = 0; attempt < 20 && !available; attempt++) {
    try { await s3.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET })); available = true; }
    catch (error) {
      if (error?.$metadata?.httpStatusCode === 404) {
        try { await s3.send(new CreateBucketCommand({ Bucket: config.S3_BUCKET })); available = true; }
        catch (createError) { if (![409].includes(createError?.$metadata?.httpStatusCode)) throw createError; available = true; }
      } else if (attempt === 19 || error?.$metadata?.httpStatusCode === 403) {
        // Do not log provider errors containing endpoints or credentials.
        // eslint-disable-next-line preserve-caught-error
        throw new Error('STORAGE_BOOTSTRAP_FAILED');
      }
      else await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  await s3.send(new PutBucketLifecycleConfigurationCommand({ Bucket: config.S3_BUCKET, LifecycleConfiguration: {
    Rules: [{ ID: 'abort-incomplete-multipart-uploads', Status: 'Enabled', Filter: { Prefix: '' }, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } }]
  } }));
  await s3.send(new PutBucketCorsCommand({Bucket:config.S3_BUCKET,CORSConfiguration:{CORSRules:[{AllowedOrigins:[config.CORS_ORIGIN],AllowedMethods:['PUT','GET','HEAD'],AllowedHeaders:['content-type','x-amz-checksum-sha256'],ExposeHeaders:['ETag'],MaxAgeSeconds:300}]}}));
  console.log('Private bucket available; incomplete multipart uploads expire after one day.');
} finally { s3.destroy(); }
