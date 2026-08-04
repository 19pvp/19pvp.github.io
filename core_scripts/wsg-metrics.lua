print("[Metrics] Loading metrics.lua script...")

-- Global storage for active match state partitioned by the globally unique
-- server instanceId. Each entry contains kind and players.
local matches = {}
local arenaInvites = {}
-- aura pointer string -> { stats, type = "HARD"|"SOFT", startTime = ms }
local activeCCs = {}
-- aura pointer string -> { stats, effectIndex, initialAmount }
local activeAbsorbs = {}
-- playerGuidString -> flagCarryStartTime
local flagCarryStartTimes = {}
local WSG_MAP_ID = 489
local WSG_BG_TYPE_ID = 2
local PREPARATION_AURA = 44521
local HORDE_FLAG = 23333
local ALLIANCE_FLAG = 23335
local ARENA_PREPARATION_AURA = 32727
local WINNER_ARENA_POINTS = 10
local LOSER_ARENA_POINTS = 5
local WSG_FLAG_AURAS = { [HORDE_FLAG] = true, [ALLIANCE_FLAG] = true }
local NO_FAKE_CAST_CLASSES = { [WARRIOR] = true, [HUNTER] = true, [ROGUE] = true }

local function isFlagCarrier(player)
    return player:HasAura(HORDE_FLAG) or player:HasAura(ALLIANCE_FLAG)
end

local function isMatchStarted(player)
    return not player:HasAura(PREPARATION_AURA)
end

-- Return the active WSG instance for a player, or nil when metrics should not run.
local function getWSGInstanceId(player)
    if not player:InBattleground() or player:GetMapId() ~= WSG_MAP_ID then return nil end
    if not isMatchStarted(player) then return nil end

    local instanceId = player:GetBattlegroundId()
    if not instanceId or instanceId == 0 then return nil end
    return instanceId
end

local function getOrCreateMatch(kind, instanceId)
    local match = matches[instanceId]
    if match then return match.kind == kind and match or nil end
    match = { kind = kind, instanceId = instanceId, players = {}, createdAt = GetCurrTime() }
    matches[instanceId] = match
    return match
end

local function arenaLog(message, data)
    print("[Arena Metrics][DEBUG] " .. message .. " -> " .. inspect(data))
end

local function pendingArenaInvites(instanceId)
    local count = 0
    for _, invitedInstanceId in pairs(arenaInvites) do
        if invitedInstanceId == instanceId then count = count + 1 end
    end
    return count
end

local function findArenaMatch(player, instanceId)
    local guid = tostring(player:GetGUID())
    if not instanceId or instanceId == 0 then instanceId = arenaInvites[guid] or player:GetBattlegroundId() end
    local match = instanceId and matches[instanceId]
    if match and match.kind == "ARENA" then return match end

    for _, candidate in pairs(matches) do
        if candidate.kind == "ARENA" and candidate.players[guid] then
            return candidate
        end
    end
    return nil
end

-- 1. Dispel / Protective Spells definition (filtered to level 19 starting spells)
local DISPEL_PROTECTIVE_SPELLS = {
    -- Priest
    [527] = true,   -- Dispel Magic
    [528] = true,   -- Cure Disease
    -- Paladin
    [1152] = true,  -- Purify
    [1022] = true,  -- Hand of Protection
    [1044] = true,  -- Hand of Freedom
    -- Shaman
    [370] = true,   -- Purge
    [526] = true,   -- Cure Toxins
    -- Mage
    [475] = true,   -- Remove Curse
    -- Druid
    [8946] = true,  -- Cure Poison
}

-- 2. Damage-absorb aura effect type
local SPELL_AURA_SCHOOL_ABSORB = 69

-- 3. Crowd control mechanics
-- These values are the core Mechanics enum values. SpellInfo exposes them as
-- a bit mask, so every rank and every player spell is handled automatically.
local HARD_CC_MECHANICS = {
    [MECHANIC_CHARM] = true,
    [MECHANIC_DISORIENTED] = true,
    [MECHANIC_FEAR] = true,
    [MECHANIC_SILENCE] = true,
    [MECHANIC_SLEEP] = true,
    [MECHANIC_STUN] = true,
    [MECHANIC_FREEZE] = true,
    [MECHANIC_KNOCKOUT] = true,
    [MECHANIC_POLYMORPH] = true,
    [MECHANIC_BANISH] = true,
    [MECHANIC_SHACKLE] = true,
    [MECHANIC_HORROR] = true,
    [MECHANIC_SAPPED] = true,
}

