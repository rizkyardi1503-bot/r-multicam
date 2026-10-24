-- R Project Multicam AI - DaVinci Resolve bridge (Free and Studio) - v1.0.0
--
-- Start "R Project Engine" first, then run this from Workspace > Scripts > R Project Multicam AI.
-- This script has no UI and no editing logic of its own. It connects DaVinci to the R Project Engine:
--   engine -> DaVinci : the engine writes <Fusion profile>/RProjectBridge/cmd-<id>-<n>.lua (per-user folder).
--                       Every file must be   return "<nonce>", function(resolve, RP) ... end
--                       The outer chunk runs with an EMPTY environment; it is rejected unless it returns this
--                       session's nonce (published only in the per-user Fusion preferences) and a function.
--   DaVinci -> engine : results go to the Fusion preference Global.RProjectBridge.Response as "<id>:<n>:<hex of JSON>"
--                       (fusion:SetPrefs + SavePrefs). Hello and Beat keys report that the bridge is alive.
-- The loop ends on the engine's stop command, when another bridge session takes over, or after 8 hours idle.
-- Paths use forward slashes (backslashes in Lua strings broke parsing in Resolve).

local VERSION = "davinci-bridge-2"
local POLL = 0.1                     -- seconds between checks for the next command
local BEAT_EVERY = 30                -- polls between heartbeats (about 3 s)
local IDLE_LIMIT = 8 * 3600 / POLL   -- polls without a command before the loop ends (8 h)
local PREFIX = "Global.RProjectBridge."
local ENV = getfenv(1)               -- this script's environment (resolve, fusion, bmd, standard libraries)
local unpack = unpack or table.unpack

local RP = { unpack = unpack }

-- ------------------------------------------------------------------ JSON + hex encoders
local function json_string(s)
  s = s:gsub('[%c"\\]', function(c)
    if c == '"' then return '\\"' elseif c == '\\' then return '\\\\'
    elseif c == '\n' then return '\\n' elseif c == '\r' then return '\\r' elseif c == '\t' then return '\\t' end
    return string.format('\\u%04x', c:byte())
  end)
  return '"' .. s .. '"'
end

local function is_array(t)
  local n = 0
  for k, _ in pairs(t) do
    if type(k) ~= "number" or k < 1 or math.floor(k) ~= k then return false end
    n = n + 1
  end
  for i = 1, n do if t[i] == nil then return false end end
  return n > 0
end

