import { REQUEST_TYPES, REQUEST_HINTS } from '../data/mock'
import type { RequestType } from '../types'
export function RequestTypePicker({value,onChange,labelId,allowed}: {value:RequestType;onChange:(t:RequestType)=>void;labelId:string;allowed?:readonly RequestType[]}) {
  const types=(Object.keys(REQUEST_TYPES) as RequestType[]).filter(t=>!allowed||allowed.includes(t))
  return <div className="request-topic-grid" role="group" aria-labelledby={labelId}>
    {types.map(t=><button type="button" key={t} aria-pressed={value===t} title={REQUEST_HINTS[t]} className={`request-topic ${value===t?'is-selected':''}`} onClick={()=>onChange(t)}><b>{t==='other'?'Другое':REQUEST_TYPES[t]}</b><small>{REQUEST_HINTS[t]}</small></button>)}
  </div>
}
