// collect.js —— 前端把 5 个字段发到后端 API

const CLOUD_ENDPOINT = "https://piying-feishu-backend.vercel.app/api/collect";

/**
 * 直接传中文字段提交（推荐：与你表头完全一致）
 * @param {{昵称:string, 年级:string, 班级:string, 第3关步数:number, 是否看视频:"是"|"否"}} feishuFields
 */
async function submitFeishuFields(feishuFields) {
  const payload = { feishu: feishuFields };
  const resp = await fetch(CLOUD_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await resp.json();
  if (!resp.ok || !json.ok) {
    console.warn("上报失败：", json);
    throw new Error(json.message || json.error || "upload failed");
  }
  return json;
}

/**
 * 传英文键的简易提交（内部会转中文字段）
 * @param {{name:string, grade:string, class:string, l3_moves:number, v_seen:boolean|string}} rec
 */
async function submitRecord(rec) {
  const v = (rec.v_seen === true || rec.v_seen === "true") ? "是"
        : (rec.v_seen === false || rec.v_seen === "false") ? "否"
        : (rec.v_seen || "否");

  return submitFeishuFields({
    "昵称": rec.name || "",
    "年级": rec.grade || "",
    "班级": rec.class || "",
    "第3关步数": Number(rec.l3_moves) || 0,
    "是否看视频": v
  });
}

// —— 示例（集成到你通关回调里即可）——
// await submitRecord({ name:"小明", grade:"六年级", class:"3班", l3_moves:8, v_seen:true });
// 或：
// await submitFeishuFields({ "昵称":"小明", "年级":"六年级", "班级":"3班", "第3关步数":8, "是否看视频":"是" });

window.submitRecord = submitRecord;
window.submitFeishuFields = submitFeishuFields;
