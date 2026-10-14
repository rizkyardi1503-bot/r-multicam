#!/usr/bin/env python3
"""One-off patch: Camera Role Contrast for ai-director.js (Windows + macOS).

Reads the shot size (wide / medium / close) and direction (behind, left, right, front,
top, crowd, side) from each Camera Role line and never cuts between two cameras of the
same kind (e.g. wide -> wide) when another covered camera is available.
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
HELPERS = r"""
function roleProfile(role){
 var s=' '+String(role||'').toLowerCase().replace(/[^a-z0-9]+/g,' ')+' ',size=null,dir=null;
 if(/ (medium|mid) wide | mws | medium long /.test(s))size='wide';
 else if(/ (wide|master|establish|establishing|full|long|lebar|ws|drone|aerial|overview) /.test(s))size='wide';
 else if(/ (medium|mid|ms|half) /.test(s))size='medium';
 else if(/ (close|closeup|cu|ecu|tight|detail|insert|deck|decks|mixer|cdj|cdjs|hands?|tangan|face|wajah) /.test(s))size='close';
 if(/ (behind|rear|back|belakang) /.test(s))dir='behind';
 else if(/ (left|kiri) /.test(s))dir='left';
 else if(/ (right|kanan) /.test(s))dir='right';
 else if(/ (front|depan) /.test(s))dir='front';
 else if(/ (top|overhead|drone|aerial|atas) /.test(s))dir='top';
 else if(/ (crowd|audience|penonton) /.test(s))dir='crowd';
 else if(/ (side|samping|stage) /.test(s))dir='side';
 return {size:size,dir:dir};
}
function roleConflict(a,b){
 if(!a||!b)return false;
 if(a.size&&b.size)return a.size===b.size;
 if(a.dir&&b.dir)return a.dir===b.dir;
 return false;
}
function camerasConflict(roleMap,x,y){return x>=0&&y>=0&&x!==y&&roleConflict(roleProfile(roleMap&&roleMap[x]),roleProfile(roleMap&&roleMap[y]));}
function contrastPool(cands,last,roleMap){
 var src=(cands||[]).slice();if(!(last>=0))return src;
 var out=src.filter(function(c){return c!==last&&!camerasConflict(roleMap,last,c);});
 return out.length?out:src;
}
// Final pass: a physical cut must not join two cameras of the same kind (wide -> wide,
// close -> close, behind -> behind). Whole shots are swapped, so shot lengths, exact-drop
// cameras and the 4-beat / max-hold rules stay as they were.
function enforceRoleContrast(choices,intervals,enabledCameras,roleMap){
 var out=choices.map(function(c){return Object.assign({},c);}),repairs=0,warnings=[];
 function runs(){var r=[];for(var i=0;i<out.length;i++){var cam=Number(out[i].camera),last=r[r.length-1];if(last&&last.camera===cam)last.end=i;else r.push({start:i,end:i,camera:cam});}return r;}
 function locked(run){for(var j=run.start;j<=run.end;j++)if(/^(drop|drop-force)$/.test(String(out[j].structureLock||'')))return true;return false;}
 function covering(run){var pool=null;for(var j=run.start;j<=run.end;j++){var c=filterEnabledCameras(intervals[j]&&intervals[j].candidates||[],enabledCameras);pool=pool===null?c:pool.filter(function(x){return c.indexOf(x)>=0;});}return pool||[];}
 function seconds(cam){var t=0;for(var j=0;j<out.length;j++)if(Number(out[j].camera)===cam)t+=Math.max(0,Number(intervals[j].end)-Number(intervals[j].start));return t;}
 function replace(run,prev,next){
  if(locked(run))return false;
  var opts=covering(run).filter(function(c){return c!==run.camera&&(!prev||c!==prev.camera)&&(!next||c!==next.camera)&&!(prev&&camerasConflict(roleMap,prev.camera,c))&&!(next&&camerasConflict(roleMap,c,next.camera));});
  if(!opts.length)return false;
  opts.sort(function(a,b){return seconds(a)-seconds(b)||a-b;});
  var cam=opts[0],role=roleMap&&roleMap[cam]?' ('+roleMap[cam]+')':'';
  for(var j=run.start;j<=run.end;j++){out[j].camera=cam;out[j].reason='Camera Role Contrast: Camera '+(cam+1)+role+' replaces a same-type angle so consecutive shots change shot size/direction.';out[j].confidence='high';}
  repairs++;return true;
 }
 for(var pass=0;pass<Math.max(1,out.length);pass++){
  var r=runs(),changed=false;
  for(var i=1;i<r.length;i++){
   var a=r[i-1],b=r[i];if(!camerasConflict(roleMap,a.camera,b.camera))continue;
   if(replace(b,a,r[i+1])||replace(a,r[i-2],b)){changed=true;break;}
  }
  if(!changed)break;
 }
 var final=runs();for(var k=1;k<final.length;k++)if(camerasConflict(roleMap,final[k-1].camera,final[k].camera))warnings.push(k);
 return {choices:out,repairs:repairs,warnings:warnings};
}
"""

EDITS = [
    # helpers right after roleTags()
    ("function energyAt(music,t){", HELPERS.strip("\n") + "\nfunction energyAt(music,t){"),
    # background flow prefers a contrasting role
    ("var e=energyAt(options.music,(it.start+it.end)/2),pool=[],total=0,source=antiRepeatPool(cands,history,last),",
     "var e=energyAt(options.music,(it.start+it.end)/2),pool=[],total=0,source=contrastPool(antiRepeatPool(cands,history,last),last,roleMap),"),
    # drop / angle-change pools prefer a contrasting role
    ("if(strong.length)return strong;var different=src.filter(function(c){return c!==last;});return different.length?different:src;",
     "if(strong.length)return contrastPool(strong,last,roleMap);var different=src.filter(function(c){return c!==last;});return different.length?contrastPool(different,last,roleMap):src;"),
    # pre-drop
    ("var prePool=antiRepeatPool(pool,history,last),", "var prePool=contrastPool(antiRepeatPool(pool,history,last),last,roleMap),"),
    # final guard after the 4-beat shot guard
    ("var physical=enforceMinimumPhysicalTransitions(choices,snapshot.intervals,options.musicAnalysis||null,enabled);choices=physical.choices;",
     "var physical=enforceMinimumPhysicalTransitions(choices,snapshot.intervals,options.musicAnalysis||null,enabled);choices=physical.choices;var contrast=enforceRoleContrast(choices,snapshot.intervals,enabled,roles);choices=contrast.choices;"),
    # summary line
    ("if(options.vision)summaries.push(",
     "if(contrast.repairs)summaries.push('Camera Role Contrast: '+contrast.repairs+' shot'+(contrast.repairs===1?'':'s')+' swapped so the same type of angle (for example wide after wide) never follows itself.');if(contrast.warnings.length)summaries.push('Camera Role Contrast: '+contrast.warnings.length+' cut'+(contrast.warnings.length===1?'':'s')+' kept the same angle type because no other covered camera was available.');if(options.vision)summaries.push("),
]

for plat in ("windows", "macos"):
    p = ROOT / "plugin" / plat / "Plugin" / "ai-director.js"
    s = p.read_text(encoding="utf-8")
    if "function enforceRoleContrast" in s:
        print(f"{plat}: already patched"); continue
    for old, new in EDITS:
        if s.count(old) != 1:
            sys.exit(f"{plat}: anchor found {s.count(old)} times: {old[:60]}")
        s = s.replace(old, new)
    p.write_text(s, encoding="utf-8")
    print(f"{plat}: patched")
