// Vercel Serverless Function (Node 18+)
// 关键点：把“是否看视频”从文本映射为 单选 的 option_id 写入，彻底避免 SingleSelectFieldConvFail

const ALLOW_ORIGINS = [
  'https://celine0257.github.io',
  'https://celine0257.github.io/',
];

function corsHeaders(origin) {
  const allowOrigin =
    ALLOW_ORIGINS.includes(origin) || ALLOW_ORIGINS.includes('*')
      ? origin
      : ALLOW_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const baseHeaders = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return res.status(200).set(baseHeaders).send('OK');
  }

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

  // ---------- 解析请求体 ----------
  let body;
  try {
    body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
  } catch {
    return res.status(400).set(baseHeaders).json({ ok: false, step: 'parse_body', error: 'Invalid JSON' });
  }

  // 兼容两种体：{fields:{}} 或 { name, grade, class, l3_moves, v_seen }
  const fIn = body?.fields && typeof body.fields === 'object' ? body.fields : {};
  const coerceString = (v) => (v == null ? '' : String(v).trim());
  const coerceNumber = (v, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const toYesNo = (v) => (v === true || String(v).trim() === '是' ? '是' : '否');

  const name = fIn['昵称'] ?? body.name;
  const grade = fIn['年级'] ?? body.grade;
  const klass = fIn['班级'] ?? body.class;
  const moves = fIn['第3关步数'] ?? body.l3_moves ?? body.moves;
  let vSeen = fIn['是否看视频'] ?? body.v_seen ?? body.seen;

  // 统一成 “是/否” 两个字
  vSeen = typeof vSeen === 'string' ? (vSeen.trim() === '是' ? '是' : '否') : toYesNo(vSeen);

  const finalFields = {
    '昵称': coerceString(name),
    '年级': coerceString(grade),
    '班级': coerceString(klass),
    '第3关步数': coerceNumber(moves, 0),
    // '是否看视频' 先占位，稍后映射为 option_id
  };

  // 基本校验
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

  // ---------- 获取 tenant_access_token ----------
  let tenantToken = '';
  try {
    const tok = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: process.env.FEISHU_APP_ID,
        app_secret: process.env.FEISHU_APP_SECRET,
      }),
    }).then(r => r.json());

    if (tok.code !== 0 || !tok.tenant_access_token) {
      return res.status(500).set(baseHeaders).json({ ok: false, step: 'get_token', error: tok });
    }
    tenantToken = tok.tenant_access_token;
  } catch (e) {
    return res.status(500).set(baseHeaders).json({ ok: false, step: 'get_token', error: String(e) });
  }

  // ---------- 查字段元数据，拿“是否看视频”的 option_id ----------
  let seenOptionId = null;
  try {
    const fieldsResp = await fetch(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${process.env.FEISHU_APP_TOKEN}/tables/${process.env.FEISHU_TABLE_ID}/fields?page_size=100`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${tenantToken}` },
      }
    ).then(r => r.json());

    if (fieldsResp.code !== 0) {
      return res.status(500).set(baseHeaders).json({ ok: false, step: 'get_fields', error: fieldsResp });
    }

    // 找到 “是否看视频” 字段（完全匹配）
    const seenField = (fieldsResp.data?.items || []).find(
      f => f.field_name === '是否看视频'
    );

    if (!seenField) {
      return res.status(400).set(baseHeaders).json({
        ok: false, step: 'get_fields',
        error: 'Field "是否看视频" not found in table'
      });
    }

    const opts = seenField.property?.options || [];
    // 在 options 里查 “是/否” 对应的 id
    const target = opts.find(o => (o.name || o.text) === vSeen);
    if (target?.id) {
      seenOptionId = target.id;
    } else {
      return res.status(400).set(baseHeaders).json({
        ok: false, step: 'map_single_select',
        error: `Option "${vSeen}" not found for field "是否看视频"`
      });
    }
  } catch (e) {
    return res.status(500).set(baseHeaders).json({ ok: false, step: 'get_fields', error: String(e) });
  }

  // 用 option_id 赋值（单选字段用对象 {id:xxx} 最稳）
  finalFields['是否看视频'] = { id: seenOptionId };

  // ---------- 写入飞书 ----------
  try {
    const url =
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${process.env.FEISHU_APP_TOKEN}` +
      `/tables/${process.env.FEISHU_TABLE_ID}/records`;

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tenantToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields: finalFields }),
    }).then(r => r.json());

    if (resp.code !== 0) {
      return res.status(400).set(baseHeaders).json({ ok: false, step: 'create_record', feishu: resp });
    }

    return res.status(200).set(baseHeaders).json({ ok: true, step: 'create_record', feishu: resp });
  } catch (e) {
    return res.status(500).set(baseHeaders).json({ ok: false, step: 'create_record', error: String(e) });
  }
}
