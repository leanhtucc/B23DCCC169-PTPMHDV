const express = require('express');
const app = express();
app.use(express.json());

const DELAY_MS = Number(process.env.DELAY_MS || 0);
const FAIL_RATE = Number(process.env.FAIL_RATE || 0);
const DROP_RATE = Number(process.env.DROP_RATE || 0);

const stats = {
  connections: 0,
  requests: 0,
  charges: 0,
  duplicates: 0
};

const idempotencyStore = new Map(); 
const chargedReferences = new Set(); 
let chargeCounter = 1;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));


app.get('/stats', (req, res) => {
  res.json(stats);
});


app.post('/charges', async (req, res) => {
  stats.requests++;
  const idempotencyKey = req.header('Idempotency-Key');
  const { reference, amount } = req.body || {};


  if (DELAY_MS > 0) {
    await sleep(DELAY_MS);
  }


  if (FAIL_RATE > 0 && Math.random() < FAIL_RATE) {
    return res.status(500).json({ error: 'Bank internal server error' });
  }


  if (idempotencyKey && idempotencyStore.has(idempotencyKey)) {
    const savedTx = idempotencyStore.get(idempotencyKey);
    if (DROP_RATE > 0 && Math.random() < DROP_RATE) {
      return req.socket.destroy();
    }
    return res.status(201).json(savedTx);
  }

  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Số tiền không hợp lệ' });
  }
  if (amount > 20000000) {
    return res.status(402).json({ error: 'Vượt hạn mức 20.000.000đ' });
  }

  stats.charges++;
  if (chargedReferences.has(reference)) {
    stats.duplicates++;
  } else {
    chargedReferences.add(reference);
  }

  const txResult = {
    chargeId: `CH${chargeCounter++}`,
    reference,
    amount
  };

  if (idempotencyKey) {
    idempotencyStore.set(idempotencyKey, txResult);
  }

  // 6. Giả lập trừ tiền xong rồi cắt kết nối trước khi trả lời (DROP_RATE)
  if (DROP_RATE > 0 && Math.random() < DROP_RATE) {
    return req.socket.destroy();
  }

  return res.status(201).json(txResult);
});

const server = app.listen(4002, () => {
  console.log(
    `[Bank Service] Đang chạy tại cổng 4002 | DELAY_MS=${DELAY_MS}, FAIL_RATE=${FAIL_RATE}, DROP_RATE=${DROP_RATE}`
  );
});

// Giữ kết nối nhàn rỗi tối đa 5 giây (mặc định của Node.js)
server.keepAliveTimeout = 5000;

// Đếm và in log mỗi khi có kết nối TCP mới
server.on('connection', (socket) => {
  stats.connections++;
  console.log(
    `[Bank TCP] Kết nối mới #${stats.connections} từ ${socket.remoteAddress}:${socket.remotePort}`
  );
});