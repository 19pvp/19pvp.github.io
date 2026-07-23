package.path = "core_scripts/?.lua;" .. package.path

local balance = require("wsg_balance")

local function player(name, nativeTeam)
    return { player = name, nativeTeam = nativeTeam }
end

local function run(groups)
    local assignments = balance.assign(groups)
    local counts = { [0] = 0, [1] = 0 }
    local teams = {}
    for _, assignment in ipairs(assignments) do
        counts[assignment.team] = counts[assignment.team] + 1
        teams[assignment.player] = assignment.team
    end

    -- Rule 1: Never have more than 1 player difference between teams
    local diff = math.abs(counts[0] - counts[1])
    assert(diff <= 1, string.format("Team difference failed: Alliance %d vs Horde %d (diff %d > 1)", counts[0], counts[1], diff))
    
    return teams, counts
end

math.randomseed(19)

print("--- Running WSG Balance Test Suite ---")

-- 1. Unbreakable Rule: Max 1 player difference across varying player counts and party sizes
print("[Test 1] Max 1 player difference across 100 random team setups...")
for seed = 1, 100 do
    math.randomseed(seed)
    local totalPlayers = math.random(1, 20)
    local remaining = totalPlayers
    local groups = {}
    local pId = 1
    while remaining > 0 do
        local gSize = math.min(remaining, math.random(1, 5))
        local gPlayers = {}
        for i = 1, gSize do
            table.insert(gPlayers, player("p" .. pId, math.random(0, 1)))
            pId = pId + 1
        end
        table.insert(groups, { players = gPlayers })
        remaining = remaining - gSize
    end
    local _, counts = run(groups)
    assert(math.abs(counts[0] - counts[1]) <= 1)
end
print("  -> PASSED: All 100 setups respected max 1 player difference.")

-- 2. Prefer keeping groups intact when balance permits
print("[Test 2] Keep groups intact when team balance permits...")

-- 2a: 2v2 (1 Alliance party of 2, 1 Horde party of 2)
local pairMatch = run({
    { players = { player("a1", 0), player("a2", 0) } },
    { players = { player("h1", 1), player("h2", 1) } },
})
assert(pairMatch.a1 == pairMatch.a2, "Alliance group of 2 should remain intact")
assert(pairMatch.h1 == pairMatch.h2, "Horde group of 2 should remain intact")
assert(pairMatch.a1 ~= pairMatch.h1, "Alliance and Horde groups should be on opposite teams")

-- 2b: 3v3 (1 Alliance party of 3, 1 Horde party of 3)
local trioMatch = run({
    { players = { player("a1", 0), player("a2", 0), player("a3", 0) } },
    { players = { player("h1", 1), player("h2", 1), player("h3", 1) } },
})
assert(trioMatch.a1 == trioMatch.a2 and trioMatch.a2 == trioMatch.a3, "Alliance trio should remain intact")
assert(trioMatch.h1 == trioMatch.h2 and trioMatch.h2 == trioMatch.h3, "Horde trio should remain intact")
assert(trioMatch.a1 ~= trioMatch.h1, "Alliance and Horde trios should be on opposite teams")

-- 2c: 5v5 (5 Alliance party, 3 Horde party, 2 Horde party)
local raidMatch = run({
    { players = { player("a1", 0), player("a2", 0), player("a3", 0), player("a4", 0), player("a5", 0) } },
    { players = { player("h1", 1), player("h2", 1), player("h3", 1) } },
    { players = { player("h4", 1), player("h5", 1) } },
})
assert(raidMatch.a1 == raidMatch.a2 and raidMatch.a2 == raidMatch.a3 and raidMatch.a3 == raidMatch.a4 and raidMatch.a4 == raidMatch.a5, "5-player group should remain intact")
assert(raidMatch.h1 == raidMatch.h2 and raidMatch.h2 == raidMatch.h3, "3-player group should remain intact")
assert(raidMatch.h4 == raidMatch.h5, "2-player group should remain intact")
print("  -> PASSED: Groups remain intact whenever team balance permits.")

-- 3. Split groups ONLY when necessary to maintain <= 1 player diff
print("[Test 3] Split groups ONLY when necessary...")

