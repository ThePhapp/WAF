const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { S3Client, PutObjectCommand, CreateBucketCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key-ktpm-2026';

app.use(cors());
app.use(express.json());

// In-memory User Database (Seeded with initial users)
const users = [
  {
    id: 'user-1',
    name: 'Nguyen Van A',
    email: 'vana@example.com',
    password: 'password123',
    avatarUrl: 'http://localhost:9000/avatars/default-avatar.png',
    role: 'customer',
    createdAt: '2026-01-15T08:00:00Z'
  },
  {
    id: 'user-2',
    name: 'Tran Thi B',
    email: 'thib@example.com',
    password: 'password123',
    avatarUrl: null,
    role: 'admin',
    createdAt: '2026-02-20T10:30:00Z'
  }
];

// MinIO / S3 Configuration
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'http://localhost:9000';
const MINIO_PUBLIC_ENDPOINT = process.env.MINIO_PUBLIC_ENDPOINT || 'http://localhost:9000';
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'minioadmin';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'minioadmin';
const BUCKET_NAME = process.env.MINIO_BUCKET || 'avatars';

// S3 Client configured for MinIO (forcePathStyle is essential for MinIO)
const s3Client = new S3Client({
  endpoint: MINIO_ENDPOINT,
  region: 'us-east-1',
  credentials: {
    accessKeyId: MINIO_ACCESS_KEY,
    secretAccessKey: MINIO_SECRET_KEY,
  },
  forcePathStyle: true,
});

// Client configured to generate pre-signed URLs accessible by external clients
const s3PresignClient = new S3Client({
  endpoint: MINIO_PUBLIC_ENDPOINT,
  region: 'us-east-1',
  credentials: {
    accessKeyId: MINIO_ACCESS_KEY,
    secretAccessKey: MINIO_SECRET_KEY,
  },
  forcePathStyle: true,
});

// Helper: Ensure avatars bucket exists
async function ensureBucketExists() {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }));
  } catch (err) {
    try {
      await s3Client.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }));
      console.log(`[User Service] Bucket "${BUCKET_NAME}" created successfully.`);
    } catch (createErr) {
      // Ignore if bucket already exists or MinIO is still booting
      console.warn(`[User Service] Notice on bucket check: ${createErr.message}`);
    }
  }
}

// Helper: Extract user from JWT or headers forwarded by Gateway
function extractUserFromRequest(req) {
  // If gateway verified token and forwarded headers
  const forwardedUserId = req.headers['x-user-id'];
  if (forwardedUserId) {
    return users.find(u => u.id === forwardedUserId) || null;
  }

  // Otherwise inspect Authorization header directly
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    return users.find(u => u.id === decoded.userId) || null;
  } catch (err) {
    return null;
  }
}

// -------------------------------------------------------------
// HEALTH CHECK
// -------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({ service: 'user-service', status: 'UP', timestamp: new Date().toISOString() });
});

// -------------------------------------------------------------
// PATTERN: GATEWAY OFFLOADING - JWT VERIFICATION ENDPOINT
// This endpoint is used by Nginx auth_request or Gateway middleware
// to offload JWT authentication before requests reach downstream services.
// -------------------------------------------------------------
app.get('/auth/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      status: 'error',
      message: 'Unauthorized: Missing or malformed Authorization header'
    });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = users.find(u => u.id === decoded.userId);

    if (!user) {
      return res.status(401).json({ status: 'error', message: 'User not found' });
    }

    // Set response headers so Nginx auth_request_set can capture them
    res.setHeader('X-User-Id', user.id);
    res.setHeader('X-User-Email', user.email);
    res.setHeader('X-User-Role', user.role);

    return res.status(200).json({
      valid: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (err) {
    return res.status(401).json({
      status: 'error',
      message: 'Unauthorized: Invalid or expired JWT token',
      details: err.message
    });
  }
});

// -------------------------------------------------------------
// AUTH ENDPOINTS (Public)
// -------------------------------------------------------------
// Register
app.post(['/users/register', '/register'], (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Missing required fields: name, email, password' });
  }

  if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'User with this email already exists' });
  }

  const newUser = {
    id: `user-${users.length + 1}`,
    name,
    email,
    password,
    avatarUrl: null,
    role: 'customer',
    createdAt: new Date().toISOString()
  };

  users.push(newUser);

  const token = jwt.sign(
    { userId: newUser.id, email: newUser.email, role: newUser.role },
    JWT_SECRET,
    { expiresIn: '2h' }
  );

  const { password: _, ...userWithoutPass } = newUser;
  res.status(201).json({
    message: 'User registered successfully',
    user: userWithoutPass,
    token
  });
});

