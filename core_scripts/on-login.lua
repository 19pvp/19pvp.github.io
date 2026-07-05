RegisterPlayerEvent(PLAYER_EVENT_ON_LEVEL_CHANGE, function (event, player, oldLevel)
  player:AddBonusTalent(200)
  player:SendBroadcastMessage("You have gained 1 bonus talent point.")
end)
