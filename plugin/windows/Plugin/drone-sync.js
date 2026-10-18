/* R Project drone sync: places silent drone clips on the master-music timeline from their camera clock.
   A drone records no audio, so the audio engine cannot place it. Its file creation_time can, once that clock is
   bridged to the master: an audio-synced camera with a trusted clock gives "master time 0" on its own clock.
   Devices disagree on time zones (DJI drones store UTC, DJI Osmo stores local time labelled UTC, Blackmagic stores
   UTC), so every clock is first converted to local wall time using the date/time in the file name when present.
   creation_time has whole-second resolution: clips are placed at +0.5 s (the middle of that second), flagged
   [CLOCK], and grouped into flights so one manual correction can move a whole flight. */
(function(root){
'use strict';
var FLIGHT_GAP=300,HALF_SECOND=0.5,TZ_STEP=900;
function num(v){return typeof v==='number'&&isFinite(v);}

/** Camera brand from FFmpeg's metadata dump ('' when unknown). */
function makeFromProbe(text){
 text=String(text||'');
 if(/com\.dji\.|encoder\s*:\s*DJI/i.test(text))return 'DJI';
 if(/blackmagic/i.test(text))return 'Blackmagic';
 if(/com\.apple\.quicktime\.make\s*:\s*Apple|iPhone/i.test(text))return 'Apple';
 if(/Sony|XAVC/i.test(text))return 'Sony';
 if(/GoPro/i.test(text))return 'GoPro';
 return '';
}
/** Camera model from FFmpeg's metadata dump (DJI encoder name, Blackmagic camera type, Apple model), else the brand. */
function modelFromProbe(text){
 text=String(text||'');var m=/encoder\s*:\s*(DJI[^\r\n]*)/i.exec(text)||/cameraType\s*:\s*([^\r\n]+)/i.exec(text)||/com\.apple\.quicktime\.model\s*:\s*([^\r\n]+)/i.exec(text);
 return m?m[1].replace(/\s+/g,' ').trim():makeFromProbe(text);
}
/** Serial number / unit id in FFmpeg's metadata dump when the camera writes one ('' otherwise). */
function serialFromProbe(text){var m=/CameraSerialNumber\s*:\s*([^\r\n]+)/i.exec(String(text||''))||/camera\.uuid\s*:\s*([^\r\n]+)/i.exec(String(text||''));return m?m[1].trim():'';}
/** Key for a remembered drone clock offset: the drone and the reference camera it was measured against (model, plus the
    unit's serial when the files carry one, so two drones of the same model are kept apart). Exports that lost the camera
    model (Gyroflow-stabilized FPV) are remembered by their source name instead. '' when neither is known. */
function offsetKey(drone,ref){
 var dm=drone&&(drone.model||drone.make),rm=ref&&(ref.model||ref.make);if(!rm)return '';
 if(!dm)return drone&&drone.name?'source "'+String(drone.name)+'" -> '+rm+(ref.serial?' #'+ref.serial:''):'';
 return dm+(drone.serial?' #'+drone.serial:drone.sameModel&&drone.name?' "'+String(drone.name)+'"':'')+' -> '+rm+(ref.serial?' #'+ref.serial:'');
}
/** Shoot day (UTC date of the middle clip) of a drone's footage: a camera clock can be reset between events, so the
    remembered offset is kept per shoot day. */
function shootDay(clips){
 var t=(clips||[]).map(function(c){return Number(c.created);}).filter(num).sort(function(a,b){return a-b;});
 return t.length?new Date(t[t.length>>1]*1000).toISOString().slice(0,10):'';
}
/** Remembered entry for a shoot day: that day's, else the nearest day's (later wins a tie), else an undated one. */
function pickMemo(memo,day){
 if(!memo)return null;var days=memo.shots&&typeof memo.shots==='object'?Object.keys(memo.shots).filter(function(k){return num(Number(memo.shots[k]&&memo.shots[k].offset));}):[];
 if(!days.length)return num(Number(memo.offset))?{offset:Number(memo.offset),at:memo.at||'',day:''}:null;
 var at=day?Date.parse(day):NaN,best=days[0];
 days.forEach(function(k){if(!isFinite(at)){if(k>best)best=k;return;}var d=Math.abs(Date.parse(k)-at),b=Math.abs(Date.parse(best)-at);if(d<b||(d===b&&k>best))best=k;});
 return {offset:Number(memo.shots[best].offset),at:memo.shots[best].at||'',day:best};
}
/** Local wall time in the file name, as seconds "UTC" (so local minus creation_time is the time-zone offset).
    DJI: DJI_YYYYMMDDHHMMSS_.... Blackmagic: <reel>_MMDDHHMM_C<n> (year taken from creation_time). */
function nameLocalTime(name,created){
 var n=String(name||'').replace(/^.*[\\/]/,''),m=/(?:^|[^0-9])(20\d{2})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})(?:[^0-9]|$)/.exec(n);
 if(m)return Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6])/1000;
 m=/(?:^|[^A-Z0-9])[A-Z]\d{3}_(\d{2})(\d{2})(\d{2})(\d{2})_C\d+/i.exec(n);
 if(m&&num(created)){var y=new Date(created*1000).getUTCFullYear(),t=Date.UTC(y,+m[1]-1,+m[2],+m[3],+m[4],0)/1000;
  // Around New Year the name's month can belong to the neighbouring year.
  if(t-created>180*86400)t=Date.UTC(y-1,+m[1]-1,+m[2],+m[3],+m[4],0)/1000;else if(created-t>180*86400)t=Date.UTC(y+1,+m[1]-1,+m[2],+m[3],+m[4],0)/1000;
  return t;}
 return null;
}
/** Time-zone offset (seconds, multiple of 15 min) between a clip's file-name time and its creation_time; null if unknown. */
function zoneOffset(name,created){
 var local=nameLocalTime(name,created);if(local===null||!num(created))return null;
 var z=Math.round((local-created)/TZ_STEP)*TZ_STEP;
 // A Blackmagic name has minutes only: accept it when it agrees within 2 minutes.
 return Math.abs(local-created-z)<=120&&Math.abs(z)<=14*3600?z:null;
}
/** One offset for a device: the value most of its clips agree on. */
function deviceZone(clips){
 var votes={},best=null,count=0;
 (clips||[]).forEach(function(c){var z=zoneOffset(c.fileName||c.name,c.created);if(z===null)return;votes[z]=(votes[z]||0)+1;if(votes[z]>count){count=votes[z];best=z;}});
 return best;
}
/** Pick the reference camera: audio-synced with a trusted clock. First a camera that keeps time the same way as the drone
    (same file-name vs creation_time zone, e.g. both store true UTC): on a real set (aertbat) the DJI drone matched the
    Blackmagic camera within 1.5 s while a DJI Osmo of the same brand was 2 min 16 s off. Then same brand, known zone,
    most placed clips. */