-- 3a: 2-player group alone in queue (Total 2) -> Must split 1v1
local forcedPairSplit = run({ { players = { player("a", 0), player("b", 0) } } })
assert(forcedPairSplit.a ~= forcedPairSplit.b, "Single 2-player group alone must split to achieve 1v1")

local function isGroupSplit(teams, playerList)
    local firstTeam = teams[playerList[1]]
    for i = 2, #playerList do
        if teams[playerList[i]] ~= firstTeam then
            return true
        end
    end
    return false
end

-- 3b: 6-player group + 4-player group (Total 10) -> Must split to achieve 5v5
local forcedRaidSplit = run({
    { players = { player("a1", 0), player("a2", 0), player("a3", 0), player("a4", 0), player("a5", 0), player("a6", 0) } },
    { players = { player("h1", 1), player("h2", 1), player("h3", 1), player("h4", 1) } },
})
local aSplit = isGroupSplit(forcedRaidSplit, { "a1", "a2", "a3", "a4", "a5", "a6" })
local hSplit = isGroupSplit(forcedRaidSplit, { "h1", "h2", "h3", "h4" })
assert(aSplit or hSplit, "6v4 groups must split at least one player to achieve 5v5")
print("  -> PASSED: Groups split only when necessary.")

-- 4. Preserve native factions when balance permits
print("[Test 4] Respect native factions when balance permits...")
local nativeMatch = run({
    { players = { player("a1", 0) } },
    { players = { player("a2", 0) } },
    { players = { player("h1", 1) } },
    { players = { player("h2", 1) } },
})
assert(nativeMatch.a1 == 0 and nativeMatch.a2 == 0, "Alliance solos should stay Alliance")
assert(nativeMatch.h1 == 1 and nativeMatch.h2 == 1, "Horde solos should stay Horde")
print("  -> PASSED: Native factions preserved.")

-- 5. Split selection variation (fairness in who gets moved)
print("[Test 5] Randomized split selection fairness...")
local moved = {}
for seed = 1, 30 do
    math.randomseed(seed)
    local splitPair = run({ { players = { player("a", 0), player("b", 0) } } })
    moved[splitPair.a == 1 and "a" or "b"] = true
end
assert(moved.a and moved.b, "Split selection should vary randomly between group members")
print("  -> PASSED: Split selection is randomized.")

-- 6. Ongoing Battleground Join Balancing
print("[Test 6] Ongoing Battleground Join Balancing...")

-- Helper for ongoing BG tests
local function runOngoing(groups, curA, curH, lastFavored)
    local assignments, nextFavored = balance.assign(groups, curA, curH, lastFavored)
    local aInc, hInc = 0, 0
    local teams = {}
    for _, a in ipairs(assignments) do
        if a.team == 0 then aInc = aInc + 1 else hInc = hInc + 1 end
        teams[a.player] = a.team
    end
    local finalA = curA + aInc
    local finalH = curH + hInc
    assert(math.abs(finalA - finalH) <= 1, string.format("Ongoing BG diff failed: %dA vs %dH", finalA, finalH))
    return teams, finalA, finalH, nextFavored
end

-- 6a: 4A vs 5H, group of 2H joins -> Both added to Alliance (6A vs 5H), group kept intact
local teams6a, finalA6a, finalH6a = runOngoing({ { players = { player("h1", 1), player("h2", 1) } } }, 4, 5)
assert(finalA6a == 6 and finalH6a == 5, "4A vs 5H + 2 players must yield 6A vs 5H")
assert(teams6a.h1 == 0 and teams6a.h2 == 0, "Group of 2 joining 4A vs 5H must be added intact to Alliance")

-- 6b: 3A vs 5H, 1 player joins -> Added to Alliance (4A vs 5H)
local _, finalA6b, finalH6b = runOngoing({ { players = { player("p1", 0) } } }, 3, 5)
assert(finalA6b == 4 and finalH6b == 5, "3A vs 5H + 1 player must yield 4A vs 5H")

-- 6c: Equal teams 5A vs 5H + 1 player, lastFavoredTeam = 0 (Alliance needed) -> Added to Alliance (6A vs 5H)
local teams6c, finalA6c, finalH6c, nextFavored6c = runOngoing({ { players = { player("p1", 0) } } }, 5, 5, 0)
assert(finalA6c == 6 and finalH6c == 5, "Equal 5A vs 5H with Alliance favored must add player to Alliance")
assert(nextFavored6c == 1, "Next favored team after 6A vs 5H should be Horde (1)")

