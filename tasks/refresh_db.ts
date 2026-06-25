import config from '../config.json' with { type: 'json' }

const gsheetData = await (await fetch('https://gsheet.devazuka.com/1F1Re3VLtPuF5fXZ1wV79CpogaSgP-fS9r9dm3_aRoP0')).json()

console.log(gsheetData)
console.log({config})
