/* ========= 游戏数据收集模块 collect.js（非模块版） ========= */
/* 后端地址（已指向你部署的 Vercel） */
var PY_ENDPOINT = 'https://piying-feishu-backend.vercel.app/api/collect';
var PY_QUEUE_KEY = 'py_collect_queue_v1';

function pyNowISO(){ try{return new Date().toISOString()}catch{return null} }
function pyLoadQ(){ try{return JSON.parse(localStorage.getItem(PY_QUEUE_KEY)||'[]')}catch{return[]} }
function pySaveQ(q){ try{localStorage.setItem(PY_QUEUE_KEY,JSON.stringify(q))}catch{} }

async function pyPostJSON(body){
  try{
    var r = await fetch(PY_ENDPOINT,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body)
    });
    if(!r.ok) throw new Error('HTTP '+r.status);
    await r.json().catch(function(){});
    return true;
  }catch(e){ return false }
}

async function pyFlushQ(){
  var q = pyLoadQ(); if(!q.length) return;
  var rest = [];
  for(var i=0;i<q.length;i++){
    var ok = await pyPostJSON(q[i]);
    if(!ok) rest.push(q[i]);
  }
  pySaveQ(rest);
}

function pyThrottle(fn,wait){
  wait = wait||300; var t=0;
  return function(){
    var now = Date.now();
    if(now - t > wait){ t = now; fn.apply(null,arguments); }
  }
}

window.PYCollect = {
  _meta:{game:'腾冲皮影戏 · 非遗探秘闯关',version:'1.0.0',timestamp:pyNowISO()},
  _student:{name:'',grade:'',class:''},
  _state:{startAt:0,totalTimeSec:0,totalMoves:0,l3Moves:0,vSeen:false},

  init:function(opts){
    opts = opts||{};
    for (var k in opts){ this._meta[k]=opts[k] }
    this._meta.timestamp = pyNowISO();
    window.addEventListener('online', function(){ pyFlushQ() });
    setTimeout(pyFlushQ, 800);
  },

  setStudent:function(o){
    o = o||{};
    this._student.name = (o.name||'').trim();
    this._student.grade = (o.grade||'').trim();
    this._student.class = (o['class']||'').trim();
  },

  startTimer:function(){
    this._state.startAt = performance.now();
    var self = this;
    return function(){ return self.stopTimer() }
  },

  stopTimer:function(){
    if(!this._state.startAt) return this._state.totalTimeSec;
    var d = (performance.now() - this._state.startAt)/1000;
    this._state.totalTimeSec = Math.max(0, Math.round(d));
    this._state.startAt = 0;
    return this._state.totalTimeSec;
  },

  addMove: pyThrottle(function(){
    this._state.totalMoves++;
  }, 60),

  setLevel3Moves:function(n){
    if(typeof n==='number' && isFinite(n)){
      this._state.l3Moves = Math.max(0, Math.round(n));
    }
  },

  markVideoSeen:function(flag){
    this._state.vSeen = !!flag;
  },

  submitFinal: async function(extra){
    extra = extra||{};
    if(this._state.startAt) this.stopTimer();
    var body = {
      name: this._student.name,
      grade: this._student.grade,
      class: this._student.class,
      time_sec: this._state.totalTimeSec,
      l3_moves: this._state.l3Moves || this._state.totalMoves,
      v_seen: this._state.vSeen,
      timestamp: pyNowISO(),
      meta: (function(meta,ext){
        var m={}; for(var k in meta){m[k]=meta[k]} for(var k2 in ext){m[k2]=ext[k2]} return m;
      })(this._meta, extra)
    };
    if(!body.name || !body.grade || !body.class){
      alert('请先填写：姓名 / 年级 / 班级');
      return false;
    }
    var ok = await pyPostJSON(body);
    if(!ok){ var q = pyLoadQ(); q.push(body); pySaveQ(q) }
    return ok;
  }
};
