local WsgState = {}

WsgState.WSG_LATE_JOIN_GRACE_SECONDS = 180
WsgState.WSG_MIN_ACTIVITY_POINTS_PER_MINUTE = 5
WsgState.WSG_FLAG_REPEAT_WINDOW_MS = 10 * 1000

local function getValue(player, methodName, fieldName)
    if type(player) ~= "table" and type(player) ~= "userdata" then return nil end
    if type(player[methodName]) == "function" then return player[methodName](player) end
    return player[fieldName]
end

local function isBot(player)
    return getValue(player, "IsBot", "isBot") == true
end

local function createState()
    return {
        pendingInvites = {},
        activeBGInstances = {},
        departedPlayers = {}, -- instanceId -> guidLow -> true; protects against stale ALE map snapshots
        participants = {}, -- instanceId -> guidLow -> participant; includes players that leave before the end
        endRewardsDistributed = {},
        activeQueueRetryAt = {},
        classCapWarnings = {},
        groupSplitWarnings = {},
        queueMidpointAlertSent = false,
        queueProjectionDirty = true,
        flagStates = {}, -- instanceId -> guidLow -> flag carry/drop state
    }
end

local function getFlagState(state, instanceId, guidLow)
    if not state or not instanceId or instanceId <= 0 or not guidLow then return nil end

    state.flagStates = state.flagStates or {}
    state.flagStates[instanceId] = state.flagStates[instanceId] or {}
    local key = tostring(guidLow)
    state.flagStates[instanceId][key] = state.flagStates[instanceId][key] or {
        carrying = false,
        wasCarrying = false,
        awaitingRepick = false,
        lastDropAt = nil,
        repeatDrops = 0,
    }
    return state.flagStates[instanceId][key]
end

function WsgState.recordFlagPickup(state, instanceId, guidLow, now)
    local flagState = getFlagState(state, instanceId, guidLow)
    if not flagState or type(now) ~= "number" then return false, 0 end

    if flagState.carrying then return false, flagState.repeatDrops end

    local isRepick = flagState.awaitingRepick
        and flagState.lastDropAt
        and now - flagState.lastDropAt < WsgState.WSG_FLAG_REPEAT_WINDOW_MS

    if not isRepick then
        flagState.lastDropAt = nil
        flagState.repeatDrops = 0
    end

    flagState.carrying = true
    flagState.wasCarrying = false
    flagState.awaitingRepick = false
    return isRepick == true, flagState.repeatDrops
end

function WsgState.recordFlagAuraRemoved(state, instanceId, guidLow)
    local flagState = getFlagState(state, instanceId, guidLow)
    if not flagState then return false end

    flagState.wasCarrying = flagState.carrying == true
    flagState.carrying = false
    return flagState.wasCarrying
end

function WsgState.recordFlagDrop(state, instanceId, guidLow, now)
    local flagState = getFlagState(state, instanceId, guidLow)
    if not flagState or type(now) ~= "number" or not flagState.wasCarrying then
        return false, 0
    end

    if flagState.lastDropAt and now - flagState.lastDropAt < WsgState.WSG_FLAG_REPEAT_WINDOW_MS then
        flagState.repeatDrops = flagState.repeatDrops + 1
    else
        flagState.repeatDrops = 0
    end

    flagState.lastDropAt = now
    flagState.wasCarrying = false
    flagState.awaitingRepick = true
    return true, flagState.repeatDrops
end

function WsgState.create()
    return createState()
end

WsgState.shared = createState()

function WsgState.recordParticipant(state, instanceId, player, teamId)
    if not state or not player or not instanceId or instanceId <= 0 or isBot(player) then return end

    local guidLow = getValue(player, "GetGUIDLow", "guidLow")
    if not guidLow then return end

    local guid = getValue(player, "GetGUID", "guid") or guidLow
    local playerTeamId = getValue(player, "GetBgTeamId", "bgTeam")

    state.participants[instanceId] = state.participants[instanceId] or {}
    state.participants[instanceId][tostring(guidLow)] = {
        guid = guid,
        guidLow = guidLow,
        team = teamId or playerTeamId,
        name = getValue(player, "GetName", "name"),
    }
