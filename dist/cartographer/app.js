/* LA Tech Week host. Geographic/time measurements + a separate editorial AI scalar.
 * The pure Cartographer core in field.js is unchanged. Camera from Prairie Labs, MIT.
 */
'use strict';
const D=window.LA_DATA, $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const BANDS=[{name:'No AI',range:'0.00 ≤ score < 0.20',color:'#d4a017'},{name:'Minor AI',range:'0.20 ≤ score < 0.40',color:'#d4a017'},{name:'Some AI',range:'0.40 ≤ score < 0.60',color:'#d4a017'},{name:'Mostly AI',range:'0.60 ≤ score < 0.80',color:'#d4a017'},{name:'All AI',range:'0.80 ≤ score ≤ 1.00',color:'#d4a017'}];
const pointColor=()=> '#d4a017';
const prominenceById=new Map(window.LA_PROMINENCE.events.map(e=>[e.id,e]));
const prominence=e=>prominenceById.get(e.id);
// Interpolate dot area (not radius): a bounded 1.4–4.2 CSS-pixel radius.
const dotRadius=score=>Math.sqrt(1.4**2+(4.2**2-1.4**2)*Math.max(0,Math.min(100,score))/100);
const groupProminence=events=>Math.max(...events.map(e=>prominence(e).score));
function prominenceDetail(e){const p=prominence(e);return `<details class="score-block" style="--color:#d4a017"><summary>Prominence ${p.score.toFixed(1)} / 100 <span>Why?</span></summary><p>Rank ${p.rank} of 793 · editorial estimate</p><p>Organizer 35% · scale 30% · support 20% · featured 15%.</p>${Object.entries(p.evidence).map(([key,value])=>`<p><b>${esc(key)}</b>: ${esc(value)}</p>`).join('')}<p>Format and co-hosts are proxies. Missing evidence is unknown; this is not measured attendance, quality or sponsor spending.</p></details>`;}

