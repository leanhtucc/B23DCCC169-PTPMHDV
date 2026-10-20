# Lab 3 – Kết nối và duy trì kết nối giữa các service

Thực hành tự khám phá (sau buổi 7–8) · GVHD: ThS Nguyễn Việt Dũng · Node.js ≥ 18, Express 5, HTTP Keep-Alive Agent, Postman

## 1. Giới thiệu

Hệ thống thanh toán học phí gồm hai service giao tiếp qua HTTP:

| Service | Cổng | Vai trò |
|---|---|---|
| **Fee Service** (`src/fee.js`) | `4001` | Quản lý công nợ sinh viên, tạo lệnh thanh toán (`P1`, `P2`, …) và gọi sang ngân hàng |
| **Bank Service** (`src/bank.js`) | `4002` | Ngân hàng giả lập: trừ tiền, giới hạn hạn mức, chống trừ trùng bằng `Idempotency-Key`, thống kê tại `/stats` |

**Quy tắc nghiệp vụ**

- Công nợ chỉ giảm khi ngân hàng xác nhận trừ tiền thành công (`201`, `PAID`).
- Không bao giờ trừ tiền hai lần cho một lệnh thanh toán (`duplicates = 0`).
- Dù ngân hàng tắt, chậm hay đứt kết nối, `GET /students/{id}/fees` vẫn phải chạy bình thường và nhanh.

## 2. Cấu trúc thư mục

```text
BTWEB-20-11/
├── src/
│   ├── bank.js       # Bank Service (cổng 4002)
│   ├── fee.js        # Fee Service (cổng 4001)
│   ├── test-th2.js   # Tình huống 2: 20 thanh toán đồng thời + đo độ trễ GET /fees
│   ├── test-th3.js   # Tình huống 3: 200 thanh toán, 10 luồng, nghỉ 6s
│   └── test-th4.js   # Tình huống 4: 60 thanh toán với DROP_RATE / FAIL_RATE
├── package.json
└── README.md
```

## 3. Cài đặt và khởi động

```bash
npm install
```

Mở 3 terminal:

| Terminal | Lệnh | Mục đích |
|---|---|---|
| 1 | `npm run bank` (hoặc `node src/bank.js`) | Chạy Bank Service |
| 2 | `npm run fee` (hoặc `node src/fee.js`) | Chạy Fee Service |
| 3 | Lệnh kiểm thử / curl / Postman | Gọi thử |

Script có sẵn: `npm run test2`, `npm run test3`, `npm run test4`.

### Biến môi trường

| Biến | Service | Mặc định | Ý nghĩa |
|---|---|---|---|
| `BANK_URL` | Fee | `http://localhost:4002` | Địa chỉ ngân hàng |
| `DELAY_MS` | Bank | `0` | Trễ mỗi phản hồi (ms) |
| `FAIL_RATE` | Bank | `0` | Tỉ lệ trả `500` ngẫu nhiên (0–1) |
| `DROP_RATE` | Bank | `0` | Tỉ lệ cắt kết nối TCP sau khi đã trừ tiền (0–1) |

## 4. API

### 4.1 Fee Service – `http://localhost:4001`

| Method | Endpoint | Body | Mô tả |
|---|---|---|---|
| GET | `/students/:id/fees` | – | Xem công nợ. Dữ liệu mẫu: `1` = 50.000.000đ, `2` = 0đ, `3` = 3.200.000đ |
| POST | `/students/:id/payments` | `{"amount": 100000}` | Tạo lệnh thanh toán và gọi ngân hàng trừ tiền |

**GET `/students/1/fees`** → `200`

```json
{ "id": "1", "name": "Sinh viên 1", "fee": 50000000 }
```

**POST `/students/1/payments`** → `201`

```json
{ "paymentId": "P1", "status": "PAID", "amount": 100000, "remainingFee": 49900000, "chargeId": "CH1" }
```

**Mã phản hồi của `POST /students/:id/payments`**

| HTTP | `status` | Khi nào |
|---|---|---|
| 201 | `PAID` | Ngân hàng xác nhận đã trừ tiền |
| 400 | `FAILED` | `amount` không phải số dương, hoặc lớn hơn công nợ hiện tại (Fee Service từ chối, không gọi ngân hàng) |
| 402 | `FAILED` | Ngân hàng từ chối: vượt hạn mức 20.000.000đ/lệnh |
| 404 | – | Không có sinh viên (cũng áp dụng cho `GET /fees`) |
| 503 | `FAILED` | Không kết nối được ngân hàng (`ECONNREFUSED`), chắc chắn chưa trừ tiền |
| 504 | `PENDING` | Hết thời gian chờ hoặc đứt kết nối khi đang chờ, chưa biết đã trừ hay chưa |

### 4.2 Bank Service – `http://localhost:4002`