local SOFT_CC_MECHANICS = {
    [MECHANIC_ROOT] = true,
    [MECHANIC_SLOW_ATTACK] = true,
    [MECHANIC_SNARE] = true,
    [MECHANIC_DAZE] = true,
}

local function newMetricStats(player, kind, teamId)
    local guid = tostring(player:GetGUID())
    local stats = {
        name = player:GetName(),
        playerGuid = guid,
        team = teamId or player:GetBgTeamId(),
        dispelsOffensive = 0,
        dispelsDefensive = 0,
        successfulInterrupts = 0,
        fakeCastInterrupts = 0,
        hardCCCount = 0,
        hardCCDuration = 0,
        softCCCount = 0,
        softCCDuration = 0,
        absorbsDone = 0,
        damageTaken = 0,
        killingBlows = 0,
        deaths = 0,
        honorableKills = 0,
        bonusHonor = 0,
        damageDone = 0,
        healingDone = 0,
        deserted = false,
        timePlayed = 0,
        _kind = kind,
        _updateTime = GetCurrTime(),
    }
    if kind == "WSG" then
        stats.healsOnFC = 0
        stats.flagCarryTime = 0
        stats.attemptsOnFlag = 0
        stats.damageOnEFC = 0
        stats.flagCaptures = 0
        stats.flagReturns = 0
    end
    return stats
end

local function updateMetricTime(stats, now, matchStarted)
    if matchStarted and stats._updateTime then
        stats.timePlayed = stats.timePlayed + (now - stats._updateTime)
    end
    stats._updateTime = now
end

local function updateScoreMetrics(stats, score)
    stats.killingBlows = score.killingBlows or 0
    stats.deaths = score.deaths or 0
    stats.honorableKills = score.honorableKills or 0
    stats.bonusHonor = score.bonusHonor or 0
    stats.damageDone = score.damageDone or 0
    stats.healingDone = score.healingDone or 0
    if stats._kind == "WSG" then
        stats.flagCaptures = score.flagCaptures or 0
        stats.flagReturns = score.flagReturns or 0
    end
end

local function finalizeMetricStats(stats)
    stats.hardCCDuration = math.floor(stats.hardCCDuration / 1000)
    stats.softCCDuration = math.floor(stats.softCCDuration / 1000)
    stats.timePlayed = math.floor(stats.timePlayed / 1000)
    stats._kind = nil
    stats._instanceId = nil
    stats._updateTime = nil
end

-- Helper to get/initialize stats for a player, partitioned by instanceId
local function getWSGStats(player, instanceId)
    if player:IsBot() then return nil end

    if not instanceId or instanceId == 0 then
        instanceId = getWSGInstanceId(player)
    elseif not isMatchStarted(player) then
        return nil
    end
    if not instanceId or instanceId == 0 then return nil end

    local match = getOrCreateMatch("WSG", instanceId)
    if not match then return nil end
    if not match.startedAt then match.startedAt = GetCurrTime() end

    local guid = tostring(player:GetGUID())
    if not match.players[guid] then
        local stats = newMetricStats(player, "WSG")
        stats._instanceId = instanceId
        match.players[guid] = stats
    end
    return match.players[guid]
end

-- Cache native battleground scores while Player userdata is still valid.
local function snapshotPlayerScore(player, instanceId)
    if player:IsBot() then return end

    if not isMatchStarted(player) then
        local guid = tostring(player:GetGUID())
        local match = instanceId and matches[instanceId]
        local stats = match and match.players[guid]
        if stats then
            updateMetricTime(stats, GetCurrTime(), false)
        end
        return
    end

    local stats = getWSGStats(player, instanceId)
    if not stats then return end

    local now = GetCurrTime()
    updateMetricTime(stats, now, true)

    local bg = GetBattleground(instanceId, WSG_BG_TYPE_ID)
    if not bg then return end

    local score = bg:GetPlayerScore(player)
    if not score then return end

    updateScoreMetrics(stats, score)
