/**
 * /api/collect
 * 只写 5 列：「昵称」「年级」「班级」「第3关步数」「是否看视频」
 * - 彻底解决 SingleSelectFieldConvFail：强制把任何对象 {name:"是"} 压成纯字符串 "是"
 * - 处理 CORS 预检，手机端不再“网络异常”
 */

const FEISHU_APP_ID     = process.env.FEISHU_APP_ID;
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET;
const FEISHU_APP_TOKEN  = process.env.FEISHU_APP_TOKEN;   // 多维表格 App Token (SLe...)
const FEISHU_TABLE_ID   = process.env.FEISHU_TABLE_ID;    // 表格 ID (tbl...)

const JSON_TYPE = 'application/json';
const ALLOW_ORIGIN = '*'; // 也可换成你的前端域名

let TENANT_TOKEN = null;
let TENANT_EXPIRES = 0;

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function send(res, code, obj){ setCORS(res); res.statusCode=code; res.setHeader('Content-Type', JSON_TYPE); res.end(JSON.stringify(obj)); }
function ok(res, obj){ send(res, 200, obj); }
function bad(res, code, obj){ send(res, code||500, obj); }

// —— 工具：把任何 “单选对象/复杂对象” 压成纯字符串 —— //
function toStr(v){
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    // 常见单选形态 { name: "是" } / { text: "是" } / { value: "是" }
    const cand = v.name ?? v.text ?? v.value ?? '';
    return String(cand);
  }
  return String(v);
}

// —— 规范化 “是否看视频” -> 只会是 "是"/"否" —— //
function normalizeSeen(input){
  const s = toStr(input).trim();
  if (!s) return '否';
  if (s === '是' || s === '否') return s;
  if (/^(yes|true|1)$/i.test(s)) return '是';
  if (/^(no|false|0)$/i.test(s)) return '否';
  // 兜底：仍然是字符串，不再是对象
  return s;
}

// —— 兼容多种体例抽取：feishu / fields / 平铺 —— //
function pick(src, ...keys){
  for (const k of keys) if (src && src[k] !== undefined) return src[k];
  return undefined;
}
function extract5(body){
  const src = (body && body.feishu) || (body && body.fields) || body || {};

  const nick  = toStr(pick(src, '昵称', 'name')).trim();
  const grade = toStr(pick(src, '年级', 'grade')).trim();
  const klass = toStr(pick(src, '班级', 'class')).trim();

  const movesRaw = pick(src, '第3关步数','第三关步数','l3_moves','moves');
  const moves = Number(movesRaw) || 0;

  const seen = normalizeSeen(pick(src, '是否看视频','v_seen','seen'));

  // 再做一次“防守式扁平化”，任何对象都压成字符串
  return {
    "昵称": toStr(nick),
    "年级": toStr(grade),
    "班级": toStr(klass),
    "第3关步数": moves,
    "是否看视频": toStr(seen)
  };
}

// —— token —— //
async function getTenantToken(){
  const now = Date.now();
  if (TENANT_TOKEN && now < TENANT_EXPIRES - 10_000) return TENANT_TOKEN;

  const r = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': JSON_TYPE },
    body: JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET })
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`get tenant token failed: ${JSON.stringify(j)}`);
  TENANT_TOKEN = j.tenant_access_token;
  TENANT_EXPIRES = Date.now() + (j.expire || 7000) * 1000;
  return TENANT_TOKEN;
}

// —— 写入飞书 —— //
async function createRecord(fields){
  // 再硬性确保所有值都是“非对象”的纯字符串或数字
  for (const k of Object.keys(fields)){
    if (k === '第3关步数') { fields[k] = Number(fields[k]) || 0; continue; }
    fields[k] = toStr(fields[k]).trim();
  }

  const token = await getTenantToken();
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${FEISHU_TABLE_ID}/records`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': JSON_TYPE
    },
    body: JSON.stringify({ fields })
  });
  const data = await resp.json();
  return data;
}

// —— 健康检查 —— //
function tail(s){ return s ? s.slice(-4) : ''; }
async function handleGET(req,res){
  return ok(res, { ok:true, message:'health ok', seen:{
    token_mode:'app-id-secret',
    table_id_tail: tail(FEISHU_TABLE_ID),
    app_token_tail: tail(FEISHU_APP_TOKEN)
  }});
}

// —— 主入口 —— //
export default async function handler(req,res){
  try{
    setCORS(res);
    if (req.method === 'OPTIONS'){ res.statusCode=204; return res.end(); }
    if (req.method === 'GET'){ return handleGET(req,res); }
    if (req.method !== 'POST'){ return ok(res,{ok:false,message:'Use POST'}); }

    let body = {};
    try{ body = typeof req.body==='object' ? req.body : JSON.parse(req.body||'{}'); }catch{}

    const fields = extract5(body);     // 仅 5 项 + 扁平化
    const feishu = await createRecord(fields);

    if (feishu.code === 0){
      return ok(res, { ok:true, step:'create_record', feishu, msg:'success' });
    }else{
      return ok(res, { ok:false, step:'create_record', feishu, msg:'feishu_error' });
    }
  }catch(e){
    return bad(res, 500, { ok:false, error:String(e) });
  }
}