-- 6d: 4A vs 5H, group of 3 joins -> Must split (2 to Alliance, 1 to Horde) -> 6A vs 6H
local teams6d, finalA6d, finalH6d = runOngoing({ { players = { player("p1", 1), player("p2", 1), player("p3", 1) } } }, 4, 5)
assert(finalA6d == 6 and finalH6d == 6, "4A vs 5H + 3 players must yield 6A vs 6H")
local p1Team, p2Team, p3Team = teams6d.p1, teams6d.p2, teams6d.p3
assert(not (p1Team == p2Team and p2Team == p3Team), "Group of 3 joining 4A vs 5H must split to achieve 6A vs 6H")

print("  -> PASSED: Ongoing BG join balancing handles unbalance, equal teams, and group splitting.")

-- 7. Exposed Helper API Functions
print("[Test 7] Exposed API Functions (groupCandidates, scoreLess, groupQueuedPlayers, assignOngoing)...")

-- 7a: Test balance.scoreLess
assert(balance.scoreLess({ splitGroups = 0, splitPlayers = 0, factionMoves = 0 }, { splitGroups = 1, splitPlayers = 0, factionMoves = 0 }) == true)
assert(balance.scoreLess({ splitGroups = 1, splitPlayers = 0, factionMoves = 0 }, { splitGroups = 0, splitPlayers = 0, factionMoves = 0 }) == false)

