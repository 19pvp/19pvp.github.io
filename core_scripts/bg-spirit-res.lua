local SPELL_SPIRIT_HEAL_MANA = 44535
local SPELL_WAITING_FOR_RESURRECT = 2584

-- Also handle manual player resurrect aura cleanup
RegisterPlayerEvent(PLAYER_EVENT_ON_RESURRECT, function(event, player)
    if player and player:HasAura(SPELL_WAITING_FOR_RESURRECT) then
        player:RemoveAura(SPELL_WAITING_FOR_RESURRECT)
        player:CastSpell(player, SPELL_SPIRIT_HEAL_MANA, true)
    end
end)
