local PLAYER_EVENT_ON_PLAYER_JOIN_BG = 74

RegisterPlayerEvent(PLAYER_EVENT_ON_PLAYER_JOIN_BG, function(event, player)
    local isBot = player:IsBot()
    local botText = "Player"
    if isBot then
        botText = "Bot"
    end
    
    SendWorldMessage("[WSG Queue Debug] " .. player:GetName() .. " (" .. botText .. ") has queued for Warsong Gulch.")
end)