const locationKey=e=>e.municipality+'|'+(e.neighborhoodGeocode?e.publicNeighborhood:'city-centre');
const band=s=>Math.min(4,Math.floor(s*5)), evById=new Map(D.events.map(e=>[e.id,e]));
const state={days:new Set(),bands:new Set(),places:new Set(),hours:new Set(),hoverHour:null,hoverDay:null,hoverBand:null,hoverPlace:null,search:'',featured:false,fallbackOnly:false,locationGroup:null,mode:'map',extent:'county',frame:'events',detail:null};
let watching=false,watchCursor=null,watchTickAt=0;
const WATCH_STEP=360;
let playTimer=null,frameOffset={x:0,y:0},mapScale=1,mapBaseScale=1,mapZoom=1,mapGestureMoved=false,mapCentre={y:0,z:0};
const MAP_LABELS=['Los Angeles','Santa Monica','Pasadena','Long Beach','Malibu','El Segundo','Culver City','Beverly Hills','West Hollywood','Burbank'];
const BM=window.LA_BASEMAP;
let metric=null,baseMap=null;
let tinyLayout=new Map();
let points=[],lines=[],bodyRings=[],anchors=[],heightScale=220,zScale=0,visible=new Set(),hoverPoint=null,tipKey='',listSignature='',lastPaint=0;
const hourOf=(date,time)=>Math.max(0,Math.min(168,(Date.parse(date+'T'+(time||'00:00')+':00-07:00')-Date.parse('2026-10-12T00:00:00-07:00'))/3600000));
const interval=e=>({start:hourOf(e.date,e.start),end:Math.max(hourOf(e.date,e.start)+1/60,hourOf(e.endDate||e.date,e.end||e.start))});
const overlaps=(e,h)=>{const t=interval(e);return t.start<h+1&&t.end>h;};
const daysActive=e=>D.days.filter((d,i)=>{const t=interval(e);return t.start<(i+1)*24&&t.end>i*24;});
const pass=(e,ignorePlace=false)=>{
 const hourOK=state.hoverHour!==null?overlaps(e,state.hoverHour):(!state.hours.size||[...state.hours].some(h=>overlaps(e,h)));
 const dayOK=state.hoverDay?daysActive(e).includes(state.hoverDay):(!state.days.size||daysActive(e).some(d=>state.days.has(d)));
 const b=band(e.ai.score),bandOK=state.hoverBand!==null?b===state.hoverBand:(!state.bands.size||state.bands.has(b));
 const placeOK=ignorePlace|| (state.hoverPlace?e.municipality===state.hoverPlace:(!state.places.size||state.places.has(e.municipality)));
 return (!window.fieldAllowed||window.fieldAllowed.has(e.id))&&(!state.locationGroup||locationKey(e)===state.locationGroup)&&(!state.fallbackOnly||!e.geocode)&&hourOK&&dayOK&&bandOK&&placeOK&&(!state.featured||e.featured)&&(!state.search||[e.name,e.municipality,...e.areas,...e.hosts,...e.themes].join(' ').toLowerCase().includes(state.search));
};
const dayPass=d=>state.hoverDay?d===state.hoverDay:!state.days.size||state.days.has(d);
function geo(lon,lat){const b=D.bounds[state.extent];return{x:(lon-b[0])/(b[2]-b[0]),z:(lat-b[1])/(b[3]-b[1])};}
function metricSetup(){const b=D.bounds[state.extent],c=utm11((b[0]+b[2])/2,(b[1]+b[3])/2),corners=[[b[0],b[1]],[b[2],b[1]],[b[0],b[3]],[b[2],b[3]]].map(p=>utm11(...p));const west=Math.min(...corners.map(p=>p.e)),east=Math.max(...corners.map(p=>p.e)),south=Math.min(...corners.map(p=>p.n)),north=Math.max(...corners.map(p=>p.n));metric={centre:c,scale:150/(east-west),west:Math.floor(west/5000)*5000,east:Math.ceil(east/5000)*5000,south:Math.floor(south/5000)*5000,north:Math.ceil(north/5000)*5000};zScale=(north-south)*metric.scale;}
function metrePoint(e,n,x=0){return{x,y:(n-metric.centre.n)*metric.scale,z:(e-metric.centre.e)*metric.scale};}
function timeDepth(t){return(.5-t)*heightScale;}
function world(p){const b=D.bounds[state.extent],g=utm11(b[0]+p.z*(b[2]-b[0]),b[1]+p.y*(b[3]-b[1]));return metrePoint(g.e,g.n,state.mode==='map'?0:timeDepth(p.x));}
function mapPoint(coords,t=0){const g=coords?geo(...coords):{x:.5,z:.5};return world({x:t,y:g.z,z:g.x});}
function reproject(){
 metricSetup();
 const instances=D.events.map(e=>({e,day:e.date,id:e.id,coords:e.coords?geo(...e.coords):{x:.5,z:.5},t:interval(e)}));
 const pack={format:'semantic-field.application/1',version:1,application:{id:'la-tech-week',title:'LA Tech Week — time and place',description:'Continuous Pacific time and municipality geometry, with optional AI score filtering.',construct_kind:'event'},scalars:[{id:'longitude',label:'Longitude'},{id:'time',label:'Hours since Monday midnight'},{id:'latitude',label:'Latitude'},{id:'ai',label:'AI relatedness'}],constructs:instances.map(i=>({id:i.id,label:i.e.name.slice(0,200)})),composite_constructs:[],observations:instances.flatMap(i=>Object.entries({longitude:i.coords.x,time:i.t.start/168,latitude:i.coords.z,ai:i.e.ai.score}).map(([scalar,value])=>({construct:i.id,scalar,value,time:{start:null,end:null}})))};
 const app=SemanticFieldCartographer.normalizeApplication(pack),cfg={axes:[['x','time'],['y','latitude'],['z','longitude']].map(([dimension,scalar])=>({dimension,label:scalar,components:[{scalar,weight:1}]}))};
 const projection=SemanticFieldCartographer.project(app,cfg),byInstance=new Map(instances.map(i=>[i.id,i])),groups=new Map();
 points=projection.points.map(p=>{const i=byInstance.get(p.id),k=i.e.municipality+':'+(state.mode==='map'?'all':Math.floor(i.t.start)),g=groups.get(k)||[];g.push(p.id);groups.set(k,g);return{...world(p),anchor:world(p),e:i.e,day:i.day,t:i.t,instance:p.id,normalized:{x:p.x,y:p.y,z:p.z}};});
 const indices=new Map();
 for(const p of points){if(state.mode==='map'||p.e.municipality==='Unknown'||p.e.geocode)continue;const k=p.e.municipality+':'+(state.mode==='map'?'all':Math.floor(p.t.start)),n=indices.get(k)||0;indices.set(k,n+1);const angle=n*2.39996323,r=groups.get(k).length>1?.3+Math.sqrt(n)*.2:0;p.y+=Math.sin(angle)*r;p.z+=Math.cos(angle)*r;}
 buildTinyLayout();
 // One continuously extruded city: geographic end faces joined through the full 168-hour span.
 lines=[];for(const shape of D.maps[state.extent])for(const ring of shape.rings){const front=ring.map(c=>mapPoint(c,0)),back=ring.map(c=>mapPoint(c,1));lines.push({front,back,name:shape.name});}
 bodyRings=D.footprints[state.extent].map(ring=>({front:ring.map(c=>mapPoint(c,0)),back:ring.map(c=>mapPoint(c,1))}));
 anchors=D.places.map(pl=>({place:pl,p:mapPoint(pl.coords,state.mode==='map'?.5:0)}));
 prepareBasemap();
 $('places-tab').querySelector('span').textContent=D.places.length;
 $('c').dataset.projectedCount=String(points.length);$('c').dataset.core='SemanticFieldCartographer.project';$('c').dataset.mode=state.mode;$('c').dataset.timeHours='168';$('c').dataset.cityContinuity='single-extrusion';refresh();
}
function toggle(set,v){set.has(v)?set.delete(v):set.add(v);refresh();}
function refresh(){
 const matching=D.events.filter(e=>pass(e));visible=new Set(matching.map(e=>e.id));
 $('visible-count').textContent=`${matching.length.toLocaleString()} events`;$('visible-count').dataset.count=matching.length;$('event-total').textContent=matching.length;$('browse-count').textContent=matching.length;const unknownCount=matching.filter(e=>e.municipality==='Unknown').length;$('unknown-events').hidden=!unknownCount;$('unknown-events').textContent=unknownCount+' unknown / virtual';$('empty-field').hidden=matching.length>0;
 const hourLabel=state.hoverHour!==null?'Preview '+hourLabelAt(state.hoverHour):state.hours.size?[...state.hours].map(hourLabelAt).join(', '):'';
 const dayLabel=state.hoverDay?'Preview '+shortDate(state.hoverDay):state.days.size?[...state.days].map(shortDate).join(', '):'All days';
 const colorLabel=state.hoverBand!==null?'Preview '+BANDS[state.hoverBand].name:state.bands.size?[...state.bands].map(i=>BANDS[i].name).join(', '):'all AI bands';
 $('selection-label').textContent=[hourLabel||dayLabel,colorLabel,state.hoverPlace||[...state.places].join(', ')].filter(Boolean).join(' · ');
 $('all-days').setAttribute('aria-pressed',String(!state.days.size&&!state.hours.size));
 document.querySelectorAll('.day').forEach(el=>{const d=el.dataset.day;el.setAttribute('aria-pressed',String(state.days.has(d)));el.classList.toggle('dim',state.days.size>0&&!state.days.has(d));});
 document.querySelectorAll('.hour').forEach(el=>el.setAttribute('aria-pressed',String(state.hours.has(+el.dataset.hour))));
 document.querySelectorAll('.band').forEach(el=>{const b=Number(el.dataset.band);el.setAttribute('aria-pressed',String(state.bands.has(b)));el.classList.toggle('dim',state.bands.size>0&&!state.bands.has(b));});
 document.querySelectorAll('#places tr').forEach(tr=>{const n=tr.dataset.place;tr.classList.toggle('selected',state.places.has(n));tr.querySelector('button').setAttribute('aria-pressed',String(state.places.has(n)));tr.querySelector('.place-count').textContent=D.events.filter(e=>e.municipality===n&&pass(e,true)).length;});
 const sig=matching.map(e=>e.id).join();if(sig!==listSignature){listSignature=sig;renderList(matching);}
 renderOverview(matching);
 const selectedHour=state.hoverHour??(state.hours.size===1?[...state.hours][0]:null);
 $('time-readout').textContent=selectedHour!==null?hourLabelAt(selectedHour):state.hoverDay?shortDate(state.hoverDay):state.days.size?[...state.days].map(shortDate).join(', '):state.hours.size?state.hours.size+' selected hours':'All 168 hours';
 $('time-count').textContent=matching.length+' events · '+new Set(matching.filter(e=>e.municipality!=='Unknown').map(e=>e.municipality)).size+' places';
 if(selectedHour!==null)$('time-scrub').value=selectedHour;
 $('time-scrub').setAttribute('aria-valuetext',hourLabelAt(Number($('time-scrub').value)||0));
 tipKey='';hoverPoint=null;$('tooltip').hidden=true;
}
function hourLabelAt(h){return shortDate(D.days[Math.min(6,Math.floor(h/24))])+' '+String(h%24).padStart(2,'0')+':00–'+String(h%24+1).padStart(2,'0')+':00 PT';}
function shortDate(d){return new Date(d+'T12:00:00-07:00').toLocaleDateString('en-US',{weekday:'short',day:'numeric',month:'short',timeZone:D.timezone});}
function renderList(events){
 const sorted=[...events].sort((a,b)=>prominence(b).score-prominence(a).score||a.date.localeCompare(b.date)||a.start.localeCompare(b.start)||a.name.localeCompare(b.name));
 $('event-list').innerHTML=sorted.length?sorted.map(e=>`<button class="event-card" data-event="${esc(e.id)}"><strong><span class="score-dot" style="--color:${e.municipality==='Unknown'?'#939ba3':pointColor(e.ai.score)}"></span>${e.featured?'<span class="gold">✦ </span>':''}${esc(e.name)}</strong><small>${esc(shortDate(e.date))} · ${esc(e.start)} · ${esc(e.municipality)} · Prominence ${prominence(e).score.toFixed(1)}</small></button>`).join(''):'<p class="small-note">No matching events.</p>';
}
function drawer(open){$('event-drawer').hidden=!open;$('browse-events').setAttribute('aria-expanded',String(open));}
$('browse-events').onclick=()=>{drawer($('event-drawer').hidden);};$('close-drawer').onclick=()=>drawer(false);
function setTab(name){$('places-panel').hidden=false;$('events-panel').hidden=name!=='events';$('places-tab').setAttribute('aria-selected',String(name==='places'));$('events-tab').setAttribute('aria-selected',String(name==='events'));}
function showDetail(e){if(watching)stopPlayback();drawer(true);state.detail=e.id;$('event-list').hidden=true;$('detail').hidden=false;$('detail').innerHTML=`<button class="close-detail" id="close-detail">← Back to list</button><h2>${e.featured?'<span class="gold">✦ </span>':''}${esc(e.name)}</h2><div class="meta">${esc(shortDate(e.date))} · ${esc(e.start)}${e.end?'—'+esc(e.end):''} PT${e.endDate&&e.endDate!==e.date?' · through '+esc(shortDate(e.endDate)):''}<br>${esc(e.municipality)} · ${esc(e.areas.join(', '))}<br>${esc(e.hosts.join(' / '))}<br>${esc(e.access)} · ${esc(e.registration)}</div>${prominenceDetail(e)}<details class="score-block" style="--color:${pointColor(e.ai.score)}"><summary>${e.ai.score.toFixed(2)} · ${BANDS[band(e.ai.score)].name} <span>Why?</span></summary>${BANDS[band(e.ai.score)].range}<p>${esc(e.ai.reason)}</p>${e.ai.evidence?`<blockquote>“${esc(e.ai.evidence)}”</blockquote>`:''}<span>Heuristic judgment · ${esc(e.ai.confidence)} confidence</span></details><div class="links"><a href="${esc(e.official)}" target="_blank" rel="noopener">Official page ↗</a>${e.partiful?`<a href="${esc(e.partiful)}" target="_blank" rel="noopener">View / RSVP ↗</a>`:''}</div><div class="meta">Location: ${esc(e.locationBasis)}. ${e.positionKind==='Published address (approx.)'?'Address-range position; approximate, not a rooftop pin.':e.neighborhoodGeocode?'Approximate neighbourhood centre; venue not published.':'Fallback to municipality centre.'}${e.publicAddress?.length?'<br>Published location: '+esc(e.publicAddress.join(', ')):e.descriptionAddress?'<br>Published in event description: '+esc(e.descriptionAddress):''}${e.coords?'<br>Coordinates: '+e.coords[1].toFixed(6)+', '+e.coords[0].toFixed(6):''}${e.neighborhoodGeocode?'<br><a href="'+esc(e.neighborhoodGeocode.source)+'" target="_blank" rel="noopener">Neighbourhood source ↗</a>':''}</div><div class="description">${esc(e.description)}</div>`;$('close-detail').onclick=()=>{$('detail').hidden=true;$('event-list').hidden=false;state.detail=null;};setTab('events');$('detail').scrollIntoView({block:'start',behavior:'auto'});}
function homePose(mode=state.mode,enter=false){
 resize();frameOffset={x:0,y:0};
 if(mode==='map'&&bodyRings.length){let pts=bodyRings.flatMap(r=>r.front);
  if(state.frame==='events'){const physical=points.filter(p=>p.e.coords),ys=physical.map(p=>p.anchor.y).sort((a,b)=>a-b),zs=physical.map(p=>p.anchor.z).sort((a,b)=>a-b),q=(a,t)=>a[Math.floor((a.length-1)*t)];if(physical.length){pts=[{y:q(ys,.02),z:q(zs,.02)},{y:q(ys,.98),z:q(zs,.98)},...anchors.filter(a=>a.place.count>=8&&a.place.coords).map(a=>a.p)];}}
  const ys=pts.map(p=>p.y),zs=pts.map(p=>p.z);mapCentre={y:(Math.max(...ys)+Math.min(...ys))/2,z:(Math.max(...zs)+Math.min(...zs))/2};mapScale=Math.min(cv.width*.78/(Math.max(...zs)-Math.min(...zs)),cv.height*.76/(Math.max(...ys)-Math.min(...ys)));mapBaseScale=mapScale;mapZoom=1;cv.dataset.zoom='1';cv.dataset.framing=state.frame;
 }
 const yaw=mode==='map'?-Math.PI/2:-2.0,pitch=mode==='map'?0:-.2;
 const pose={x:0,y:0,z:0,yaw,pitch};
 {
  const shape=bodyRings.flatMap(r=>mode==='map'?r.front:[...r.front,...r.back]);
  const sample=shape.length?shape:[{x:-110,y:-45,z:-75},{x:110,y:45,z:75}];
  const apply=d=>Object.assign(cam,{...pose,x:-Math.sin(yaw)*Math.cos(pitch)*d,y:-Math.sin(pitch)*d,z:-Math.cos(yaw)*Math.cos(pitch)*d});
  let low=115,high=1800;
  for(let i=0;i<24;i++){const d=(low+high)/2;apply(d);const views=sample.map(view),ss=views.map(toScreen),xs=ss.map(p=>p.sx),ys=ss.map(p=>p.sy);const fits=views.every(v=>v.z>=8)&&Math.max(...xs)-Math.min(...xs)<cv.width*.80&&Math.max(...ys)-Math.min(...ys)<cv.height*.58;if(fits)high=d;else low=d;}
  apply(high);const ss=sample.map(p=>toScreen(view(p))),xs=ss.map(p=>p.sx),ys=ss.map(p=>p.sy);frameOffset={x:cv.width/2-(Math.max(...xs)+Math.min(...xs))/2,y:cv.height*.43-(Math.max(...ys)+Math.min(...ys))/2};Object.assign(pose,{x:cam.x,y:cam.y,z:cam.z});
 }
 Object.assign(HOME,pose);Object.assign(cam,pose);look.yaw=pose.yaw;look.pitch=pose.pitch;resetCamera();
}
function watchLabel(){const h=watchCursor??0;return ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][Math.floor(h/24)]+' '+String(h%24).padStart(2,'0')+':00';}
function updateWatch(){document.querySelectorAll('.day').forEach(el=>el.classList.toggle('active-time',watchCursor!==null&&el.dataset.day===D.days[Math.floor(watchCursor/24)])); $('watch-week').textContent=watching?'Ⅱ Pause · '+watchLabel():watchCursor!==null&&watchCursor<167?'▶ Resume · '+watchLabel():'▶ Watch week';$('watch-week').setAttribute('aria-pressed',String(watching));}
function stopPlayback(){watching=false;updateWatch();if(playTimer!==null)clearInterval(playTimer);playTimer=null;$('play-week').textContent='▶ Play week';$('play-week').setAttribute('aria-pressed','false');}
function chooseHour(h,manual=true){if(manual){stopPlayback();watchCursor=null;updateWatch();}state.days.clear();state.hoverDay=null;state.hoverHour=null;state.hours.clear();state.hours.add(Math.max(0,Math.min(167,Math.round(h))));refresh();}
function renderOverview(events){
 const b=D.bounds[state.extent],spanX=(b[2]-b[0])*Math.cos(34.1*Math.PI/180),spanY=b[3]-b[1],scale=Math.min(260/spanX,155/spanY);
 const loc=c=>[150+(c[0]-(b[0]+b[2])/2)*Math.cos(34.1*Math.PI/180)*scale,93-(c[1]-(b[1]+b[3])/2)*scale];
 const path=ring=>ring.map((c,i)=>{const [x,y]=loc(c);return(i?'L':'M')+x.toFixed(2)+','+y.toFixed(2);}).join(' ')+'Z';
 let html=D.footprints[state.extent].map(r=>`<path d="${path(r)}" fill="#172c3a" stroke="#7690a3" stroke-width=".7"/>`).join('');
 html+=D.maps[state.extent].flatMap(s=>s.rings.map(r=>`<path d="${path(r)}" fill="none" stroke="#3a5364" stroke-width=".35"/>`)).join('');
 html+='<text x="12" y="185" fill="#758d9f" font-size="9" letter-spacing="1">PACIFIC OCEAN</text>';
 for(const e of events.filter(e=>e.geocode)){const [x,y]=loc(e.coords);html+=`<circle cx="${x}" cy="${y}" r="1.7" fill="${pointColor(e.ai.score)}"/>`;}
 for(const p of D.places.filter(p=>p.coords).sort((a,b)=>a.count-b.count)){const es=events.filter(e=>e.municipality===p.name),n=es.length;if(!n)continue;const [x,y]=loc(p.coords),r=Math.min(7,2+Math.sqrt(n)*.3);let offset=0;const circumference=2*Math.PI*r;const mix=BANDS.map((b,i)=>{const length=es.filter(e=>band(e.ai.score)===i).length/n*circumference;const c=`<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${b.color}" stroke-width="2" stroke-dasharray="${length} ${circumference-length}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${x} ${y})"/>`;offset+=length;return c;}).join('');html+=`<g class="map-place" role="button" tabindex="0" data-map-place="${esc(p.name)}" aria-pressed="${state.places.has(p.name)}" aria-label="Filter ${esc(p.name)}, ${n} events"><title>${esc(p.name)} · ${n} events</title><circle cx="${x}" cy="${y}" r="5" fill="transparent"/><circle cx="${x}" cy="${y}" r="${r}" fill="#0f172066" stroke="${state.places.has(p.name)?'#edca83':'#b7c7d3'}" stroke-width="1"/>${mix}</g>${['Los Angeles','Santa Monica','Long Beach','Pasadena'].includes(p.name)?`<text x="${x+8}" y="${y-6}" fill="#c3d2dc" font-size="8" pointer-events="none">${esc(p.name)}</text>`:''}`;}
 $('geographic-overview').innerHTML=html;$('overview-unknown').textContent=events.filter(e=>e.municipality==='Unknown').length+' unknown / virtual';
}
$('geographic-overview').onclick=e=>{const target=e.target.closest('[data-map-place]');if(target)toggle(state.places,target.dataset.mapPlace);};
$('geographic-overview').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){const target=e.target.closest('[data-map-place]');if(target){e.preventDefault();toggle(state.places,target.dataset.mapPlace);}}};
$('time-scrub').oninput=e=>chooseHour(Number(e.target.value));
$('previous-hour').onclick=()=>chooseHour((state.hours.size===1?[...state.hours][0]:Number($('time-scrub').value)||0)-1);
$('next-hour').onclick=()=>chooseHour((state.hours.size===1?[...state.hours][0]:Number($('time-scrub').value)||0)+1);
$('clear-time').onclick=()=>{stopPlayback();watchCursor=null;updateWatch();state.days.clear();state.hours.clear();state.hoverDay=state.hoverHour=null;refresh();};
$('play-week').onclick=()=>{if(playTimer!==null){stopPlayback();return;}chooseHour(state.hours.size===1&&[...state.hours][0]<167?[...state.hours][0]:0,false);$('play-week').textContent='Ⅱ Pause';$('play-week').setAttribute('aria-pressed','true');playTimer=setInterval(()=>{const h=[...state.hours][0]??0;if(h>=167){stopPlayback();return;}chooseHour(h+1,false);},900);};
addEventListener('blur',stopPlayback);
new ResizeObserver(()=>{if(!document.body.classList.contains('immersive'))homePose();}).observe(cv);

