/**
 * Benchmark Script: Đo độ trễ khi đi qua Gateway so với gọi thẳng Service
 *
 * BTVN: "Đo độ trễ khi đi qua gateway so với gọi thẳng service"
 * Microservices Architecture:
 * - Direct Service Call: http://localhost:3001/users/profile
 * - Gateway Call:        http://localhost:8081/users/profile
 */

const DIRECT_URL = process.env.DIRECT_URL || 'http://localhost:3001';
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:8081';
const NUM_REQUESTS = parseInt(process.env.NUM_REQUESTS || '50', 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '1', 10);

// Helper for delay
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Helper: Calculate statistics
function calculateStats(latencies) {
  if (latencies.length === 0) return { min: 0, max: 0, avg: 0, median: 0, p95: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = sum / sorted.length;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const median = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  return { min, max, avg, median, p95 };
}

async function loginToGetToken() {
  console.log('Logging in to obtain JWT token for protected endpoint testing...');
  const res = await fetch(`${GATEWAY_URL}/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'vana@example.com', password: 'password123' })
  });

  if (!res.ok) {
    throw new Error(`Failed to login via gateway: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  console.log(`JWT obtained successfully for user: ${data.user.name} (${data.user.id})\n`);
  return data.token;
}

async function measureSingleRequest(url, token) {
  const start = performance.now();
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  const duration = performance.now() - start;
  if (!res.ok) {
    throw new Error(`Request to ${url} failed with status ${res.status}`);
  }
  await res.json(); // parse response
  return duration;
}

async function runBenchmarkSuite() {
  console.log('================================================================');
  console.log('       KIẾN TRÚC PHẦN MỀM: BENCHMARK ĐỘ TRỄ API GATEWAY');
  console.log('================================================================');
  console.log(`Direct Target:  ${DIRECT_URL}/users/profile`);
  console.log(`Gateway Target: ${GATEWAY_URL}/users/profile`);
  console.log(`Sample Count:   ${NUM_REQUESTS} requests per target`);
  console.log('----------------------------------------------------------------\n');

  let token;
  try {
    token = await loginToGetToken();
  } catch (err) {
    console.error('Login error:', err.message);
    process.exit(1);
  }

  // Warm-up phase
  console.log('Warming up connection pools (5 requests each)...');
  for (let i = 0; i < 5; i++) {
    await measureSingleRequest(`${DIRECT_URL}/users/profile`, token);
    await measureSingleRequest(`${GATEWAY_URL}/users/profile`, token);
    await sleep(50);
  }
  console.log('Warm-up complete.\n');

  // Benchmark Direct Service
  console.log(`[1/2] Testing DIRECT call to User Service (${NUM_REQUESTS} requests)...`);
  const directLatencies = [];
  for (let i = 0; i < NUM_REQUESTS; i++) {
    try {
      const ms = await measureSingleRequest(`${DIRECT_URL}/users/profile`, token);
      directLatencies.push(ms);
      process.stdout.write(`\r  Progress: ${i + 1}/${NUM_REQUESTS} (Last: ${ms.toFixed(2)} ms)`);
      // Small delay to adhere to rate limits
      await sleep(30);
    } catch (err) {
      console.error(`\n  Request ${i + 1} error:`, err.message);
    }
  }
  console.log('\n  Done direct calls.\n');

  // Benchmark Gateway Call
  console.log(`[2/2] Testing call VIA API GATEWAY (${NUM_REQUESTS} requests)...`);
  const gatewayLatencies = [];
  for (let i = 0; i < NUM_REQUESTS; i++) {
    try {
      const ms = await measureSingleRequest(`${GATEWAY_URL}/users/profile`, token);
      gatewayLatencies.push(ms);
      process.stdout.write(`\r  Progress: ${i + 1}/${NUM_REQUESTS} (Last: ${ms.toFixed(2)} ms)`);
      // Respect rate limit of 10 req/s by spacing requests 110ms apart
      await sleep(110);
    } catch (err) {
      console.error(`\n  Request ${i + 1} error:`, err.message);
    }
  }
  console.log('\n  Done gateway calls.\n');

  // Calculate statistics
  const directStats = calculateStats(directLatencies);
  const gatewayStats = calculateStats(gatewayLatencies);

  const overheadMs = gatewayStats.avg - directStats.avg;
  const overheadPct = directStats.avg > 0 ? ((overheadMs / directStats.avg) * 100) : 0;

  // Print results
  console.log('================================================================');
  console.log('                    KẾT QUẢ ĐO ĐỘ TRỄ');
  console.log('================================================================');
  console.log(`| Chỉ số (Metric)       | Gọi Trực Tiếp (Direct) | Qua API Gateway   |`);
  console.log(`|-----------------------|------------------------|-------------------|`);
  console.log(`| Số lượng request      | ${String(directLatencies.length).padEnd(22)} | ${String(gatewayLatencies.length).padEnd(17)} |`);
  console.log(`| Min Latency           | ${(directStats.min.toFixed(2) + ' ms').padEnd(22)} | ${(gatewayStats.min.toFixed(2) + ' ms').padEnd(17)} |`);
  console.log(`| Max Latency           | ${(directStats.max.toFixed(2) + ' ms').padEnd(22)} | ${(gatewayStats.max.toFixed(2) + ' ms').padEnd(17)} |`);
  console.log(`| Average (Mean)        | ${(directStats.avg.toFixed(2) + ' ms').padEnd(22)} | ${(gatewayStats.avg.toFixed(2) + ' ms').padEnd(17)} |`);
  console.log(`| Median (p50)          | ${(directStats.median.toFixed(2) + ' ms').padEnd(22)} | ${(gatewayStats.median.toFixed(2) + ' ms').padEnd(17)} |`);
  console.log(`| 95th Percentile (p95) | ${(directStats.p95.toFixed(2) + ' ms').padEnd(22)} | ${(gatewayStats.p95.toFixed(2) + ' ms').padEnd(17)} |`);
  console.log(`================================================================`);
  console.log(`  -> Độ trễ tăng thêm (Overhead):  +${overheadMs.toFixed(2)} ms (${overheadPct > 0 ? '+' : ''}${overheadPct.toFixed(1)}%)`);
  console.log('================================================================\n');

  console.log('NHẬN XÉT VỀ MẶT KIẾN TRÚC PHẦN MỀM:');
  console.log('1. Độ trễ khi qua API Gateway cao hơn gọi trực tiếp do các yếu tố:');
  console.log('   - Thêm 1 chặng mạng (Network Hop): Client -> Gateway -> Service.');
  console.log('   - Gateway Offloading: Gateway phải xử lý kiểm tra Rate Limit (10 req/s) và xác thực JWT token (auth_request subrequest).');
  console.log('2. Đánh đổi kiến trúc (Architectural Trade-off):');
  console.log('   - Chi phí: Tăng độ trễ khoảng vài mili-giây.');
  console.log('   - Lợi ích: Đơn giản hóa kiến trúc backend, bảo mật tập trung (nếu token hỏng thì bị chặn ngay tại biên),');
  console.log('              giấu kín cấu trúc IP/port nội bộ của các microservice, bảo vệ chống DDoS/Spam bằng Rate Limiting,');
  console.log('              và giảm tải logic xác thực cho từng service con (Offloading pattern).');
}

runBenchmarkSuite().catch(console.error);
