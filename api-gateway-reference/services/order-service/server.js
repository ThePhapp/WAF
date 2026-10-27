const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

// In-memory Order Database (Seeded with orders)
const orders = [
  {
    id: 'ord-101',
    userId: 'user-1',
    items: [{ name: 'MacBook Pro M3 14-inch', quantity: 1, price: 42000000 }],
    totalAmount: 42000000,
    status: 'COMPLETED',
    createdAt: '2026-03-01T10:00:00Z'
  },
  {
    id: 'ord-102',
    userId: 'user-1',
    items: [{ name: 'Logitech MX Master 3S Mouse', quantity: 1, price: 2200000 }],
    totalAmount: 2200000,
    status: 'SHIPPED',
    createdAt: '2026-03-10T14:30:00Z'
  },
  {
    id: 'ord-201',
    userId: 'user-2',
    items: [{ name: 'Keychron Q1 Pro Wireless Keyboard', quantity: 1, price: 4500000 }],
    totalAmount: 4500000,
    status: 'PROCESSING',
    createdAt: '2026-03-15T09:15:00Z'
  }
];

// Health check
app.get('/health', (req, res) => {
  res.json({ service: 'order-service', status: 'UP', timestamp: new Date().toISOString() });
});

// List orders (filters by query ?userId=... or header X-User-Id forwarded by Gateway)
app.get(['/orders', '/orders/'], (req, res) => {
  const userId = req.query.userId || req.headers['x-user-id'];

  if (userId) {
    const userOrders = orders.filter(o => o.userId === userId);
    return res.json({
      source: 'order-service',
      userId,
      count: userOrders.length,
      orders: userOrders
    });
  }

  res.json({
    source: 'order-service',
    count: orders.length,
    orders
  });
});

// List orders for specific user
app.get('/orders/user/:userId', (req, res) => {
  const { userId } = req.params;
  const userOrders = orders.filter(o => o.userId === userId);
  res.json({
    source: 'order-service',
    userId,
    count: userOrders.length,
    orders: userOrders
  });
});

// Get order details by ID
app.get('/orders/:id', (req, res) => {
  const order = orders.find(o => o.id === req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  res.json({
    source: 'order-service',
    order
  });
});

// Create new order
app.post(['/orders', '/orders/'], (req, res) => {
  const userId = req.body.userId || req.headers['x-user-id'];
  const { items, totalAmount } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'Missing userId for order' });
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Order must contain at least one item' });
  }

  const calculatedTotal = totalAmount || items.reduce((sum, item) => sum + (item.price * (item.quantity || 1)), 0);

  const newOrder = {
    id: `ord-${orders.length + 101}`,
    userId,
    items,
    totalAmount: calculatedTotal,
    status: 'PENDING',
    createdAt: new Date().toISOString()
  };

  orders.push(newOrder);

  res.status(201).json({
    message: 'Order created successfully',
    order: newOrder
  });
});

app.listen(PORT, () => {
  console.log(`[Order Service] Running on port ${PORT}`);
});
