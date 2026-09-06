/**
 * @ffmpeg/core 0.12.10 exits its CLI through an Emscripten exception. Its exec
 * wrapper neither restores the stack nor frees malloc'd argv. Repeated frame
 * commands exhaust the stack after ~160 calls. Keep argv on the saved stack
 * and restore it in finally. The FFmpeg WASM/filter code is unmodified.
 * Fail closed on upgrades: the exact pinned wrapper must still be recognized.
 */
const ORIGINAL_EXEC =
  'function exec(..._args){const args=[...Module["DEFAULT_ARGS"],..._args];try{Module["_ffmpeg"](args.length,stringsToPtr(args))}catch(e){if(!e.message.startsWith("Aborted")){throw e}}return Module["ret"]}'
const REENTRANT_EXEC = `function exec(..._args){
  const args=[...Module["DEFAULT_ARGS"],..._args];
  const savedStack=stackSave();
  const stackAlloc=(size)=>{const ptr=(stackSave()-size)&-16;stackRestore(ptr);return ptr};
  try {
    const argv=stackAlloc((args.length+1)*4);
    for(let i=0;i<args.length;i++){
      const size=Module["lengthBytesUTF8"](args[i])+1;
      const ptr=stackAlloc(size);
      Module["stringToUTF8"](args[i],ptr,size);
      Module["setValue"](argv+i*4,ptr,"i32");
    }
    Module["setValue"](argv+args.length*4,0,"i32");
    try { Module["_ffmpeg"](args.length,argv) }
    catch(e){ if(!e.message.startsWith("Aborted")) throw e }
    return Module["ret"];
  } finally { stackRestore(savedStack) }
}`

export function reentrantFfmpegCore(source: string) {
  if (!source.includes(ORIGINAL_EXEC)) throw new Error('Unsupported FFmpeg core version')
  return source.replace(ORIGINAL_EXEC, REENTRANT_EXEC)
}
