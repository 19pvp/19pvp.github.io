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

function WsgBalance.assign(groups)
    local totalPlayers = 0
    local states = {
        [0] = {
            score = { splitGroups = 0, splitPlayers = 0, factionMoves = 0 },
        },
    }

    shuffle(groups)
    for _, group in ipairs(groups) do
        totalPlayers = totalPlayers + #group.players
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

    local lowerTarget = math.floor(totalPlayers / 2)
    local upperTarget = math.ceil(totalPlayers / 2)
    local best = states[lowerTarget]
    if upperTarget ~= lowerTarget and shouldReplace(best, states[upperTarget]) then
        best = states[upperTarget]
    end

    local assignments = {}
    while best and best.candidate do
        for _, assignment in ipairs(best.candidate.assignments) do
            assignments[#assignments + 1] = assignment
        end
        best = best.previous
    end

    shuffle(assignments)
    return assignments
end

return WsgBalance