function chooseReference(cameras,droneMake,droneZone){
 var ok=(cameras||[]).filter(function(c){return c&&num(c.anchor);}),known=function(c){return c.zone!==null&&c.zone!==undefined?1:0;},
  sameZone=function(c){return droneZone!==null&&droneZone!==undefined&&known(c)&&c.zone===droneZone?1:0;};
 ok.sort(function(a,b){var sa=a.make&&a.make===droneMake?1:0,sb=b.make&&b.make===droneMake?1:0;return sameZone(b)-sameZone(a)||sb-sa||known(b)-known(a)||(b.placed||0)-(a.placed||0);});
 return ok[0]||null;
}
/** Master start in local wall time for each clocked camera, and how far they disagree with the chosen reference. */
function clockReport(cameras,ref){
 return (cameras||[]).filter(function(c){return c&&num(c.anchor);}).map(function(c){
  var z=c.zone===null||c.zone===undefined?0:c.zone,wall=c.anchor+z;
  return {name:c.name,make:c.make||'',zone:c.zone,masterStartWall:wall,
   differsFromReference:ref?Math.round((wall-(ref.anchor+(ref.zone||0)))*100)/100:0};
 });
}
/**
 * Plan a drone source.
 * drone: {name, make, clips:[{id,name,created,duration}]}
 * cameras: [{name, make, anchor (camera clock at master 0), zone (or null), placed}]
 * opts: {musicDuration, frame, flightGap, learned: {key: {offset, at}} (remembered corrections, see offsetKey)}
 * Returns {reference, droneZone, refZone, clips:[{id,name,flight,start,status,reason}], flights:[...] , warnings:[...]}
 */