end

-- Hook: Healing on friendly flag carriers
RegisterPlayerEvent(PLAYER_EVENT_ON_HEAL, function(event, player, target, heal)
    local stats = getWSGStats(player)
    if not stats then return end
    local targetPlayer = target and target:ToPlayer()
    if not targetPlayer then return end
    -- If friendly target has either flag, track it as healing on friendly flag carrier
    if isFlagCarrier(targetPlayer) then
        stats.healsOnFC = stats.healsOnFC + heal
    end
end)

-- Hook: Track player desertion and total play time when leaving
RegisterPlayerEvent(PLAYER_EVENT_ON_LEAVE_BG, function(event, player, mapId, instanceId, bg)
    local stats = getWSGStats(player, instanceId)
    if not stats then return end
    -- Record play time up to the point they left
    local now = GetCurrTime()
    local match = matches[stats._instanceId]
    local matchStart = match and match.startedAt or stats._updateTime or now
    updateMetricTime(stats, now, true)
    if not bg then return end
    local status = bg:GetStatus()
    if status >= STATUS_WAIT_LEAVE then return end
    -- Store the exact second of the match when they deserted
    stats.deserted = math.floor((now - matchStart) / 1000)
end)

-- Hook: Send aggregated stats as web event at the end of the BG match
RegisterBGEvent(BG_EVENT_ON_END, function(event, bg, bgId, instanceId, winner)
    local match = matches[instanceId]
    if not match or match.kind ~= "WSG" then return end
    local currentMatchStats = match.players

    -- Format flag carrying time (convert ms to seconds) and CC duration
    for _, stats in pairs(currentMatchStats) do
        stats.flagCarryTime = math.floor(stats.flagCarryTime / 1000)
        finalizeMetricStats(stats)
    end

    print("[WSG Metrics] Closing match instance -> " .. inspect({ instanceId = instanceId, winner = winner }))
    SendWebEvent('PVP_BG_STATS', nil, {
        instanceId = instanceId,
        winner = winner,
        players = currentMatchStats,
    })

    -- Clear stats only for this specific match instance
    matches[instanceId] = nil
end)

local function getMatch(player, instanceId, allowInvite)
    if not allowInvite and not player:InArena() then return nil end

    instanceId = instanceId or player:GetBattlegroundId()
    if not instanceId or instanceId == 0 then return nil end

    local match = getOrCreateMatch("ARENA", instanceId)
    if not match then return nil end
    return match
end

local function addParticipant(player, instanceId, allowInvite, teamId)
    local match = getMatch(player, instanceId, allowInvite)
    if not match then return nil end

    local guid = tostring(player:GetGUID())
    local stats = match.players[guid]
    if not stats then
        stats = newMetricStats(player, "ARENA", teamId)
        stats._guid = player:GetGUID()
        stats.deserted = -1
        -- Set by PLAYER_EVENT_ON_LEAVE_BG after the original queue group is restored.
        stats.queuedWithGroup = false
        stats.left = false
        match.players[guid] = stats
    elseif teamId then
        stats.team = teamId
    end
    return match, stats
end

local function snapshotArenaScore(player, instanceId, bg)
    instanceId = instanceId or player:GetBattlegroundId()
    local match, stats = addParticipant(player, instanceId)
    if not match then return end

    bg = bg or GetBattleground(instanceId, player:GetBattlegroundTypeId())
    if not bg then return end

    local score = bg:GetPlayerScore(player)
    if not score then return end

    updateMetricTime(stats, GetCurrTime(), match.startedAt ~= nil)
    updateScoreMetrics(stats, score)
end

