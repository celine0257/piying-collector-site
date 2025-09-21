// ===== 你的后端地址（已为你填写好，可直接用） =====
const API_BASE = "https://piying-feishu-backend.vercel.app/api";
// 在页面上展示用
window.__COLLECT_API__ = API_BASE;

const JSON_HEADERS = {
  "Content-Type": "application/json"
};

function withTimeout(promise, ms = 15000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("请求超时（15s）")), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

async function postJSON(url, data) {
  const res = await withTimeout(fetch(url, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(data)
  }));
  if (!res.ok) {
    const txt = await res.text().catch(()=> "");
    throw new Error(`HTTP ${res.status}: ${txt || res.statusText}`);
  }
  return res.json();
}

async function getJSON(url) {
  const res = await withTimeout(fetch(url));
  if (!res.ok) {
    const txt = await res.text().catch(()=> "");
    throw new Error(`HTTP ${res.status}: ${txt || res.statusText}`);
  }
  return res.json();
}

// ===== 向后端发送通关记录 =====
// payload 格式： {
//   name, grade, class, time_sec, l3_moves, v_seen, timestamp
// }
// opts.dry 为 true 时仅测试通路，不入库
async function send(payload, opts = {}) {
  // 基本校验，避免把空记录打到库里
  const p = Object.assign({}, payload);
  if (!p.name) p.name = "匿名";
  if (!p.grade) p.grade = "未填";
  if (!p.class) p.class = "未填";
  if (typeof p.time_sec !== "number") p.time_sec = Number(p.time_sec) || 0;
  if (typeof p.l3_moves !== "number") p.l3_moves = Number(p.l3_moves) || 0;
  if (!p.v_seen) p.v_seen = "否";
  if (!p.timestamp) p.timestamp = new Date().toISOString();

  const url = `${API_BASE}/collect${opts.dry ? "?dry=1" : ""}`;
  return postJSON(url, p);
}

// ===== 连通性检测：/ping =====
async function ping() {
  return getJSON(`${API_BASE}/ping`);
}

// ===== 暴露全局，便于游戏里直接调用 =====
window.Collect = { send, ping };
