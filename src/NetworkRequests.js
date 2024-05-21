export const fetchSheetData = async (className) => {
  try {
    const spreadsheetId = '1ViaaK-QNOP-8SW3vyHQJGsbH3ItTVF7mqBsQJIK2cyQ'

    if (className === 'Rogue') {
      const promises = [
        fetch(`https://opensheet.elk.sh/${spreadsheetId}/Rogue: Sub (ALLY)`)
          .then(response => response.json()),
        fetch(`https://opensheet.elk.sh/${spreadsheetId}/Rogue: Sub (HORDE)`)
          .then(response => response.json()),
        fetch(`https://opensheet.elk.sh/${spreadsheetId}/Rogue: Sub (BiS)`)
          .then(response => response.json()),
      ]

      return Promise.all(promises)
        .then(data => {
          const rogueData = {
            'Sub (ALLY)': data[0],
            'Sub (HORDE)': data[1],
            'Sub (BiS)': data[2],
          }
          console.log(rogueData)
          return rogueData
        })
    } else if (className === 'Hunter') {
      const promises = [
        fetch(`https://opensheet.elk.sh/${spreadsheetId}/Hunter: Surv (ALLY)`)
          .then(response => response.json()),
        fetch(`https://opensheet.elk.sh/${spreadsheetId}/Hunter: Surv (HORDE)`)
          .then(response => response.json()),
        fetch(`https://opensheet.elk.sh/${spreadsheetId}/Hunter: Surv (BiS)`)
          .then(response => response.json()),
      ]

      return Promise.all(promises)
        .then(data => {
          const hunterData = {
            'Surv (ALLY)': data[0],
            'Surv (HORDE)': data[1],
            'Surv (BiS)': data[2],
          }
          console.log(hunterData)
          return hunterData
        })
    } else {
      console.warn(`No data for "${className}" yet. Update spreadsheet!`)
      return null
    }
  } catch (error) {
    console.error('Error fetching data:', error)
    return null
  }
}

/* This is NOT the best solution to fetch data, I think we should
change our naming convention for our spreadsheet tabs, and perhaps 
figure out what specs we will actually want to bother making gear sets for
moving foward. For now this is working, but this code is not amazing. */