local function finishArenaMatch(match, winner, duration, reason)
    if not match or match.finished then return end
    match.finished = true
    match.winner = winner

    for _, stats in pairs(match.players) do
        local points = 0
        local entered = stats.deserted == false or stats.timePlayed > 0
        if entered and not stats.deserted then
            points = stats.team == winner and WINNER_ARENA_POINTS or LOSER_ARENA_POINTS
            local player = GetPlayerByGUID(stats._guid)
            if player then
                player:ModifyArenaPoints(points)
            else
                points = 0
            end
        end
        stats.arenaPoints = points
    end

    for _, stats in pairs(match.players) do
        finalizeMetricStats(stats)
        arenaInvites[stats.playerGuid] = nil
        stats._guid = nil
    end

    print("[Arena Metrics] Closing match instance -> " .. inspect({
        instanceId = match.instanceId,
        duration = duration,
        winner = winner,
        reason = reason,
    }))
    SendWebEvent("PVP_ARENA_STATS", nil, {
        instanceId = match.instanceId,
        bgId = match.bgId,
        duration = duration,
        winner = winner,
        players = match.players,
    })
    matches[match.instanceId] = nil
end

local function getMetricStats(player, instanceId)
    local stats = getWSGStats(player, instanceId)
    if stats then return stats end
    local _, arenaStats = addParticipant(player, instanceId)
    return arenaStats
end

