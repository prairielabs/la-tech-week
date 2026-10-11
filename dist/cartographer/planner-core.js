/* Pure planning operations. Unknown durations are never silently invented. */
(function(root){
const epoch=Date.parse('2026-10-12T00:00:00-07:00'),H=3600000;
const start=e=>Date.parse(e.startsAt),end=e=>e.endsAt?Date.parse(e.endsAt):null;
const multi=e=>Boolean(e.endDate&&e.endDate!==e.date);
const overlap=(a,b)=>{const ae=end(a),be=end(b);return ae!==null&&be!==null&&start(a)<be&&start(b)<ae;};
function km(a,b){if(!a.coords||!b.coords)return null;const rad=Math.PI/180,p=a.coords,q=b.coords;const v=Math.sin((q[1]-p[1])*rad/2)**2+Math.cos(p[1]*rad)*Math.cos(q[1]*rad)*Math.sin((q[0]-p[0])*rad/2)**2;return 6371*2*Math.asin(Math.sqrt(Math.min(1,v)));}
function activeDay(e,d){const s=Date.parse(d+'T00:00:00-07:00');return start(e)<s+24*H&&(end(e)??start(e)+60000)>s;}
function activeHour(e,h){const s=epoch+h*H;return start(e)<s+H&&(end(e)??start(e)+60000)>s;}
function warnings(events){const out=new Map(events.map(e=>[e.id,[]]));for(let i=0;i<events.length;i++)for(let j=i+1;j<events.length;j++){const a=events[i],b=events[j];if(multi(a)||multi(b))continue;if(overlap(a,b)){out.get(a.id).push('Overlaps '+b.name);out.get(b.id).push('Overlaps '+a.name);}}return out;}
function nextFit(anchor,events){if(end(anchor)===null||multi(anchor))return [];return events.filter(e=>e.id!==anchor.id&&!multi(e)&&e.date===anchor.endDate&&start(e)>=end(anchor)+30*60000&&start(e)<=end(anchor)+4*H&&e.registration!=='closed').map(e=>({e,distance:km(anchor,e),gap:(start(e)-end(anchor))/60000,shared:e.themes.filter(t=>anchor.themes.includes(t)).length,sameArea:anchor.areas.some(a=>e.areas.includes(a))})).sort((a,b)=>Number(b.sameArea)-Number(a.sameArea)||b.shared-a.shared||a.gap-b.gap).slice(0,18);}
function ics(events){const clean=s=>String(s??'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');const utc=s=>new Date(s).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');let lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Prairie Labs//Fieldtrip//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH'];for(const e of events){lines.push('BEGIN:VEVENT','UID:'+e.id+'@fieldtrip.prairielabs.ai','DTSTAMP:'+utc(Date.now()),'DTSTART:'+utc(e.startsAt));if(e.endsAt)lines.push('DTEND:'+utc(e.endsAt));lines.push('SUMMARY:'+clean(e.name),'LOCATION:'+clean(e.publicAddress?.join(', ')||e.areas.join(', ')),'DESCRIPTION:'+clean('Saved possibility — not an RSVP. '+(!e.endsAt?'End time not published. ':'')+'Check latest time and location: '+(e.partiful||e.official)),'URL:'+(e.partiful||e.official),'STATUS:TENTATIVE','END:VEVENT');}lines.push('END:VCALENDAR');return lines.map(l=>{let out='',n=0;for(const c of l){const bytes=new TextEncoder().encode(c).length;if(n+bytes>73){out+='\r\n ';n=1;}out+=c;n+=bytes;}return out;}).join('\r\n')+'\r\n';}
function assemble(events,chosenDay,variant=0){
 const eligible=events.filter(e=>end(e)!==null&&!multi(e)&&e.registration!=='closed'&&(end(e)-start(e))<=5*H&&(end(e)-start(e))>=15*60000&&e.areas.some(a=>a!=='Other'&&!/virtual/i.test(a)));
 const ds=[...new Set(eligible.map(e=>e.date))];const day=chosenDay||ds.sort((a,b)=>eligible.filter(e=>e.date===b).length-eligible.filter(e=>e.date===a).length||a.localeCompare(b))[0];
 const pool=eligible.filter(e=>e.date===day),areas=[...new Set(pool.flatMap(e=>e.areas).filter(a=>a!=='Other'&&!/virtual/i.test(a)))];
 let plans=[];for(const area of areas){const local=pool.filter(e=>e.areas.includes(area)).sort((a,b)=>start(a)-start(b)||a.name.localeCompare(b.name));
 for(let i=0;i<local.length;i++){const plan=[local[i]];for(let j=i+1;j<local.length&&plan.length<3;j++){const prev=plan[plan.length-1],e=local[j];if(start(e)>=end(prev)+45*60000&&start(e)<=end(prev)+4*H)plan.push(e);}if(plan.length)plans.push({day,area,events:plan,score:plan.length*100+new Set(plan.flatMap(e=>e.formats)).size*3+plan.filter(e=>e.featured).length*5});}}
 const seen=new Set();plans=plans.filter(p=>{const k=p.events.map(e=>e.id).join();if(seen.has(k))return false;seen.add(k);return true;}).sort((a,b)=>b.score-a.score||a.area.localeCompare(b.area)||start(a.events[0])-start(b.events[0]));return plans.length?plans[variant%plans.length]:{day:chosenDay||null,area:null,events:[]};
}
const api={start,end,multi,overlap,km,activeDay,activeHour,warnings,nextFit,ics,assemble};if(typeof module!=='undefined')module.exports=api;else root.PlannerCore=api;
})(typeof window!=='undefined'?window:globalThis);
