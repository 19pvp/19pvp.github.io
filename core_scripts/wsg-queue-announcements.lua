RegisterPlayerEvent(PLAYER_EVENT_ON_BG_QUEUE_ENTER, function(event, player)
    local isBot = player:IsBot()
    local botText = "Player"
    if isBot then
        botText = "Bot"
    end
    
    print("[WSG Queue Debug] Queue enter -> " .. inspect({ player = player:GetName(), isBot = isBot }))
end)