-- Common combat metrics for every supported battleground type.
RegisterPlayerEvent(PLAYER_EVENT_ON_SPELL_CAST, function(event, player, spell, skipCheck)
    local stats = getMetricStats(player)
    if not stats then return end

    local spellId = spell:GetEntry()
    local target = spell:GetTarget()
    local targetPlayer = target and target:ToPlayer()
    if DISPEL_PROTECTIVE_SPELLS[spellId] and targetPlayer then
        if player:GetTeam() == targetPlayer:GetTeam() then
            stats.dispelsDefensive = stats.dispelsDefensive + 1
        else
            stats.dispelsOffensive = stats.dispelsOffensive + 1
        end
    end
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_INTERRUPT_CAST, function(event, interrupter, target, targetWasCasting, successful)
    local interrupterStats = getMetricStats(interrupter)
    if successful and interrupterStats then
        interrupterStats.successfulInterrupts = interrupterStats.successfulInterrupts + 1
    end

    if not target or targetWasCasting or interrupter:IsBot() or NO_FAKE_CAST_CLASSES[target:GetClass()] then return end
    local targetStats = getMetricStats(target)
    if targetStats then
        targetStats.fakeCastInterrupts = targetStats.fakeCastInterrupts + 1
    end
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_AURA_APPLY, function(event, player, aura)
    local playerStats = getMetricStats(player)
    local spellId = aura:GetAuraId()
    if not spellId then return end

    if WSG_FLAG_AURAS[spellId] then
        if not playerStats or playerStats._kind ~= "WSG" then return end
        local guid = tostring(player:GetGUID())
        if not flagCarryStartTimes[guid] then
            playerStats.attemptsOnFlag = playerStats.attemptsOnFlag + 1
            flagCarryStartTimes[guid] = GetCurrTime()
        end
        return
    end

    local caster = aura:GetCaster()
    local casterPlayer = caster and caster:ToPlayer()
    if caster and not casterPlayer then
        local owner = caster:GetOwner()
        if owner then casterPlayer = owner:ToPlayer() end
    end
    if not casterPlayer then return end

    local casterStats = getMetricStats(casterPlayer)
    if not casterStats then return end

    local spellInfo = GetSpellInfo(spellId)
    if not spellInfo then return end

    local mechanicMask = spellInfo:GetAllEffectsMechanicMask()
    mechanicMask = type(mechanicMask) == "number" and mechanicMask or tonumber(tostring(mechanicMask))
    local ccType
    for mechanic in pairs(HARD_CC_MECHANICS) do
        if mechanicMask and math.floor(mechanicMask / (2 ^ mechanic)) % 2 == 1 then
            ccType = "HARD"
            break
        end
    end
    if not ccType then
        for mechanic in pairs(SOFT_CC_MECHANICS) do
            if mechanicMask and math.floor(mechanicMask / (2 ^ mechanic)) % 2 == 1 then
                ccType = "SOFT"
                break
            end
        end
    end

    local absorbEffectIndex
    for effectIndex = 0, 2 do
        if spellInfo:GetEffectApplyAuraName(effectIndex) == SPELL_AURA_SCHOOL_ABSORB then
            absorbEffectIndex = effectIndex
            break
        end
    end
    local absorbAmount = absorbEffectIndex and aura:GetEffectAmount(absorbEffectIndex)
    local auraKey = tostring(aura)
    if ccType and not activeCCs[auraKey] then
        activeCCs[auraKey] = {
            stats = casterStats,
            type = ccType,
            startTime = GetCurrTime(),
        }
    end
    if absorbEffectIndex and absorbAmount and absorbAmount > 0 and not activeAbsorbs[auraKey] then
        activeAbsorbs[auraKey] = {
            stats = casterStats,
            effectIndex = absorbEffectIndex,
            initialAmount = absorbAmount,
        }
    end
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_AURA_REMOVE, function(event, player, aura, remove_mode)
    local playerStats = getMetricStats(player)
    local auraKey = tostring(aura)
    local now = GetCurrTime()

    local ccEntry = activeCCs[auraKey]
    if ccEntry then
        local duration = now - ccEntry.startTime
        if duration > 0 then
            if ccEntry.type == "HARD" then
                ccEntry.stats.hardCCCount = ccEntry.stats.hardCCCount + 1
                ccEntry.stats.hardCCDuration = ccEntry.stats.hardCCDuration + duration
            elseif ccEntry.type == "SOFT" then
                ccEntry.stats.softCCCount = ccEntry.stats.softCCCount + 1
                ccEntry.stats.softCCDuration = ccEntry.stats.softCCDuration + duration
            end
        end
        activeCCs[auraKey] = nil
    end

    local absorbEntry = activeAbsorbs[auraKey]
    if absorbEntry then
        local remainingAmount = aura:GetEffectAmount(absorbEntry.effectIndex)
        local absorbedAmount = math.max(absorbEntry.initialAmount - remainingAmount, 0)
        if absorbedAmount > 0 then
            absorbEntry.stats.absorbsDone = absorbEntry.stats.absorbsDone + absorbedAmount
            if playerStats then
                playerStats.damageTaken = playerStats.damageTaken + absorbedAmount
            end
        end
        activeAbsorbs[auraKey] = nil
    end

    local spellId = aura:GetAuraId()
    if playerStats and playerStats._kind == "WSG" and spellId and WSG_FLAG_AURAS[spellId] then
        local guid = tostring(player:GetGUID())
        local startTime = flagCarryStartTimes[guid]
        if startTime then
            local elapsed = now - startTime
            if elapsed > 0 then
                playerStats.flagCarryTime = playerStats.flagCarryTime + elapsed
            end
            flagCarryStartTimes[guid] = nil
        end
    end
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_DAMAGE, function(event, player, target, damage)
    local targetPlayer = target and target:ToPlayer()
    if not targetPlayer then return end

    local victimStats = getMetricStats(targetPlayer)
    if victimStats then
        victimStats.damageTaken = victimStats.damageTaken + damage
    end

    local attackerStats = getWSGStats(player)
    if attackerStats and isFlagCarrier(targetPlayer) then
        attackerStats.damageOnEFC = attackerStats.damageOnEFC + damage
    end
end)

-- Score objects are deleted when a player leaves, so keep the last native
-- scoreboard values while the player is still in either match type.
CreateLuaEvent(function()
    for _, player in ipairs(GetPlayersInWorld()) do
        if player:InBattleground() and player:GetMapId() == WSG_MAP_ID then
            local instanceId = player:GetBattlegroundId()
            if instanceId then snapshotPlayerScore(player, instanceId) end
        elseif player:InArena() then
            snapshotArenaScore(player)
        end
    end
end, 500, 0)

