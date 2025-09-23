// api/collect.js —— 最终版（稳妥、带类型归一化 + CORS）
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  // 健康检查
  if (req.method === "GET") {
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json({
      ok: true,
      message: "health ok",
      seen: {
        token_mode: "app-id-secret",
        table_id_tail: (process.env.FEISHU_TABLE_ID || "").slice(-4),
        app_token_tail: (process.env.FEISHU_APP_TOKEN || "").slice(-4),
      },
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "Use POST" });
  }

  // ---------- 解析 Body（两种输入都兼容） ----------
  let body = {};
  try {
    body = req.body ?? {};
  } catch (e) {
    return res.status(400).json({ ok: false, step: "parse_body", error: String(e) });
  }

  // 允许两种结构：
  // A) 扁平：{ name, grade, class, l3_moves, v_seen }
  // B) feishu.fields：{ feishu: { 昵称, 年级, 班级, 第3关步数, 是否看视频 } }
  const hasFeishu = body?.feishu && typeof body.feishu === "object";

  const recordFields = hasFeishu ? {
    "昵称": body.feishu["昵称"] ?? "",
    "年级": body.feishu["年级"] ?? "",
    "班级": body.feishu["班级"] ?? "",
    "第3关步数": Number(body.feishu["第3关步数"] ?? 0),
    "是否看视频": (body.feishu["是否看视频"] ?? "") // 这里必须是 "是"/"否"
  } : {
    "昵称": (body.name ?? "").toString(),
    "年级": (body.grade ?? "").toString(),
    "班级": (body.class ?? "").toString(),
    "第3关步数": Number(body.l3_moves ?? body.moves ?? 0),
    "是否看视频": (body.v_seen === true || body.v_seen === "true" || body.v_seen === "是") ? "是" : "否",
  };

  // --------- 调飞书：先换 tenant_access_token ----------
  try {
    const tokenResp = await fetch((process.env.FEISHU_API_BASE || "https://open.feishu.cn") + "/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: process.env.FEISHU_APP_ID,
        app_secret: process.env.FEISHU_APP_SECRET,
      }),
    });
    const tokenJson = await tokenResp.json();
    if (!tokenResp.ok || tokenJson.code !== 0) {
      return res.status(500).json({ ok: false, step: "get_token", error: tokenJson });
    }

    const tenantToken = tokenJson.tenant_access_token;

    // --------- 新增记录（注意 Single-Select 必须是字符串 "是"/"否"） ----------
    const addResp = await fetch((process.env.FEISHU_API_BASE || "https://open.feishu.cn")
      + `/open-apis/bitable/v1/apps/${process.env.FEISHU_APP_TOKEN}/tables/${process.env.FEISHU_TABLE_ID}/records`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${tenantToken}`,
      },
      body: JSON.stringify({ fields: recordFields }),
    });

    const addJson = await addResp.json();

    if (!addResp.ok || addJson.code !== 0) {
      return res.status(400).json({ ok: false, step: "create_record", feishu: addJson });
    }

    return res.status(200).json({ ok: true, step: "create_record", feishu: addJson });

  } catch (e) {
    return res.status(500).json({ ok: false, step: "exception", error: String(e) });
  }
}
