async function runSituation2() {
  console.log("Bắt đầu gửi đồng thời 20 yêu cầu thanh toán...");
  const startPayments = Date.now();

  const paymentPromises = Array.from({ length: 20 }, () =>
    fetch("http://localhost:4001/students/1/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 10000 }),
    }).then(async (r) => ({ status: r.status, body: await r.json() })),
  );

  await new Promise((r) => setTimeout(r, 500));
  const startFeeCheck = Date.now();
  const feeRes = await fetch("http://localhost:4001/students/1/fees");
  const feeTime = Date.now() - startFeeCheck;
  console.log(
    `GET /students/1/fees trả về mã ${feeRes.status} trong ${feeTime}ms (Yêu cầu < 300ms)`,
  );

  const results = await Promise.all(paymentPromises);
  const totalPaymentTime = Date.now() - startPayments;
  console.log(
    `20 thanh toán hoàn tất trong ${totalPaymentTime}ms (Yêu cầu <= 4500ms)`,
  );
  console.log("Mẫu phản hồi thanh toán:", results[0]);
}
runSituation2();
