// === 简单可复用的采集SDK（浏览器端） ===
// 会向你的后端 POST JSON： https://piying-feishu-backend.vercel.app/api/collect
// 用法：window.Collect.send(payload[, options])

(() => {
  const ENDPOINT = 'https://piying-feishu-backend.vercel.app/api/collect';

  // 校验并规范字段（你的后端会做最终校验，这里做基础防呆）
  function normalize(data = {}) {
    const out = {
      name: String(data.name ?? '').slice(0, 40) || '未命名同学',
      grade: String(data.grade ?? '').slice(0, 10) || '未填年级',
      class: String(data.class ?? '').slice(0, 10) || '未填班级',
      time_sec: Number.isFinite(+data.time_sec) ? Math.max(0, +data.time_sec) : 0,
      l3_moves: Number.isFinite(+data.l3_moves) ? Math.max(0, +data.l3_moves) : 0,
      v_seen: Boolean(data.v_seen),
      timestamp: data.timestamp ? String(data.timestamp) : new Date().toISOString(),
    };
    return out;
  }

  async function postJSON(url, body) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      mode: 'cors', // 你的后端已允许 CORS
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    let json;
    try { json = JSON.parse(text) } catch { json = {raw:text} }
    if (!resp.ok) {
      const msg = json?.error || resp.status + ' ' + resp.statusText;
      throw new Error(msg);
    }
    return json;
  }

  /**
   * 发送数据
   * @param {Object} payload - {name, grade, class, time_sec, l3_moves, v_seen, timestamp}
   * @param {Object} options - {dryRun:boolean} 仅测试通路，不入库
   */
  async function send(payload, options = {}) {
    const norm = normalize(payload);
    const url = options.dryRun ? `${ENDPOINT}?dry=1` : ENDPOINT;
    // 附带来源信息，便于后端/表格统计
    norm._client = 'github-pages';
    norm._ua = navigator.userAgent.slice(0,160);
    norm._page = location.href;
    return await postJSON(url, norm);
  }

  // 暴露到全局（给游戏里直接调用）
  window.Collect = { send };
})();
