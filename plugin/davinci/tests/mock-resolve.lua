-- Lua mock of the DaVinci Resolve scripting API subset used by the bridge snippets, plus a fusion:SetPrefs /
-- SavePrefs that writes a Fusion.prefs-style file. Behaviour copied from the live Resolve 21.1 Free probe:
-- AppendToTimeline endFrame EXCLUSIVE; CreateEmptyTimeline makes the new timeline current at the project frame rate;
-- SetSetting works after useCustomSettings=1; API lists carry a "__flags" number.
-- Globals expected: MOCK_MODEL (table), RP_PREFS_PATH (string). Defines: resolve, fusion, MOCK (state for the dump).
local M = MOCK_MODEL
MOCK = { ops = 0, appends = {}, renders = {}, deletedJobs = {}, deletedTimelines = {}, deletedItems = {}, uid = 0 }

local function flags(list) list.__flags = 0; return list end
local function uid(p) MOCK.uid = MOCK.uid + 1; return p .. MOCK.uid end

-- media pool items
local mpis, byId = {}, {}
for _, m in ipairs(M.media) do
  local o = { data = m }
  function o:GetUniqueId() return self.data.id end
  function o:GetName() return self.data.id end
  function o:GetClipProperty(name)
    local p = { ["File Path"] = self.data.path or "", FPS = self.data.fps, Type = self.data.type, Start = self.data.start }
    if name then return p[name] end
    p.__flags = 0
    return p
  end
  mpis[#mpis + 1] = o
  byId[m.id] = o
end

-- timeline items
local function new_item(d)
  local o = { d = d }
  function o:GetName() return self.d.name end
  function o:GetType() return self.d.type end
  function o:GetStart() return self.d.start end
  function o:GetEnd() return self.d["end"] end
  function o:GetDuration() return self.d["end"] - self.d.start end
  function o:GetSourceStartFrame() return self.d.srcStart end
  function o:GetSourceEndFrame() return self.d.srcEnd end
  function o:GetClipEnabled() return self.d.enabled end
  function o:GetUniqueId() return self.d.id end
  function o:GetTrackTypeAndIndex() return self.d.track and { self.d.track[1], self.d.track[2], __flags = 0 } or nil end
  function o:GetMediaPoolItem() return self.d.mpiId and byId[self.d.mpiId] or nil end
  return o
end

local project = {}
local timelines = {}

local function new_timeline(d)
  for _, tr in ipairs(d.video) do for i, it in ipairs(tr.items) do tr.items[i] = new_item(it) end end
  for _, tr in ipairs(d.audio) do for i, it in ipairs(tr.items) do tr.items[i] = new_item(it) end end
  local o = { d = d }
  function o:GetUniqueId() return self.d.id end
  function o:GetName() return self.d.name end
  function o:GetStartFrame() return self.d.start end
  function o:GetEndFrame()
    local e = self.d.start
    for _, kind in ipairs({ "video", "audio" }) do
      for _, tr in ipairs(self.d[kind]) do for _, it in ipairs(tr.items) do if it.d["end"] > e then e = it.d["end"] end end end
    end
    return e
  end
  function o:GetSetting(k)
    local map = { timelineFrameRate = "fps", timelineResolutionWidth = "width", timelineResolutionHeight = "height", useCustomSettings = "custom" }
    return self.d[map[k]]
  end
  function o:SetSetting(k, v)
    MOCK.ops = MOCK.ops + 1
    if k == "useCustomSettings" then self.d.custom = v; return true end
    if self.d.custom ~= "1" then return false end
    local map = { timelineFrameRate = "fps", timelineResolutionWidth = "width", timelineResolutionHeight = "height" }
    if not map[k] then return false end
    self.d[map[k]] = tostring(v)
    return true
  end
  function o:GetTrackCount(kind) return #self.d[kind] end
  function o:GetItemListInTrack(kind, n)
    local out = {}
    for i, it in ipairs(self.d[kind][n].items) do out[i] = it end
    return flags(out)
  end
  function o:GetIsTrackEnabled(kind, n) return self.d[kind][n].enabled ~= false end
  function o:GetIsTrackLocked(kind, n) return self.d[kind][n].locked == true end
  function o:AddTrack(kind) self.d[kind][#self.d[kind] + 1] = { enabled = true, locked = false, items = {} }; return true end
  function o:DeleteClips(items)
    for _, x in ipairs(items) do
      MOCK.deletedItems[#MOCK.deletedItems + 1] = x:GetUniqueId()
      for _, kind in ipairs({ "video", "audio" }) do
        for _, tr in ipairs(self.d[kind]) do
          for i = #tr.items, 1, -1 do if tr.items[i] == x then table.remove(tr.items, i) end end
        end
      end
    end
    return true
  end
  function o:GetMarkInOut()
    local m = { __flags = 0 }
    for k, v in pairs(self.d.marks or {}) do m[k] = { ["in"] = v["in"], out = v.out } end
    return m
  end
  function o:SetMarkInOut(a, b, kind) self.d.marks = self.d.marks or {}; self.d.marks[kind or "all"] = { ["in"] = a, out = b }; return true end
  function o:ClearMarkInOut() self.d.marks = {}; return true end
  timelines[#timelines + 1] = o
  return o
end
for _, t in ipairs(M.timelines) do new_timeline(t) end

local function find_tl(id) for _, t in ipairs(timelines) do if t.d.id == id then return t end end end
local current = find_tl(M.current)

-- folders: root holds the music, a subfolder holds the cameras (tests the recursive search)
local root, sub = {}, {}
function root:GetClipList() local out = { mpis[1] }; return flags(out) end
function root:GetSubFolderList() return flags({ sub }) end
function sub:GetClipList() local out = {}; for i = 2, #mpis do out[#out + 1] = mpis[i] end; return flags(out) end
function sub:GetSubFolderList() return flags({}) end

local pool = {}
function pool:GetRootFolder() return root end
function pool:CreateEmptyTimeline(name)
  for _, t in ipairs(timelines) do if t.d.name == name then return nil end end
  local t = new_timeline({ id = uid("tl-new-"), name = name, start = 86400, fps = M.projectFps, width = "1920", height = "1080", custom = "0",
    video = { { enabled = true, locked = false, items = {} } }, audio = { { items = {} } }, marks = {} })
  current = t
  return t
end
function pool:DeleteTimelines(list)
  for _, x in ipairs(list) do
    for i = #timelines, 1, -1 do if timelines[i] == x then table.remove(timelines, i) end end
    MOCK.deletedTimelines[#MOCK.deletedTimelines + 1] = x.d.id
  end
  return true
end
function pool:AppendToTimeline(infos)
  local out = {}
  for _, x in ipairs(infos) do
    MOCK.appends[#MOCK.appends + 1] = { timelineId = current.d.id, mpiId = x.mediaPoolItem:GetUniqueId(), startFrame = x.startFrame,
      endFrame = x.endFrame, trackIndex = x.trackIndex, recordFrame = x.recordFrame, mediaType = x.mediaType }
    local srcLen = x.endFrame - x.startFrame                             -- live: endFrame is exclusive
    local clipFps = tonumber(x.mediaPoolItem:GetClipProperty("FPS")) or 25
    local len = math.floor(srcLen * tonumber(current.d.fps) / clipFps + 0.5)   -- record frames (WAV labelled 24 fps)
    local kind = x.mediaType == 2 and "audio" or "video"
    local tracks = current.d[kind]
    if tracks[x.trackIndex] then
      local it = new_item({ id = uid("it-"), name = x.mediaPoolItem:GetUniqueId(), type = kind,
        start = x.recordFrame, ["end"] = x.recordFrame + len, srcStart = x.startFrame, srcEnd = x.startFrame + srcLen, enabled = true,
        mpiId = x.mediaPoolItem:GetUniqueId(), track = { kind, x.trackIndex } })
      local items = tracks[x.trackIndex].items
      items[#items + 1] = it
      out[#out + 1] = it
    end
  end
  return flags(out)
end

local renderFormat = { format = M.renderFormat.format, codec = M.renderFormat.codec }
local renderMode = 0
local jobs = {}
function project:GetName() return M.projectName end
function project:GetUniqueId() return "project-1" end
function project:GetSetting(k) if k == "timelineFrameRate" then return M.projectFps end end
function project:GetMediaPool() return pool end
function project:GetCurrentTimeline() return current end
function project:SetCurrentTimeline(t) current = t; return true end
function project:GetTimelineCount() return #timelines end
function project:GetTimelineByIndex(i) return timelines[i] end
function project:GetCurrentRenderFormatAndCodec() return { format = renderFormat.format, codec = renderFormat.codec, __flags = 0 } end
-- Live behaviour: setting the format that is already selected returns false (the restore must be checked by reading back).
function project:SetCurrentRenderFormatAndCodec(f, c)
  if renderFormat.format == f and renderFormat.codec == c then return false end
  renderFormat = { format = f, codec = c }; return true
end
function project:GetCurrentRenderMode() return renderMode end
function project:SetCurrentRenderMode(m) renderMode = m; return true end
function project:GetRenderCodecs() return { ["H.264"] = "H264", __flags = 0 } end
function project:SetRenderSettings(s)
  local copy = {}
  for k, v in pairs(s) do copy[k] = v end
  copy.timelineId = current.d.id
  copy.renderMode = renderMode
  MOCK.renders[#MOCK.renders + 1] = copy
  current.d.marks = { video = { ["in"] = s.MarkIn - current.d.start, out = s.MarkOut - current.d.start } }
  return true
end
function project:AddRenderJob() local id = uid("job-"); jobs[id] = { polls = 0 }; return id end
function project:StartRendering(ids) if type(ids) ~= "table" then return false end; MOCK.started = #ids; return true end
function project:GetRenderJobStatus(id)
  local j = jobs[id]
  j.polls = j.polls + 1
  if j.polls < 2 then return { JobStatus = "Rendering", CompletionPercentage = 50 } end
  return { JobStatus = "Complete", CompletionPercentage = 100 }
end
function project:IsRenderingInProgress() for _, j in pairs(jobs) do if j.polls < 2 then return true end end; return false end
function project:DeleteRenderJob(id) MOCK.deletedJobs[#MOCK.deletedJobs + 1] = id; jobs[id] = nil; return true end

local pm = {}
function pm:GetCurrentProject() return project end

resolve = {}
function resolve:GetProjectManager() return pm end
function resolve:GetProductName() return "DaVinci Resolve (mock)" end
function resolve:GetVersionString() return "21.1.0.17" end
function resolve:IsStudio() return false end

-- fusion prefs: same text layout as Fusion.prefs; MapPath("Profile:") = folder of Fusion.prefs (backslashes, like live)
local prefs = {}
fusion = {}
function fusion:MapPath(p)
  if p ~= "Profile:" then error("unexpected MapPath " .. p) end
  if rawget(_G, "RP_MOCK_PROFILE") then return RP_MOCK_PROFILE end     -- e.g. a non-ASCII profile path
  return ((RP_PREFS_PATH:match("^(.*[/\\])") or ""):gsub("/", "\\"))
end
function fusion:SetPrefs(key, value)
  local k = key:match("^Global%.RProjectBridge%.(%w+)$")
  if not k then error("unexpected prefs key " .. key) end
  prefs[k] = value
end
function fusion:GetPrefs(key)
  local k = key:match("^Global%.RProjectBridge%.(%w+)$")
  return k and prefs[k] or nil
end
function fusion:SavePrefs()
  local keys = {}
  for k in pairs(prefs) do keys[#keys + 1] = k end
  table.sort(keys)
  local lines = {}
  for _, k in ipairs(keys) do lines[#lines + 1] = "\t\t\t" .. k .. " = \"" .. tostring(prefs[k]) .. "\"," end
  local f = assert(io.open(RP_PREFS_PATH .. ".tmp", "wb"))
  f:write("{\n\tGlobal = {\n\t\tRProjectBridge = {\n" .. table.concat(lines, "\n") .. "\n\t\t},\n\t},\n}\n")
  f:close()
  os.remove(RP_PREFS_PATH)
  assert(os.rename(RP_PREFS_PATH .. ".tmp", RP_PREFS_PATH))
end

-- Minimal JSON for the dump (the bridge keeps its encoder private).
local function enc(v)
  local t = type(v)
  if t == "nil" then return "null" elseif t == "boolean" then return tostring(v)
  elseif t == "number" then return (math.floor(v) == v) and string.format("%d", v) or string.format("%.17g", v)
  elseif t == "string" then return '"' .. v:gsub('[%c"\\]', function(c) return string.format("\\u%04x", c:byte()) end) .. '"'
  elseif t == "table" then
    local n, out = 0, {}
    for _ in pairs(v) do n = n + 1 end
    if n > 0 and #v == n then for i = 1, n do out[i] = enc(v[i]) end; return "[" .. table.concat(out, ",") .. "]" end
    for k, x in pairs(v) do if type(x) ~= "function" and type(x) ~= "userdata" then out[#out + 1] = enc(tostring(k)) .. ":" .. enc(x) end end
    return "{" .. table.concat(out, ",") .. "}"
  end
  return "null"
end
MOCK.json = enc

function MOCK.dump()
  local tls = {}
  for _, t in ipairs(timelines) do
    local d = { id = t.d.id, name = t.d.name, fps = t.d.fps, marks = t.d.marks, video = {}, audio = {} }
    for _, kind in ipairs({ "video", "audio" }) do
      for n, tr in ipairs(t.d[kind]) do
        local items = {}
        for _, it in ipairs(tr.items) do items[#items + 1] = { id = it.d.id, start = it.d.start, ["end"] = it.d["end"], srcStart = it.d.srcStart } end
        d[kind][n] = { n = n, items = items }
      end
    end
    tls[#tls + 1] = d
  end
  return { timelines = tls, appends = MOCK.appends, renders = MOCK.renders, deletedJobs = MOCK.deletedJobs, renderFormat = renderFormat, renderMode = renderMode,
    deletedTimelines = MOCK.deletedTimelines, deletedItems = MOCK.deletedItems, started = MOCK.started, session = prefs.Session }
end
