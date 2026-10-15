#!/usr/bin/env python3
"""v2.3.11.5 stability patch for jsx/host.jsx (Windows + macOS).

1. Resume on Windows: snapshot camera signature normalises paths exactly like rp_cameraMediaSignature.
2. In/Out: AI plan points are clipped to the sequence In/Out (plus In/Out boundaries) before staging,
   so applying no longer fails with "Edit point outside sequence In/Out".
3. Untouched intervals keep the user's own disabled state instead of re-enabling clips.
4. Too many sequence markers no longer disables the whole panel.
5. Unsupported razor frame rates are rejected before any edit instead of at the first razor.
6. A backup copy of the sequence is made before the AI plan is applied (non-fatal if it fails).
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parents[1] / "plugin"
EDITS = [
    # 0 declare step range cache (was read before first assignment -> ReferenceError in rp_begin)
    ("function rp_gc(){try{rp_stepRanges=null;", "var rp_stepRanges=null;\nfunction rp_gc(){try{rp_stepRanges=null;"),
    # 1
    ("for(c=0;c<tr.clips.length;c++){var f=String(tr.clips[c].file||'');if(f&&!seen[f]){seen[f]=1;files.push(f);}}",
     "for(c=0;c<tr.clips.length;c++){var f=String(tr.clips[c].file||'');if(f){f=f.replace(/\\\\/g,'/');if($.os&&String($.os).toLowerCase().indexOf('windows')>=0)f=f.toLowerCase();}if(f&&!seen[f]){seen[f]=1;files.push(f);}}"),
    # 2
    (" var points=rp_parseInternalPoints(csv,a1.frame,a1.duration);\n return rp_buildAISnapshot(points,a1.signature,'internal');",
     " var points=rp_parseInternalPoints(csv,a1.frame,a1.duration);\n"
     " var range=rp_processingRange(app.project.activeSequence),pe=a1.frame/4;\n"
     " if(range.selected){var inside=[],pi;for(pi=0;pi<points.length;pi++)if(points[pi]>range.start+pe&&points[pi]<range.end-pe)inside.push(points[pi]);points=inside;if(range.start>pe)points.unshift(range.start);if(range.end<a1.duration-pe)points.push(range.end);if(!points.length)throw Error('No music cuts fall inside the sequence In/Out. Widen In/Out or clear it.');}\n"
     " return rp_buildAISnapshot(points,a1.signature,'internal');"),
    # 3
    ("  if(first===last)continue;\n  var task={identity:rp_clipIdentity(clip)",
     "  if(first===last)continue;\n  if(clip.disabled&&j.winners[first]<0)continue;\n  var task={identity:rp_clipIdentity(clip)"),
    # 4
    ("try{var s=app.project.activeSequence,marks=s?rp_manual(s):{points:[],ignored:0};",
     "try{var s=app.project.activeSequence,marks={points:[],ignored:0};if(s){try{marks=rp_manual(s);}catch(me){marks={points:[],ignored:0};}}"),
    # 5a helper
    ("function rp_razorAt(j,index,time){",
     "function rp_razorFormat(frame){var fps=1/frame,formats=[[24,100],[25,101],[30000/1001,103],[30,104],[50,105],[60000/1001,107],[60,108],[24000/1001,110],[48,113]],k;for(k=0;k<formats.length;k++)if(Math.abs(fps-formats[k][0])<0.005)return formats[k][1];return null;}\n"
     "function rp_razorAt(j,index,time){"),
    # 5b early check
    (" var duration=rp_duration(s),frame=rp_frame(s),tracks=[],v;\n if(!isFinite(duration)||duration<=0)throw Error('Invalid sequence duration.');",
     " var duration=rp_duration(s),frame=rp_frame(s),tracks=[],v;\n if(!isFinite(duration)||duration<=0)throw Error('Invalid sequence duration.');\n"
     " if(kind!=='delete'&&rp_razorFormat(frame)===null)throw Error('Sequence frame rate '+Math.round(100/frame)/100+' fps is not supported yet. Use 23.976, 24, 25, 29.97, 30, 48, 50, 59.94 or 60 fps. No edits were made.');"),
    # 6 backup
    ("  if(String(rp_a1Snapshot().signature)!==String(p.a1Signature))throw Error('A1 changed. Analyze the music again.');\n  var result=rp_startJob(",
     "  if(String(rp_a1Snapshot().signature)!==String(p.a1Signature))throw Error('A1 changed. Analyze the music again.');\n"
     "  try{live.clone();var back=app.project.activeSequence;if(!back||String(back.sequenceID)!==String(p.sequenceID))app.project.openSequence(String(p.sequenceID));}catch(be){}\n"
     "  if(!app.project.activeSequence||String(app.project.activeSequence.sequenceID)!==String(p.sequenceID))throw Error('Could not return to the original sequence after backup. No edits were made.');\n"
     "  var result=rp_startJob("),
]

for plat in ("windows", "macos"):
    f = ROOT / plat / "Plugin" / "jsx" / "host.jsx"
    src = f.read_text(encoding="utf-8")
    for old, new in EDITS:
        n = src.count(old)
        if n != 1:
            sys.exit(f"{plat}: expected 1 match, found {n}: {old[:70]!r}")
        src = src.replace(old, new)
    f.write_text(src, encoding="utf-8")
    m = ROOT / plat / "Plugin" / "CSXS" / "manifest.xml"
    ms = m.read_text(encoding="utf-8")
    if 'Version="[22.0,26.99]"' in ms:
        m.write_text(ms.replace('Version="[22.0,26.99]"', 'Version="[22.0,99.9]"'), encoding="utf-8")
    print(plat, "patched")
