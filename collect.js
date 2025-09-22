// api/collect.js
// Node.js (Vercel) API Route

const FEISHU_APP_ID = process.env.FEISHU_APP_ID;
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET;
const FEISHU_APP_TOKEN = process.env.FEISHU_APP_TOKEN; // 多维表格 App Token（SLe...，尾巴 jnTe）
const FEISHU_TABLE_ID = process.env.FEISHU_TABLE_ID;   // 表ID（tbl...，尾巴 nVjz）

async function getTenantToken() {
  // 用 app_id / app_secret 换 tenant_access_token
  const url = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      app_id: FEISHU_APP_ID,
      app_secret: FEISHU_APP_SECRET,
    }),
  });
  const data = await resp.json();
  if (!resp.ok || data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`get_token_failed:${data.code}:${data.msg || 'unknown'}`);
  }
  return data.tenant_access_token;
}

// 把各种请求体整合为飞书 fields
function buildFeishuFields(body) {
  // 允许三种写法：1) { fields: {...} }  2) { feishu: {...} }  3) 扁平 { name, grade, class, l3_moves, v_seen }
  let fields = {};

  if (body && typeof body === 'object') {
    if (body.fields && typeof body.fields === 'object') {
      fields = { ...body.fields };
    } else if (body.feishu && typeof body.feishu === 'object') {
      fields = { ...body.feishu };
    } else {
      // 扁平写法转成中文列名
      const n = body.name ?? body.昵称;
      const g = body.grade ?? body.年级;
      const c = body.class ?? body.班级;
      const m = body.l3_moves ?? body['第3关步数'] ?? body['第三关步数'];
      const v = body.v_seen ?? body['是否看视频'];

      if (n !== undefined) fields['昵称'] = n;
      if (g !== undefined) fields['年级'] = g;
      if (c !== undefined) fields['班级'] = c;
      if (m !== undefined) fields['第3关步数'] = Number(m);
      if (v !== undefined) fields['是否看视频'] = v === true ? '是' : v === false ? '否' : v;
    }
  }

  // 只保留 5 个目标字段，避免多余字段导致校验不通过
  const allowKeys = new Set(['昵称', '年级', '班级', '第3关步数', '是否看视频']);
  const cleaned = {};
  for (const k of Object.keys(fields)) {
    if (allowKeys.has(k) && fields[k] !== undefined && fields[k] !== null && fields[k] !== '') {
      cleaned[k] = fields[k];
    }
  }

  return cleaned;
}

export default async function handler(req, res) {
  // -------- CORS：必须最前面，移动端需要 OPTIONS 预检 --------
  // 如果希望更安全：把 * 改成你的前端域名 https://celine0257.github.io
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    // 预检直接 204 返回
    res.status(204).end();
    return;
  }

  // 健康检查 / 诊断：GET
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      message: 'health ok',
      seen: {
        token_mode: 'app-id-secret',
        table_id_tail: FEISHU_TABLE_ID ? FEISHU_TABLE_ID.slice(-4) : null,
        app_token_tail: FEISHU_APP_TOKEN ? FEISHU_APP_TOKEN.slice(-4) : null,
      },
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'Use POST' });
  }

  // 环境变量检查
  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET || !FEISHU_APP_TOKEN || !FEISHU_TABLE_ID) {
    return res.status(500).json({
      ok: false,
      step: 'env_check',
      message: 'Missing env',
      env_seen: {
        app_id_len: FEISHU_APP_ID ? FEISHU_APP_ID.length : null,
        app_secret_len: FEISHU_APP_SECRET ? FEISHU_APP_SECRET.length : null,
        app_token_tail: FEISHU_APP_TOKEN ? FEISHU_APP_TOKEN.slice(-4) : null,
        table_id_tail: FEISHU_TABLE_ID ? FEISHU_TABLE_ID.slice(-4) : null,
      },
    });
  }

  // 解析 body
  let body = {};
  try {
    body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
  } catch (e) {
    return res.status(400).json({ ok: false, step: 'parse_body', error: String(e) });
  }

  // 组装要写入飞书的 fields（只保留 5 个）
  const fields = buildFeishuFields(body);

  // 校验：至少要有 1 个合法字段
  if (!fields || Object.keys(fields).length === 0) {
    return res.status(400).json({
      ok: false,
      step: 'validate',
      message: 'no valid fields (列名需与多维表完全一致)',
      example: {
        fields: {
          '昵称': '小明',
          '年级': '六年级',
          '班级': '3班',
          '第3关步数': 8,
          '是否看视频': '是',
        },
      },
    });
  }

  // 换取 tenant_access_token
  let tenantToken;
  try {
    tenantToken = await getTenantToken();
  } catch (e) {
    return res.status(500).json({ ok: false, step: 'get_token', error: String(e) });
  }

  // 写入飞书多维表
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${FEISHU_TABLE_ID}/records`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tenantToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ fields }),
    });
    const data = await resp.json();

    if (!resp.ok || data.code !== 0) {
      return res.status(500).json({
        ok: false,
        step: 'create_record',
        feishu: data,
      });
    }

    return res.status(200).json({
      ok: true,
      step: 'create_record',
      feishu: data,
      msg: 'success',
    });
  } catch (e) {
    return res.status(500).json({ ok: false, step: 'create_record_exception', error: String(e) });
  }
}
