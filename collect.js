/**
 * Vercel Serverless Function - /api/collect
 * 仅写入 5 个字段到飞书多维表格：
 * 「昵称」「年级」「班级」「第3关步数」「是否看视频」
 * - 统一将 “是否看视频” 规范为 纯字符串 "是"/"否"
 * - 兼容前端三种体例：{feishu:{}} / {fields:{}} / 平铺
 * - 处理 CORS 预检，避免前端“网络异常”
 */

const FEISHU_APP_ID = process.env.FEISHU_APP_ID;
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET;
const FEISHU_APP_TOKEN = process.env.FEISHU_APP_TOKEN;
const FEISHU_TABLE_ID = process.env.FEISHU_TABLE_ID;

const CORS_ALLOW_ORIGIN = '*'; // 你也可以换成 https://celine0257.github.io 等固定域名
const JSON_TYPE = 'application/json';

let TENANT_TOKEN = null;
let TENANT_TOKEN_EXPIRES_AT = 0;

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function ok(res, obj) {
  setCORS(res);
  res.statusCode = 200;
  res.setHeader('Content-Type', JSON_TYPE);
  res.end(JSON.stringify(obj));
}

function bad(res, code, obj) {
  setCORS(res);
  res.statusCode = code || 500;
  res.setHeader('Content-Type', JSON_TYPE);
  res.end(JSON.stringify(obj));
}

// —— 规范化 “是否看视频” → 仅 "是" / "否" —— //
function normalizeSeen(input) {
  // 布尔
  if (typeof input === 'boolean') return input ? '是' : '否';

  // 字符串
  if (typeof input === 'string') {
    const s = input.trim();
    if (s === '是' || s === '否') return s;
    if (/^(yes|true|1)$/i.test(s)) return '是';
    if (/^(no|false|0)$/i.test(s)) return '否';
    return s || '否';
  }

  // 对象 { name/text/value: "是" }
  if (input && typeof input === 'object') {
    const s = String(input.name ?? input.text ?? input.value ?? '').trim();
    if (!s) return '否';
    if (s === '是' || s === '否') return s;
    if (/^(yes|true|1)$/i.test(s)) return '是';
    if (/^(no|false|0)$/i.test(s)) return '否';
    return s;
  }

  return '否';
}

// —— 取 body 中的值（兼容 feishu / fields / 平铺）—— //
function pick(obj, key1, key2) {
  if (!obj) return undefined;
  if (obj[key1] !== undefined) return obj[key1];
  if (obj[key2] !== undefined) return obj[key2];
  return undefined;
}

function extractPayload(body) {
  // 兼容三种来源：feishu / fields / 平铺
  const src =
    (body && body.feishu) ||
    (body && body.fields) ||
    body ||
    {};

  // 年级/班级/昵称
  const nick = String(
    pick(src, '昵称', 'name') ?? ''
  ).trim();

  const grade = String(
    pick(src, '年级', 'grade') ?? ''
  ).trim();

  const klass = String(
    pick(src, '班级', 'class') ?? ''
  ).trim();

  // 第3关步数 / 第三关步数 任意一个
  const movesRaw =
    src['第3关步数'] ??
    src['第三关步数'] ??
    src['l3_moves'] ??
    src['moves'] ??
    0;
  const moves = Number(movesRaw) || 0;

  // 是否看视频
  const seenSrc =
    src['是否看视频'] ??
    src['v_seen'] ??
    src['seen'];
  const seen = normalizeSeen(seenSrc);

  return {
    "昵称": nick,
    "年级": grade,
    "班级": klass,
    "第3关步数": moves,
    "是否看视频": seen
  };
}

// —— 获取 tenant_access_token（app-id-secret）—— //
async function getTenantToken() {
  const now = Date.now();
  if (TENANT_TOKEN && now < TENANT_TOKEN_EXPIRES_AT - 10_000) {
    return TENANT_TOKEN;
  }
  const resp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': JSON_TYPE },
    body: JSON.stringify({
      app_id: FEISHU_APP_ID,
      app_secret: FEISHU_APP_SECRET
    })
  });
  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`get tenant_access_token failed: ${JSON.stringify(data)}`);
  }
  TENANT_TOKEN = data.tenant_access_token;
  TENANT_TOKEN_EXPIRES_AT = Date.now() + (data.expire * 1000 || 7000 * 1000);
  return TENANT_TOKEN;
}

// —— 写入飞书多维表格 —— //
async function createFeishuRecord(fields) {
  const token = await getTenantToken();
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${FEISHU_TABLE_ID}/records`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': JSON_TYPE,
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ fields })
  });
  const data = await resp.json();
  return data;
}

// —— 健康检查 —— //
function envTail(s) {
  if (!s) return '';
  return s.slice(-4);
}

async function handleGET(req, res) {
  const seen = {
    token_mode: 'app-id-secret',
    table_id_tail: envTail(FEISHU_TABLE_ID),
    app_token_tail: envTail(FEISHU_APP_TOKEN)
  };
  return ok(res, { ok: true, message: 'health ok', seen });
}

// —— 主入口 —— //
export default async function handler(req, res) {
  try {
    setCORS(res);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }

    if (req.method === 'GET') {
      return handleGET(req, res);
    }

    if (req.method !== 'POST') {
      return ok(res, { ok: false, message: 'Use POST' });
    }

    // 读取 JSON
    let body = {};
    try {
      body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
    } catch {
      body = {};
    }

    // 组装仅 5 项的 fields
    const fields = extractPayload(body);

    // 写入飞书
    const feishu = await createFeishuRecord(fields);

    if (feishu.code === 0) {
      return ok(res, {
        ok: true,
        step: 'create_record',
        feishu,
        msg: 'success'
      });
    } else {
      return bad(res, 200, {
        ok: false,
        step: 'create_record',
        feishu,
        msg: 'feishu_error'
      });
    }
  } catch (err) {
    return bad(res, 500, { ok: false, error: String(err) });
  }
}
