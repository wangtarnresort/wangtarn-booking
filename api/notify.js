// Vercel Serverless Function — ส่งแจ้งเตือน "มีคิวจองใหม่" เข้า LINE ของเจ้าหน้าที่
// ต้องตั้งค่า Environment Variables ใน Vercel 2 ตัว:
//   LINE_CHANNEL_ACCESS_TOKEN  = Channel access token (long-lived) ของ Messaging API channel
//   LINE_ADMIN_USER_IDS        = LINE userId ของเจ้าหน้าที่ คั่นด้วยเครื่องหมายจุลภาค (,)

const ADMIN_URL = 'https://wangtarn-booking.vercel.app/admin.html';
const hits = new Map();

function tooMany(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 20; // เกิน 20 ครั้ง/10 นาที ต่อ IP ถือว่าผิดปกติ
}

function clean(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, max);
}

module.exports = async (req, res) => {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const adminIds = (process.env.LINE_ADMIN_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // เปิดลิงก์นี้ในเบราว์เซอร์เพื่อเช็คสถานะการตั้งค่า (ไม่แสดงค่าลับ)
  if (req.method === 'GET') {
    res.status(200).json({
      function: 'ok',
      tokenSet: Boolean(token),
      adminIdCount: adminIds.length,
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  if (!token || adminIds.length === 0) {
    res.status(500).json({ error: 'notification is not configured' });
    return;
  }

  const ip = String((req.headers['x-forwarded-for'] || '').split(',')[0] || 'unknown').trim();
  if (tooMany(ip)) {
    res.status(429).json({ error: 'too many requests' });
    return;
  }

  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const activity = clean(b.activity, 30);
  const resource = clean(b.resource, 40);
  const dateText = clean(b.dateText, 60);
  const timeText = clean(b.timeText, 120);
  const name = clean(b.name, 80);
  const phone = clean(b.phone, 20);
  const extra = clean(b.extra, 120);
  const total = Number(b.total);

  if (!activity || !dateText || !timeText || !name || !/^[0-9+\-\s]{6,20}$/.test(phone) ||
      !Number.isFinite(total) || total < 0 || total > 100000) {
    res.status(400).json({ error: 'invalid payload' });
    return;
  }

  const lines = [
    '🔔 มีคิวจองใหม่ (รอตรวจสอบการชำระเงิน)',
    `กิจกรรม: ${activity}${resource ? ' · ' + resource : ''}`,
    `วันที่: ${dateText}`,
    `เวลา: ${timeText}`,
    `ผู้จอง: ${name} (${phone})`,
    extra ? `รายละเอียด: ${extra}` : null,
    `ยอด: ${total.toLocaleString('en-US')} บาท`,
    '',
    `ตรวจสอบ/ยืนยัน: ${ADMIN_URL}`,
  ].filter((l) => l !== null);

  try {
    const r = await fetch('https://api.line.me/v2/bot/message/multicast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ to: adminIds, messages: [{ type: 'text', text: lines.join('\n') }] }),
    });
    if (!r.ok) {
      const detail = await r.text();
      console.error('LINE API error', r.status, detail);
      res.status(502).json({ error: 'line api error', status: r.status, detail: String(detail).slice(0, 300) });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'send failed' });
  }
};