function mode(m){if(m==='map'){if(watchCursor!==null){state.hours.clear();state.hoverHour=null;}stopPlayback();watchCursor=null;updateWatch();}$('c').setAttribute('aria-label',m==='map'?'LA event map. Scroll to zoom, drag to pan. Dot size shows prominence. Click for details.':'LA events across 168 hours in 3D. Drag to look, scroll to glide, WASD to move. Dot size shows prominence. Back to 2D restores the map.');$('view-toggle').textContent=m==='map'?'Explore 3D ↗':'Back to 2D';$('view-toggle').setAttribute('aria-pressed',String(m==='stack'));document.querySelector('.map-hint').textContent=m==='map'?'Scroll to zoom · Drag to pan':'Drag to look · Scroll to glide · WASD move';document.querySelector('.scene').dataset.view=m;if(m==='map'){document.body.classList.remove('immersive');$('enter').textContent='Enter field ↗';}state.mode=m;cameraLocked=m==='map';cv.classList.toggle('fixed-map',cameraLocked);$('c').dataset.camera=cameraLocked?'fixed-north-up':'free-flight';document.querySelector('.navigation span').textContent=cameraLocked?'FIXED MAP · Hover dots to inspect · Click for details · Scrub time above':'DRAG look · WASD move · WHEEL glide · SPACE / SHIFT rise / sink · R home';document.querySelector('.axes').innerHTML=m==='map'?'<span>2D · FIXED NORTH-UP MAP</span><span>↑ NORTH</span>':'<span>↔ X · TIME / 168 HOURS</span><span>Y · NORTH / KM</span><span>Z · EAST / KM</span>';document.querySelector('.scene-caption').innerHTML=m==='map'?'<span class="gold">✦</span> Featured = golden halo<br>All events · filter by time above<br>Fixed geography · click a dot for its event':'<span class="gold">✦</span> Featured = golden halo<br>One city, extruded through one week<br>Drag to look · click a dot for its event';$('stack-view').setAttribute('aria-pressed',String(m==='stack'));$('map-view').setAttribute('aria-pressed',String(m==='map'));reproject();homePose();}
function immersive(){document.body.classList.toggle('immersive');$('enter').textContent=document.body.classList.contains('immersive')?'Exit field ↙':'Enter field ↗';if(document.body.classList.contains('immersive')){mode('stack');homePose('stack',true);cv.focus();}else homePose();}
$('bands').innerHTML=[4,3,2,1,0].map(i=>`<button class="band" style="--color:${pointColor((i+.5)/5)}" data-band="${i}" aria-pressed="false" title="${BANDS[i].range}"><span class="dot"></span>${BANDS[i].name}<small>${BANDS[i].range.replace('score','s')}</small></button>`).join('');
$('bands').querySelectorAll('button').forEach(el=>{const b=+el.dataset.band;el.onclick=()=>{const selected=state.bands.has(b);state.bands.clear();if(!selected)state.bands.add(b);refresh();};el.onpointerenter=()=>{state.hoverBand=b;refresh();};el.onpointerleave=()=>{state.hoverBand=null;refresh();};el.onfocus=()=>{state.hoverBand=b;refresh();};el.onblur=()=>{state.hoverBand=null;refresh();};});
$('timeline').innerHTML=D.days.map((d,i)=>{const es=D.events.filter(e=>daysActive(e).includes(d));return `<div class="day-strip"><button class="day" data-day="${d}" aria-pressed="false" aria-label="${shortDate(d)}, ${es.length} active events"><span class="day-name">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i]}</span><span class="date">${12+i}</span></button><div class="hour-labels"><span>00</span><span>06</span><span>12</span><span>18</span></div><div class="hours">${Array.from({length:24},(_,h)=>{const n=D.events.filter(e=>overlaps(e,i*24+h)).length;return `<button class="hour" data-hour="${i*24+h}" aria-pressed="false" aria-label="${hourLabelAt(i*24+h)}, ${n} active events" title="${hourLabelAt(i*24+h)} · ${n} events" style="--activity:${Math.min(1,n/70)}"></button>`;}).join('')}</div></div>`;}).join('');
$('timeline').querySelectorAll('.day').forEach(el=>{el.onclick=()=>{stopPlayback();watchCursor=null;updateWatch();state.hours.clear();state.hoverHour=null;const selected=state.days.has(el.dataset.day);state.days.clear();if(!selected)state.days.add(el.dataset.day);refresh();};el.onpointerenter=()=>{state.hoverDay=el.dataset.day;refresh();};el.onpointerleave=()=>{state.hoverDay=null;refresh();};el.onfocus=()=>{state.hoverDay=el.dataset.day;refresh();};el.onblur=()=>{state.hoverDay=null;refresh();};});
$('timeline').querySelectorAll('.hour').forEach(el=>{const h=+el.dataset.hour;el.onclick=()=>{stopPlayback();state.days.clear();state.hoverDay=null;toggle(state.hours,h);};el.onpointerenter=()=>{state.hoverDay=null;state.hoverHour=h;refresh();};el.onpointerleave=()=>{state.hoverHour=null;refresh();};el.onfocus=()=>{state.hoverHour=h;refresh();};el.onblur=()=>{state.hoverHour=null;refresh();};});
$('places').innerHTML=D.places.map(p=>`<tr data-place="${esc(p.name)}"><td><button aria-pressed="false">${esc(p.name)}${p.kind!=='Municipality'?`<small>${esc(p.kind)}</small>`:''}</button></td><td class="place-count">${p.count}</td></tr>`).join('');
$('places').querySelectorAll('tr').forEach(tr=>{tr.querySelector('button').onclick=()=>{state.fallbackOnly=false;state.locationGroup=null;toggle(state.places,tr.dataset.place);};tr.onpointerenter=()=>{state.hoverPlace=tr.dataset.place;refresh();};tr.onpointerleave=()=>{state.hoverPlace=null;refresh();};});
$('event-list').onclick=e=>{const b=e.target.closest('[data-event]');if(b)showDetail(evById.get(b.dataset.event));};
$('search').oninput=e=>{state.search=e.target.value.trim().toLowerCase();drawer(Boolean(state.search));$('detail').hidden=true;$('event-list').hidden=false;state.detail=null;refresh();};$('featured').onchange=e=>{state.featured=e.target.checked;refresh();};
$('reset').onclick=()=>{stopPlayback();watchCursor=null;updateWatch();state.days.clear();state.hours.clear();state.hoverHour=null;state.bands.clear();state.places.clear();state.hoverDay=state.hoverBand=state.hoverPlace=null;state.search='';state.featured=false;state.fallbackOnly=false;state.locationGroup=null;$('search').value='';$('featured').checked=false;drawer(false);$('detail').hidden=true;$('event-list').hidden=false;state.detail=null;refresh();};
$('watch-week').onclick=()=>{
 if(watching){stopPlayback();return;}
 stopPlayback();if(state.mode==='map')mode('stack');drawer(false);
 watchCursor=watchCursor!==null&&watchCursor<167?watchCursor:state.hours.size===1&&[...state.hours][0]<167?[...state.hours][0]:state.days.size===1?D.days.indexOf([...state.days][0])*24:0;
 watching=true;watchTickAt=Date.now();chooseHour(watchCursor,false);updateWatch();
 playTimer=setInterval(()=>{if(watchCursor>=167){stopPlayback();watchCursor=null;state.hours.clear();refresh();updateWatch();return;}watchCursor++;watchTickAt=Date.now();chooseHour(watchCursor,false);updateWatch();},WATCH_STEP);
};
$('view-toggle').onclick=()=>{mode(state.mode==='map'?'stack':'map');cv.focus();};
$('all-days').onclick=()=>{stopPlayback();watchCursor=null;updateWatch();state.days.clear();state.hours.clear();state.hoverHour=null;state.hoverDay=null;refresh();};$('stack-view').onclick=()=>mode('stack');$('map-view').onclick=()=>mode('map');$('extent').onchange=e=>{state.frame=e.target.value==='county-full'?'county':'events';state.extent='county';reproject();homePose();};$('home').onclick=()=>homePose();$('enter').onclick=immersive;$('places-tab').onclick=()=>setTab('places');$('events-tab').onclick=()=>setTab('events');$('about-open').onclick=()=>$('about').showModal();$('about-close').onclick=()=>$('about').close();
addEventListener('keydown',e=>{if(e.code==='Escape'&&!$('about').open){drawer(false);}if(['INPUT','SELECT','TEXTAREA','BUTTON'].includes(e.target.tagName)||$('about').open)return;if(e.code==='Escape')drawer(false);if(e.code==='KeyF')immersive();if(e.code==='Escape'&&document.body.classList.contains('immersive'))immersive();});
let down=null;cv.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY};if(state.mode!=='map')mapGestureMoved=false;});cv.addEventListener('pointerup',e=>{if(down&&!mapGestureMoved&&Math.hypot(e.clientX-down.x,e.clientY-down.y)<5){const r=cv.getBoundingClientRect();hoverPoint=pickEvent((e.clientX-r.left)*devicePixelRatio,(e.clientY-r.top)*devicePixelRatio);}if(!mapGestureMoved&&down&&Math.hypot(e.clientX-down.x,e.clientY-down.y)<5&&hoverPoint){if(hoverPoint.unknown||hoverPoint.cityGroup){state.fallbackOnly=Boolean(hoverPoint.cityGroup);state.locationGroup=hoverPoint.cityGroup?hoverPoint.key:null;state.places.clear();state.places.add(hoverPoint.cityGroup?hoverPoint.municipality:'Unknown');refresh();drawer(true);setTab('events');$('events-panel').scrollIntoView({block:'start'});}else showDetail(hoverPoint.e);}down=null;});
// North-up map navigation is independent of the free-flight 3D camera.
const mapPointers=new Map();
function syncMap(){mapCentre.z=Math.max(-75,Math.min(75,mapCentre.z));mapCentre.y=Math.max(-zScale/2,Math.min(zScale/2,mapCentre.y));cv.dataset.zoom=mapZoom.toFixed(3);hoverPoint=null;$('tooltip').hidden=true;}
function zoomMap(factor,sx=cv.width/2,sy=cv.height/2){
 const z=mapCentre.z+(sx-cv.width/2)/mapScale,y=mapCentre.y-(sy-cv.height/2)/mapScale;
 mapZoom=Math.max(.6,Math.min(16,mapZoom*factor));mapScale=mapBaseScale*mapZoom;
 mapCentre.z=z-(sx-cv.width/2)/mapScale;mapCentre.y=y+(sy-cv.height/2)/mapScale;syncMap();
}
cv.addEventListener('wheel',e=>{if(state.mode!=='map')return;e.preventDefault();const rect=cv.getBoundingClientRect(),delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?cv.clientHeight:1);zoomMap(Math.exp(-delta*(e.ctrlKey?.006:.0015)),(e.clientX-rect.left)*devicePixelRatio,(e.clientY-rect.top)*devicePixelRatio);},{passive:false});
cv.addEventListener('pointerdown',e=>{if(state.mode!=='map'||(e.pointerType==='mouse'&&e.button!==0))return;if(!mapPointers.size)mapGestureMoved=false;mapPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(mapPointers.size>1)mapGestureMoved=true;dragging=true;cv.classList.add('dragging');cv.setPointerCapture(e.pointerId);});
cv.addEventListener('pointermove',e=>{if(state.mode!=='map'||!mapPointers.has(e.pointerId))return;const before=[...mapPointers.values()],prev=mapPointers.get(e.pointerId);mapPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const after=[...mapPointers.values()];
 if(before.length===2){const a={x:(before[0].x+before[1].x)/2,y:(before[0].y+before[1].y)/2},b={x:(after[0].x+after[1].x)/2,y:(after[0].y+after[1].y)/2},dist=p=>Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y),rect=cv.getBoundingClientRect();mapCentre.z-=(b.x-a.x)*devicePixelRatio/mapScale;mapCentre.y+=(b.y-a.y)*devicePixelRatio/mapScale;if(dist(before)>1)zoomMap(dist(after)/dist(before),(b.x-rect.left)*devicePixelRatio,(b.y-rect.top)*devicePixelRatio);mapGestureMoved=true;
 }else if(before.length===1){const dx=e.clientX-prev.x,dy=e.clientY-prev.y;mapCentre.z-=dx*devicePixelRatio/mapScale;mapCentre.y+=dy*devicePixelRatio/mapScale;if(down&&Math.hypot(e.clientX-down.x,e.clientY-down.y)>3)mapGestureMoved=true;syncMap();}
});
const endMapPointer=e=>{mapPointers.delete(e.pointerId);dragging=mapPointers.size>0;if(!dragging)cv.classList.remove('dragging');};
cv.addEventListener('pointerup',endMapPointer);cv.addEventListener('pointercancel',e=>{mapGestureMoved=true;endMapPointer(e);down=null;});
$('unknown-events').onclick=()=>{state.fallbackOnly=false;state.locationGroup=null;state.places.clear();state.places.add('Unknown');refresh();drawer(true);setTab('events');};
$('zoom-in').onclick=()=>zoomMap(1.4);$('zoom-out').onclick=()=>zoomMap(1/1.4);$('reset-map').onclick=()=>homePose();
cv.addEventListener('dblclick',e=>{if(state.mode!=='map')return;const r=cv.getBoundingClientRect();zoomMap(1.7,(e.clientX-r.left)*devicePixelRatio,(e.clientY-r.top)*devicePixelRatio);});
cv.addEventListener('keydown',e=>{if(state.mode!=='map')return;if(e.key==='+'||e.key==='='){e.preventDefault();zoomMap(1.4);}else if(e.key==='-'){e.preventDefault();zoomMap(1/1.4);}else if(e.key==='Home'){e.preventDefault();homePose();}});
function screen(p){if(state.mode==='map')return{sx:cv.width/2+(p.z-mapCentre.z)*mapScale,sy:cv.height/2-(p.y-mapCentre.y)*mapScale,depth:240};const v=view(p);if(v.z<=3)return null;const s=toScreen(v);return{sx:s.sx+frameOffset.x,sy:s.sy+frameOffset.y,depth:v.z};}
function fallbackGroups(){const groups=new Map();for(const e of D.events){if(e.geocode||!e.coords||!visible.has(e.id))continue;const key=locationKey(e);if(!groups.has(key))groups.set(key,{key,municipality:e.municipality,name:e.neighborhoodGeocode?e.publicNeighborhood+' · '+e.municipality:e.municipality,precision:e.neighborhoodGeocode?'Neighbourhood centre':'City centre',p:mapPoint(e.coords),events:[]});groups.get(key).events.push(e);}return[...groups.values()].map(g=>({...g,prominence:groupProminence(g.events),meanAI:g.events.reduce((n,e)=>n+e.ai.score,0)/g.events.length}));}

