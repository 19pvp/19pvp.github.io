local SPELL_SPIRIT_HEAL = 22012
local SPELL_SPIRIT_HEAL_MANA = 44535
local SPELL_WAITING_FOR_RESURRECT = 2584
local RES_RANGE = 30.0 -- Range in yards around the Spirit Healer

local SPELL_EVENT_ON_CAST = 2

local function OnSpiritHealCast(event, caster, spell, skipCheck)
    if not caster then return end

    local map = caster:GetMap()
    if not map or not map:IsBattleground() then
        return
    end

    local players = map:GetPlayers()
    if not players then return end

    for _, player in ipairs(players) do
        -- Check if player is dead
        if player and not player:IsAlive() then
            -- Check if player is friendly to the Spirit Healer
            if not caster:IsHostileTo(player) then
                -- Check if player is within range of the Spirit Healer
                if caster:GetDistance(player) <= RES_RANGE then
                    -- Verify player is still dead
                    if not player:IsAlive() then
                        -- Resurrect player
                        player:ResurrectPlayer(100)
                        if player:HasAura(SPELL_WAITING_FOR_RESURRECT) then
                            player:RemoveAura(SPELL_WAITING_FOR_RESURRECT)
                        end
                        -- Apply Spirit Heal buff / mana restore
                        player:CastSpell(player, SPELL_SPIRIT_HEAL_MANA, true)
                    end
                end
            end
        end
    end
end

RegisterSpellEvent(SPELL_SPIRIT_HEAL, SPELL_EVENT_ON_CAST, OnSpiritHealCast)

RegisterPlayerEvent(PLAYER_EVENT_ON_RESURRECT, function(event, player)
    if player:HasAura(SPELL_WAITING_FOR_RESURRECT) then
        player:RemoveAura(SPELL_WAITING_FOR_RESURRECT)
        player:CastSpell(player, SPELL_SPIRIT_HEAL_MANA, true)
    end
end)
