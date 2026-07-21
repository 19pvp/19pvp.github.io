local SPELL_SPIRIT_HEAL = 22012
local SPELL_SPIRIT_HEAL_CHANNEL = 22011
local SPELL_SPIRIT_HEAL_MANA = 44535
local SPELL_RESURRECTION_VISUAL = 24171
local SPELL_WAITING_FOR_RESURRECT = 2584
local RES_RANGE = 25.0 -- Range in yards around the Spirit Healer (user requested 25)

local SPELL_EVENT_ON_CAST = 2

local function LogDebug(msg)
    print("[BG Spirit Res] " .. msg)
    if SendWorldMessage then
        SendWorldMessage("|cff00ff00[BG Spirit Res]|r " .. msg)
    end
end

local function IsFriendlySpiritGuide(player, sh)
    if not sh or not player then return false end
    local entry = sh:GetEntry()
    if entry == 13116 then -- Alliance Spirit Guide
        return player:IsAlliance()
    elseif entry == 13117 then -- Horde Spirit Guide
        return player:IsHorde()
    end
    return true -- Generic Spirit Healers (6491)
end

local function OnSpiritHealCast(event, caster, spell, skipCheck)
    if not caster then return end

    local spellId = spell and spell:GetEntry() or 0
    local map = caster:GetMap()
    local mapId = map and map:GetMapId() or 0

    LogDebug(string.format("Spirit Guide Cast: Spell %d on Map %d", spellId, mapId))

    -- Find all friendly dead players within 25 yards of the casting Spirit Healer
    local players = caster:GetPlayersInRange(RES_RANGE, 2, 2)
    if not players or #players == 0 then
        -- Fallback: check all players in range 25.0
        local allPlayers = caster:GetPlayersInRange(RES_RANGE)
        if allPlayers then
            players = {}
            for _, p in ipairs(allPlayers) do
                if p and p:IsDead() then
                    table.insert(players, p)
                end
            end
        end
    end

    if not players then return end

    local resCount = 0
    for _, player in ipairs(players) do
        if player and not player:IsAlive() and IsFriendlySpiritGuide(player, caster) then
            resCount = resCount + 1
            local pName = player:GetName()
            LogDebug(string.format("Synched Resurrect: Resurrecting friendly player %s (dist: %.1fy)", pName, caster:GetDistance(player)))

            -- Resurrect player
            player:ResurrectPlayer(100)

            -- Play golden resurrection beam visual on the resurrected player
            player:CastSpell(player, SPELL_RESURRECTION_VISUAL, true)

            -- Clean up ghost/waiting aura
            if player:HasAura(SPELL_WAITING_FOR_RESURRECT) then
                player:RemoveAura(SPELL_WAITING_FOR_RESURRECT)
            end

            -- Apply Spirit Heal mana/health restore
            player:CastSpell(player, SPELL_SPIRIT_HEAL_MANA, true)
        end
    end

    if resCount > 0 then
        LogDebug(string.format("Synched Resurrected %d player(s) near %s.", resCount, caster:GetName()))
    end
end

-- Hook spell events for Spirit Heal (22012) and Spirit Heal Channel (22011) to trigger at the exact wave moment
RegisterSpellEvent(SPELL_SPIRIT_HEAL, SPELL_EVENT_ON_CAST, OnSpiritHealCast)
RegisterSpellEvent(SPELL_SPIRIT_HEAL_CHANNEL, SPELL_EVENT_ON_CAST, OnSpiritHealCast)

-- Also handle manual player resurrect aura cleanup
RegisterPlayerEvent(PLAYER_EVENT_ON_RESURRECT, function(event, player)
    if player and player:HasAura(SPELL_WAITING_FOR_RESURRECT) then
        player:RemoveAura(SPELL_WAITING_FOR_RESURRECT)
        player:CastSpell(player, SPELL_SPIRIT_HEAL_MANA, true)
    end
end)
