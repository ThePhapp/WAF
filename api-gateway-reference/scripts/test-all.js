/**
 * Test Suite tự động kiểm thử toàn diện 5 yêu cầu của bài tập:
 * 1. Routing: Định tuyến /users và /orders
 * 2. Offloading: Kiểm tra JWT
 * 3. Offloading: Giới hạn 10 request/giây
 * 4. Aggregation: Endpoint /dashboard gộp thông tin user + orders
 * 5. Valet Key: Upload ảnh đại diện lên MinIO qua Pre-signed URL (hạn 5 phút)
 */

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:8081';
const DIRECT_USER_URL = process.env.DIRECT_USER_URL || 'http://localhost:3001';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let testResults = [];
function recordResult(testName, passed, details) {
  testResults.push({ testName, passed, details });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${icon} | ${testName}`);
  if (details) console.log(`       -> ${details}`);
}

async function runTests() {
  console.log('================================================================');
  console.log('    KIỂM THỬ TỰ ĐỘNG HỆ THỐNG MICROSERVICES & API GATEWAY');
  console.log('================================================================');
  console.log(`Gateway: ${GATEWAY_URL}\n`);

  let jwtToken = null;

  // -------------------------------------------------------------
  // TEST 1: GATEWAY ROUTING - PUBLIC LOGIN & ISSUING JWT
  // -------------------------------------------------------------
  try {
    const res = await fetch(`${GATEWAY_URL}/users/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'vana@example.com', password: 'password123' })
    });
    const data = await res.json();
    if (res.ok && data.token) {
      jwtToken = data.token;
      recordResult('1.1 Gateway Routing: Định tuyến POST /users/login tới user-service', true, 'Nhận JWT token hợp lệ (không in token)');
    } else {
      recordResult('1.1 Gateway Routing: POST /users/login', false, `Status: ${res.status}, Body: ${JSON.stringify(data)}`);
    }
  } catch (err) {
    recordResult('1.1 Gateway Routing: POST /users/login', false, err.message);
  }

  await sleep(120);

  // -------------------------------------------------------------
  // TEST 2: GATEWAY OFFLOADING - JWT VERIFICATION
  // -------------------------------------------------------------
  // 2.1 Request WITHOUT token -> Expect 401
  try {
    const res = await fetch(`${GATEWAY_URL}/users/profile`);
    if (res.status === 401) {
      recordResult('2.1 JWT Offloading: Chặn request khi thiếu token (HTTP 401)', true, 'Gateway trả về HTTP 401 Unauthorized');
    } else {
      recordResult('2.1 JWT Offloading: Chặn request thiếu token', false, `Mong đợi 401 nhưng nhận được ${res.status}`);
    }
  } catch (err) {
    recordResult('2.1 JWT Offloading: Chặn request thiếu token', false, err.message);
  }

  await sleep(120);

  // 2.2 Request with INVALID token -> Expect 401
  try {
    const res = await fetch(`${GATEWAY_URL}/users/profile`, {
      headers: { 'Authorization': 'Bearer token-gia-mao-invalid' }
    });
    if (res.status === 401) {
      recordResult('2.2 JWT Offloading: Chặn request khi token không hợp lệ (HTTP 401)', true, 'Gateway chặn token giả mạo');
    } else {
      recordResult('2.2 JWT Offloading: Chặn request token không hợp lệ', false, `Mong đợi 401 nhưng nhận được ${res.status}`);
    }
  } catch (err) {
    recordResult('2.2 JWT Offloading: Chặn token không hợp lệ', false, err.message);
  }

  await sleep(120);

  // 2.3 Request with VALID token -> Expect 200
  try {
    const res = await fetch(`${GATEWAY_URL}/users/profile`, {
      headers: { 'Authorization': `Bearer ${jwtToken}` }
    });
    const data = await res.json();
    if (res.ok && data.user) {
      recordResult('2.3 JWT Offloading: Cho phép request khi có JWT hợp lệ (HTTP 200)', true, `Lấy thành công user: ${data.user.name}`);
    } else {
      recordResult('2.3 JWT Offloading: Cho phép request có JWT hợp lệ', false, `Status: ${res.status}`);
    }
  } catch (err) {
    recordResult('2.3 JWT Offloading: Cho phép request có JWT hợp lệ', false, err.message);
  }

  await sleep(120);

  // -------------------------------------------------------------
  // TEST 3: GATEWAY ROUTING - ORDER SERVICE
  // -------------------------------------------------------------
  try {
    const res = await fetch(`${GATEWAY_URL}/orders`, {
      headers: { 'Authorization': `Bearer ${jwtToken}` }
    });
    const data = await res.json();
    if (res.ok && Array.isArray(data.orders)) {
      recordResult('3.1 Gateway Routing: Định tuyến GET /orders tới order-service', true, `Đã nhận danh sách ${data.orders.length} đơn hàng`);
    } else {
      recordResult('3.1 Gateway Routing: Định tuyến GET /orders', false, `Status: ${res.status}`);
    }
  } catch (err) {
    recordResult('3.1 Gateway Routing: Định tuyến GET /orders', false, err.message);
  }

  await sleep(120);

  // -------------------------------------------------------------
  // TEST 4: GATEWAY AGGREGATION - ENDPOINT /dashboard
  // -------------------------------------------------------------
  try {
    const res = await fetch(`${GATEWAY_URL}/dashboard`, {
      headers: { 'Authorization': `Bearer ${jwtToken}` }
    });
    const data = await res.json();
    if (res.ok && data.data && data.data.user && Array.isArray(data.data.orders)) {
      const hasUserData = Boolean(data.data.user.name);
      const hasOrdersData = data.data.orders.length > 0;
      if (hasUserData && hasOrdersData) {
        recordResult('4.1 Gateway Aggregation: Endpoint /dashboard gộp thành công User + Orders', true,
          `User: ${data.data.user.name} | Số đơn: ${data.data.orders.length} | Tổng chi tiêu: ${data.data.summary.totalSpent.toLocaleString()} VND`);
      } else {
        recordResult('4.1 Gateway Aggregation: Endpoint /dashboard', false, 'Dữ liệu gộp không đầy đủ');
      }
    } else {
      recordResult('4.1 Gateway Aggregation: Endpoint /dashboard', false, `Status: ${res.status}, Body: ${JSON.stringify(data)}`);
    }
  } catch (err) {
    recordResult('4.1 Gateway Aggregation: Endpoint /dashboard', false, err.message);
  }

  await sleep(120);

  // -------------------------------------------------------------
  // TEST 5: VALET KEY PATTERN - UPLOAD ẢNH ĐẠI DIỆN LÊN MINIO
  // -------------------------------------------------------------
  let presignedData = null;
  try {
    // 5.1 Yêu cầu tạo Pre-signed URL
    const res = await fetch(`${GATEWAY_URL}/users/avatar/presigned-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`
      },
      body: JSON.stringify({ filename: 'test-avatar.png', contentType: 'image/png' })
    });
    presignedData = await res.json();
    if (res.ok && presignedData.uploadUrl && presignedData.expiresInSeconds === 300) {
      recordResult('5.1 Valet Key: Sinh Pre-signed URL thành công', true,
        `URL hết hạn đúng sau 300 giây (5 phút) | Bucket: ${presignedData.bucket}`);
    } else {
      recordResult('5.1 Valet Key: Sinh Pre-signed URL', false, `Status: ${res.status}, Body: ${JSON.stringify(presignedData)}`);
    }
  } catch (err) {
    recordResult('5.1 Valet Key: Sinh Pre-signed URL', false, err.message);
  }

  await sleep(120);

  // 5.2 Upload trực tiếp ảnh nhị phân lên MinIO bằng URL có chữ ký (Valet Key direct upload)
  if (presignedData && presignedData.uploadUrl) {
    try {
      // Tạo một ảnh PNG mẫu nhỏ 8x8 pixels dạng buffer
      const dummyPngBytes = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x08,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x4B, 0x6D, 0x29, 0xDC, 0x00, 0x00, 0x00,
        0x1B, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x60, 0x60, 0xF8, 0x0F,
        0x00, 0x01, 0x04, 0x01, 0x00, 0x18, 0xDD, 0x8D, 0xB0, 0x00, 0x00, 0x00,
        0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
      ]);

      const uploadRes = await fetch(presignedData.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'image/png'
        },
        body: dummyPngBytes
      });

      if (uploadRes.ok) {
        recordResult('5.2 Valet Key: Client upload trực tiếp lên MinIO thành công', true,
          `HTTP ${uploadRes.status} Created/OK (Dữ liệu ảnh truyền thẳng tới MinIO, không qua API Gateway)`);
      } else {
        recordResult('5.2 Valet Key: Upload trực tiếp lên MinIO', false, `Status: ${uploadRes.status} ${await uploadRes.text()}`);
      }
    } catch (err) {
      recordResult('5.2 Valet Key: Upload trực tiếp lên MinIO', false, err.message);
    }

    await sleep(120);

    // 5.3 Xác nhận và cập nhật Avatar trong User Service
    try {
      const confirmRes = await fetch(`${GATEWAY_URL}/users/avatar/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({ objectKey: presignedData.objectKey })
      });
      const confirmData = await confirmRes.json();
      if (confirmRes.ok && confirmData.user && confirmData.user.avatarUrl) {
        recordResult('5.3 Valet Key: Cập nhật URL ảnh đại diện trong User Service thành công', true,
          `Avatar URL: ${confirmData.user.avatarUrl}`);
      } else {
        recordResult('5.3 Valet Key: Cập nhật Avatar', false, `Status: ${confirmRes.status}`);
      }
    } catch (err) {
      recordResult('5.3 Valet Key: Cập nhật Avatar', false, err.message);
    }
  }

  // -------------------------------------------------------------
  // TEST 6: GATEWAY OFFLOADING - RATE LIMITING (10 REQUEST/GIÂY)
  // Gửi dồn dập 15 request trong < 500ms để kích hoạt HTTP 429
  // -------------------------------------------------------------
  console.log('\nĐang thử nghiệm kích hoạt Rate Limit (gửi 15 request dồn dập trong 1 giây)...');
  try {
    const burstPromises = [];
    for (let i = 0; i < 15; i++) {
      burstPromises.push(
        fetch(`${GATEWAY_URL}/users/profile`, {
          headers: { 'Authorization': `Bearer ${jwtToken}` }
        }).then(r => r.status)
      );
    }
    const statuses = await Promise.all(burstPromises);
    const rateLimitedCount = statuses.filter(s => s === 429 || s === 503).length;
    const okCount = statuses.filter(s => s === 200).length;

    if (rateLimitedCount > 0) {
      recordResult('6.1 Rate Limiting Offloading: Chặn khi vượt 10 request/giây (HTTP 429)', true,
        `Đã chặn ${rateLimitedCount} request với status HTTP 429 Too Many Requests (Thành công: ${okCount})`);
    } else {
      recordResult('6.1 Rate Limiting Offloading: Chặn khi vượt 10 request/giây', false,
        `Không có request nào bị rate limit. Statuses: ${statuses.join(', ')}`);
    }
  } catch (err) {
    recordResult('6.1 Rate Limiting Offloading', false, err.message);
  }

  // -------------------------------------------------------------
  // TỔNG KẾT KẾT QUẢ
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log('                     BẢNG TỔNG KẾT KIỂM THỬ');
  console.log('================================================================');
  const totalPassed = testResults.filter(t => t.passed).length;
  console.log(`Kết quả: ${totalPassed}/${testResults.length} bài test VƯỢT QUA (${((totalPassed / testResults.length) * 100).toFixed(0)}%)\n`);

  if (totalPassed === testResults.length) {
    console.log('🎉 TẤT CẢ CÁC YÊU CẦU TRONG SLIDE ĐỀ BÀI ĐÃ ĐƯỢC THỰC THI CHÍNH XÁC!');
  } else {
    console.log('⚠️ Một số bài kiểm thử chưa đạt, vui lòng xem chi tiết phía trên.');
  }
}

runTests().catch(console.error);
