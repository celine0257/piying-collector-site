// Vercel Serverless Function (Node 18+)
const ALLOW_ORIGINS = [
  'https://celine0257.github.io',
  'https://celine0257.github.io/', // 有些浏览器会带末尾 /
  // 需要临时放开全部时可用：'*'
];

function corsHeaders(origin) {
  const allowOrigin = ALLOW_ORIGINS.includes(origin) || ALLOW_ORIGINS.includes('*')
    ? origin
    : ALLOW_ORIGINS[0]; // 默认放你 GitHub Pages
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const baseHeaders = corsHeaders(origin);

  // 1) 预检
  if (req.method === 'OPTIONS') {
    return res.status(200).set(baseHeaders).send('OK');
  }

  // 2) 健康探针（GET）
  if (req.method === 'GET') {
    const seen = {
      token_mode: 'app-id-secret',
      table_id_tail: (process.env.FEISHU_TABLE_ID || '').slice(-4),
      app_token_tail: (process.env.FEISHU_APP_TOKEN || '').slice(-4),
    };
    return res.status(200).set(baseHeaders).json({ ok: true, message: 'health ok', seen });
  }

  if (req.method !== 'POST') {
    return res.status(405).set(baseHeaders).json({ ok: false, message: 'Use POST' });
  }

  // 3) 解析 JSON（避免 “Invalid JSON” 报错）
  let body = null;
  try {
    body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
  } catch {
    return res.status(400).set(baseHeaders).json({ ok: false, step: 'parse_body', error: 'Invalid JSON' });
  }

  // 4) 统一出 {fields:{}} 结构，并做强制映射/清洗
  const fieldsIn = body?.fields && typeof body.fields === 'object' ? body.fields : {};
  const coerceString = (v) => (v == null ? '' : String(v).trim());
  const coerceNumber = (v, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const boolToYesNo = (v) => (v === true || String(v).trim() === '是' ? '是' : '否');

  // 兼容旧格式：{ name, grade, class, l3_moves, v_seen }
  const name = fieldsIn['昵称'] ?? body.name;
  const grade = fieldsIn['年级'] ?? body.grade;
  const klass = fieldsIn['班级'] ?? body.class;
  const moves = fieldsIn['第3关步数'] ?? body.l3_moves ?? body.moves;
  let seen = fieldsIn['是否看视频'] ?? body.v_seen ?? body.seen;

  // 单选字段必须是字符串：'是' 或 '否'
  if (typeof seen !== 'string') {
    seen = boolToYesNo(seen);
  } else {
    const s = seen.trim();
    seen = s === '是' ? '是' : s === '否' ? '否' : '否';
  }

  const finalFields = {
    '昵称': coerceString(name),
    '年级': coerceString(grade),
    '班级': coerceString(klass),
    '第3关步数': coerceNumber(moves, 0),
    '是否看视频': seen, // ← 单选，必须是“是/否”
  };

  // 基本校验：至少要有“昵称/年级/班级/是否看视频”
  if (!finalFields['昵称'] && !finalFields['年级'] && !finalFields['班级']) {
    return res.status(400).set(baseHeaders).json({
      ok: false,
      step: 'validate',
      message: 'fields required',
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

  // 5) 获取 tenant_access_token
  let tenantToken = '';
  try {
    const tokenResp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: process.env.FEISHU_APP_ID,
        app_secret: process.env.FEISHU_APP_SECRET,
      }),
    }).then(r => r.json());

    if (tokenResp.code !== 0 || !tokenResp.tenant_access_token) {
      return res.status(500).set(baseHeaders).json({
        ok: false,
        step: 'get_token',
        error: tokenResp,
      });
    }
    tenantToken = tokenResp.tenant_access_token;
  } catch (e) {
    return res.status(500).set(baseHeaders).json({ ok: false, step: 'get_token', error: String(e) });
  }

  // 6) 写入飞书多维表格（只写 5 列）
  try {
    const url =
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${process.env.FEISHU_APP_TOKEN}` +
      `/tables/${process.env.FEISHU_TABLE_ID}/records`;

    const createResp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tenantToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields: finalFields }),
    }).then(r => r.json());

    if (createResp.code !== 0) {
      return res.status(400).set(baseHeaders).json({
        ok: false,
        step: 'create_record',
        feishu: createResp,
      });
    }

    return res.status(200).set(baseHeaders).json({
      ok: true,
      step: 'create_record',
      feishu: createResp,
    });
  } catch (e) {
    return res.status(500).set(baseHeaders).json({ ok: false, step: 'create_record', error: String(e) });
  }
}
