// Isolated test process only: simulate loss immediately after the durable stage
// transaction. Never starts a production listener or kills another process.
import {ProjectService} from '../../apps/autoclipper-project-service/dist/application/project.service.js';
if(process.env.PIPELINE_INTEGRATION_ISOLATED!=='true')throw Error('Isolated pipeline test required');
const service=new ProjectService();
if(process.argv[2]!=='usage-outbox')await service.usage.dispatch();
await service.pipelines.dispatch();
process.kill(process.pid,'SIGKILL');
