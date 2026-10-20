const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sendPayment() {
  const res = await fetch("http://localhost:4001/students/1/payments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: 1000 }),
  });
  return res.status;
}

async function runSituation3() {
  const totalRequests = 200;
  const concurrency = 10;
  let successCount = 0;
  let currentIndex = 0;

  const startTime = Date.now();

  async function worker() {
    while (currentIndex < totalRequests) {
      currentIndex++;
      const status = await sendPayment();
      if (status === 201) successCount++;
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const duration = Date.now() - startTime;

  const statsRes = await fetch("http://localhost:4002/stats");
  const stats = await statsRes.json();

  console.log(
    `Hoàn thành: ${successCount}/${totalRequests} thanh toán trong ${duration}ms`,
  );
  console.log("Thống kê tại /stats:", stats);

  console.log("Đang chờ nhàn rỗi 6 giây để ngân hàng đóng kết nối cũ...");
  await sleep(6000);

  console.log("Gửi tiếp 5 yêu cầu sau khi nhàn rỗi 6 giây...");
  let afterIdleSuccess = 0;
  for (let i = 0; i < 5; i++) {
    if ((await sendPayment()) === 201) afterIdleSuccess++;
  }
  console.log(
    `Kết quả sau khi nhàn rỗi 6 giây: ${afterIdleSuccess}/5 thành công`,
  );
}
runSituation3();
