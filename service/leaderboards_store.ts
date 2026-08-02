export const LEADERBOARD_METRICS = [
  ['dispelsOffensive', 'Offensive dispels'],
  ['dispelsDefensive', 'Defensive dispels'],
  ['successfulInterrupts', 'Successful interrupts'],
  ['fakeCastInterrupts', 'Fake-cast interrupts'],
  ['hardCCCount', 'Hard CC count'],
  ['hardCCDuration', 'Hard CC duration (seconds)'],
  ['softCCCount', 'Soft CC count'],
  ['softCCDuration', 'Soft CC duration (seconds)'],
  ['absorbsDone', 'Absorbs done'],
  ['healsOnFC', 'Healing on flag carriers'],
  ['flagCarryTime', 'Flag carry time (seconds)'],
  ['attemptsOnFlag', 'Flag pickups'],
  ['damageOnEFC', 'Damage on enemy flag carriers'],
  ['damageTaken', 'Damage taken'],
  ['killingBlows', 'Killing blows'],
  ['deaths', 'Deaths'],
  ['honorableKills', 'Honorable kills'],
  ['bonusHonor', 'Bonus honor'],
  ['damageDone', 'Damage done'],
  ['healingDone', 'Healing done'],
  ['flagReturns', 'Flag returns'],
  ['deserted', 'Deserted battlegrounds'],
  ['timePlayed', 'Time played (seconds)'],
] as const

export type LeaderboardMetric = typeof LEADERBOARD_METRICS[number][0]
export type LeaderboardPeriod = 'today' | 'week' | 'month' | 'all'

const DAY_MS = 86_400_000
const DAY_BUCKETS = 31
const WEEK_DAYS = 7
const MONTH_DAYS = 30
const metricIndex = new Map(LEADERBOARD_METRICS.map(([key], index) => [key, index]))

export type LeaderboardPlayer = {
  playerGuid: string
  name: string
  class?: number
  value: number
  matches: number
}

type PlayerAggregate = {
  name: string
  class?: number
  total: Float64Array
  today: Float64Array
  week: Float64Array
  month: Float64Array
  dayIds: Int32Array
  days: Float64Array
  dayMatches: Uint32Array
  matches: number
  todayMatches: number
  weekMatches: number
  monthMatches: number
}

const localDayNumber = (timestamp: number) => {
  const date = new Date(timestamp)
  date.setHours(date.getHours() - 5)
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS)
}

const bucketIndex = (day: number) => ((day % DAY_BUCKETS) + DAY_BUCKETS) % DAY_BUCKETS