end

function WsgState.restoreFromWorld(state, bgTypeId, mapId)
    local instances = {}
    if not state or type(GetPlayersInWorld) ~= "function" then return instances end

    for _, player in ipairs(GetPlayersInWorld() or {}) do
        if not isBot(player)
            and type(player.InBattleground) == "function"
            and player:InBattleground()
            and type(player.GetBattlegroundTypeId) == "function"
            and player:GetBattlegroundTypeId() == bgTypeId
            and type(player.GetMapId) == "function"
            and player:GetMapId() == mapId
            and type(player.GetBattlegroundId) == "function" then
            local instanceId = player:GetBattlegroundId()
            if instanceId and instanceId > 0 then
                WsgState.recordParticipant(state, instanceId, player)
                instances[instanceId] = true
            end
        end
    end
    return instances
end

function WsgState.getParticipants(state, instanceId)
    if not state or not instanceId then return {} end
    return state.participants[instanceId] or {}
end

function WsgState.markPlayerDeserted(state, player, instanceId)
    if not state or not player then return false end

    local guidLow = getValue(player, "GetGUIDLow", "guidLow")
    if not guidLow then return false end

    local function markInstance(matchInstanceId)
        local participants = state.participants[matchInstanceId]
        local participant = participants and participants[tostring(guidLow)]
        if not participant then return false end
        participant.deserted = true
        return true
    end

    if instanceId and instanceId > 0 then
        return markInstance(instanceId)
    end

    for matchInstanceId in pairs(state.participants) do
        if markInstance(matchInstanceId) then return true end
    end
    return false
end

function WsgState.isDeserted(participant)
    return participant and participant.deserted == true
end

function WsgState.updateParticipationMetrics(state, instanceId, guidLow, stats)
    if not state or not instanceId or not guidLow or not stats then return false end

    local participants = state.participants[instanceId]
    local participant = participants and participants[tostring(guidLow)]
    if not participant then return false end

    participant.participation = {
        timePlayed = math.max(0, tonumber(stats.timePlayed) or 0),
        damageDone = math.max(0, tonumber(stats.damageDone) or 0),
        healingDone = math.max(0, tonumber(stats.healingDone) or 0),
        killingBlows = math.max(0, tonumber(stats.killingBlows) or 0),
        honorableKills = math.max(0, tonumber(stats.honorableKills) or 0),
        successfulInterrupts = math.max(0, tonumber(stats.successfulInterrupts) or 0),
        dispelsOffensive = math.max(0, tonumber(stats.dispelsOffensive) or 0),
        damageOnEFC = math.max(0, tonumber(stats.damageOnEFC) or 0),
        healsOnFC = math.max(0, tonumber(stats.healsOnFC) or 0),
        flagCarryTime = math.max(0, tonumber(stats.flagCarryTime) or 0),
        flagCaptures = math.max(0, tonumber(stats.flagCaptures) or 0),
        flagReturns = math.max(0, tonumber(stats.flagReturns) or 0),
    }
    return true
end

function WsgState.getParticipationScore(participation)
    if not participation then return 0 end

    return participation.damageDone / 1000
        + participation.healingDone / 1000
        + participation.killingBlows * 10
        + participation.honorableKills * 2
        + participation.successfulInterrupts * 2
        + participation.dispelsOffensive * 2
        + participation.damageOnEFC / 500
        + participation.healsOnFC / 500
        + participation.flagCarryTime / 10000
        + participation.flagCaptures * 50
        + participation.flagReturns * 20
end

