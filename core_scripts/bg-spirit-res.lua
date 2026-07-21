local SPELL_SPIRIT_HEAL = 22012
local SPELL_SPIRIT_HEAL_MANA = 44535
local SPELL_WAITING_FOR_RESURRECT = 2584
local RES_RANGE = 30.0 -- Range in yards around the Spirit Healer
local WAVE_INTERVAL = 30000 -- 30 seconds wave interval

local CREATURE_EVENT_ON_AIUPDATE = 7
local CREATURE_EVENT_ON_ADD = 36

local SPIRIT_HEALER_ENTRIES = {
    [13116] = true, -- Alliance Spirit Guide
    [13117] = true, -- Horde Spirit Guide
    [6491]  = true, -- Spirit Healer
}

local function LogDebug(msg)
    print(msg)
    if SendWorldMessage then
        SendWorldMessage("|cff00ff00[BG Spirit Res]|r " .. msg)
    end
end

local function OnSpiritHealWave(eventId, delay, repeats, creature)
    if not creature then return end

    local map = creature:GetMap()
    if not map or not map:IsBattleground() then
        return
    end

    local players = creature:GetPlayersInRange(RES_RANGE)
    if not players then return end

    local deadCount = 0
    for _, player in ipairs(players) do
        if player and not player:IsAlive() and not creature:IsHostileTo(player) then
            deadCount = deadCount + 1
        end
    end

    if deadCount > 0 then
        LogDebug(string.format("Spirit Guide %s (%d) wave: resurrecting %d player(s) in range.", creature:GetName(), creature:GetEntry(), deadCount))

        -- Visual spell cast on Spirit Guide NPC
        creature:CastSpell(creature, SPELL_SPIRIT_HEAL, true)

        for _, player in ipairs(players) do
            if player and not player:IsAlive() and not creature:IsHostileTo(player) then
                local pName = player:GetName()
                LogDebug("Resurrecting " .. pName)

                player:ResurrectPlayer(100)
                if player:HasAura(SPELL_WAITING_FOR_RESURRECT) then
                    player:RemoveAura(SPELL_WAITING_FOR_RESURRECT)
                end
                player:CastSpell(player, SPELL_SPIRIT_HEAL_MANA, true)
            end
        end
    end
end

local function InitSpiritGuide(creature)
    if not creature then return end
    local map = creature:GetMap()
    if not map or not map:IsBattleground() then return end

    -- Check runtime cache to avoid duplicate timers
    if not creature:Data():Get("SpiritResTimerActive") then
        creature:Data():Set("SpiritResTimerActive", true)
        creature:RegisterEvent(OnSpiritHealWave, WAVE_INTERVAL, 0)
        LogDebug(string.format("Initialized 30s Spirit Heal wave for %s in BG.", creature:GetName()))
    end
end

for entry, _ in pairs(SPIRIT_HEALER_ENTRIES) do
    RegisterCreatureEvent(entry, CREATURE_EVENT_ON_ADD, function(event, creature)
        InitSpiritGuide(creature)
    end)

    RegisterCreatureEvent(entry, CREATURE_EVENT_ON_AIUPDATE, function(event, creature, diff)
        InitSpiritGuide(creature)
    end)
end

RegisterPlayerEvent(PLAYER_EVENT_ON_RESURRECT, function(event, player)
    if player:HasAura(SPELL_WAITING_FOR_RESURRECT) then
        player:RemoveAura(SPELL_WAITING_FOR_RESURRECT)
        player:CastSpell(player, SPELL_SPIRIT_HEAL_MANA, true)
    end
end)
