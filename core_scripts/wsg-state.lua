local WsgState = {}

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
    }
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

function WsgState.forEachPlayers(state, instanceId, callback, onUnavailable)
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

function WsgState.forEachActiveBattlegrounds(state, callback)
    if not state or type(callback) ~= "function" then return end

    for instanceId in pairs(state.activeBGInstances) do
        local players = {}
        WsgState.forEachPlayers(state, instanceId, function(player)
            if type(player.InBattleground) ~= "function"
                or type(player.GetBattlegroundId) ~= "function"
                or not player:InBattleground()
                or player:GetBattlegroundId() ~= instanceId then
                return
            end

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
end

return WsgState
