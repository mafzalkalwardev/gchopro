export const CAPS_LUA = `
local now = tonumber(ARGV[1])
local minuteLimit = tonumber(ARGV[2])
local hourLimit = tonumber(ARGV[3])
local dayLimit = tonumber(ARGV[4])
local segmentLimit = tonumber(ARGV[5])
local segments = tonumber(ARGV[6])
local member = ARGV[7]
local mode = ARGV[8]
local function count(key, window)
  redis.call("ZREMRANGEBYSCORE", key, "-inf", now - window)
  return redis.call("ZCARD", key)
end
local function segmentCount(key)
  redis.call("ZREMRANGEBYSCORE", key, "-inf", now - 86400000)
  local rows = redis.call("ZRANGE", key, 0, -1)
  local total = 0
  for _, value in ipairs(rows) do
    local mark = string.find(value, ":", 1, true)
    if mark then total = total + tonumber(string.sub(value, mark + 1)) end
  end
  return total
end
local minute = count(KEYS[1], 60000)
local hour = count(KEYS[2], 3600000)
local day = count(KEYS[3], 86400000)
local used = segmentCount(KEYS[4])
if mode == "read" then
  return {1, "ok", minute, hour, day, used}
end
if minute >= minuteLimit then return {0, "rate_minute", minute, hour, day, used} end
if hour >= hourLimit then return {0, "rate_hour", minute, hour, day, used} end
if day >= dayLimit then return {0, "rate_day", minute, hour, day, used} end
if used + segments > segmentLimit then return {0, "rate_segments", minute, hour, day, used} end
if mode == "commit" then
  redis.call("ZADD", KEYS[1], now, member)
  redis.call("ZADD", KEYS[2], now, member)
  redis.call("ZADD", KEYS[3], now, member)
  redis.call("ZADD", KEYS[4], now, member .. ":" .. segments)
  redis.call("PEXPIRE", KEYS[1], 120000)
  redis.call("PEXPIRE", KEYS[2], 7200000)
  redis.call("PEXPIRE", KEYS[3], 172800000)
  redis.call("PEXPIRE", KEYS[4], 172800000)
end
return {1, "ok", minute, hour, day, used}
`;
