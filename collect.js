/* ========= 游戏数据收集模块 collect.js ========= */
const ENDPOINT = 'https://piying-feishu-backend.vercel.app/api/collect';
const QUEUE_KEY = 'py_collect_queue_v1';

function nowISO(){ try{return new Date().toISOString()}catch{return null} }
function loadQ(){ try{return JSON.parse(localStorage.getItem(QUEUE_KEY)||'[]')}catch{return[]} }
function saveQ(q){ try{localStorage.setItem(QUEUE_KEY,JSON.stringify(q))}catch{} }

async function postJSON(body){
  try{
    const r=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!r.ok) throw new Error('HTTP '+r.status);
    await r.json().catch(()=>{});
    return true;
  }catch(e){ return false }
}

async function flushQ(){
  const q=loadQ(); if(!q.length)return;
  const rest=[]; for(const b of q){ const ok=await postJSON(b); if(!ok) rest.push(b) }
  saveQ(rest);
}

function throttle(fn,w=300){let t=0;return(...a)=>{const n=Date.now();if(n-t>w){t=n;fn(...a)}}}

const PYCollect={
  _meta:{game:'腾冲皮影戏 · 非遗探秘闯关',version:'1.0.0',timestamp:nowISO()},
  _student:{name:'',grade:'',class:''},
  _state:{startAt:0,totalTimeSec:0,totalMoves:0,l3Moves:0,vSeen:false},

  init(opts={}){ this._meta={...this._meta,...opts,timestamp:nowISO()};
    window.addEventListener('online',()=>flushQ()); setTimeout(flushQ,800); },

  setStudent({name='',grade='',class:cls=''}={}){ this._student={name:name.trim(),grade:grade.trim(),class:cls.trim()} },

  startTimer(){ this._state.startAt=performance.now(); return ()=>this.stopTimer() },

  stopTimer(){ if(!this._state.startAt) return this._state.totalTimeSec;
    const d=(performance.now()-this._state.startAt)/1000;
    this._state.totalTimeSec=Math.max(0,Math.round(d)); this._state.startAt=0; return this._state.totalTimeSec },

  addMove: throttle(function(){ this._state.totalMoves++ }, 60),

  setLevel3Moves(n){ if(Number.isFinite(n)) this._state.l3Moves=Math.max(0,Math.round(n)) },

  markVideoSeen(f=true){ this._state.vSeen=!!f },

  async submitFinal(extra={}){
    if(this._state.startAt) this.stopTimer();
    const body={
      name:this._student.name, grade:this._student.grade, class:this._student.class,
      time_sec:this._state.totalTimeSec, l3_moves:this._state.l3Moves||this._state.totalMoves,
      v_seen:this._state.vSeen, timestamp:nowISO(), meta:{...this._meta,...extra}
    };
    if(!body.name||!body.grade||!body.class){ alert('请先填写：姓名/年级/班级'); return false }
    const ok=await postJSON(body);
    if(!ok){ const q=loadQ(); q.push(body); saveQ(q) }
    return ok;
  }
};

if(typeof window!=='undefined'){ window.PYCollect=PYCollect }
export default PYCollect;
