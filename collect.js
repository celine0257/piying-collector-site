// api/collect.js
export default async function handler(req, res) {
  if (req.method !== "POST") {
    // 健康页也返回你当前配置的末尾，方便核对
    return res.status(200).json({
      ok: false,
      message: "Use POST",
    });
  }

  // 读取环境变量（务必在 Vercel -> Settings -> Environment Variables 配好）
  const {
    FEISHU_APP_ID,
    FEISHU_APP_SECRET,
    FEISHU_APP_TOKEN, // 形如 SLe... 开头
    FEISHU_TABLE_ID,  // 形如 tbl... 开头
  } = process.env;

  // ----------- 1) 取 token -----------
  async function getTenantToken() {
    const r = await fetch(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET }),
      }
    );
    const j = await r.json();
    if (j.code !== 0 || !j.tenant_access_token) {
      throw new Error("get_token_failed:" + JSON.stringify(j));
    }
    return j.tenant_access_token;
  }

  // ----------- 2) 统一字段（只保留 5 个）-----------
  function normalizePayload(body) {
    // 兼容三种来源：body.feishu / 直接中文键 / 英文键
    const src = body?.feishu ?? body ?? {};

    const name =
      (src["昵称"] ?? src.name ?? "").toString().trim();
    const grade =
      (src["年级"] ?? src.grade ?? "").toString().trim();
    const klass =
      (src["班级"] ?? src.class ?? "").toString().trim();

    // 第3关步数：可能叫“第3关步数 / 第三关步数 / l3_moves / moves”
    const movesRaw =
      src["第3关步数"] ?? src["第三关步数"] ?? src.l3_moves ?? src.moves ?? src["步数"];
    const moves = Number(movesRaw ?? 0);

    // 是否看视频：统一转成 “是 / 否” （字符串）
    let seenRaw = src["是否看视频"];
    if (seenRaw === undefined) seenRaw = src.v_seen;
    if (typeof seenRaw === "boolean") {
      seenRaw = seenRaw ? "是" : "否";
    } else {
      const s = String(seenRaw ?? "").trim();
      if (s === "true") seenRaw = "是";
      else if (s === "false") seenRaw = "否";
      else if (s === "是" || s === "否") seenRaw = s;
      else if (s) seenRaw = s; // 允许你直接传“是/否”或“已看/未看”等（飞书字段里要配同名选项）
      else seenRaw = ""; // 不传
    }

    return {
      // 这里只返回 5 个字段，保证不会把“时间戳”等带上
      fields: {
        "昵称": name,
        "年级": grade,
        "班级": klass,
        "第3关步数": moves,
        "是否看视频": seenRaw, // **注意：一定是字符串**
      },
    };
  }

  // ----------- 3) 调飞书：新增记录 -----------
  async function createRecord(token, fields) {
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${FEISHU_TABLE_ID}/records`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields }),
    });
    const j = await r.json();
    return j;
  }

  try {
    const norm = normalizePayload(await readJSON(req));
    // 先最小化检查：字段名是否都存在
    const fields = norm.fields;

    // 只要这 5 个键
    const allowed = ["昵称", "年级", "班级", "第3关步数", "是否看视频"];
    Object.keys(fields).forEach(k => {
      if (!allowed.includes(k)) delete fields[k];
    });

    // 拿 token + 写入
    const token = await getTenantToken();
    const out = await createRecord(token, fields);

    if (out.code === 0) {
      return res.status(200).json({ ok: true, step: "create_record", feishu: out, msg: "success" });
    } else {
      return res.status(200).json({ ok: false, step: "create_record", feishu: out });
    }
  } catch (err) {
    return res.status(200).json({ ok: false, step: "exception", error: String(err?.message || err) });
  }
}

// 安全读 JSON（防止 "Error: Invalid JSON"）
async function readJSON(req) {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON");
  }
}
