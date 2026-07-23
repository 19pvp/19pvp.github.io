local WsgBalance = {}

local function shuffle(values)
    for i = #values, 2, -1 do
        local j = math.random(i)
        values[i], values[j] = values[j], values[i]
    end
end

local function scoreLess(left, right)
    if left.splitGroups ~= right.splitGroups then
        return left.splitGroups < right.splitGroups
    end
    if left.splitPlayers ~= right.splitPlayers then
        return left.splitPlayers < right.splitPlayers
    end
    return left.factionMoves < right.factionMoves
end

local function groupCandidates(group)
    local nativeAlliance = {}
    local nativeHorde = {}

    for _, queuedPlayer in ipairs(group.players) do
        local nativeTeam = queuedPlayer.nativeTeam
        assert(nativeTeam == 0 or nativeTeam == 1, "nativeTeam must be 0 or 1")
        table.insert(nativeTeam == 0 and nativeAlliance or nativeHorde, queuedPlayer)
    end

    shuffle(nativeAlliance)
    shuffle(nativeHorde)

    local candidates = {}
    local groupSize = #group.players
    for allianceCount = 0, groupSize do
        local allianceNativesKept = math.min(allianceCount, #nativeAlliance)
        local hordeMovedToAlliance = allianceCount - allianceNativesKept
        local assignments = {}

        for i, queuedPlayer in ipairs(nativeAlliance) do
            table.insert(assignments, { player = queuedPlayer.player, team = i <= allianceNativesKept and 0 or 1 })
        end
        for i, queuedPlayer in ipairs(nativeHorde) do
            table.insert(assignments, { player = queuedPlayer.player, team = i <= hordeMovedToAlliance and 0 or 1 })
        end

        candidates[#candidates + 1] = {
            allianceCount = allianceCount,
            assignments = assignments,
            splitGroups = allianceCount > 0 and allianceCount < groupSize and 1 or 0,
            splitPlayers = math.min(allianceCount, groupSize - allianceCount),
            factionMoves = math.abs(allianceCount - #nativeAlliance),
        }
    end

    return candidates
end

local function shouldReplace(current, candidate)
    return not current or scoreLess(candidate.score, current.score)
        or (not scoreLess(current.score, candidate.score) and math.random(2) == 1)
end

function WsgBalance.assign(groups, currentAlliance, currentHorde, lastFavoredTeam)
    currentAlliance = currentAlliance or 0
    currentHorde = currentHorde or 0

    local incomingPlayers = 0
    for _, group in ipairs(groups) do
        incomingPlayers = incomingPlayers + #group.players
    end
    local totalPlayers = currentAlliance + currentHorde + incomingPlayers

    local states = {
        [0] = {
            score = { splitGroups = 0, splitPlayers = 0, factionMoves = 0 },
        },
    }

    shuffle(groups)
    for _, group in ipairs(groups) do
        local nextStates = {}
        for allianceBefore, previous in pairs(states) do
            for _, candidate in ipairs(groupCandidates(group)) do
                local allianceAfter = allianceBefore + candidate.allianceCount
                local nextState = {
                    previous = previous,
                    candidate = candidate,
                    score = {
                        splitGroups = previous.score.splitGroups + candidate.splitGroups,
                        splitPlayers = previous.score.splitPlayers + candidate.splitPlayers,
                        factionMoves = previous.score.factionMoves + candidate.factionMoves,
                    },
                }
                if shouldReplace(nextStates[allianceAfter], nextState) then
                    nextStates[allianceAfter] = nextState
                end
            end
        end
        states = nextStates
    end

    local candidateIncoming = {}
    for aInc = 0, incomingPlayers do
        if states[aInc] then
            local aFinal = currentAlliance + aInc
            local hFinal = currentHorde + (incomingPlayers - aInc)
            local diff = math.abs(aFinal - hFinal)
            table.insert(candidateIncoming, { aInc = aInc, diff = diff, state = states[aInc] })
        end
    end

    local minDiff = math.huge
    for _, item in ipairs(candidateIncoming) do
        if item.diff < minDiff then
            minDiff = item.diff
        end
    end

    local validCandidates = {}
    for _, item in ipairs(candidateIncoming) do
        if item.diff == minDiff then
            table.insert(validCandidates, item)
        end
    end

    local bestItem = nil
    for _, item in ipairs(validCandidates) do
        if not bestItem then
            bestItem = item
        else
            if scoreLess(item.state.score, bestItem.state.score) then
                bestItem = item
            elseif not scoreLess(bestItem.state.score, item.state.score) then
                if lastFavoredTeam == 0 and item.aInc > bestItem.aInc then
                    bestItem = item
                elseif lastFavoredTeam == 1 and item.aInc < bestItem.aInc then
                    bestItem = item
                elseif lastFavoredTeam == nil and math.random(2) == 1 then
                    bestItem = item
                end
            end
        end
    end

    local best = bestItem and bestItem.state
    local assignments = {}
    while best and best.candidate do
        for _, assignment in ipairs(best.candidate.assignments) do
            assignments[#assignments + 1] = assignment
        end
        best = best.previous
    end

    shuffle(assignments)
    
    local newAlliance = currentAlliance + (bestItem and bestItem.aInc or 0)
    local newHorde = currentHorde + (incomingPlayers - (bestItem and bestItem.aInc or 0))
    local nextFavoredTeam = nil
    if newAlliance < newHorde then
        nextFavoredTeam = 0
    elseif newHorde < newAlliance then
        nextFavoredTeam = 1
    else
        nextFavoredTeam = lastFavoredTeam
    end

    return assignments, nextFavoredTeam
end

WsgBalance.scoreLess = scoreLess
WsgBalance.groupCandidates = groupCandidates

function WsgBalance.groupQueuedPlayers(queuedPlayers)
    local groupsByKey = {}
    local groups = {}

    for _, player in ipairs(queuedPlayers) do
        local group = type(player.GetGroup) == "function" and player:GetGroup() or nil
        local key
        if group then
            key = "group:" .. tostring(group:GetGUID())
        elseif type(player.GetGUID) == "function" then
            key = "solo:" .. tostring(player:GetGUID())
        elseif type(player.GetGUIDLow) == "function" then
            key = "solo:" .. tostring(player:GetGUIDLow())
        elseif type(player) == "table" and player.name then
            key = "solo:" .. tostring(player.name)
        else
            key = "solo:" .. tostring(player)
        end

        if not groupsByKey[key] then
            groupsByKey[key] = { players = {} }
            groups[#groups + 1] = groupsByKey[key]
        end

        local pObj = player.player or player
        local team = player.nativeTeam or (type(player.GetTeam) == "function" and player:GetTeam() or 0)
        table.insert(groupsByKey[key].players, {
            player = pObj,
            nativeTeam = team,
        })
    end

    return groups
end

function WsgBalance.calculateBotTargets(realAlliance, realHorde, minPlayersPerTeam)
    minPlayersPerTeam = minPlayersPerTeam or 5
    realAlliance = realAlliance or 0
    realHorde = realHorde or 0

    -- If no real players remain in the BG (0 real players total), all bots must leave
    if realAlliance == 0 and realHorde == 0 then
        return 0, 0
    end

    local targetAlliance = math.max(0, minPlayersPerTeam - realAlliance)
    local targetHorde = math.max(0, minPlayersPerTeam - realHorde)

    return targetAlliance, targetHorde
end

function WsgBalance.computeBotActions(roster, minPlayersPerTeam)
    minPlayersPerTeam = minPlayersPerTeam or 5
    local toRemove = {}
    local toAdd = { [0] = 0, [1] = 0 }

    local realAlliance = (roster[0] and roster[0].realCount) or 0
    local realHorde = (roster[1] and roster[1].realCount) or 0

    local targetAllianceBots, targetHordeBots = WsgBalance.calculateBotTargets(realAlliance, realHorde, minPlayersPerTeam)
    local desiredBots = { [0] = targetAllianceBots, [1] = targetHordeBots }

    for team = 0, 1 do
        local tData = roster[team] or { realCount = 0, bots = {} }
        local currentBots = tData.bots or {}
        local currentBotCount = #currentBots
        local targetBotCount = desiredBots[team]

        if currentBotCount > targetBotCount then
            local removeCount = currentBotCount - targetBotCount
            for i = 1, removeCount do
                table.insert(toRemove, currentBots[i])
            end
        elseif currentBotCount < targetBotCount then
            toAdd[team] = targetBotCount - currentBotCount
        end
    end

    return {
        toRemove = toRemove,
        toAdd = toAdd,
    }
end

function WsgBalance.extractRoster(map)
    if not map or type(map.GetPlayers) ~= "function" then return nil end

    local roster = {
        [0] = { realCount = 0, bots = {} },
        [1] = { realCount = 0, bots = {} },
    }

    for _, p in ipairs(map:GetPlayers()) do
        local team = type(p.GetBgTeamId) == "function" and p:GetBgTeamId() or (p.team or 0)
        if team == 0 or team == 1 then
            local isBot = type(p.IsBot) == "function" and p:IsBot() or (p.isBot == true)
            if isBot then
                table.insert(roster[team].bots, p)
            else
                roster[team].realCount = roster[team].realCount + 1
            end
        end
    end

    return roster
end

function WsgBalance.computeMapBotActions(map, minPlayersPerTeam)
    local roster = WsgBalance.extractRoster(map)
    if not roster then
        return { toRemove = {}, toAdd = { [0] = 0, [1] = 0 } }
    end
    return WsgBalance.computeBotActions(roster, minPlayersPerTeam)
end

WsgBalance.assignOngoing = WsgBalance.assign

return WsgBalance
