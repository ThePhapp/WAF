const { spawn } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

const services = [
  { name: 'user-service', dir: path.join(rootDir, 'services', 'user-service'), script: 'server.js' },
  { name: 'order-service', dir: path.join(rootDir, 'services', 'order-service'), script: 'server.js' },
  { name: 'aggregator-service', dir: path.join(rootDir, 'services', 'aggregator-service'), script: 'server.js' },
  { name: 'api-gateway', dir: path.join(rootDir, 'gateway'), script: 'standalone-gateway.js' }
];

const children = [];

console.log('================================================================');
console.log('       KHỞI CHẠY TẤT CẢ SERVICES VÀ GATEWAY (STANDALONE)');
console.log('================================================================');

services.forEach(svc => {
  const child = spawn('node', [svc.script], {
    cwd: svc.dir,
    stdio: 'inherit',
    env: { ...process.env, PORT: svc.name === 'user-service' ? 3001 : (svc.name === 'order-service' ? 3002 : (svc.name === 'aggregator-service' ? 3003 : 8081)), GATEWAY_PORT: 8081 }
  });

  child.on('error', err => {
    console.error(`[${svc.name}] Lỗi:`, err.message);
  });

  children.push(child);
});

process.on('SIGINT', () => {
  console.log('\nĐang dừng tất cả các service...');
  children.forEach(child => child.kill());
  process.exit(0);
});

process.on('SIGTERM', () => {
  children.forEach(child => child.kill());
  process.exit(0);
});
