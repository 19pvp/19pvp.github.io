import sharp from 'npm:sharp'

const wowClasses = [
  'Druid',
  'Hunter',
  'Mage',
  'Paladin',
  'Priest',
  'Rogue',
  'Shaman',
  'Warlock',
  'Warrior',
]

const fetchAll = async (urlList, concurrent = 5) => {
  let count = 0
  const result = Array(urlList.length)
  const next = async () => {
    if (count >= urlList.length) return
    const index = count++
    const url = urlList[index]
    try {
      const start = Date.now()
      result[index] = await (await fetch(url)).json()
      const duration = Date.now() - start
      console.log((duration / 1000).toFixed(3).padStart(3, '0'), { url })
    } catch (err) {
      result[index] = { error: err, url }
      console.log(err, { url })
    }
    return next()
  }
  await Promise.all([...Array(concurrent).keys()].map(next))
  return result
}

// Download all the sheets
const sheetsDocumentId = '1ViaaK-QNOP-8SW3vyHQJGsbH3ItTVF7mqBsQJIK2cyQ'
const toBuildUrl = className =>
  `https://opensheet.elk.sh/${sheetsDocumentId}/${className}`

const builds = await fetchAll(wowClasses.map(toBuildUrl))
const buildsJSON = JSON.stringify(
  Object.fromEntries(
    wowClasses.map((className, index) => [
      className,
      builds[index].map(({ ['Enchant Name']: _, Icon: __, ...rest }) => rest),
    ]),
  ),
)

await Deno.writeTextFile('src/cached-builds.json', buildsJSON)

// Download all the items data
const itemIds = [
  ...new Set(
    builds
      .flat()
      .flatMap(buildEntry => [buildEntry.ID, buildEntry['Enchant ID']])
      .filter(Boolean),
  ),
]

const items = await fetchAll(
  itemIds.map(id => `https://19pvp.github.io/data/items/${id}.json`),
)

const run = (cmd, args) => new Deno.Command(cmd, { args }).output()

// All the images are already downloaded from
// https://github.com/Gethe/wow-ui-textures/archive/refs/heads/live.zip
// it's needed to lowercase all the icons names first
const icons = [
  ...[...new Set(items.map(item => `ICONS/${item.icon}.png`))].sort(),
  'PaperDoll/UI-PaperDoll-Slot-Chest.PNG',
  'PaperDoll/UI-PaperDoll-Slot-Feet.PNG',
  'PaperDoll/UI-PaperDoll-Slot-Finger.PNG',
  'PaperDoll/UI-PaperDoll-Slot-Hands.PNG',
  'PaperDoll/UI-PaperDoll-Slot-Head.PNG',
  'PaperDoll/UI-PaperDoll-Slot-Legs.PNG',
  'PaperDoll/UI-PaperDoll-Slot-MainHand.PNG',
  'PaperDoll/UI-PaperDoll-Slot-Neck.PNG',
  'PaperDoll/UI-PaperDoll-Slot-Ranged.PNG',
  'PaperDoll/UI-PaperDoll-Slot-Relic.PNG',
  'PaperDoll/UI-PaperDoll-Slot-SecondaryHand.PNG',
  'PaperDoll/UI-PaperDoll-Slot-Shoulder.PNG',
  'PaperDoll/UI-PaperDoll-Slot-Trinket.PNG',
  'PaperDoll/UI-PaperDoll-Slot-Waist.PNG',
  'PaperDoll/UI-PaperDoll-Slot-Wrists.PNG',
]

const itemsJSON = JSON.stringify(
  Object.fromEntries(items.map(item => [item.id, item]).filter(entry => entry[0])),
)

await Deno.writeTextFile('src/cached-items.json', itemsJSON)

await run('biome', [
  'format',
  '--write',
  'src/cached-items.json',
  'src/cached-builds.json',
])

for (const icon of icons) {
  await run('convert', [
    `/home/cdenis/Downloads/wow-ui-textures-live/${icon}`,
    ...['-shave', '3x3', '+repage'],
    ...['-fill', 'black'],
    ...['-draw', 'color 0,0 point'],
    ...['-draw', 'color 0,1 point'],
    ...['-draw', 'color 0,2 point'],
    ...['-draw', 'color 1,0 point'],
    ...['-draw', 'color 2,0 point'],
    ...['-draw', 'color 1,1 point'],

    ...['-draw', 'color 57,0 point'],
    ...['-draw', 'color 57,1 point'],
    ...['-draw', 'color 57,2 point'],
    ...['-draw', 'color 56,0 point'],
    ...['-draw', 'color 56,1 point'],
    ...['-draw', 'color 55,0 point'],

    ...['-draw', 'color 0,57 point'],
    ...['-draw', 'color 1,57 point'],
    ...['-draw', 'color 2,57 point'],
    ...['-draw', 'color 0,56 point'],
    ...['-draw', 'color 1,56 point'],
    ...['-draw', 'color 0,55 point'],

    ...['-draw', 'color 57,57 point'],
    ...['-draw', 'color 57,56 point'],
    ...['-draw', 'color 57,55 point'],
    ...['-draw', 'color 56,56 point'],
    ...['-draw', 'color 56,57 point'],
    ...['-draw', 'color 55,57 point'],
    `src/icons/${icon}`,
  ])
}

await run('convert', [
  ...icons.map(name => `src/icons/${name}`),
  '-append',
  'src/icons/sprite.png',
])

const iconsHandler = sharp('src/icons/sprite.png')
await iconsHandler
  .webp({ effort: 6, quality: 80 })
  .toFile(`src/icons/sprite.webp`)
await iconsHandler
  .avif({ effort: 4, quality: 45 })
  .toFile(`src/icons/sprite.avif`)
await iconsHandler
  .jpeg({ mozjpeg: true, quality: 80 })
  .toFile(`src/icons/sprite.jpeg`)
