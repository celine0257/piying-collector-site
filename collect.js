// /api/collect.js
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.status(200).json({ ok: false, message: "Use POST" });
  }
  if (req.method !== "POST") {
    return res.status(200).json({ ok: false, message: "Use POST" });
  }

  try {
    const body = await readJSON(req);

    // -------- 只保留你表里存在的 5 列 --------
    const feishuFields =
      body.feishu && typeof body.feishu === "object"
        ? {
            "昵称": body.feishu["昵称"] ?? "",
            "年级": body.feishu["年级"] ?? "",
            "班级": body.feishu["班级"] ?? "",
            "第3关步数": body.feishu["第3关步数"] ?? body.feishu["第三关步数"] ?? 0,
            "是否看视频": body.feishu["是否看视频"] ?? ""
          }
        : {
            "昵称": (body.name ?? "").toString(),
            "年级": (body.grade ?? "").toString(),
            "班级": (body.class ?? "").toString(),
            "第3关步数": Number(body.l3_moves ?? body.moves ?? 0),
            "是否看视频": (body.v_seen ? "是" : "否")
          };

    // ===== 获取 tenant_access_token =====
    const tokenResp = await fetch(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: process.env.FEISHU_APP_ID,
          app_secret: process.env.FEISHU_APP_SECRET
        })
      }
    );
    const tokenData = await tokenResp.json();
    if (!tokenResp.ok || tokenData.code !== 0) {
      return res.status(200).json({
        ok: false,
        step: "get_token",
        error: tokenData,
        message: `get_token_failed:${tokenData.code}:${tokenData.msg}`
      });
    }
    const accessToken = tokenData.tenant_access_token;

    // ===== 写多维表格：只发 5 列 =====
    const appToken = process.env.FEISHU_APP_TOKEN;   // 以 SLe... 开头
    const tableId  = process.env.FEISHU_TABLE_ID;    // 以 tbl... 开头

    const createResp = await fetch(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Authorization": `Bearer ${accessToken}`
        },
        body: JSON.stringify({ fields: feishuFields })
      }
    );
    const createData = await createResp.json();

    if (!createResp.ok || createData.code !== 0) {
      return res.status(200).json({
        ok: false,
        step: "create_record",
        feishu: createData
      });
    }

    return res.status(200).json({
      ok: true,
      step: "create_record",
      feishu: createData
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e) });
  }
}

async function readJSON(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}