| Method | Endpoint | Header / Body | Mô tả |
|---|---|---|---|
| GET | `/stats` | – | Thống kê `{connections, requests, charges, duplicates}` |
| POST | `/charges` | Header `Idempotency-Key: P1`; Body `{"reference": "P1", "amount": 100000}` | Trừ tiền trực tiếp |

Phản hồi `POST /charges`: `201 {chargeId, reference, amount}` · `400` số tiền không hợp lệ · `402` vượt 20.000.000đ · `500` lỗi giả lập (`FAIL_RATE`). Gửi lại cùng `Idempotency-Key` sẽ trả lại kết quả cũ, không trừ tiền lần nữa.

## 5. Giải pháp kỹ thuật theo từng tình huống

| TH | Vấn đề | Giải pháp trong `fee.js` |
|---|---|---|
| 1 | Ngân hàng tắt rồi bật lại | Đọc `BANK_URL` từ env; bắt `ECONNREFUSED`/`ENOTFOUND` và trả ngay `503 FAILED`. Không cần khởi động lại Fee Service khi ngân hàng hoạt động lại |
| 2 | Ngân hàng chậm (`DELAY_MS=5000`) | Gọi bất đồng bộ; đặt hạn chót 4,2s tính từ lúc gọi (kể cả thời gian xếp hàng chờ socket trong agent, vì `req.setTimeout` chỉ đếm khi đã có socket). Quá hạn thì hủy request và trả `504 PENDING`. `GET /fees` không phụ thuộc ngân hàng |
| 3 | Duy trì kết nối | `http.Agent({ keepAlive: true, maxSockets: 15 })` tái sử dụng socket TCP; tự mở kết nối mới nếu ngân hàng đóng socket nhàn rỗi sau 5s |
| 4 | Đứt giữa chừng, lỗi tạm thời | Luôn gửi `Idempotency-Key = paymentId`; retry (tối đa 4 lần, tổng ≤ 4,2s) khi gặp `ECONNRESET` hoặc `500`; **không** retry khi gặp `400`/`402` |

## 6. Kịch bản kiểm thử (PowerShell)

Trước mỗi tình huống, **tắt hẳn rồi chạy lại cả bank và fee** (Ctrl+C). Lý do:

- Biến môi trường chỉ có hiệu lực khi khởi động.
- Bộ đếm `P1, P2…` của Fee và kho `Idempotency-Key` của bank phải cùng được đặt lại; nếu chỉ restart Fee, bank sẽ trả kết quả cũ cho mã trùng.
- Nếu báo `EADDRINUSE` (cổng 4001/4002 đang bị tiến trình cũ giữ), tắt tiến trình cũ trước. Server cũ vẫn chạy code cũ.

### Tình huống 1 – Ngân hàng tắt, rồi bật lại

```powershell
# Terminal 2 (chưa bật bank)
node src/fee.js

# Terminal 3 – kỳ vọng 503 FAILED trong < 1,5s; GET /fees vẫn 200
curl.exe -i -w "`nThoi gian: %{time_total}s`n" -X POST http://localhost:4001/students/1/payments -H "Content-Type: application/json" -d "{\"amount\": 100000}"
curl.exe -i http://localhost:4001/students/1/fees

# Terminal 1 – bật bank, rồi gọi lại thanh toán ở Terminal 3 → 201 PAID
node src/bank.js
```

### Tình huống 2 – Ngân hàng rất chậm

```powershell
# Terminal 1
$env:DELAY_MS="5000"; node src/bank.js

# Terminal 3 – 20 thanh toán đồng thời, đo GET /fees
node src/test-th2.js
```

### Tình huống 3 – Keep-Alive

```powershell
# Terminal 1
Remove-Item Env:\DELAY_MS -ErrorAction SilentlyContinue
node src/bank.js

# Terminal 2: chạy lại node src/fee.js
# Terminal 3 – 200 thanh toán, 10 luồng, nghỉ 6s rồi gửi tiếp
node src/test-th3.js
```

### Tình huống 4 – Lỗi tạm thời và bị từ chối

**4a – `DROP_RATE=0.3`**

```powershell
# Terminal 1
$env:DROP_RATE="0.3"; node src/bank.js
# Terminal 2: chạy lại node src/fee.js
# Terminal 3
node src/test-th4.js "4A - DROP_RATE=0.3"
```

**4b – `FAIL_RATE=0.3`**

```powershell
# Terminal 1
Remove-Item Env:\DROP_RATE -ErrorAction SilentlyContinue
$env:FAIL_RATE="0.3"; node src/bank.js
# Terminal 2: chạy lại node src/fee.js
# Terminal 3
node src/test-th4.js "4B - FAIL_RATE=0.3"
```

**4c – Thanh toán 25.000.000đ (vượt hạn mức)**

