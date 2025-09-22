export default async function handler(req, res) {
  // 允许 CORS
  res.setHeader("Access-Control-Allow-Origin", "https://celine0257.github.io");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    // 预检请求直接返回 204
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "Use POST" });
  }

  try {
    const payload = req.body;

    // ✅ 调飞书 API
    const tokenResp = await fetch(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: process.env.FEISHU_APP_ID,
          app_secret: process.env.FEISHU_APP_SECRET,
        }),
      }
    );

    const { tenant_access_token } = await tokenResp.json();

    const feishuResp = await fetch(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${process.env.FEISHU_APP_TOKEN}/tables/${process.env.FEISHU_TABLE_ID}/records`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tenant_access_token}`,
        },
        body: JSON.stringify({
          fields: payload.fields,
        }),
      }
    );

    const feishuJson = await feishuResp.json();
    return res.status(200).json({ ok: true, step: "create_record", feishu: feishuJson });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || "server error" });
  }
}
