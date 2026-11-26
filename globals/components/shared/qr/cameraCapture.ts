/** Own each requested stream, including one resolving after route disposal. */
export function createCameraCapture({request,attach}:{request:()=>Promise<MediaStream>;attach:(stream:MediaStream)=>Promise<void>}){
 let active=true;let stream:MediaStream|undefined;
 function stop(){active=false;stream?.getTracks().forEach(track=>track.stop());stream=undefined;}
 return {async start(){try{const acquired=await request();if(!active){acquired.getTracks().forEach(track=>track.stop());return;}stream=acquired;await attach(acquired);}catch(error){stop();throw error;}},stop};
}
