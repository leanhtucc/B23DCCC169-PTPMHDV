const express = require('express');
const http = require('http');

const app = express();
app.use(express.json());

const BANK_URL = process.env.BANK_URL || 'http://localhost:4002';

const students = {
  '1': { id: '1', name: 'Sinh viên 1', fee: 50000000 },
  '2': { id: '2', name: 'Sinh viên 2', fee: 0 },
  '3': { id: '3', name: 'Sinh viên 3', fee: 3200000 }
};

let paymentCounter = 1;


const bankAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 15,
  keepAliveMsecs: 1000
});

function callBankOnce(payload, idempotencyKey, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL('/charges', BANK_URL);
    const bodyData = JSON.stringify(payload);

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        agent: bankAgent,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyData),
          'Idempotency-Key': idempotencyKey
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          clearTimeout(deadline);
          let parsed = {};
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch (_) {}
          resolve({ statusCode: res.statusCode, body: parsed });
        });
      }
    );

    // Hạn chót tính từ lúc gọi (kể cả thời gian xếp hàng chờ socket trong agent),
    // khác req.setTimeout vốn chỉ bắt đầu đếm khi đã có socket.
    const deadline = setTimeout(() => {
      const err = new Error('Hết thời gian chờ phản hồi từ ngân hàng');
      err.code = 'ETIMEDOUT';
      req.destroy(err);
    }, timeoutMs);

    req.on('error', (err) => {
      clearTimeout(deadline);
      reject(err);
    });

    req.write(bodyData);
    req.end();
  });
}


async function processBankCharge(paymentId, amount) {
  const startTime = Date.now();
  const MAX_TOTAL_TIME_MS = 4200; 
  const MAX_ATTEMPTS = 4;

  let uncertainState = false; 

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const elapsed = Date.now() - startTime;
    const remainingTime = MAX_TOTAL_TIME_MS - elapsed;


    if (remainingTime <= 150) {
      break;
    }

    try {
      const response = await callBankOnce(
        { reference: paymentId, amount },
        paymentId, 
        remainingTime
      );


      if (response.statusCode === 201) {
        return {
          httpCode: 201,
          status: 'PAID',
          data: response.body
        };
      }

  
      if (response.statusCode >= 400 && response.statusCode < 500) {
        return {
          httpCode: response.statusCode,
          status: 'FAILED',
          error: response.body.error || 'Ngân hàng từ chối giao dịch'
        };
      }


      if (response.statusCode >= 500) {
        if (attempt === MAX_ATTEMPTS) {
          return {
            httpCode: uncertainState ? 504 : 503,
            status: uncertainState ? 'PENDING' : 'FAILED',
            error: 'Ngân hàng gặp lỗi tạm thời (500)'
          };
        }
        continue;
      }
    } catch (err) {
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        return {
          httpCode: 503,
          status: 'FAILED',
          error: 'Không kết nối được tới ngân hàng'
        };
      }


      uncertainState = true;

   
      if (err.code === 'ETIMEDOUT') {
        return {
          httpCode: 504,
          status: 'PENDING',
          error: 'Hết thời gian chờ ngân hàng phản hồi'
        };
      }


    }
  }

  return {
    httpCode: uncertainState ? 504 : 503,
    status: uncertainState ? 'PENDING' : 'FAILED',
    error: 'Không xác định được trạng thái giao dịch sau khi thử lại'
  };
}


app.get('/students/:id/fees', (req, res) => {
  const student = students[req.params.id];
  if (!student) {
    return res.status(404).json({ error: 'Không tìm thấy sinh viên' });
  }
  return res.status(200).json(student);
});


app.post('/students/:id/payments', async (req, res) => {
  const student = students[req.params.id];
  if (!student) {
    return res.status(404).json({ error: 'Không tìm thấy sinh viên' });
  }

  const { amount } = req.body || {};
  const paymentId = `P${paymentCounter++}`;

  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({
      error: 'Số tiền thanh toán không hợp lệ',
      paymentId,
      status: 'FAILED'
    });
  }

  if (amount > student.fee) {
    return res.status(400).json({
      error: 'Số tiền thanh toán vượt quá công nợ hiện tại',
      paymentId,
      status: 'FAILED'
    });
  }

  const result = await processBankCharge(paymentId, amount);


  if (result.status === 'PAID') {
    student.fee -= amount;
    return res.status(201).json({
      paymentId,
      status: 'PAID',
      amount,
      remainingFee: student.fee,
      chargeId: result.data.chargeId
    });
  }
  return res.status(result.httpCode).json({
    error: result.error,
    paymentId,
    status: result.status
  });
});

app.listen(4001, () => {
  console.log(`[Fee Service] Đang chạy tại cổng 4001 | BANK_URL=${BANK_URL}`);
});