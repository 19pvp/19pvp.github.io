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
    assert(math.abs(counts[0] - counts[1]) <= 1)
    return teams
end

math.randomseed(19)

local pair = run({ { players = { player("a", 0), player("b", 0) } } })
assert(pair.a ~= pair.b, "a two-player group must split in an otherwise empty match")

local trio = run({ { players = { player("a", 0), player("b", 0), player("c", 0) } } })
assert(trio.a + trio.b + trio.c == 1 or trio.a + trio.b + trio.c == 2)

local intact = run({
    { players = { player("a", 0), player("b", 0) } },
    { players = { player("c", 1), player("d", 1) } },
})
assert(intact.a == intact.b and intact.c == intact.d and intact.a ~= intact.c, "groups should remain intact when balance permits")

local faction = run({
    { players = { player("a", 0) } },
    { players = { player("b", 1) } },
})
assert(faction.a == 0 and faction.b == 1, "native factions should be preserved when balance permits")

for count = 1, 20 do
    local players = {}
    for i = 1, count do
        players[#players + 1] = { players = { player("solo" .. i, i % 2) } }
    end
    run(players)
end

local moved = {}
for seed = 1, 20 do
    math.randomseed(seed)
    local splitPair = run({ { players = { player("a", 0), player("b", 0) } } })
    moved[splitPair.a == 1 and "a" or "b"] = true
end
assert(moved.a and moved.b, "split selection should vary between group members")

print("wsg_balance_test: ok")
