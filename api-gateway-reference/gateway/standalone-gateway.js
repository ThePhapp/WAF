const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.GATEWAY_PORT || 8081;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key-ktpm-2026';

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3001';
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://localhost:3002';
const AGGREGATOR_SERVICE_URL = process.env.AGGREGATOR_SERVICE_URL || 'http://localhost:3003';

app.use(cors());

// -------------------------------------------------------------
// PATTERN: GATEWAY OFFLOADING - RATE LIMITING
// Giới hạn 10 request/giây tại Gateway (10 requests / 1000ms window)
// Trả về HTTP 429 Too Many Requests khi vượt ngưỡng
// -------------------------------------------------------------
const gatewayLimiter = rateLimit({
  windowMs: 1000, // 1 second window
  max: 10,        // Limit each IP to 10 requests per second
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429,
  message: {
    status: 'error',
    pattern: 'Gateway Offloading (Rate Limiting)',
    error: 'Too Many Requests',
    message: 'Rate limit of 10 requests/second exceeded at API Gateway.'
  }
});

app.use(gatewayLimiter);

// Gateway Health Check
app.get('/health', (req, res) => {
  res.json({
    gateway: 'Node.js API Gateway (Standalone)',
    status: 'UP',
    rateLimit: '10 requests/second',
    jwtOffloading: true,
    routing: {
      '/users': USER_SERVICE_URL,
      '/orders': ORDER_SERVICE_URL,
      '/dashboard': 'Gateway Aggregation'
    }
  });
});

// -------------------------------------------------------------
// PATTERN: GATEWAY OFFLOADING - JWT VERIFICATION MIDDLEWARE
// Gateway kiểm tra token tập trung trước khi chuyển tiếp vào các microservice.
// Các service phía sau không cần tự giải mã hay kiểm tra JWT nữa.
// -------------------------------------------------------------
const jwtOffloadingMiddleware = (req, res, next) => {
  // Public routes that bypass JWT verification
  const publicPaths = ['/users/login', '/users/register', '/login', '/register', '/health'];
  if (publicPaths.some(p => req.path.startsWith(p))) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      status: 'error',
      pattern: 'Gateway Offloading (JWT)',
      error: 'Unauthorized',
      message: 'Invalid or missing JWT token. Request rejected at API Gateway.'
    });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Attach decoded user info into forwarded headers for backend services
    req.headers['x-user-id'] = decoded.userId;
    req.headers['x-user-email'] = decoded.email;
    req.headers['x-user-role'] = decoded.role;
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      status: 'error',
      pattern: 'Gateway Offloading (JWT)',
      error: 'Unauthorized',
      message: 'JWT token verification failed at API Gateway.',
      details: err.message
    });
  }
};

app.use(jwtOffloadingMiddleware);

// -------------------------------------------------------------
// PATTERN: GATEWAY AGGREGATION
// Endpoint /dashboard gộp thông tin user và đơn hàng của user đó
// -------------------------------------------------------------
app.get(['/dashboard', '/dashboard/'], async (req, res) => {
  const userId = req.headers['x-user-id'] || req.query.userId || 'user-1';
  const startTime = Date.now();

  try {
    const [userRes, ordersRes] = await Promise.allSettled([
      fetch(`${USER_SERVICE_URL}/users/${userId}`, {
        headers: { 'X-User-Id': userId }
      }).then(r => r.json()),
      fetch(`${ORDER_SERVICE_URL}/orders/user/${userId}`, {
        headers: { 'X-User-Id': userId }
      }).then(r => r.json())
    ]);

    const user = userRes.status === 'fulfilled' ? userRes.value.user : null;
    const orders = ordersRes.status === 'fulfilled' ? (ordersRes.value.orders || []) : [];

    const totalSpent = orders.reduce((sum, ord) => sum + (ord.totalAmount || 0), 0);

    res.json({
      pattern: 'Gateway Aggregation',
      status: 'success',
      aggregatedAt: new Date().toISOString(),
      aggregationLatencyMs: Date.now() - startTime,
      data: {
        user,
        orders,
        summary: {
          totalOrders: orders.length,
          totalSpent,
          currency: 'VND'
        }
      }
    });
  } catch (err) {
    res.status(500).json({
      pattern: 'Gateway Aggregation',
      error: 'Failed to aggregate dashboard data',
      details: err.message
    });
  }
});

// -------------------------------------------------------------
// PATTERN: GATEWAY ROUTING
// Định tuyến /users -> User Service, /orders -> Order Service
// -------------------------------------------------------------
app.use('/users', createProxyMiddleware({
  target: USER_SERVICE_URL,
  changeOrigin: true,
  on: {
    proxyReq: (proxyReq, req) => {
      if (req.headers['x-user-id']) {
        proxyReq.setHeader('x-user-id', req.headers['x-user-id']);
      }
    }
  }
}));

app.use('/orders', createProxyMiddleware({
  target: ORDER_SERVICE_URL,
  changeOrigin: true,
  on: {
    proxyReq: (proxyReq, req) => {
      if (req.headers['x-user-id']) {
        proxyReq.setHeader('x-user-id', req.headers['x-user-id']);
      }
    }
  }
}));

app.listen(PORT, () => {
  console.log(`[API Gateway] Running on port ${PORT}`);
  console.log(`[API Gateway] Rate limit: 10 req/sec`);
  console.log(`[API Gateway] Routing /users -> ${USER_SERVICE_URL}`);
  console.log(`[API Gateway] Routing /orders -> ${ORDER_SERVICE_URL}`);
  console.log(`[API Gateway] Aggregation /dashboard active`);
});