// Login - returns JWT token
app.post(['/users/login', '/login'], (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email.toLowerCase() === (email || '').toLowerCase());

  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '2h' }
  );

  const { password: _, ...userWithoutPass } = user;
  res.json({
    message: 'Login successful',
    token,
    user: userWithoutPass
  });
});

// -------------------------------------------------------------
// USER MANAGEMENT ENDPOINTS
// -------------------------------------------------------------
// Get current user profile (Protected)
app.get(['/users/profile', '/profile'], (req, res) => {
  const user = extractUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized: Authentication required' });
  }

  const { password: _, ...userWithoutPass } = user;
  res.json({
    source: 'user-service',
    user: userWithoutPass
  });
});

// Get user by ID (Internal / Gateway lookup)
app.get(['/users/:id'], (req, res) => {
  const user = users.find(u => u.id === req.params.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const { password: _, ...userWithoutPass } = user;
  res.json({
    source: 'user-service',
    user: userWithoutPass
  });
});

// List all users
app.get('/users', (req, res) => {
  const safeUsers = users.map(({ password, ...u }) => u);
  res.json({
    source: 'user-service',
    count: safeUsers.length,
    users: safeUsers
  });
});

// -------------------------------------------------------------
// PATTERN: VALET KEY PATTERN
// Generate pre-signed PUT URL for direct avatar upload to MinIO.
// The URL expires in EXACTLY 5 minutes (300 seconds) as required.
// App server issues the valet key (signed URL); client streams directly to MinIO.
// -------------------------------------------------------------
app.post(['/users/avatar/presigned-url', '/avatar/presigned-url'], async (req, res) => {
  const user = extractUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized: Authentication required' });
  }

  const { filename = 'avatar.jpg', contentType = 'image/jpeg' } = req.body || {};
  const fileExtension = filename.split('.').pop() || 'jpg';
  const objectKey = `user-${user.id}-${Date.now()}.${fileExtension}`;

  // 5 minutes expiry = 300 seconds (BTVN Requirement)
  const EXPIRES_IN_SECONDS = 300;

  try {
    // Ensure bucket exists in MinIO
    await ensureBucketExists();

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: objectKey,
      ContentType: contentType,
    });

    // Generate pre-signed URL valid for 5 minutes
    const presignedUrl = await getSignedUrl(s3PresignClient, command, {
      expiresIn: EXPIRES_IN_SECONDS,
    });

    res.json({
      pattern: 'Valet Key',
      status: 'success',
      message: 'Pre-signed URL generated successfully. Upload directly to MinIO using HTTP PUT.',
      uploadUrl: presignedUrl,
      method: 'PUT',
      objectKey: objectKey,
      bucket: BUCKET_NAME,
      expiresInSeconds: EXPIRES_IN_SECONDS,
      expiresAt: new Date(Date.now() + EXPIRES_IN_SECONDS * 1000).toISOString(),
      directAccessUrl: `${MINIO_PUBLIC_ENDPOINT}/${BUCKET_NAME}/${objectKey}`,
      instructions: [
        `1. Send HTTP PUT request to "uploadUrl" with your image binary data.`,
        `2. Header "Content-Type: ${contentType}".`,
        `3. Direct upload bypasses API Gateway & User Service, saving server bandwidth.`,
        `4. URL expires in 5 minutes.`
      ]
    });
  } catch (err) {
    console.error('[User Service] Error generating pre-signed URL:', err);
    res.status(500).json({
      error: 'Failed to generate pre-signed URL',
      details: err.message
    });
  }
});

// Confirm avatar upload and link it to user profile
app.post(['/users/avatar/confirm', '/avatar/confirm'], (req, res) => {
  const user = extractUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized: Authentication required' });
  }

  const { objectKey } = req.body;
  if (!objectKey) {
    return res.status(400).json({ error: 'Missing objectKey in request body' });
  }

  const directAvatarUrl = `${MINIO_PUBLIC_ENDPOINT}/${BUCKET_NAME}/${objectKey}`;
  user.avatarUrl = directAvatarUrl;

  const { password: _, ...safeUser } = user;
  res.json({
    status: 'success',
    message: 'Avatar updated successfully',
    user: safeUser
  });
});

app.listen(PORT, () => {
  console.log(`[User Service] Running on port ${PORT}`);
  console.log(`[User Service] MinIO endpoint: ${MINIO_ENDPOINT}`);
  ensureBucketExists();
});
