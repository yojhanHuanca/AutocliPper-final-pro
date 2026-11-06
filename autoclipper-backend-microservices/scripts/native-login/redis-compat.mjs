// Loopback-only, in-memory Redis subset for the isolated native login demo.
// It is intentionally insufficient for queues, workers, or production use.
import net from 'node:net';

if(process.env.NODE_ENV!=='development'||process.env.AUTOCLIPPER_NATIVE_LOGIN!=='true')throw new Error('Native login Redis compatibility server is development-only');
const port=Number(process.env.NATIVE_REDIS_PORT??16379);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid native Redis port');
const entries=new Map();
function current(key){const value=entries.get(key);if(value&&value.expiresAt!==null&&value.expiresAt<=Date.now()){entries.delete(key);return undefined;}return value;}
function line(buffer,start){const end=buffer.indexOf('\r\n',start);return end<0?null:{value:buffer.toString('utf8',start,end),next:end+2};}
function parse(buffer,start=0){
  const header=line(buffer,start);if(!header)return null;
  if(buffer[start]!==42)throw new Error('RESP arrays only');
  const count=Number(header.value.slice(1));if(!Number.isInteger(count)||count<1||count>16)throw new Error('RESP command too large');
  let next=header.next;const args=[];
  for(let index=0;index<count;index++){
    const part=line(buffer,next);if(!part)return null;if(buffer[next]!==36)throw new Error('RESP bulk only');
    const length=Number(part.value.slice(1));if(!Number.isInteger(length)||length<0||length>65536)throw new Error('RESP bulk too large');
    if(buffer.length<part.next+length+2)return null;
    if(buffer[part.next+length]!==13||buffer[part.next+length+1]!==10)throw new Error('Invalid RESP framing');
    args.push(buffer.toString('utf8',part.next,part.next+length));next=part.next+length+2;
  }
  return{args,next};
}
const simple=value=>`+${value}\r\n`,integer=value=>`:${value}\r\n`,bulk=value=>value===null?'$-1\r\n':`$${Buffer.byteLength(value)}\r\n${value}\r\n`;
function execute(args){
  const command=args[0]?.toUpperCase();
  if(command==='PING')return simple('PONG');
  if(command==='CLIENT'||command==='SELECT')return simple('OK');
  if(command==='INFO')return bulk('# Server\r\nredis_version:7.0.0\r\n');
  if(command==='COMMAND')return '*0\r\n';
  if(command==='EVAL'){
    const [,script,keys,key]=args;
    const match=/^local n=redis\.call\('INCR',KEYS\[1\]\); if n==1 then redis\.call\('EXPIRE',KEYS\[1\],(60|600)\) end; return n$/.exec(script??'');
    if(keys!=='1'||!key||!match)return '-ERR unsupported development rate-limit script\r\n';
    const previous=current(key),value=Number(previous?.value??0)+1;
    if(entries.size>=10000&&!previous)return '-ERR native rate-limit capacity reached\r\n';
    entries.set(key,{value:String(value),expiresAt:previous?.expiresAt??Date.now()+Number(match[1])*1000});
    return integer(value);
  }
  if(command==='SET'){
    const [,key,value,mode,seconds]=args;if(!key||value===undefined||mode?.toUpperCase()!=='EX'||!/^\d+$/.test(seconds??''))return '-ERR unsupported SET\r\n';
    if(entries.size>=10000&&!current(key))return '-ERR native key capacity reached\r\n';
    entries.set(key,{value,expiresAt:Date.now()+Number(seconds)*1000});return simple('OK');
  }
  if(command==='GETDEL'){
    const key=args[1]??'',value=current(key)?.value??null;entries.delete(key);return bulk(value);
  }
  if(command==='DEL'){
    let removed=0;for(const key of args.slice(1))if(entries.delete(key))removed++;return integer(removed);
  }
  if(command==='QUIT')return simple('OK');
  return '-ERR unsupported native login command\r\n';
}
const server=net.createServer(socket=>{
  let buffered=Buffer.alloc(0);
  socket.on('data',chunk=>{
    buffered=Buffer.concat([buffered,chunk]);
    if(buffered.length>262144){socket.destroy();return;}
    try{for(;;){const parsed=parse(buffered);if(!parsed)break;socket.write(execute(parsed.args));buffered=buffered.subarray(parsed.next);}}
    catch{socket.destroy();}
  });
});
server.listen(port,'127.0.0.1');