const numberValue = (value: unknown) => {
  if (typeof value === 'boolean') return value ? 1 : 0
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

export const isLeaderboardMetric = (value: string): value is LeaderboardMetric =>
  metricIndex.has(value as LeaderboardMetric)
export const isLeaderboardPeriod = (value: string): value is LeaderboardPeriod =>
  value === 'today' || value === 'week' || value === 'month' || value === 'all'

export class LeaderboardStore {
  readonly players = new Map<string, PlayerAggregate>()
  private currentDay = localDayNumber(Date.now())

  private makePlayer() {
    const player: PlayerAggregate = {
      name: '',
      total: new Float64Array(LEADERBOARD_METRICS.length),
      today: new Float64Array(LEADERBOARD_METRICS.length),
      week: new Float64Array(LEADERBOARD_METRICS.length),
      month: new Float64Array(LEADERBOARD_METRICS.length),
      dayIds: new Int32Array(DAY_BUCKETS),
      days: new Float64Array(DAY_BUCKETS * LEADERBOARD_METRICS.length),
      dayMatches: new Uint32Array(DAY_BUCKETS),
      matches: 0,
      todayMatches: 0,
      weekMatches: 0,
      monthMatches: 0,
    }
    player.dayIds.fill(-1)
    return player
  }

  private synchronizeDay() {
    const day = localDayNumber(Date.now())
    if (day <= this.currentDay) return

    this.currentDay = day
    for (const player of this.players.values()) {
      for (let bucket = 0; bucket < DAY_BUCKETS; bucket++) {
        if (player.dayIds[bucket] < this.currentDay - MONTH_DAYS + 1) {
          player.dayIds[bucket] = -1
          player.days.fill(0, bucket * LEADERBOARD_METRICS.length, (bucket + 1) * LEADERBOARD_METRICS.length)
        }
      }

      // Rebuild the rolling windows after advancing the daily bucket.
      player.today.fill(0)
      player.week.fill(0)
      player.month.fill(0)
      player.todayMatches = 0
      player.weekMatches = 0
      player.monthMatches = 0
      for (let bucket = 0; bucket < DAY_BUCKETS; bucket++) {
        const bucketDay = player.dayIds[bucket]
        if (bucketDay < this.currentDay - MONTH_DAYS + 1 || bucketDay > this.currentDay) continue

        const matches = player.dayMatches[bucket]
        player.monthMatches += matches
        if (bucketDay >= this.currentDay - WEEK_DAYS + 1) player.weekMatches += matches
        if (bucketDay === this.currentDay) player.todayMatches += matches

        const sourceOffset = bucket * LEADERBOARD_METRICS.length
        const isToday = bucketDay === this.currentDay
        const isWeek = bucketDay >= this.currentDay - WEEK_DAYS + 1
        for (let metric = 0; metric < LEADERBOARD_METRICS.length; metric++) {
          const value = player.days[sourceOffset + metric]
          player.month[metric] += value
          if (isWeek) player.week[metric] += value
          if (isToday) player.today[metric] += value
        }
      }
    }
  }

  addMatch(payload: unknown, timestamp: number) {
    this.synchronizeDay()
    if (!payload || typeof payload !== 'object') return

    const players = (payload as { players?: unknown }).players
    if (!players || typeof players !== 'object') return
    const day = localDayNumber(timestamp)
    const includeDaily = day >= this.currentDay - MONTH_DAYS + 1 && day <= this.currentDay

    for (const [guidKey, rawStats] of Object.entries(players)) {
      if (!rawStats || typeof rawStats !== 'object') continue
      const stats = rawStats as Record<string, unknown>
      const guid = String(stats.playerGuid || guidKey)
      if (!guid) continue

      let player = this.players.get(guid)
      if (!player) {
        player = this.makePlayer()
        this.players.set(guid, player)
      }
      if (typeof stats.name === 'string' && stats.name) player.name = stats.name
      player.matches++

      const dayBucket = includeDaily ? bucketIndex(day) : -1
      if (includeDaily && player.dayIds[dayBucket] !== day) {
        player.dayIds[dayBucket] = day
        player.days.fill(0, dayBucket * LEADERBOARD_METRICS.length, (dayBucket + 1) * LEADERBOARD_METRICS.length)
        player.dayMatches[dayBucket] = 0
      }
      if (includeDaily) {
        player.dayMatches[dayBucket]++
        player.monthMatches++
        if (day >= this.currentDay - WEEK_DAYS + 1) player.weekMatches++
        if (day === this.currentDay) player.todayMatches++
      }

      for (const [key] of LEADERBOARD_METRICS) {
        const value = numberValue(stats[key])
        const index = metricIndex.get(key)!
        player.total[index] += value
        if (!includeDaily) continue

        player.days[dayBucket * LEADERBOARD_METRICS.length + index] += value
        player.month[index] += value
        if (day >= this.currentDay - WEEK_DAYS + 1) player.week[index] += value
        if (day === this.currentDay) player.today[index] += value
      }
    }
  }

  getLeaderboard(metric: LeaderboardMetric, period: LeaderboardPeriod) {
    this.synchronizeDay()
    const index = metricIndex.get(metric)!
    const values = period === 'all' ? 'total' : period === 'today' ? 'today' : period
    const top = [] as Array<{ playerGuid: string; name: string; class?: number; value: number; matches: number }>

    for (const [playerGuid, player] of this.players) {
      const value = player[values][index]
      if (value < 1) continue
      const name = player.name || playerGuid

      let start = 0
      let end = top.length
      while (start < end) {
        const middle = (start + end) >> 1
        const current = top[middle]
        const before = value > current.value ||
          (value === current.value && name.localeCompare(current.name) < 0)
        if (before) end = middle
        else start = middle + 1
      }

      if (top.length < 100 || start < top.length) {
        const matches = period === 'all'
          ? player.matches
          : period === 'today'
          ? player.todayMatches
          : period === 'week'
          ? player.weekMatches
          : player.monthMatches
        top.splice(start, 0, { playerGuid, name, class: player.class, value, matches })
        if (top.length > 100) top.pop()
      }
    }

    return top
  }
}
