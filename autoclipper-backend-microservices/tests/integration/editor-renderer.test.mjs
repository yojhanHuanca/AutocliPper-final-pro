import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {processingSpec} from '@autoclipper/api-contracts';
import {videoFilter} from '../../apps/autoclipper-media-processing-service/dist/domain/video-filter.js';
const execute=promisify(execFile),ffmpeg=process.env.FFMPEG_PATH??'ffmpeg';
const spec={version:1,kind:'clip',startSeconds:0,endSeconds:2,aspect:'square'};
test('actual FFmpeg respects manual crop and burned subtitle templates',{timeout:60000},async t=>{
  const directory=await mkdtemp(join(tmpdir(),'editor-filter-'));
  async function frame(value,source='color=c=blue:s=640x240:r=30'){
    const result=await execute(ffmpeg,['-v','error','-f','lavfi','-i',source,'-filter_threads','1','-threads','1','-vf',videoFilter(processingSpec.parse(value)),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{cwd:directory,encoding:'buffer',timeout:15000,maxBuffer:2097152,windowsHide:true});return result.stdout;
  }
  try{
    await t.test('left and right overflow offsets select different measured source regions',async()=>{
      const source='color=c=red:s=640x240:r=30,drawbox=x=320:y=0:w=320:h=240:color=blue:t=fill';
      const left=await frame({...spec,framing:{x:0,y:0.5}},source),right=await frame({...spec,framing:{x:1,y:0.5}},source),offset=(360*720+360)*3;
      assert.ok(left[offset]>200&&left[offset+2]<30);assert.ok(right[offset]<30&&right[offset+2]>200);
    });
    await writeFile(join(directory,'captions.srt'),'1\n00:00:00,000 --> 00:00:02,000\nExplicit subtitle style fixture\n');
    await t.test('bold template burns yellow glyphs at the requested top position',async()=>{
      const bytes=await frame({...spec,subtitles:{provenance:'user',cues:[{startSeconds:0,endSeconds:2,text:'Explicit subtitle style fixture'}],style:{template:'bold',fontSize:30,position:'top'}}});let top=0,bottom=0;for(let offset=0;offset<bytes.length;offset+=3)if(bytes[offset]>150&&bytes[offset+1]>150&&bytes[offset+2]<120){if(offset<bytes.length/2)top++;else bottom++;}assert.ok(top>50);assert.equal(bottom,0);
    });
    await t.test('boxed template encodes a translucent background behind the captions',async()=>{
      const bytes=await frame({...spec,subtitles:{provenance:'user',cues:[{startSeconds:0,endSeconds:2,text:'Explicit subtitle style fixture'}],style:{template:'boxed',fontSize:24,position:'bottom'}}});let translucent=0;for(let offset=Math.floor(bytes.length*2/3/3)*3;offset<bytes.length;offset+=3)if(bytes[offset]<20&&bytes[offset+1]<20&&bytes[offset+2]>70&&bytes[offset+2]<180)translucent++;assert.ok(translucent>500);
    });
  }finally{await rm(directory,{recursive:true,force:true});}
});
