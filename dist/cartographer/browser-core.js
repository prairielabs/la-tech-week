/* Fieldtrip event browsing. Public schedule facts; no inferred venues. */
(function(root){
'use strict';
const days=Array.from({length:7},(_,i)=>`2026-10-${12+i}`),dayMs=86400000;
const communities=new Set(['Marina del Rey','View Park/Windsor Hills','East Los Angeles']);
const virtual=e=>(e.areas||[]).includes('Virtual (LA)')||/^Virtual\b/i.test(e.locationBasis||'');
// Use only a structured published locality, never a guessed venue or coordinates.
const publishedPlace=e=>virtual(e)?'':(e.publicAddress||[]).map(s=>String(s).match(/^([^,]+),\s*[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?$/)?.[1]?.trim()).find(Boolean)||'';
const municipality=e=>e.municipality&&e.municipality!=='Unknown'?e.municipality:publishedPlace(e)||'Unknown';
const elsewhere=e=>!virtual(e)&&(!e.municipality||e.municipality==='Unknown');
const label=e=>virtual(e)?'Virtual':municipality(e)==='Unknown'?'Elsewhere / location unconfirmed':municipality(e);
const matchesPlace=(e,value)=>!value||(value==='__elsewhere'?elsewhere(e):value==='__virtual'?virtual(e):municipality(e)===value);
function placeGroups(events){const values=predicate=>[...new Set(events.filter(predicate).map(municipality))].filter(s=>s!=='Unknown').sort().map(value=>({value,label:value}));return [
 {label:'Municipalities',options:values(e=>!elsewhere(e)&&!virtual(e)&&!communities.has(municipality(e)))},
 {label:'Unincorporated communities',options:values(e=>communities.has(municipality(e)))},
 {label:'Elsewhere / other places',options:[{value:'__elsewhere',label:'All elsewhere / unlisted'},...values(elsewhere)]},
 {label:'Online',options:[{value:'__virtual',label:'Virtual events'}]}
 ];}
const requiresResponse=e=>e.access==='APPLY'||e.access==='RSVP';
const isLA=e=>municipality(e)==='Los Angeles';
const neighborhoods=e=>isLA(e)?(e.areas||[]).filter(a=>!['Other','Virtual (LA)','Los Angeles'].includes(a)):[];
function activeDay(e,d){const s=Date.parse(d+'T00:00:00-07:00'),a=Date.parse(e.startsAt),b=e.endsAt?Date.parse(e.endsAt):a+60000;return a<s+dayMs&&b>s;}
function distance(e,origin){if(!origin||!e.coords)return null;const rad=Math.PI/180,[x,y]=e.coords,[lon,lat]=origin;const h=Math.sin((lat-y)*rad/2)**2+Math.cos(y*rad)*Math.cos(lat*rad)*Math.sin((lon-x)*rad/2)**2;return 3958.7613*2*Math.asin(Math.sqrt(Math.min(1,h)));}
function filter(events,o={}){const q=(o.query||'').trim().toLowerCase().split(/\s+/).filter(Boolean);let rows=events.filter(e=>(o.days===undefined||o.days.some(d=>activeDay(e,d)))&&matchesPlace(e,o.municipality)&&(!o.neighborhood||neighborhoods(e).includes(o.neighborhood))&&(!o.topic||e.themes.includes(o.topic))&&(!o.format||e.formats.includes(o.format))&&(!o.hideClosed||e.registration!=='closed')&&(!o.requireAccess||requiresResponse(e))&&(!o.saved||o.saved.has(e.id))&&(!o.origin||(distance(e,o.origin)!==null&&distance(e,o.origin)<=Number(o.radius||10)))&&q.every(t=>[e.name,...e.hosts,...e.areas,...e.themes,...e.formats,e.description||'',...(e.publicAddress||[]),label(e)].join(' ').toLowerCase().includes(t)));
const time=(a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt)||a.name.localeCompare(b.name);
rows.sort((a,b)=>o.sort==='name'?a.name.localeCompare(b.name):o.sort==='municipality'?label(a).localeCompare(label(b))||time(a,b):o.sort==='featured'?Number(b.featured)-Number(a.featured)||time(a,b):o.sort==='distance'&&o.origin?distance(a,o.origin)-distance(b,o.origin)||time(a,b):time(a,b));return rows;}
function dayCounts(events,o){const rows=filter(events,{...o,days:undefined});return days.map(d=>rows.filter(e=>activeDay(e,d)).length);}
const api={days,communities,virtual,publishedPlace,elsewhere,matchesPlace,placeGroups,municipality,label,requiresResponse,isLA,neighborhoods,activeDay,distance,filter,dayCounts};if(typeof module!=='undefined')module.exports=api;else root.BrowseCore=api;
})(typeof window!=='undefined'?window:globalThis);