// Display-only offsets: one tiny point per imprecisely located event, centred on
// its recorded area. Stable IDs keep offsets fixed when filters change.
function buildTinyLayout(){
 tinyLayout=new Map();const groups=new Map();
 for(const p of points){if(p.e.geocode)continue;const key=locationKey(p.e);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);}
 for(const ps of groups.values()){
  ps.sort((a,b)=>a.e.id.localeCompare(b.e.id));
  const offsets=ps.map((p,i)=>{const radius=3.4*Math.sqrt(i),angle=i*2.39996323;return{x:Math.cos(angle)*radius,y:Math.sin(angle)*radius};});
  const centre=offsets.reduce((n,o)=>({x:n.x+o.x/ps.length,y:n.y+o.y/ps.length}),{x:0,y:0});
  ps.forEach((p,i)=>tinyLayout.set(p.e.id,{x:offsets[i].x-centre.x,y:offsets[i].y-centre.y}));
 }
}
const mapDotScale=()=>Math.max(.75,Math.min(3,Math.sqrt(mapZoom)));
function eventScreen(p){
 const s=screen(p);if(!s||state.mode!=='map'||p.e.geocode)return s;
 const o=tinyLayout.get(p.e.id),spread=mapDotScale()*devicePixelRatio;
 return {...s,sx:s.sx+o.x*spread,sy:s.sy+o.y*spread};
}
function eventRadius(p,s){const base=state.mode==='map'&&!p.e.geocode?.65+.35*prominence(p.e).score/100:dotRadius(prominence(p.e).score);const scale=state.mode==='map'?mapDotScale():Math.max(.55,Math.min(1.35,240/s.depth));return base*scale*devicePixelRatio;}
function pickEvent(sx,sy){let best=13*devicePixelRatio,hit=null;for(const p of points){if(!visible.has(p.e.id))continue;const s=eventScreen(p);if(!s)continue;const distance=Math.hypot(s.sx-sx,s.sy-sy),limit=(state.mode==='map'&&!p.e.geocode?5:13)*devicePixelRatio;if(distance<limit&&distance<best){best=distance;hit={...p,s};}}return hit;}

