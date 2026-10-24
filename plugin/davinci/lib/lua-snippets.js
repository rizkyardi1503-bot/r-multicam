// Lua command snippets for the DaVinci bridge ("R Project Multicam AI.lua").
// Each command file is:
//   -- RPCMD {"op":...,"args":...}                (machine-readable header, used by the test mocks)
//   return "<session nonce>", function(resolve, RP)
//   local A = <args as a Lua table literal>
//   <operation body>                               (returns a plain table -> JSON response)
//   end
// The bridge runs the outer chunk with an empty environment and only accepts it when the nonce matches.
// Every operation that edits refuses to touch the original timeline (A.origId).
'use strict';

// JS value -> Lua 5.1 literal. Strings are escaped byte-safe; NaN/Infinity become nil.
function toLua(v, depth = 0) {
  if (depth > 40) throw Error('toLua: structure too deep');
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'nil';
  if (typeof v === 'string') return luaString(v);
  if (Array.isArray(v)) return '{' + v.map((x) => toLua(x, depth + 1)).join(', ') + '}';
  if (typeof v === 'object') {
    const parts = [];
    for (const k of Object.keys(v)) { if (v[k] !== undefined) parts.push('[' + luaString(k) + ']=' + toLua(v[k], depth + 1)); }
    return '{' + parts.join(', ') + '}';
  }
  throw Error('toLua: unsupported type ' + typeof v);
}
function luaString(s) {
  const bytes = Buffer.from(String(s), 'utf8');
  let out = '"';
  for (const b of bytes) {
    if (b === 0x22) out += '\\"';
    else if (b === 0x5c) out += '\\\\';
    else if (b === 0x0a) out += '\\n';
    else if (b === 0x0d) out += '\\r';
    else if (b < 0x20 || b >= 0x7f) out += '\\' + String(b).padStart(3, '0');   // control + non-ASCII bytes: pure ASCII file
    else out += String.fromCharCode(b);
  }
  return out + '"';
}

// Shared Lua helper: make A.timelineId current and verify it really is (AppendToTimeline/render use the current one).
const OPEN_TL = `
local function open_timeline(project, id, what)
  local tl = RP.find_timeline(project, id)
  if not tl then error("The " .. what .. " timeline was not found.", 0) end
  if not project:SetCurrentTimeline(tl) then error("Could not open the " .. what .. " timeline.", 0) end
  local cur = project:GetCurrentTimeline()
  if not cur or cur:GetUniqueId() ~= id then error("The current timeline is not the " .. what .. " timeline; nothing was changed.", 0) end
  return tl
end`;

const SETTINGS = '{ "timelineFrameRate", "timelineResolutionWidth", "timelineResolutionHeight", "timelineDropFrameTimecode" }';