local function recordQueueGroup(match, player, stats)
    local group = player:GetGroup()
    if not group then
        stats.queuedWithGroup = false
        return
    end

    local members = group:GetMembers()
    if #members < 2 then
        stats.queuedWithGroup = false
        return
    end

    local leaderGuid = group:GetLeaderGUID()
    local captainGuidLow
    for _, member in ipairs(members) do
        if tostring(member:GetGUID()) == tostring(leaderGuid) then
            captainGuidLow = member:GetGUIDLow()
            break
        end
    end
    if not captainGuidLow then return end

    stats.queuedWithGroup = true
    stats.queueCaptainGuidLow = captainGuidLow

    -- Mark every participant from the same original group, including players
    -- who have not left the arena yet.
    for _, member in ipairs(members) do
        if member then
            local memberStats = match.players[tostring(member:GetGUID())]
            if memberStats then
                memberStats.queuedWithGroup = true
                memberStats.queueCaptainGuidLow = captainGuidLow
            end
        end
    end
end

-- The invitation is the participation boundary. Players who refuse or time
-- out are kept in match.players even though they never enter the arena.
RegisterPlayerEvent(PLAYER_EVENT_ON_BG_INVITE, function(event, player, mapId, instanceId, bg, teamId)
    local match, stats = addParticipant(player, instanceId, true, teamId)
    arenaLog("Invite", {
        player = player:GetName(),
        instanceId = instanceId,
        team = teamId,
        tracked = match ~= nil,
    })
    if match and stats then
        stats.deserted = -1
        arenaInvites[tostring(player:GetGUID())] = instanceId
    end
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_ENTER_BG, function(event, player, mapId, instanceId)
    local match, stats = addParticipant(player, instanceId)
    arenaLog("Enter", {
        player = player:GetName(),
        instanceId = instanceId,
        tracked = match ~= nil,
        team = stats and stats.team,
    })
    if stats then stats.deserted = false end
    arenaInvites[tostring(player:GetGUID())] = nil
end)

-- The preparation aura is removed when the arena actually begins. This keeps
-- duration independent of the time spent waiting in the arena instance.
RegisterPlayerEvent(PLAYER_EVENT_ON_AURA_REMOVE, function(event, player, aura)
    if not player:InArena() or aura:GetAuraId() ~= ARENA_PREPARATION_AURA then return end

    local match = getMatch(player)
    arenaLog("Preparation removed", {
        player = player:GetName(),
        instanceId = player:GetBattlegroundId(),
        tracked = match ~= nil,
    })
    if match and not match.startedAt then
        local now = GetCurrTime()
        match.startedAt = now
        for _, stats in pairs(match.players) do
            updateMetricTime(stats, now, false)
        end
    end
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_LEAVE_BG, function(event, player, mapId, instanceId, bg)
    local match = matches[instanceId]
    arenaLog("Leave", {
        player = player:GetName(),
        instanceId = instanceId,
        mapId = mapId,
        bgFound = bg ~= nil,
        status = bg and bg:GetStatus(),
        tracked = match and match.kind == "ARENA" or false,
    })
    if not match or match.kind ~= "ARENA" then return end

    local stats = match.players[tostring(player:GetGUID())]
    if not stats then return end
    local now = GetCurrTime()
    updateMetricTime(stats, now, match.startedAt ~= nil)
    stats.left = true
    if bg and bg:GetStatus() < STATUS_WAIT_LEAVE then
        stats.deserted = match.startedAt and math.floor((now - match.startedAt) / 1000) or 0
    end
    recordQueueGroup(match, player, stats)
end)

RegisterPlayerEvent(PLAYER_EVENT_ON_BG_QUEUE_LEAVE, function(event, player, mapId, instanceId, bg, teamId)
    local guid = tostring(player:GetGUID())
    mapId = mapId or (bg and bg:GetMapId())
    if not instanceId or instanceId == 0 then instanceId = bg and bg:GetInstanceId() end
    local match = findArenaMatch(player, instanceId)
    if match then instanceId = match.instanceId end
    local stats
    if not match and mapId and mapId ~= WSG_MAP_ID and instanceId and instanceId ~= 0 then
        match, stats = addParticipant(player, instanceId, true, teamId)
    end
    arenaLog("Queue leave", {
        player = player:GetName(),
        mapId = mapId,
        eventInstanceId = instanceId,
        team = teamId,
        bgFound = bg ~= nil,
        instanceId = instanceId,
        inviteFound = arenaInvites[guid] ~= nil,
        matchFound = match ~= nil,
    })
    if not match then return end
    arenaInvites[guid] = nil

    stats = stats or match.players[guid]
    if not stats then return end
    stats.left = true
    stats.deserted = -1
    recordQueueGroup(match, player, stats)

    local pending = pendingArenaInvites(instanceId)
    arenaLog("Queue leave recorded", {
        instanceId = instanceId,
        team = stats.team,
        pendingInvites = pending,
        playerTimePlayed = stats.timePlayed,
    })
end)

