const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3001';
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://localhost:3002';

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ service: 'aggregator-service', status: 'UP', timestamp: new Date().toISOString() });
});

// -------------------------------------------------------------
// PATTERN: GATEWAY AGGREGATION
// Endpoint /dashboard aggregates user info + order info into 1 single response.
// Executes parallel requests to User Service and Order Service.
// Supports fault tolerance / partial response if one service is down.
// -------------------------------------------------------------
app.get(['/dashboard', '/dashboard/'], async (req, res) => {
  const startTime = Date.now();

  // Extract userId from Gateway forwarded header or query parameter
  const userId = req.headers['x-user-id'] || req.query.userId || 'user-1';
  const authHeader = req.headers.authorization;

  const fetchOptions = {
    headers: {
      ...(authHeader ? { Authorization: authHeader } : {}),
      'X-User-Id': userId
    },
    // 5 seconds timeout
    signal: AbortSignal.timeout(5000)
  };

  try {
    // Parallel fetching from User Service and Order Service (Concurrent fan-out)
    const [userResult, ordersResult] = await Promise.allSettled([
      fetch(`${USER_SERVICE_URL}/users/${userId}`, fetchOptions).then(async r => {
        if (!r.ok) throw new Error(`User service returned ${r.status}`);
        return r.json();
      }),
      fetch(`${ORDER_SERVICE_URL}/orders/user/${userId}`, fetchOptions).then(async r => {
        if (!r.ok) throw new Error(`Order service returned ${r.status}`);
        return r.json();
      })
    ]);

    const user = userResult.status === 'fulfilled' ? userResult.value.user : null;
    const ordersData = ordersResult.status === 'fulfilled' ? ordersResult.value : null;
    const orders = ordersData ? ordersData.orders : [];

    // Calculate aggregated metrics
    const totalSpent = orders.reduce((sum, ord) => sum + (ord.totalAmount || 0), 0);
    const orderStatuses = orders.reduce((acc, ord) => {
      acc[ord.status] = (acc[ord.status] || 0) + 1;
      return acc;
    }, {});

    const processingDurationMs = Date.now() - startTime;

    res.json({
      pattern: 'Gateway Aggregation',
      status: 'success',
      aggregatedAt: new Date().toISOString(),
      aggregationLatencyMs: processingDurationMs,
      data: {
        user: user || {
          id: userId,
          error: 'User service unavailable or user not found',
          details: userResult.reason?.message
        },
        orders: orders,
        summary: {
          totalOrders: orders.length,
          totalSpent: totalSpent,
          orderStatuses: orderStatuses,
          currency: 'VND'
        }
      },
      partialFailures: {
        userServiceFailed: userResult.status === 'rejected',
        orderServiceFailed: ordersResult.status === 'rejected'
      }
    });
  } catch (err) {
    console.error('[Aggregator Service] Aggregation error:', err);
    res.status(500).json({
      pattern: 'Gateway Aggregation',
      status: 'error',
      message: 'Failed to aggregate dashboard data',
      details: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`[Aggregator Service] Running on port ${PORT}`);
  console.log(`[Aggregator Service] User service target: ${USER_SERVICE_URL}`);
  console.log(`[Aggregator Service] Order service target: ${ORDER_SERVICE_URL}`);
});