const BODIES = {
  ping: `
local project = RP.project()
local tl = project:GetCurrentTimeline()
return { project = project:GetName(), timeline = tl and tl:GetName() or nil }`,

  stop: `
RP.stopping = true
return { stopping = true }`,

  // Only the fields the engine needs. Media pool item properties are read once per media file.
  snapshot: `
local project = RP.project()
local tl = project:GetCurrentTimeline()
if not tl then error("Open a timeline in DaVinci Resolve first.", 0) end
local mpis = {}
local function mpi_info(mpi)
  local id = RP.try(mpi, "GetUniqueId") or tostring(mpi)
  if not mpis[id] then
    local p = RP.try(mpi, "GetClipProperty")
    if type(p) ~= "table" then p = {} end
    mpis[id] = { id = id, path = p["File Path"], fps = p["FPS"], type = p["Type"], start = p["Start"] }
  end
  return mpis[id]
end
local function item_info(it)
  local info = { name = RP.try(it, "GetName"), type = RP.try(it, "GetType"), start = RP.try(it, "GetStart"),
    ["end"] = RP.try(it, "GetEnd"), duration = RP.try(it, "GetDuration"), srcStart = RP.try(it, "GetSourceStartFrame"),
    srcEnd = RP.try(it, "GetSourceEndFrame"), enabled = RP.try(it, "GetClipEnabled"), id = RP.try(it, "GetUniqueId") }
  local mpi = RP.try(it, "GetMediaPoolItem")
  if mpi then info.mpi = mpi_info(mpi) end
  return info
end
local settings = {}
for _, k in ipairs(${SETTINGS}) do settings[k] = RP.try(tl, "GetSetting", k) end
local out = { project = project:GetName(), projectFps = RP.try(project, "GetSetting", "timelineFrameRate"),
  timeline = { id = tl:GetUniqueId(), name = tl:GetName(), start = tl:GetStartFrame(), ["end"] = tl:GetEndFrame(), settings = settings },
  timelineNames = {}, audioTracks = tl:GetTrackCount("audio"), audio = {}, video = {} }
for i = 1, (RP.try(project, "GetTimelineCount") or 0) do
  local t = project:GetTimelineByIndex(i)
  if t then out.timelineNames[#out.timelineNames + 1] = t:GetName() end
end
if out.audioTracks >= 1 then
  for _, it in ipairs(RP.list(tl:GetItemListInTrack("audio", 1))) do out.audio[#out.audio + 1] = item_info(it) end
end
for n = 1, tl:GetTrackCount("video") do
  local tr = { n = n, enabled = RP.try(tl, "GetIsTrackEnabled", "video", n), locked = RP.try(tl, "GetIsTrackLocked", "video", n), items = {} }
  for _, it in ipairs(RP.list(tl:GetItemListInTrack("video", n))) do tr.items[#tr.items + 1] = item_info(it) end
  out.video[#out.video + 1] = tr
end
return out`,

  create_timeline: `
local project = RP.project()
local mp = project:GetMediaPool()
local tl = mp:CreateEmptyTimeline(A.name)
if not tl then error("Could not create the timeline " .. A.name, 0) end
local id = tl:GetUniqueId()
if id == A.origId then error("Internal error: the new timeline has the original timeline's id.", 0) end
local applied = {}
RP.try(tl, "SetSetting", "useCustomSettings", "1")
for _, k in ipairs(${SETTINGS}) do
  if A.settings[k] ~= nil then applied[k] = RP.try(tl, "SetSetting", k, tostring(A.settings[k])) and true or false end
end
local setCurrent = project:SetCurrentTimeline(tl) and true or false
local cur = project:GetCurrentTimeline()
local guard = 0
while tl:GetTrackCount("video") < A.videoTracks and guard < 64 do tl:AddTrack("video"); guard = guard + 1 end
if tl:GetTrackCount("audio") < 1 then tl:AddTrack("audio", "stereo") end
return { id = id, name = tl:GetName(), start = tl:GetStartFrame(), fps = RP.try(tl, "GetSetting", "timelineFrameRate"),
  width = RP.try(tl, "GetSetting", "timelineResolutionWidth"), height = RP.try(tl, "GetSetting", "timelineResolutionHeight"),
  setCurrent = setCurrent, currentId = cur and cur:GetUniqueId() or "", video = tl:GetTrackCount("video"),
  audio = tl:GetTrackCount("audio"), applied = applied }`,

  delete_timeline: `
if A.id == A.origId then error("Refusing to delete the original timeline.", 0) end
local project = RP.project()
local tl = RP.find_timeline(project, A.id)
if not tl then return { deleted = false } end
return { deleted = project:GetMediaPool():DeleteTimelines({ tl }) and true or false }`,

  append: `
if A.timelineId == A.origId then error("Refusing to append to the original timeline.", 0) end
local project = RP.project()
local mp = project:GetMediaPool()${OPEN_TL}
open_timeline(project, A.timelineId, "new")
local idx = RP.media_index(project)
local function lookup(x) return (x.mpiId and idx.byId[x.mpiId]) or idx.byPath[RP.norm(x.path)] end
local infos = {}
for i, x in ipairs(A.items) do
  local mpi = lookup(x)
  if not mpi then idx = RP.media_index(project, true); mpi = lookup(x) end
  if not mpi then error("Media pool item not found: " .. tostring(x.path), 0) end
  infos[i] = { mediaPoolItem = mpi, startFrame = x.startFrame, endFrame = x.endFrame, trackIndex = x.trackIndex,
    recordFrame = x.recordFrame, mediaType = x.mediaType }
end
local res = RP.list(mp:AppendToTimeline(infos))
local out = {}
for i, it in ipairs(res) do
  local ti = RP.try(it, "GetTrackTypeAndIndex")
  out[i] = { id = RP.try(it, "GetUniqueId"), start = RP.try(it, "GetStart"), duration = RP.try(it, "GetDuration"),
    srcStart = RP.try(it, "GetSourceStartFrame"), trackType = type(ti) == "table" and ti[1] or nil, trackIndex = type(ti) == "table" and ti[2] or nil }
end
return { requested = #infos, count = #res, items = out }`,

  delete_items: `
if A.timelineId == A.origId then error("Refusing to delete clips from the original timeline.", 0) end
local project = RP.project()
local tl = RP.find_timeline(project, A.timelineId)
if not tl then error("The new timeline was not found.", 0) end
local want, found = {}, {}
for _, id in ipairs(A.ids) do want[id] = true end
for _, kind in ipairs({ "video", "audio" }) do
  for n = 1, tl:GetTrackCount(kind) do
    for _, it in ipairs(RP.list(tl:GetItemListInTrack(kind, n))) do
      if want[RP.try(it, "GetUniqueId")] then found[#found + 1] = it end
    end
  end
end
local ok = #found > 0 and tl:DeleteClips(found, false) or false
return { requested = #A.ids, found = #found, deleted = ok and true or false }`,

  // Read what Best Drops will change, so cleanup can always restore it.
  render_save: `
local project = RP.project()${OPEN_TL}
local tl = open_timeline(project, A.timelineId, "render")
return { format = RP.try(project, "GetCurrentRenderFormatAndCodec"), mode = RP.try(project, "GetCurrentRenderMode"),
  marks = RP.try(tl, "GetMarkInOut") }`,

  render_start: `
local project = RP.project()${OPEN_TL}
open_timeline(project, A.timelineId, "render")
RP.try(project, "SetCurrentRenderMode", 1)
if not project:SetCurrentRenderFormatAndCodec(A.format, A.codec) then
  local codecs = {}
  for desc, name in pairs(RP.try(project, "GetRenderCodecs", A.format) or {}) do
    if desc ~= "__flags" then codecs[#codecs + 1] = tostring(name) end
  end
  return { jobs = {}, error = "Could not select " .. A.format .. " / " .. A.codec .. " for rendering. Available: " .. table.concat(codecs, ", ") }
end
local ids, rejected = {}, {}
for i, s in ipairs(A.jobs) do
  if project:SetRenderSettings(s) then
    local job = project:AddRenderJob()
    if job and job ~= "" then ids[#ids + 1] = job else rejected[#rejected + 1] = i end
  else
    rejected[#rejected + 1] = i
  end
end
local started = false
if #ids > 0 then
  started = project:StartRendering(ids) and true or false
  if not started then started = project:StartRendering(RP.unpack(ids)) and true or false end
end
return { jobs = ids, rejected = rejected, started = started }`,

  render_poll: `
local project = RP.project()
local status = {}
for _, id in ipairs(A.jobs) do
  local st = RP.try(project, "GetRenderJobStatus", id) or {}
  status[id] = { JobStatus = st.JobStatus, CompletionPercentage = st.CompletionPercentage, Error = st.Error }
end
return { inProgress = project:IsRenderingInProgress() and true or false, status = status }`,

  render_cleanup: `
local project = RP.project()
local deleted = 0
for _, id in ipairs(A.deleteJobs or {}) do
  if RP.try(project, "DeleteRenderJob", id) then deleted = deleted + 1 end
end
local out = { deleted = deleted, formatRestored = false, modeRestored = false, marksRestored = false, notRestored = {} }
local f = A.saved and A.saved.format
if type(f) == "table" and f.format and f.codec then
  RP.try(project, "SetCurrentRenderFormatAndCodec", f.format, f.codec)
  local now = RP.try(project, "GetCurrentRenderFormatAndCodec") or {}
  out.formatRestored = now.format == f.format and now.codec == f.codec
end
if A.saved and A.saved.mode ~= nil then
  RP.try(project, "SetCurrentRenderMode", A.saved.mode)
  out.modeRestored = RP.try(project, "GetCurrentRenderMode") == A.saved.mode
end
local tl = RP.find_timeline(project, A.timelineId)
if tl and A.saved and A.saved.marks then
  RP.try(tl, "ClearMarkInOut", "all")
  out.marksRestored = true
  for _, kind in ipairs({ "video", "audio" }) do
    local r = A.saved.marks[kind]
    if r and r["in"] ~= nil and r.out ~= nil then
      out.marksRestored = (tl:SetMarkInOut(r["in"], r.out, kind) and true or false) and out.marksRestored
    elseif r and (r["in"] ~= nil or r.out ~= nil) then
      out.marksRestored = false
      out.notRestored[#out.notRestored + 1] = kind .. (r["in"] ~= nil and " Mark In only" or " Mark Out only")
    end
  end
end
return out`,
};

function build(op, args, nonce) {
  const body = BODIES[op];
  if (!body) throw Error('Unknown bridge operation: ' + op);
  if (!/^[0-9a-f]{16,64}$/.test(String(nonce || ''))) throw Error('Bridge session nonce missing.');
  const header = JSON.stringify({ op, args: args || {} });
  // The header is one comment line (JSON never contains a raw newline).
  return '-- RPCMD ' + header + '\nreturn "' + nonce + '", function(resolve, RP)\nlocal A = ' + toLua(args || {}) + '\n' + body.trim() + '\nend\n';
}

function parseHeader(text) {
  const m = /^-- RPCMD (.*)$/m.exec(text);
  return m ? JSON.parse(m[1]) : null;
}
function parseNonce(text) {
  const m = /^return "([0-9a-f]+)", function\(resolve, RP\)$/m.exec(text);
  return m ? m[1] : null;
}

module.exports = { build, parseHeader, parseNonce, toLua, luaString, OPS: Object.keys(BODIES) };