RegisterBGEvent(BG_EVENT_ON_END, function(event, bg, bgId, instanceId, winner)
    local match = matches[instanceId]
    arenaLog("Battleground end", {
        instanceId = instanceId,
        bgId = bgId,
        winner = winner,
        tracked = match and match.kind == "ARENA" or false,
    })
    if not match or match.kind ~= "ARENA" then return end

    local map = GetMapById(bg:GetMapId(), instanceId)
    if map then
        for _, player in ipairs(map:GetPlayers()) do
            snapshotArenaScore(player, instanceId, bg)
            local stats = match.players[tostring(player:GetGUID())]
            if stats then recordQueueGroup(match, player, stats) end
        end
    end

    match.endedAt = GetCurrTime()
    match.winner = winner
    match.bgId = bgId
    local startedAt = match.startedAt or match.createdAt
    local duration = math.max(0, math.floor((match.endedAt - startedAt) / 1000))
    finishArenaMatch(match, winner, duration, "completed")
end)

-- By PRE_DESTROY all players have gone through the leave hook, so queue-group
-- information is available even for players who stayed until the match ended.
RegisterBGEvent(BG_EVENT_ON_PRE_DESTROY, function(event, bg, bgId, instanceId)
    local match = matches[instanceId]
    arenaLog("Battleground pre-destroy", {
        instanceId = instanceId,
        bgId = bgId,
        tracked = match and match.kind == "ARENA" or false,
        ended = match and match.endedAt ~= nil or false,
    })
    if not match or match.kind ~= "ARENA" or not match.endedAt then return end

    local endedAt = match.endedAt
    local startedAt = match.startedAt or match.createdAt
    local duration = math.max(0, math.floor((endedAt - startedAt) / 1000))
    finishArenaMatch(match, match.winner, duration, "pre_destroy_fallback")
end)

-- DEBUG
RegisterPlayerEvent(PLAYER_EVENT_ON_CHAT, function(event, player, msg, Type, lang)
    if not msg or msg:sub(1, 8):lower() ~= "?metrics" then return end
    local suffix = msg:sub(9)
    if suffix ~= "" and not suffix:match("^%s") then return end

    local query = suffix:match("^%s*(.-)%s*$")
    local instanceId = player:GetBattlegroundId()
    local match = instanceId and matches[instanceId]
    if not match then
        instanceId = arenaInvites[tostring(player:GetGUID())]
        match = instanceId and matches[instanceId]
    end
    local currentMatchStats = match and match.players
    if not currentMatchStats then
        player:SendBroadcastMessage("[Metrics] No metrics available for this match yet.")
        return false
    end

    local label = match.kind == "ARENA" and "Arena" or "WSG"
    local metricKey = query ~= "" and query or nil
    local found = false
    for _, stats in pairs(currentMatchStats) do
        local value = metricKey and stats[metricKey] or stats
        local hasValue = not metricKey or (value ~= nil and value ~= false and value ~= 0 and value ~= "")
        if hasValue then
            found = true
            if metricKey then
                player:SendBroadcastMessage("[" .. label .. " Metrics] " .. stats.name .. " -> " .. metricKey .. " = " .. inspect(value))
            else
                player:SendBroadcastMessage("[" .. label .. " Metrics] " .. stats.name .. " -> " .. inspect(stats))
            end
        end
    end

    if metricKey and not found then
        player:SendBroadcastMessage("[" .. label .. " Metrics] No players accumulated this metric yet.")
    elseif not metricKey and not found then
        player:SendBroadcastMessage("[" .. label .. " Metrics] No players are tracked in this match yet.")
    end

    return false
end)