function planDrone(drone,cameras,opts){
 opts=opts||{};var gap=Number(opts.flightGap)||FLIGHT_GAP,music=Number(opts.musicDuration)||0,frame=Number(opts.frame)||0,warnings=[];
 var dz=deviceZone(drone.clips),ref=chooseReference(cameras,drone.make,dz);
 if(!ref)return {reference:null,clips:(drone.clips||[]).map(function(c){return {id:c.id,name:c.name,flight:-1,start:null,status:'excluded',reason:'no audio-synced camera with a trusted clock to bridge from'};}),flights:[],warnings:['No camera clock to bridge from: sync at least one camera by audio with its clock trusted.']};
 var rz=ref.zone===null||ref.zone===undefined?null:ref.zone;
 if(dz===null||rz===null){warnings.push('Time zone not found in file names; assuming the drone and '+ref.name+' clocks use the same zone.');dz=0;rz=0;}
 // A correction the user made before for this drone and reference camera: applied to every clip.
 var key=offsetKey(drone,ref),day=shootDay(drone.clips),memo=key&&opts.learned?pickMemo(opts.learned[key],day):null,learned=memo?{key:key,offset:memo.offset,at:memo.at,day:memo.day}:null;
 var masterStartWall=ref.anchor+rz-(learned?learned.offset:0),clips=(drone.clips||[]).filter(function(c){return num(c.created)&&c.duration>0;}).slice().sort(function(a,b){return a.created-b.created;});
 // Flights: a new flight starts after a recording gap longer than `gap` seconds.
 var flight=0,prevEnd=null,out=[],flights=[];
 clips.forEach(function(c){
  var wall=c.created+dz;if(prevEnd!==null&&wall-prevEnd>gap)flight++;prevEnd=wall+c.duration;
  var start=wall-masterStartWall+HALF_SECOND;if(frame)start=Math.round(start/frame)*frame;
  var row={id:c.id,name:c.name,flight:flight,start:Math.round(start*1e6)/1e6,duration:c.duration,status:'placed',reason:''};
  // duration is the end of the used range in file time; sourceIn its start (track sources use part of a file).
  // The host drops a piece under half a frame after rounding its In up and Out down to whole frames: 2.5 frames keeps
  // every planned clip placeable, so the drone's correction buttons never ask for a clip that was not built.
  if(music&&(start+(c.sourceIn||0)>=music||start+c.duration<=(frame?frame*2.5:0))){row.status='excluded';row.reason='camera clock places it outside the music';}
  out.push(row);
  if(!flights[flight])flights[flight]={flight:flight,clips:0,placed:0,first:start,last:start+c.duration};
  var f=flights[flight];f.clips++;if(row.status==='placed')f.placed++;f.first=Math.min(f.first,start);f.last=Math.max(f.last,start+c.duration);
 });
 (drone.clips||[]).forEach(function(c){if(!(num(c.created)&&c.duration>0))out.push({id:c.id,name:c.name,flight:-1,start:null,status:'excluded',reason:'no camera clock in this file'});});
 var others=clockReport(cameras,ref).filter(function(r){return r.name!==ref.name&&Math.abs(r.differsFromReference)>2;});
 others.forEach(function(r){warnings.push(r.name+' clock is '+Math.abs(r.differsFromReference).toFixed(1)+' s '+(r.differsFromReference<0?'behind ':'ahead of ')+ref.name+'; the drone follows '+ref.name+'. If the drone is off, correct one drone clip.');});
 return {reference:ref.name,referenceMake:ref.make||'',key:key,shootDay:day,learned:learned,droneZone:dz,refZone:rz,masterStartWall:masterStartWall,clips:out,flights:flights.filter(Boolean),warnings:warnings};
}
/** After the user moved one clip of a flight: the offset to apply to the other clips of that flight. */
function flightCorrection(plan,clipId,actualStart){
 var row=null;(plan&&plan.clips||[]).forEach(function(r){if(String(r.id)===String(clipId))row=r;});
 if(!row||row.start===null)throw Error('This clip is not part of a drone flight in the plan.');
 var delta=Number(actualStart)-row.start;if(!isFinite(delta))throw Error('Invalid clip position.');
 return {flight:row.flight,delta:Math.round(delta*1e6)/1e6,clips:plan.clips.filter(function(r){return r.flight===row.flight&&r.status==='placed'&&String(r.id)!==String(clipId);}).map(function(r){return {id:r.id,from:r.start,to:Math.round((r.start+delta)*1e6)/1e6};})};
}

var api={FLIGHT_GAP:FLIGHT_GAP,makeFromProbe:makeFromProbe,modelFromProbe:modelFromProbe,serialFromProbe:serialFromProbe,offsetKey:offsetKey,shootDay:shootDay,pickMemo:pickMemo,nameLocalTime:nameLocalTime,zoneOffset:zoneOffset,deviceZone:deviceZone,chooseReference:chooseReference,clockReport:clockReport,planDrone:planDrone,flightCorrection:flightCorrection};
root.RPDroneSync=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
}(typeof window!=='undefined'?window:globalThis));