function WsgState.getParticipationStatus(participant)
    if not participant then
        return { eligible = false, reason = "missing_participant", score = 0, requiredScore = 0, timePlayed = 0 }
    end
    if WsgState.isDeserted(participant) then
        return { eligible = false, reason = "deserted", score = 0, requiredScore = 0, timePlayed = 0 }
    end

    local participation = participant.participation
    if not participation then
        return { eligible = false, reason = "missing_metrics", score = 0, requiredScore = 0, timePlayed = 0 }
    end

    local timePlayed = participation.timePlayed
    local score = WsgState.getParticipationScore(participation)
    if timePlayed <= WsgState.WSG_LATE_JOIN_GRACE_SECONDS then
        return {
            eligible = true,
            reason = "late_join_grace",
            score = score,
            requiredScore = 0,
            timePlayed = timePlayed,
        }
    end

    local requiredScore = (timePlayed / 60) * WsgState.WSG_MIN_ACTIVITY_POINTS_PER_MINUTE
    return {
        eligible = score >= requiredScore,
        reason = score >= requiredScore and "activity_met" or "activity_too_low",
        score = score,
        requiredScore = requiredScore,
        timePlayed = timePlayed,
    }
end

function WsgState.isParticipationEligible(participant)
    return WsgState.getParticipationStatus(participant).eligible
end

local function isActivePlayer(state, instanceId, player, participant)
    local departed = state.departedPlayers and state.departedPlayers[instanceId]
    local guidLow = participant and participant.guidLow
    return not (departed and departed[guidLow])
        and type(player.InBattleground) == "function"
        and type(player.GetBattlegroundId) == "function"
        and player:InBattleground()
        and player:GetBattlegroundId() == instanceId
end

function WsgState.forEachParticipants(state, instanceId, callback, onUnavailable)
    if not state or not instanceId or type(callback) ~= "function"
        or type(GetPlayerByGUID) ~= "function" then
        return 0
    end

    local count = 0
    for _, participant in pairs(WsgState.getParticipants(state, instanceId)) do
        local player = GetPlayerByGUID(participant.guid)
        if player and not isBot(player) then
            callback(player, participant)
            count = count + 1
        elseif type(onUnavailable) == "function" and not player then
            onUnavailable(participant)
        end
    end
    return count
end

function WsgState.forEachActivePlayers(state, instanceId, callback, onUnavailable)
    if type(callback) ~= "function" then return 0 end
    return WsgState.forEachParticipants(state, instanceId, function(player, participant)
        if isActivePlayer(state, instanceId, player, participant) then
            callback(player, participant)
        end
    end, onUnavailable)
end

WsgState.forEachPlayers = WsgState.forEachActivePlayers

function WsgState.getActivePlayerCounts(state, instanceId)
    local counts = { [0] = 0, [1] = 0 }
    if not state or not instanceId then return counts end

    -- Participants are maintained by BG enter/leave events, so this remains
    -- independent from map snapshots and live Player object state.
    local departed = state.departedPlayers and state.departedPlayers[instanceId]
    for _, participant in pairs(WsgState.getParticipants(state, instanceId)) do
        if not (departed and departed[participant.guidLow])
            and (participant.team == 0 or participant.team == 1) then
            counts[participant.team] = counts[participant.team] + 1
        end
    end
    return counts
end

function WsgState.forEachActiveBattlegrounds(state, callback)
    if not state or type(callback) ~= "function" then return end

    for instanceId in pairs(state.activeBGInstances) do
        local players = {}
        WsgState.forEachActivePlayers(state, instanceId, function(player)
            table.insert(players, player)
        end)
        if next(players) then
            callback(instanceId, players)
        end
    end
end

function WsgState.claimEndRewards(state, instanceId)
    if not state or not instanceId or instanceId <= 0 then return false end
    if state.endRewardsDistributed[instanceId] then return false end
    state.endRewardsDistributed[instanceId] = true
    return true
end

function WsgState.clearMatch(state, instanceId)
    if not state or not instanceId or instanceId <= 0 then return end
    state.participants[instanceId] = nil
    state.departedPlayers[instanceId] = nil
    if state.flagStates then state.flagStates[instanceId] = nil end
end

return WsgState