-- 7b: Test balance.groupCandidates
local testGroup = { players = { player("p1", 0), player("p2", 0) } }
local candidates = balance.groupCandidates(testGroup)
assert(#candidates == 3, "2-player group must generate 3 candidates (0, 1, 2 alliance counts)")

-- 7c: Test balance.groupQueuedPlayers
local fakePlayers = {
    { player = "p1", nativeTeam = 0 },
    { player = "p2", nativeTeam = 1 },
}
local grouped = balance.groupQueuedPlayers(fakePlayers)
assert(#grouped == 2, "Solo players should form 2 distinct group buckets")

-- 7d: Test balance.assignOngoing alias
local ongoingAssignments = balance.assignOngoing({ { players = { player("p1", 0) } } }, 4, 5)
assert(#ongoingAssignments == 1 and ongoingAssignments[1].team == 0, "assignOngoing alias works correctly")

-- 8. Bot Target Calculation Tests
print("[Test 8] Dynamic Bot Target Calculation...")

-- 8a: 1A vs 0H -> Needs 4 Alliance bots, 5 Horde bots (User Example 1)
local bA1, bH1 = balance.calculateBotTargets(1, 0, 5)
assert(bA1 == 4 and bH1 == 5, "1A vs 0H needs 4 Alliance bots and 5 Horde bots")

-- 8b: 1A vs 1H -> Needs 4 Alliance bots, 4 Horde bots (1 Horde bot leaves! User Example 2)
local bA2, bH2 = balance.calculateBotTargets(1, 1, 5)
assert(bA2 == 4 and bH2 == 4, "1A vs 1H needs 4 Alliance bots and 4 Horde bots")

-- 8c: 5A vs 5H -> Needs 0 Alliance bots, 0 Horde bots (User Example 3: no bots when 5v5 real players)
local bA3, bH3 = balance.calculateBotTargets(5, 5, 5)
assert(bA3 == 0 and bH3 == 0, "5A vs 5H needs 0 bots")

-- 8d: 6A vs 5H (11 real players total) -> Needs 0 Alliance bots, 0 Horde bots
local bA4, bH4 = balance.calculateBotTargets(6, 5, 5)
assert(bA4 == 0 and bH4 == 0, "6A vs 5H needs 0 bots")

-- 8e: Test computeBotActions diff computation (User Example 2: 1 Horde bot removed when 2nd real player enters)
local plan1 = balance.computeBotActions({
    [0] = { realCount = 1, bots = { "botA1", "botA2", "botA3", "botA4" } },
    [1] = { realCount = 1, bots = { "botH1", "botH2", "botH3", "botH4", "botH5" } },
}, 5)
assert(#plan1.toRemove == 1 and plan1.toRemove[1] == "botH1", "computeBotActions must return 1 Horde bot to remove when 2nd real player joins")
assert(plan1.toAdd[0] == 0 and plan1.toAdd[1] == 0, "No bots to add")

-- 8f: Edge Case 10v9 (Alliance: 5 real + 5 bots = 10; Horde: 4 real + 5 bots = 9). Single player joins Horde -> Horde real becomes 5 -> All 5 Horde bots leave to make room for real players!
local plan10v9 = balance.computeBotActions({
    [0] = { realCount = 5, bots = { "botA1", "botA2", "botA3", "botA4", "botA5" } },
    [1] = { realCount = 5, bots = { "botH1", "botH2", "botH3", "botH4", "botH5" } },
}, 5)
assert(#plan10v9.toRemove == 10, "10v9 edge case: when 5th real player joins Horde, all 5 Horde bots (and 5 Alliance bots) must be removed!")

-- 8g: Edge Case Full Capacity (Alliance: 5 real + 6 bots; Horde: 4 real + 4 bots). 5th real player joins Alliance -> 6 Alliance bots + 3 Horde bots removed
local planFullCap = balance.computeBotActions({
    [0] = { realCount = 5, bots = { "botA1", "botA2", "botA3", "botA4", "botA5", "botA6" } },
    [1] = { realCount = 4, bots = { "botH1", "botH2", "botH3", "botH4" } },
}, 5)
assert(#planFullCap.toRemove == 9, "Full capacity edge case: 6 Alliance bots and 3 Horde bots removed to reach target counts")

-- 8h: Ongoing group join (2 Alliance real + 3 bots vs 1 Horde real + 4 bots). Group of 2 real Horde players joins -> Horde real becomes 3 -> 2 Horde bots leave
local planGroupJoin = balance.computeBotActions({
    [0] = { realCount = 2, bots = { "botA1", "botA2", "botA3" } },
    [1] = { realCount = 3, bots = { "botH1", "botH2", "botH3", "botH4" } },
}, 5)
assert(#planGroupJoin.toRemove == 2 and planGroupJoin.toRemove[1] == "botH1" and planGroupJoin.toRemove[2] == "botH2", "Group join: 2 Horde bots removed when Horde real count increases by 2")

-- 8i: Over 10 real players (6 Alliance real + 2 bots vs 5 Horde real + 3 bots) -> All 5 bots removed
local planOver10 = balance.computeBotActions({
    [0] = { realCount = 6, bots = { "botA1", "botA2" } },
    [1] = { realCount = 5, bots = { "botH1", "botH2", "botH3" } },
}, 5)
assert(#planOver10.toRemove == 5, "Over 10 real players: all 5 remaining bots must be removed")

print("  -> PASSED: Bot target calculations, 10v9 edge cases, capacity frees, and group join bot diffs verified.")

-- 9. Player Leave Bot Replacement Tests (Never swap teams, fill with bots)
print("[Test 9] Player Leave Bot Replacement (No mid-match team swaps)...")

-- 9a: 1 Real Alliance leaves a match (real Alliance drops to 3 vs 5H real) -> 1 Alliance bot added to fill slot!
local leavePlan1 = balance.computeBotActions({
    [0] = { realCount = 3, bots = { "botA1" } },
    [1] = { realCount = 5, bots = {} },
}, 5)
assert(#leavePlan1.toRemove == 0, "No bots removed when real player leaves")
assert(leavePlan1.toAdd[0] == 1 and leavePlan1.toAdd[1] == 0, "1 Alliance bot added to replace leaving real player (3A real + 2 bots = 5A total vs 5H real)")

-- 9b: 2 Real Alliance players leave (real Alliance drops to 2 vs 5H real) -> 2 Alliance bots added to fill slots (real diff becomes 3, 0 team swaps!)
local leavePlan2 = balance.computeBotActions({
    [0] = { realCount = 2, bots = { "botA1" } },
    [1] = { realCount = 5, bots = {} },
}, 5)
assert(#leavePlan2.toRemove == 0, "No bots removed when 2 real players leave")
assert(leavePlan2.toAdd[0] == 2 and leavePlan2.toAdd[1] == 0, "2 Alliance bots added to replace 2 leaving real players (2A real + 3 bots = 5A total vs 5H real)")

-- 9c: Subsequent real player joins after leave (2A real + 3 bots vs 5H real) -> Assigns to Alliance (2A < 5H), 1 Alliance bot removed!
local joinAfterLeaveAssigns, _ = balance.assign({ { players = { player("newA", 0) } } }, 2, 5)
assert(#joinAfterLeaveAssigns == 1 and joinAfterLeaveAssigns[1].team == 0, "New player assigned to Alliance (2A < 5H)")
local joinAfterLeaveBotPlan = balance.computeBotActions({
    [0] = { realCount = 3, bots = { "botA1", "botA2", "botA3" } },
    [1] = { realCount = 5, bots = {} },
}, 5)
assert(#joinAfterLeaveBotPlan.toRemove == 1 and joinAfterLeaveBotPlan.toRemove[1] == "botA1", "1 Alliance bot removed as new real player joins Alliance")

print("  -> PASSED: Player leaves are filled by bots without team swaps, and subsequent joins replace bots.")

-- 10. Large Group & Composition Boundaries
print("[Test 10] Large Group & Composition Boundaries...")

-- 10a: Full 5-man party queues alone in empty queue -> Splits 3v2 (or 2v3) to satisfy strict Rule #1 (|A - H| <= 1)
local g5AssignsEmpty, _ = balance.assign({ { players = { player("a1", 0), player("a2", 0), player("a3", 0), player("a4", 0), player("a5", 0) } } })
local c5Empty = { [0] = 0, [1] = 0 }
for _, a in ipairs(g5AssignsEmpty) do c5Empty[a.team] = c5Empty[a.team] + 1 end
assert((c5Empty[0] == 3 and c5Empty[1] == 2) or (c5Empty[0] == 2 and c5Empty[1] == 3), "5-man party in empty queue splits 3v2 to satisfy Rule #1 (|A-H| <= 1)")

-- 10b: Full 5-man party joins ongoing BG with 4 Horde real players -> Kept 100% INTACT on Alliance (5A vs 4H, diff 1 <= 1)
local g5AssignsOngoing, _ = balance.assign({ { players = { player("a1", 0), player("a2", 0), player("a3", 0), player("a4", 0), player("a5", 0) } } }, 0, 4)
local g5Team = g5AssignsOngoing[1].team
for _, a in ipairs(g5AssignsOngoing) do
    assert(a.team == 0, "5-man party joining 0A vs 4H ongoing BG stays 100% INTACT on Alliance")
end

-- 10c: 10-man raid party queues together -> Must split 5v5
local g10Assigns, _ = balance.assign({ { players = { player("a1", 0), player("a2", 0), player("a3", 0), player("a4", 0), player("a5", 0), player("a6", 0), player("a7", 0), player("a8", 0), player("a9", 0), player("a10", 0) } } })
local c10 = { [0] = 0, [1] = 0 }
for _, a in ipairs(g10Assigns) do c10[a.team] = c10[a.team] + 1 end
assert(c10[0] == 5 and c10[1] == 5, "10-man party must split 5v5")

-- 10d: 4-man + 4-man parties (Total 8) -> Both kept intact (4v4)
local g44Assigns, _ = balance.assign({
    { players = { player("p1", 0), player("p2", 0), player("p3", 0), player("p4", 0) } },
    { players = { player("q1", 1), player("q2", 1), player("q3", 1), player("q4", 1) } },
})
local teamOfPlayer = {}
for _, a in ipairs(g44Assigns) do
    local pObj = (type(a.player) == "table" and a.player.player) or a.player
    local pName = type(pObj) == "table" and pObj.name or tostring(pObj)
    teamOfPlayer[pName] = a.team
end

assert(teamOfPlayer["p1"] == teamOfPlayer["p2"] and teamOfPlayer["p2"] == teamOfPlayer["p3"] and teamOfPlayer["p3"] == teamOfPlayer["p4"], "Group 1 (p1..p4) intact")
assert(teamOfPlayer["q1"] == teamOfPlayer["q2"] and teamOfPlayer["q2"] == teamOfPlayer["q3"] and teamOfPlayer["q3"] == teamOfPlayer["q4"], "Group 2 (q1..q4) intact")
assert(teamOfPlayer["p1"] ~= teamOfPlayer["q1"], "Group 1 and Group 2 placed on opposite teams")

print("  -> PASSED: Large groups and raid parties handled correctly under Rule #1 constraints.")

-- 11. Mixed Native Faction Parties
print("[Test 11] Mixed Native Faction Party Balancing...")
local mixedAssigns, _ = balance.assign({
    { players = { player("m1", 0), player("m2", 1) } }, -- Party of 2 with 1 Alliance native and 1 Horde native
})
assert(mixedAssigns[1].team ~= mixedAssigns[2].team, "Mixed faction 2-man group alone in match splits 1v1")

print("  -> PASSED: Mixed native faction parties handled correctly.")

-- 12. Oscillating Alternating Favored Team Sequence
print("[Test 12] Oscillating Alternating Favored Team Sequence...")
local fav = nil
local curA, curH = 5, 5
local sequenceTeams = {}
for i = 1, 4 do
    local assigns, nextFav = balance.assign({ { players = { player("trickle" .. i, 0) } } }, curA, curH, fav)
    local assignedTeam = assigns[1].team
    table.insert(sequenceTeams, assignedTeam)
    if assignedTeam == 0 then curA = curA + 1 else curH = curH + 1 end
    fav = nextFav
end
assert(sequenceTeams[1] == 0 and sequenceTeams[2] == 1 and sequenceTeams[3] == 0 and sequenceTeams[4] == 1, "Trickle sequence alternates 0, 1, 0, 1")

print("  -> PASSED: Oscillating sequence alternates teams predictably.")

-- 13. Empty Queue & Single Player Bounds
print("[Test 13] Empty Queue & Single Player Bounds...")
local emptyAssigns, _ = balance.assign({})
assert(#emptyAssigns == 0, "Empty queue returns empty assignments")

local singleAssigns, _ = balance.assign({ { players = { player("lonely", 0) } } })
assert(#singleAssigns == 1, "Single player queue assigns correctly")

print("  -> PASSED: Boundary cases (empty queue, single player) passed.")

-- 14. Extract Roster & Compute Map Bot Actions Helpers
print("[Test 14] Extract Roster & Compute Map Bot Actions Helpers...")
local mockMap = {
    GetPlayers = function()
        return {
            { GetBgTeamId = function() return 0 end, IsBot = function() return false end },
            { GetBgTeamId = function() return 0 end, IsBot = function() return true end, GetName = function() return "BotA1" end },
            { GetBgTeamId = function() return 1 end, IsBot = function() return true end, GetName = function() return "BotH1" end },
        }
    end
}
local extracted = balance.extractRoster(mockMap)
assert(extracted[0].realCount == 1 and #extracted[0].bots == 1 and #extracted[1].bots == 1, "extractRoster parses real vs bot counts correctly")

local mapPlan = balance.computeMapBotActions(mockMap, 5)
assert(mapPlan.toAdd[0] == 3 and mapPlan.toAdd[1] == 4, "computeMapBotActions returns correct bot target additions")

print("  -> PASSED: Map roster extraction and map bot action calculation verified.")

-- 15. Empty Real Player BG Bot Kick Edge Case
print("[Test 15] Empty Real Player BG Bot Kick Edge Case...")
local bA0, bH0 = balance.calculateBotTargets(0, 0, 5)
assert(bA0 == 0 and bH0 == 0, "calculateBotTargets returns 0, 0 when 0 real players remain")

local emptyRealPlan = balance.computeBotActions({
    [0] = { realCount = 0, bots = { "botA1", "botA2", "botA3", "botA4" } },
    [1] = { realCount = 0, bots = { "botH1", "botH2", "botH3", "botH4", "botH5" } },
}, 5)
assert(#emptyRealPlan.toRemove == 9, "When last real player leaves (0 real players), all 9 remaining bots are kicked")
assert(emptyRealPlan.toAdd[0] == 0 and emptyRealPlan.toAdd[1] == 0, "No bots added when 0 real players remain")

print("  -> PASSED: All bots kicked when no real players remain in BG.")

print("\nwsg_balance_test: ok (All 15 test suites passed cleanly)")

