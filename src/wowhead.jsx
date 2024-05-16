import { useFetchJSON } from './hooks.js'

// TODO: persist in localstorage?
const itemsDB = new Map()
export const Item = ({ id }) => {
  const item = useFetchJSON(
    `https://nether.wowhead.com/tooltip/item/${id}?dataEnv=11&locale=0`,
  )
  if (item.pending) return <div>Loading...</div>
  if (item.error) return <div>Error: {item.error.message}</div>
  return (
    <div>
      <img
        src={`//wow.zamimg.com/images/wow/icons/medium/${item.data.icon}.jpg`}
        alt="item-icon"
      />
      <div>
        <span>{item.data.name}</span>
        <div
          ref={elem => {
            elem.innerHTML = item.data.tooltip
          }}
        />
      </div>
    </div>
  )
}
