import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {internalProcessingSpec} from '@autoclipper/api-contracts';
import {splitScreenPlan} from '../../apps/autoclipper-media-processing-service/dist/domain/split-screen-filter.js';
import {subtitles} from '../../apps/autoclipper-media-processing-service/dist/domain/processing.js';
const execute=promisify(execFile),ffmpeg=process.env.FFMPEG_PATH??'ffmpeg',ffprobe=process.env.FFPROBE_PATH??'ffprobe';
export function tone(buffer,sampleRate=8000){let crossings=0,power=0;for(let offset=0;offset<buffer.length;offset+=2){const value=buffer.readInt16LE(offset);power+=value*value;if(offset&&value>=0&&buffer.readInt16LE(offset-2)<0)crossings++;}return{frequency:crossings/(buffer.length/2/sampleRate),rms:Math.sqrt(power/(buffer.length/2))};}
test('FFmpeg split-screen frames, proportions, freeze duration, audio selection and captions are real',{timeout:90000},async t=>{
  const directory=await mkdtemp(join(tmpdir(),'split-filter-')),main=join(directory,'primary.mp4'),second=join(directory,'secondary.mp4');let index=0;
  const base={version:1,kind:'clip',startSeconds:0,endSeconds:3,aspect:'square',framing:{x:0,y:0.5},splitScreen:{secondaryUploadId:randomUUID(),layout:'side_by_side',primaryRatio:0.4,startSeconds:0,shortInput:'freeze',audio:'primary',framing:{x:1,y:0.5}}};
  async function render(input){const spec=internalProcessingSpec.parse(input),plan=splitScreenPlan(spec),cwd=join(directory,String(index++));await mkdir(cwd);if(spec.subtitles)await writeFile(join(cwd,'captions.srt'),subtitles(spec).srt);const output=join(cwd,'clip.mp4');await execute(ffmpeg,['-v','error','-filter_complex_threads','1','-threads','1','-ss',String(spec.startSeconds),'-i',main,'-threads','1','-ss',String(spec.splitScreen.startSeconds),'-i',second,'-filter_complex',plan.filter,'-map','[video]',...(plan.audioInput===null?['-an']:['-map','[audio]']),'-t',String(spec.endSeconds-spec.startSeconds),'-c:v','libx264','-threads','1','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac',output],{cwd,timeout:30000,windowsHide:true});return output;}
  async function frame(path,time=0.5){return(await execute(ffmpeg,['-v','error','-ss',String(time),'-i',path,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer',timeout:15000,maxBuffer:2097152,windowsHide:true})).stdout;}
  async function audio(path,time){return tone((await execute(ffmpeg,['-v','error','-ss',String(time),'-i',path,'-t','0.4','-vn','-ac','1','-ar','8000','-f','s16le','pipe:1'],{encoding:'buffer',timeout:15000,maxBuffer:1048576,windowsHide:true})).stdout);}
  function pixel(bytes,x,y){return [...bytes.subarray((y*720+x)*3,(y*720+x)*3+3)];}
  try{
    for(const [path,color,frequency,duration] of [[main,'red',440,4],[second,'blue',880,1]])await execute(ffmpeg,['-v','error','-f','lavfi','-i',`color=c=${color}:s=640x240:r=30,drawbox=x=320:y=0:w=320:h=240:color=${color==='red'?'green':'yellow'}:t=fill`,'-f','lavfi','-i',`sine=frequency=${frequency}:sample_rate=48000`,'-t',String(duration),'-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac',path],{timeout:30000,windowsHide:true});
    await t.test('side-by-side uses the requested ratio and each source framing; audio is primary only',async()=>{const output=await render(base),bytes=await frame(output),left=pixel(bytes,100,360),right=pixel(bytes,500,360);assert.ok(left[0]>180&&left[1]<50&&left[2]<40);assert.ok(right[0]>180&&right[1]>180&&right[2]<50);assert.ok(pixel(bytes,287,360)[0]>180);assert.ok(pixel(bytes,288,360)[1]>180);const measured=await audio(output,0.2);assert.ok(Math.abs(measured.frequency-440)<20);});
    await t.test('stacked layout rounds panel boundaries and none emits no audio stream',async()=>{const output=await render({...base,splitScreen:{...base.splitScreen,layout:'stacked',primaryRatio:0.6,audio:'none'}}),bytes=await frame(output);assert.ok(pixel(bytes,100,200)[0]>180);assert.ok(pixel(bytes,650,600)[1]>180);const info=JSON.parse((await execute(ffprobe,['-v','error','-select_streams','a','-show_entries','stream=codec_type','-of','json',output],{timeout:15000,windowsHide:true})).stdout);assert.deepEqual(info.streams,[]);});
    await t.test('short secondary freezes to the primary duration and pads selected secondary audio with silence',async()=>{const output=await render({...base,splitScreen:{...base.splitScreen,audio:'secondary'}}),late=await frame(output,2.5);assert.ok(pixel(late,500,360)[1]>180);assert.ok(Math.abs((await audio(output,0.2)).frequency-880)<20);assert.ok((await audio(output,2)).rms<5);const info=JSON.parse((await execute(ffprobe,['-v','error','-show_entries','format=duration','-of','json',output],{timeout:15000,windowsHide:true})).stdout);assert.ok(Math.abs(Number(info.format.duration)-3)<0.1);});
    await t.test('primary captions are burned on the final composite canvas',async()=>{const output=await render({...base,subtitles:{provenance:'user',cues:[{startSeconds:0,endSeconds:2.8,text:'Caption on the composite'}],style:{template:'clean',fontSize:30,position:'top'}}}),bytes=await frame(output);let white=0;for(let offset=0;offset<bytes.length/2;offset+=3)if(bytes[offset]>220&&bytes[offset+1]>220&&bytes[offset+2]>220)white++;assert.ok(white>50);});
  }finally{await rm(directory,{recursive:true,force:true});}
});