local function encode(v, depth)
  depth = depth or 0
  if depth > 40 then return 'null' end
  local tv = type(v)
  if tv == "nil" then return 'null'
  elseif tv == "boolean" then return v and 'true' or 'false'
  elseif tv == "number" then
    if v ~= v or v == math.huge or v == -math.huge then return 'null' end
    if math.floor(v) == v and math.abs(v) < 1e15 then return string.format('%d', v) end
    return string.format('%.17g', v)
  elseif tv == "string" then return json_string(v)
  elseif tv == "table" then
    local out = {}
    if is_array(v) then
      for i = 1, #v do out[#out + 1] = encode(v[i], depth + 1) end
      return '[' .. table.concat(out, ',') .. ']'
    end
    for k, x in pairs(v) do
      local tx = type(x)
      if k ~= "__flags" and tx ~= "function" and tx ~= "userdata" and tx ~= "thread" then
        out[#out + 1] = json_string(tostring(k)) .. ':' .. encode(x, depth + 1)
      end
    end
    return '{' .. table.concat(out, ',') .. '}'
  end
  return 'null'
end
RP.json = encode

function RP.hex(s)
  return (s:gsub('.', function(c) return string.format('%02x', c:byte()) end))
end

-- ------------------------------------------------------------------ helpers for command snippets
-- API lists carry a "__flags" number; keep only object values, in key order.
function RP.list(t)
  local out = {}
  if type(t) ~= "table" then return out end
  local keys = {}
  for k, v in pairs(t) do
    if k ~= "__flags" and type(v) ~= "number" then keys[#keys + 1] = k end
  end
  table.sort(keys, function(a, b)
    if type(a) == type(b) then return a < b end
    return type(a) == "number"
  end)
  for _, k in ipairs(keys) do out[#out + 1] = t[k] end
  return out
end

-- Call obj:method(...) if it exists; nil instead of an error (older/newer API differences).
function RP.try(obj, method, ...)
  if obj == nil then return nil end
  local okf, f = pcall(function() return obj[method] end)
  if not okf or f == nil then return nil end
  local res = { pcall(f, obj, ...) }
  if not res[1] then return nil end
  return unpack(res, 2)
end

function RP.norm(p)
  if type(p) ~= "string" then return "" end
  return (p:gsub("\\", "/"):lower())
end

function RP.project()
  local pm = resolve and resolve:GetProjectManager()
  local project = pm and pm:GetCurrentProject()
  if not project then error("Open a project in DaVinci Resolve first.", 0) end
  return project
end

function RP.find_timeline(project, id)
  local n = RP.try(project, "GetTimelineCount") or 0
  for i = 1, n do
    local tl = project:GetTimelineByIndex(i)
    if tl and RP.try(tl, "GetUniqueId") == id then return tl end
  end
  return nil
end

function RP.clip_path(mpi)
  local p = RP.try(mpi, "GetClipProperty", "File Path")
  if type(p) == "table" then p = p["File Path"] end
  return type(p) == "string" and p or ""
end

-- Media pool items by unique id and by File Path, across all folders. Cached between commands; rebuilt when the
-- project or the number of clips changes, or when force is set (a lookup missed).
local media_cache = nil
function RP.media_index(project, force)
  local clips, folders = {}, 0
  local function walk(folder, depth)
    if not folder or depth > 50 then return end
    folders = folders + 1
    for _, c in ipairs(RP.list(RP.try(folder, "GetClipList"))) do clips[#clips + 1] = c end
    for _, sub in ipairs(RP.list(RP.try(folder, "GetSubFolderList"))) do walk(sub, depth + 1) end
  end
  walk(project:GetMediaPool():GetRootFolder(), 0)
  local key = tostring(RP.try(project, "GetUniqueId") or project:GetName()) .. "|" .. #clips .. "|" .. folders
  if media_cache and media_cache.key == key and not force then return media_cache end
  local idx = { key = key, byId = {}, byPath = {} }
  for _, c in ipairs(clips) do
    local id = RP.try(c, "GetUniqueId")
    if id then idx.byId[id] = c end
    local p = RP.norm(RP.clip_path(c))
    if p ~= "" and not idx.byPath[p] then idx.byPath[p] = c end
  end
  media_cache = idx
  return idx
end

-- ------------------------------------------------------------------ prefs channel
local function setpref(key, value) fusion:SetPrefs(PREFIX .. key, value) end
local function getpref(key) local ok, v = pcall(function() return fusion:GetPrefs(PREFIX .. key) end); if ok then return v end end
local function save() fusion:SavePrefs() end

-- Per-session id (persistent counter, survives restarts of the script) and a secret nonce.
local function entropy()
  local parts = {}
  pcall(function() parts[#parts + 1] = tostring(os.time()) end)
  pcall(function() parts[#parts + 1] = string.format("%.6f", os.clock()) end)
  parts[#parts + 1] = tostring({}) .. tostring(function() end) .. tostring(parts)
  pcall(function() parts[#parts + 1] = tostring(bmd.getappuuid()) end)
  return table.concat(parts, "|")
end
local function make_nonce()
  local seed = 0
  local e = entropy()
  for i = 1, #e do seed = (seed * 31 + e:byte(i)) % 2147483647 end
  pcall(function() seed = (seed + math.floor(os.clock() * 1e6)) % 2147483647 end)
  math.randomseed(seed)
  for _ = 1, 10 do math.random() end
  local out = {}
  for i = 1, 32 do
    local r = math.random(0, 15)
    local b = e:byte((i * 7) % #e + 1) or 0
    out[i] = string.format("%x", (r + b) % 16)
  end
  return table.concat(out)
end

local session = tonumber(getpref("Session")) or 0
session = session + 1
setpref("Session", tostring(session))
local NONCE = make_nonce()
local ID = "s" .. session .. "x" .. NONCE:sub(1, 6)   -- public (file names); the full nonce is never in a file name
local nextN = 1
local beats = 0

-- Per-user command folder next to Fusion.prefs. Never a shared/public folder.
-- loadfile/fileexists use the ANSI code page, so a profile path with non-ASCII characters (e.g. a user name with
-- accents) cannot be used directly: then both sides use ProgramData/RProjectMulticam/bridge-<hash of the profile
-- path>, which R Project Engine restricts to the current user. The engine computes the same name (lib/bridge.js).
local PROFILE = (tostring(fusion:MapPath("Profile:") or ""):gsub("\\", "/")):gsub("/+$", "")
local function path_hash(s)
  local h1, h2 = 5381, 0
  for i = 1, #s do
    local b = s:byte(i)
    h1 = (h1 * 33 + b) % 4294967296
    h2 = (h2 * 131 + b) % 4294967296
  end
  return string.format("%08x%08x", h1, h2)
end
local DIR
if PROFILE:find("[^\32-\126]") then
  local pd = "C:/ProgramData"
  pcall(function() local v = os.getenv("ProgramData"); if v and v ~= "" then pd = v end end)
  local key = PROFILE:gsub("[A-Z]", function(c) return string.char(c:byte() + 32) end)
  DIR = (pd:gsub("\\", "/")):gsub("/+$", "") .. "/RProjectMulticam/bridge-" .. path_hash(key)
else
  DIR = PROFILE .. "/RProjectBridge"
end
local dir_ok = PROFILE ~= "" and (DIR:match("^%a:/") or DIR:match("^/")) and not DIR:lower():find("/users/public/", 1, true)

local function beat(state)
  beats = beats + 1
  setpref("Beat", ID .. ":" .. nextN .. ":" .. beats .. ":" .. (state or "idle"))
end

local function hello()
  local info = { version = VERSION, id = ID, nonce = NONCE, session = session, dir = DIR }
  if not dir_ok then info.error = "Unsafe or unknown command folder: " .. DIR end
  pcall(function()
    info.product = resolve:GetProductName()
    info.resolve = resolve:GetVersionString()
    info.studio = RP.try(resolve, "IsStudio")
    local project = resolve:GetProjectManager():GetCurrentProject()
    info.project = project and project:GetName()
    local tl = project and project:GetCurrentTimeline()
    info.timeline = tl and tl:GetName()
  end)
  setpref("Hello", ID .. ":" .. RP.hex(encode(info)))
  setpref("Response", "")
  beat("hello")
  save()
end

local function respond(n, payload)
  local ok, text = pcall(encode, payload)
  if not ok then text = encode({ ok = false, error = "Could not encode the result: " .. tostring(text) }) end
  setpref("Response", ID .. ":" .. n .. ":" .. RP.hex(text))
  beat("idle")
  save()
end

-- Load a command file safely: outer chunk in an empty environment, must return (NONCE, function).
local function run_command(path)
  local chunk, err = loadfile(path)
  if not chunk then return { ok = false, error = "Command did not load: " .. tostring(err) } end
  setfenv(chunk, {})
  local ok, tag, body = pcall(chunk)
  if not ok or tag ~= NONCE or type(body) ~= "function" then
    return { ok = false, error = "Command rejected (not from this R Project Engine session)." }
  end
  setfenv(body, ENV)
  local ok2, result = pcall(body, resolve, RP)
  if ok2 then return { ok = true, result = result } end
  return { ok = false, error = tostring(result) }
end

-- ------------------------------------------------------------------ main loop
hello()
if not dir_ok then beat("stopped"); save(); return end
local idle, taken_over, awaiting_ack = 0, false, nil
while idle < IDLE_LIMIT do
  local path = DIR .. "/cmd-" .. ID .. "-" .. nextN .. ".lua"
  if bmd.fileexists(path) then
    idle = 0
    local n = nextN
    nextN = nextN + 1
    setpref("Response", "")            -- no stale answer while this command runs
    respond(n, run_command(path))
    awaiting_ack = n
    if RP.stopping then break end
  elseif awaiting_ack and bmd.fileexists(DIR .. "/ack-" .. ID .. "-" .. awaiting_ack) then
    -- The engine has read the answer: drop the (possibly large) Response from Fusion.prefs.
    awaiting_ack = nil
    setpref("Response", "")
    beat("idle"); save()
  else
    bmd.wait(POLL)
    idle = idle + 1
    if idle % BEAT_EVERY == 0 then
      -- Another bridge session took over: this loop ends.
      local h = getpref("Hello")
      if type(h) == "string" and h:sub(1, #ID + 1) ~= ID .. ":" then taken_over = true; break end
      beat("idle"); save()
    end
  end
end
if not taken_over then            -- never overwrite the keys of the session that took over
  setpref("Response", "")
  beat("stopped")
  save()
end
