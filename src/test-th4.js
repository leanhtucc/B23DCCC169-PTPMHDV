async function run60Payments(label) {
  let paidCount = 0;
  let pending504Count = 0;

  const feeBefore = await (
    await fetch("http://localhost:4001/students/1/fees")
  ).json();

  for (let i = 0; i < 60; i++) {
    const res = await fetch("http://localhost:4001/students/1/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 10000 }),
    });
    const body = await res.json();
    if (res.status === 201 && body.status === "PAID") paidCount++;
    if (res.status === 504 && body.status === "PENDING") pending504Count++;
  }

  const feeAfter = await (
    await fetch("http://localhost:4001/students/1/fees")
  ).json();
  const bankStats = await (await fetch("http://localhost:4002/stats")).json();

  console.log(`=== KẾT QUẢ ${label} ===`);
  console.log(`Số lệnh PAID: ${paidCount}/60 (Yêu cầu >= 54/60)`);
  console.log(`Số lệnh 504 PENDING: ${pending504Count}`);
  console.log(
    `Công nợ đã giảm: ${feeBefore.fee - feeAfter.fee}đ (Tương ứng ${paidCount * 10000}đ)`,
  );
  console.log("Bank /stats:", bankStats);
}

run60Payments(process.argv[2] || "TEST");