```powershell
# Terminal 1
Remove-Item Env:\FAIL_RATE -ErrorAction SilentlyContinue
node src/bank.js

# Terminal 3 – kỳ vọng 402 FAILED, bank nhận đúng 1 request (không retry)
curl.exe -i -X POST http://localhost:4001/students/1/payments -H "Content-Type: application/json" -d "{\"amount\": 25000000}"
curl.exe http://localhost:4002/stats
```

Đổi `BANK_URL` (kiểm tra TH1): `$env:BANK_URL="http://localhost:4999"; node src/fee.js` → hành vi vẫn là `503` nhanh.

## 7. Kết quả kiểm thử

Đo trên máy phát triển (Node 24), mỗi tình huống chạy với bank và fee khởi động mới.

| TH | Phép đo | Yêu cầu | Kết quả đo |
|---|---|---|---|
| 1 | Bank tắt, `POST /payments` | `503` + JSON, < 1,5s | `503 FAILED`, ~80ms |
| 1 | Bank tắt, `GET /fees` | `200` nhanh | `200`, ~2ms |
| 1 | Bank bật lại | `201` không restart Fee | Đạt |
| 2 | `DELAY_MS=5000`, 20 lệnh đồng thời | `504 PENDING`, ≤ 4,5s | `504 PENDING`, 4338ms |
| 2 | `GET /fees` trong lúc chờ | < 300ms | 17ms |
| 3 | 200 lệnh, 10 luồng | 200/200 | 200/200 (~233ms) |
| 3 | Số kết nối TCP (`connections`) | ≤ 20 | 11 |
| 3 | Gửi tiếp sau khi nghỉ 6s | Thành công | 5/5 |
| 4a | `DROP_RATE=0.3`, 60 lệnh | ≥ 54/60 `PAID`, `duplicates = 0` | 59/60 `PAID`, 1 `504 PENDING`, `duplicates = 0` |
| 4a | Công nợ | Giảm đúng tiền các lệnh `PAID` | Giảm 590.000đ = 59 × 10.000đ |
| 4b | `FAIL_RATE=0.3`, 60 lệnh | ≥ 54/60 `PAID`, không trừ hai lần | 60/60 `PAID`, `duplicates = 0` |
| 4c | Thanh toán 25.000.000đ | `402`, bank nhận đúng 1 request | `402 FAILED`, `requests = 1`, `charges = 0` |

### Trước và sau khi sửa

"Trước" là bản Fee Service tối giản: mỗi lần gọi mở kết nối mới (`agent: false`), không timeout, không retry, không gửi `Idempotency-Key`, mọi lỗi mạng trả `500`.

| TH | Chỉ số | Trước khi sửa | Sau khi sửa |
|---|---|---|---|
| 1 | Bank tắt, `POST /payments` | `500`, error rỗng (~45ms) | `503 FAILED`, có `error` (~80ms) |
| 1 | `GET /fees` | `200` (~2ms) | `200` (~2ms) |
| 2 | 20 lệnh đồng thời, `DELAY_MS=5000` | ~5174ms, chờ hết độ trễ của bank, không có `504` | 4338ms, `504 PENDING` |
| 2 | `GET /fees` khi đang chờ | 24ms | 17ms |
| 3 | `connections` cho 200 lệnh | 201 | 11 |
| 3 | Thành công / sau nghỉ 6s | 200/200 · 5/5 | 200/200 · 5/5 |
| 4a | `DROP_RATE=0.3`, 60 lệnh `PAID` | 37/60 (công nợ không phản ánh số tiền bank đã trừ: `charges` = 60) | 59/60, 1 `504 PENDING` |
| 4a | `duplicates` | 0 | 0 |
| 4b | `FAIL_RATE=0.3`, 60 lệnh `PAID` | 40/60 | 60/60 |
| 4b | `duplicates` | 0 | 0 |
| 4c | Thanh toán 25.000.000đ | `402`, bank nhận 1 request | `402`, bank nhận 1 request |

Bản "trước" ở 4c đã đúng vì không có cơ chế retry nào; điều cần giữ là bản "sau" (có retry) không retry lỗi `402`.

**Ghi chú**

- Trong 4a, `charges` có thể lớn hơn số lệnh `PAID`: bank đã trừ tiền nhưng Fee không nhận được xác nhận nên báo `PENDING` và không giảm công nợ. Đây là trạng thái "không biết đã trừ hay chưa" mà đề cho phép; `duplicates` vẫn phải bằng 0.
- Số liệu thay đổi theo máy và lần chạy (do tỉ lệ lỗi ngẫu nhiên). Ngưỡng đạt: 4a/4b ≥ 54/60.
- Số liệu "trước khi sửa" do bản Fee Service tối giản tạo ra (không nằm trong repo); nó chỉ nhằm so sánh.