function drawPath(path,color,width=1,closed=true){
 ctx.beginPath();let prev=null,first=null;for(const p of path){const s=screen(p);if(!s){prev=null;continue;}if(prev)ctx.lineTo(s.sx,s.sy);else ctx.moveTo(s.sx,s.sy);prev=s;if(!first)first=s;}if(closed&&prev&&first)ctx.lineTo(first.sx,first.sy);ctx.strokeStyle=color;ctx.lineWidth=width*devicePixelRatio;ctx.stroke();
}
function polygonRings(g){if(g.type==='Polygon')return g.coordinates;if(g.type==='MultiPolygon')return g.coordinates.flat();if(g.type==='GeometryCollection')return g.geometries.flatMap(polygonRings);return [];}
function prepareBasemap(){baseMap={roads:BM.roads.map(r=>({...r,path:r.path.map(c=>mapPoint(c))})),parks:BM.parks.map(p=>({...p,rings:polygonRings(p.geometry).map(r=>r.map(c=>mapPoint(c))),p:mapPoint(p.coords)})),runways:BM.runways.map(p=>({...p,rings:polygonRings(p.geometry).map(r=>r.map(c=>mapPoint(c)))})),landmarks:BM.landmarks.map(p=>({...p,p:mapPoint(p.coords)})),districts:BM.districts.map(p=>({...p,p:mapPoint(p.coords)}))};}
function drawBasemap(){
 const dpr=devicePixelRatio;
 for(const area of [...baseMap.parks,...baseMap.runways]){ctx.beginPath();for(const ring of area.rings){const ss=ring.map(screen);if(ss.some(p=>!p))continue;ss.forEach((p,i)=>i?ctx.lineTo(p.sx,p.sy):ctx.moveTo(p.sx,p.sy));ctx.closePath();}ctx.fillStyle=area.coords?'#3d494344':'#68768055';ctx.fill('evenodd');}
 for(const road of baseMap.roads){const freeway=road.kind==='freeway';if(freeway)drawPath(road.path,'#0d1217bb',3,false);drawPath(road.path,freeway?'#8293a2aa':'#65788877',freeway?1.2:.65,false);}
 cv.dataset.basemapRoads=String(baseMap.roads.length);
}
function drawLocalLabels(){
 const dpr=devicePixelRatio;const mobile=cv.clientWidth<620;const occupied=mobile?[{x:0,y:0,w:cv.width,h:122*dpr}]:[{x:0,y:0,w:250*dpr,h:85*dpr},{x:cv.width-450*dpr,y:0,w:450*dpr,h:95*dpr}];
 function label(name,p,type='city'){
  const q=screen(p);if(!q||q.sx<20*dpr||q.sx>cv.width-20*dpr||q.sy<(mobile?120:20)*dpr||q.sy>cv.height-90*dpr)return false;
  ctx.font=`${(type==='city'?12:type==='district'?11:10)*dpr}px -apple-system,sans-serif`;const w=ctx.measureText(name).width,h=13*dpr;
  for(const [dx,dy] of [[9,-8],[9,16],[-w/dpr-9,-8],[-w/dpr-9,16],[9,-23],[9,32],[9,-40],[-w/dpr-9,32]]){const x=q.sx+dx*dpr,y=q.sy+dy*dpr,box={x:x-3*dpr,y:y-h,w:w+6*dpr,h:h+3*dpr};if(x<45*dpr||x+w>cv.width-12*dpr||y<(mobile?120:20)*dpr||y>cv.height-105*dpr||occupied.some(b=>box.x<b.x+b.w+6*dpr&&box.x+box.w+6*dpr>b.x&&box.y<b.y+b.h+5*dpr&&box.y+box.h+5*dpr>b.y))continue;occupied.push(box);ctx.strokeStyle='#10171c';ctx.lineWidth=3*dpr;ctx.strokeText(name,x,y);ctx.fillStyle=type==='city'?'#d0dae1':type==='district'?'#a4b7c4':'#859eac';ctx.fillText(name,x,y);if(type==='landmark'){ctx.strokeStyle='#8295a1';ctx.lineWidth=.8*dpr;ctx.beginPath();ctx.moveTo(q.sx-3*dpr,q.sy);ctx.lineTo(q.sx+3*dpr,q.sy);ctx.moveTo(q.sx,q.sy-3*dpr);ctx.lineTo(q.sx,q.sy+3*dpr);ctx.stroke();}return true;}
  return false;
 }
 const cities=MAP_LABELS.filter(n=>n!=='Los Angeles').slice(0,mobile?5:9);$('c').dataset.labels=MAP_LABELS.slice(0,mobile?5:10).join('|');
 for(const name of cities){const a=anchors.find(a=>a.place.name===name);if(a)label(name,a.p);}
 for(const name of ['DTLA','Hollywood','Venice','Westwood','Playa Vista','Century City','Los Feliz','Echo Park','Mar Vista','Pacific Palisades'].slice(0,mobile?4:10)){const p=baseMap.districts.find(p=>p.name===name);if(p)label(name,p.p,'district');}
 for(const p of baseMap.landmarks)label(p.name,p.p,'landmark');
 for(const p of baseMap.parks)label(p.name,p.p,'landmark');
 const order=['405','10','101','110','5','105','210','134','170','710','605','91','60','PCH','14','118'];
 for(const name of order){const candidates=baseMap.roads.filter(r=>r.kind==='freeway'&&r.name===name).flatMap(r=>r.path.map(screen)).filter(p=>p&&p.sx>65*dpr&&p.sx<cv.width-65*dpr&&p.sy>145*dpr&&p.sy<cv.height-180*dpr).sort((a,b)=>Math.hypot(a.sx-cv.width*.48,a.sy-cv.height*.43)-Math.hypot(b.sx-cv.width*.48,b.sy-cv.height*.43));
  ctx.font=`${9*dpr}px ui-monospace,monospace`;const w=ctx.measureText(name).width+10*dpr,h=16*dpr;for(const p of candidates){const box={x:p.sx-w/2,y:p.sy-h/2,w,h};if(occupied.some(b=>box.x<b.x+b.w+10*dpr&&box.x+box.w+10*dpr>b.x&&box.y<b.y+b.h+8*dpr&&box.y+box.h+8*dpr>b.y))continue;occupied.push(box);ctx.fillStyle='#18232a';ctx.fillRect(box.x,box.y,w,h);ctx.strokeStyle='#708591';ctx.lineWidth=.6*dpr;ctx.strokeRect(box.x,box.y,w,h);ctx.fillStyle='#a6bdcc';ctx.fillText(name,box.x+5*dpr,p.sy+3*dpr);break;}}
 if(mapZoom>1.3&&state.mode==='map')for(const name of ['Sunset Blvd','Wilshire Blvd','Santa Monica Blvd','Venice Blvd','Sepulveda Blvd']){const roads=baseMap.roads.filter(r=>r.name===name),r=roads.sort((a,b)=>b.path.length-a.path.length)[0];if(r)label(name,r.path[Math.floor(r.path.length/2)],'landmark');}
 ctx.fillStyle='#586e80';ctx.font=`${11*dpr}px -apple-system,sans-serif`;const ocean=screen(mapPoint([-118.65,33.95]));if(ocean&&ocean.sx>70*dpr&&ocean.sx<cv.width-150*dpr&&ocean.sy>150*dpr&&ocean.sy<cv.height-160*dpr)ctx.fillText('P A C I F I C   O C E A N',ocean.sx,ocean.sy);
}
function drawMetricGrid(){
 const dpr=devicePixelRatio,front=state.mode==='map'?0:timeDepth(0),back=timeDepth(1);
 const stroke=(a,b,major)=>drawPath([a,b],major?'#70808a33':'#56636d1c',major?.6:.4,false);
 for(let e=metric.west;e<=metric.east;e+=5000){const km=(e-metric.west)/1000,major=km%10===0;stroke(metrePoint(e,metric.south,front),metrePoint(e,metric.north,front),major);if(state.mode==='stack'){stroke(metrePoint(e,metric.south,back),metrePoint(e,metric.north,back),major);if(major)stroke(metrePoint(e,metric.south,front),metrePoint(e,metric.south,back),false);}else{const s=screen(metrePoint(e,metric.south));if(s&&s.sx>45*dpr&&s.sx<cv.width-45*dpr&&((5000*metric.scale*mapScale)>32*dpr||major)){ctx.fillStyle='#82919e';ctx.font=`${9*dpr}px ui-monospace,monospace`;ctx.fillText(km+' km',s.sx+4*dpr,cv.height-(cv.clientWidth<620?88:104)*dpr);}}}
 for(let n=metric.south;n<=metric.north;n+=5000){const km=(n-metric.south)/1000,major=km%10===0;stroke(metrePoint(metric.west,n,front),metrePoint(metric.east,n,front),major);if(state.mode==='stack')stroke(metrePoint(metric.west,n,back),metrePoint(metric.east,n,back),major);else{const s=screen(metrePoint(metric.west,n));if(s&&s.sy>110*dpr&&s.sy<cv.height-180*dpr&&((5000*metric.scale*mapScale)>32*dpr||major)){ctx.fillStyle='#82919e';ctx.font=`${9*dpr}px ui-monospace,monospace`;ctx.fillText(km+' km',12*dpr,s.sy-4*dpr);}}}
 cv.dataset.gridMetres='5000';cv.dataset.projection='EPSG:32611';
}
function paint(t){requestAnimationFrame(paint);step(t);if(t-lastPaint<30)return;lastPaint=t;ctx.clearRect(0,0,cv.width,cv.height);
 const dpr=devicePixelRatio;
 const picked=state.hoverPlace||[...state.places][0];
 // One filled mainland shell; only its exterior is extruded. Interior municipal boundaries stay on the map face.
 const faces=[];
 for(const l of bodyRings){faces.push({path:l.front,color:'#202c3699'});if(state.mode==='stack'){faces.push({path:l.back,color:'#263e5125'});for(let i=0;i<l.front.length-1;i++)faces.push({path:[l.front[i],l.front[i+1],l.back[i+1],l.back[i]],color:'#31516b18'});}}
 const mesh=faces.map(f=>({...f,screen:f.path.map(screen)})).filter(f=>f.screen.every(Boolean));mesh.sort((a,b)=>b.screen.reduce((n,p)=>n+p.depth,0)/b.screen.length-a.screen.reduce((n,p)=>n+p.depth,0)/a.screen.length);
 for(const f of mesh){ctx.beginPath();f.screen.forEach((p,k)=>k?ctx.lineTo(p.sx,p.sy):ctx.moveTo(p.sx,p.sy));ctx.closePath();ctx.fillStyle=f.color;ctx.fill();}
 drawMetricGrid();
 for(const l of bodyRings){drawPath(l.front,'#607785',.65);if(state.mode==='stack')drawPath(l.back,'#536b7d',.7);}
 for(const l of lines)drawPath(l.front,l.name===picked?'#c0a367':'#34434e66',l.name===picked?1.1:.2);
 drawBasemap();
 if(state.mode==='stack'){
  const P=h=>({x:timeDepth(h/168),y:zScale/2+18,z:-82});drawPath([P(0),P(168)],'#9a8557',1,false);
  for(let h=0;h<=168;h++){const p=P(h);drawPath([p,{...p,y:p.y-(h%24===0?5:h%6===0?3:1.5)}],h%24===0?'#bea575':'#526170',.65,false);if(h%24===0&&h<168&&(cv.clientWidth>=620||h%48===0)){const s=screen({...p,y:p.y-10});if(s){ctx.fillStyle='#b8aa8f';ctx.font=`${9*dpr}px ui-monospace,monospace`;ctx.fillText(cv.clientWidth<620?(h===168?'End':['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][h/24]):h===168?'Mon 19 · 00h':['Mon 12','Tue 13','Wed 14','Thu 15','Fri 16','Sat 17','Sun 18'][h/24]+' · '+h+'h',s.sx,s.sy+(h/24%3)*14*dpr);}}}
  const chosenHours=state.hoverHour!==null?[state.hoverHour]:[...state.hours];const sweep=watching?(watchCursor??0)+Math.min(.99,(Date.now()-watchTickAt)/WATCH_STEP):null;const ranges=sweep!==null?[[sweep,sweep+.3]]:chosenHours.length?chosenHours.map(h=>[h,h+1]):(state.hoverDay?[state.hoverDay]:[...state.days]).map(d=>{const h=D.days.indexOf(d)*24;return[h,h+24];});
  for(const [h,end] of ranges)for(const l of bodyRings){for(const time of [h,end]){const x=timeDepth(time/168);const slice=l.front.map(p=>({...p,x}));const ss=slice.map(screen);if(ss.every(Boolean)){ctx.beginPath();ss.forEach((p,i)=>i?ctx.lineTo(p.sx,p.sy):ctx.moveTo(p.sx,p.sy));ctx.closePath();ctx.fillStyle=watching?'#efc87924':'#efc87918';ctx.fill();}drawPath(slice,watching?'#ffdf91':'#edca83',watching?1.6:1);}}
 }
 for(const a of anchors){if(a.place.name==='Unknown')continue;const s=screen(a.p);if(!s)continue;ctx.fillStyle='#607381';ctx.fillRect(s.sx-dpr,s.sy-dpr,2*dpr,2*dpr);}
 const drawn=[];for(const p of points){const s=eventScreen(p);if(s)drawn.push({p,s,active:visible.has(p.e.id)});}
 drawn.sort((a,b)=>state.mode==='map'?prominence(a.p.e).score-prominence(b.p.e).score:b.s.depth-a.s.depth);hoverPoint=null;let best=13*dpr;
 for(const {p,s,active} of drawn){const r=eventRadius(p,s);ctx.globalAlpha=active?1:.035;ctx.fillStyle=p.e.municipality==='Unknown'?'#9ba4ac':pointColor(p.e.ai.score);
  if(state.mode==='stack'&&active&&(state.detail===p.e.id||hoverPoint?.e?.id===p.e.id)){const end={...p,x:timeDepth(p.t.end/168)};drawPath([p,end],p.e.municipality==='Unknown'?'#9ba4ac44':pointColor(p.e.ai.score)+'44',.7,false);}
  ctx.shadowBlur=active?(state.mode==='map'&&!p.e.geocode?(p.e.featured?2:0):p.e.featured?9:3)*dpr:0;ctx.shadowColor=ctx.fillStyle;ctx.beginPath();ctx.arc(s.sx,s.sy,r,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;if(active&&!dragging&&mouseX>=0){const dist=Math.hypot(s.sx-mouseX,s.sy-mouseY);if(dist<best&&dist<(state.mode==='map'&&!p.e.geocode?5:13)*dpr){best=dist;hoverPoint={...p,s};}}
 }
 ctx.globalAlpha=1;
 drawSavedRoute();
 cv.dataset.activeDots=String(visible.size);
 drawLocalLabels();

 updateTip();
}
function updateTip(){if(!hoverPoint){$('tooltip').hidden=true;tipKey='';return;}const key=hoverPoint?(hoverPoint.cityGroup?'city:'+hoverPoint.name+':'+hoverPoint.events.length:hoverPoint.unknown?'unknown:'+hoverPoint.day:hoverPoint.instance):'';if(key!==tipKey){tipKey=key;if(!hoverPoint){$('tooltip').hidden=true;return;}$('tooltip').hidden=false;if(hoverPoint.cityGroup){$('tooltip').innerHTML=`<strong>${esc(hoverPoint.name)} · ${hoverPoint.events.length} events</strong>${esc(hoverPoint.precision)} · approximate area, not venue pins.<br>Largest prominence: ${hoverPoint.prominence.toFixed(1)} / 100 · dot represents the highest-scored event.<br>Mean AI score: ${hoverPoint.meanAI.toFixed(2)} · subjective estimate.<br>Click to see these events.`;}else if(hoverPoint.unknown){$('tooltip').innerHTML=`<strong>Unknown / virtual</strong>${hoverPoint.events.length} events<br>Exactly at the geographic centre.<br>Largest prominence: ${groupProminence(hoverPoint.events).toFixed(1)} / 100.<br>Click to open this group.`;}else{const e=hoverPoint.e,b=band(e.ai.score);$('tooltip').innerHTML=`<strong>${e.featured?'✦ ':''}${esc(e.name)}</strong>${esc(shortDate(hoverPoint.day))} · ${esc(e.start)} PT<br>${esc(e.municipality)} · ${esc(e.areas.join(', '))}<br>${esc(e.positionKind)}${state.mode==='map'&&!e.geocode?'<br>Tiny dot in an area-centre collection; its offset is for display, not a venue coordinate.':''}${e.publicAddress?.length?'<br>'+esc(e.publicAddress.join(', ')):''}${e.municipality==='Unknown'?'<br>Gray · unknown/virtual location':''}<div>Prominence ${prominence(e).score.toFixed(1)} / 100 · rank ${prominence(e).rank}</div><div class="tip-score" style="--color:${pointColor(e.ai.score)}">${e.ai.score.toFixed(2)} · ${BANDS[b].name} · ${BANDS[b].range}</div><div>${esc(e.ai.reason)}</div><div style="color:#8596a6;margin-top:6px">Click for details and sources</div>`;}}
 if(hoverPoint){const box=$('tooltip'),x=hoverPoint.s.sx/devicePixelRatio+15,y=hoverPoint.s.sy/devicePixelRatio+15;box.style.left=Math.max(8,Math.min(cv.clientWidth-box.offsetWidth-8,x))+'px';box.style.top=Math.max(8,Math.min(cv.clientHeight-box.offsetHeight-8,y))+'px';}
}
try{homePose();if(D.events.some(e=>!e.ai))throw Error('AI scores missing');mode('stack');resize();setTab('events');requestAnimationFrame(paint);const id=new URLSearchParams(location.search).get('event');if(evById.has(id))showDetail(evById.get(id));}catch(e){$('visible-count').textContent='Could not build the field: '+e.message;console.error(e);}

// Fieldtrip host bridge. Core projection and camera remain the original Cartographer.
window.fieldSaved=new Set();
function drawSavedRoute(){
 const ps=points.filter(p=>window.fieldSaved.has(p.e.id)).sort((a,b)=>a.t.start-b.t.start);
 for(let i=1;i<ps.length;i++)if(ps[i].e.date===ps[i-1].e.date)drawPath([ps[i-1],ps[i]],'#aaf4cf',1.6,false);
 for(const p of ps){const s=eventScreen(p);if(!s)continue;ctx.strokeStyle='#aaf4cf';ctx.lineWidth=1.6*devicePixelRatio;ctx.beginPath();ctx.arc(s.sx,s.sy,6*devicePixelRatio,0,Math.PI*2);ctx.stroke();}
 if(state.detail){const p=points.find(p=>p.e.id===state.detail);if(p){const s=eventScreen(p);if(s){ctx.strokeStyle='#fff';ctx.lineWidth=2*devicePixelRatio;ctx.beginPath();ctx.arc(s.sx,s.sy,9*devicePixelRatio,0,Math.PI*2);ctx.stroke();}}}
}
showDetail=function(e){stopPlayback();state.detail=e.id;window.dispatchEvent(new CustomEvent('field-select',{detail:e.id}));};
window.fieldHost={
 filter(ids){window.fieldAllowed=new Set(ids);refresh();},
 saved(ids){window.fieldSaved=new Set(ids);},
 select(id){state.detail=id;},
 view(m){mode(m);},home(){homePose();},zoom(dir){if(state.mode==='map')zoomMap(dir>0?1.3:1/1.3);else wheelImpulse+=dir*120;},
 days(days){stopPlayback();watchCursor=null;updateWatch();state.days=new Set(days);state.hours.clear();state.hoverDay=state.hoverHour=null;refresh();},
 day(day){stopPlayback();watchCursor=null;updateWatch();state.days.clear();state.hours.clear();if(day)state.days.add(day);refresh();},
 hour(h){chooseHour(h);},clearHour(){state.hours.clear();stopPlayback();watchCursor=null;refresh();},
 watch(){ $('watch-week').click();},stop(){stopPlayback();},
 get(){return {mode:state.mode,watching,hour:state.hours.size?[...state.hours][0]:null};}
};
