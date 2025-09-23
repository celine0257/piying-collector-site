// api/collect.js
// 只写 5 列：昵称 / 年级 / 班级 / 第3关步数 / 是否看视频 ("是"/"否")
// 支持两种入参：
// A) { "fields": { "昵称":"小明","年级":"六年级","班级":"3班","第3关步数":8,"是否看视频":"是" } }
// B) { "name":"小明","grade":"六年级","class":"3班","l3_moves":8,"v_seen":true }

const ALLOW_ORIGINS = new Set([
  "https://celine0257.github.io",
  "https://piying-collector-site.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173",
]);

function cors(res, origin) {
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGINS.has(origin || "") ? origin : "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}
function ok(res, data) { res.status(200).json({ ok: true, ...data }); }
function bad(res, code, message, extra = {}) { res.status(code).json({ ok: false, message, ...extra }); }

// 统一把传参清洗成 5 个中文字段
function normalizeBody(body = {}) {
  if (body && typeof body === "object" && body.fields) {
    const f = body.fields;
    return {
      昵称: f["昵称"] ?? "",
      年级: f["年级"] ?? "",
      班级: f["班级"] ?? "",
      第3关步数: Number(f["第3关步数"] ?? f["第三关步数"] ?? 0) || 0,
      是否看视频: normYesNo(f["是否看视频"]),
    };
  }
  return {
    昵称: (body.name ?? "").toString(),
    年级: (body.grade ?? "").toString(),
    班级: (body.class ?? "").toString(),
    第3关步数: Number(body.l3_moves ?? body.moves ?? 0) || 0,
    是否看视频: normYesNo(body.v_seen),
  };
}
function normYesNo(v) {
  if (typeof v === "string") return v.trim() === "否" ? "否" : "是";
  if (typeof v === "boolean") return v ? "是" : "否";
  return String(v ?? "").trim() === "否" ? "否" : "是";
}

async function getTenantToken() {
  const r = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: process.env.FEISHU_APP_ID,
      app_secret: process.env.FEISHU_APP_SECRET,
    }),
  });
  const j = await r.json();
  if (!r.ok || j.code !== 0) throw new Error(`get token failed: ${JSON.stringify(j)}`);
  return j.tenant_access_token;
}

async function createRecord(token, fields) {
  const appToken = process.env.FEISHU_APP_TOKEN; // SLe...
  const tableId = process.env.FEISHU_TABLE_ID;   // tbl...
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  const j = await r.json();
  return { status: r.status, data: j };
}

export default async function handler(req, res) {
  cors(res, req.headers.origin);
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    return ok(res, {
      message: "health ok",
      seen: {
        token_mode: "app-id-secret",
        table_id_tail: (process.env.FEISHU_TABLE_ID || "").slice(-4),
        app_token_tail: (process.env.FEISHU_APP_TOKEN || "").slice(-4),
      },
    });
  }

  if (req.method !== "POST") return bad(res, 405, "Use POST");

  let body = {};
  try { body = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}"); }
  catch { return bad(res, 400, "Invalid JSON"); }

  const fields = normalizeBody(body);
  fields["是否看视频"] = fields["是否看视频"] === "否" ? "否" : "是";
  fields["第3关步数"] = Number(fields["第3关步数"]) || 0;

  let token;
  try { token = await getTenantToken(); }
  catch (e) { return bad(res, 500, "get_token_failed", { error: String(e) }); }

  try {
    const r = await createRecord(token, fields);
    if (r.status === 200 && r.data && r.data.code === 0) {
      return ok(res, { step: "create_record", feishu: r.data, fields, msg: "success" });
    }
    return bad(res, 502, "feishu_create_failed", { feishu: r.data, fields });
  } catch (e) {
    return bad(res, 500, "feishu_api_error", { error: String(e), fields });
  }
}
