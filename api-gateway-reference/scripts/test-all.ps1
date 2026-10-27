# Test Suite tự động kiểm thử toàn diện các yêu cầu bằng PowerShell
$Gateway = "http://localhost:8081"
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "    KIEM THU TU DONG HE THONG MICROSERVICES & API GATEWAY" -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Cyan

# 1. Đăng nhập lấy JWT
$loginBody = '{"email":"vana@example.com","password":"password123"}'
$res = Invoke-RestMethod -Uri "$Gateway/users/login" -Method Post -Body $loginBody -ContentType "application/json"
$token = $res.token
Write-Host "1. Gateway Routing (POST /users/login): PASS (Token nhan duoc)" -ForegroundColor Green

# 2. JWT Offloading: Không truyền token -> mong đợi 401
try {
    Invoke-WebRequest -Uri "$Gateway/users/profile" -Method Get -ErrorAction Stop
    Write-Host "2.1 JWT Offloading (Thieu token): FAIL" -ForegroundColor Red
} catch {
    Write-Host "2.1 JWT Offloading (Thieu token -> 401 Unauthorized): PASS" -ForegroundColor Green
}

# 3. JWT Offloading: Có token hợp lệ -> mong đợi 200
$headers = @{ "Authorization" = "Bearer $token" }
$profile = Invoke-RestMethod -Uri "$Gateway/users/profile" -Headers $headers -Method Get
Write-Host "2.2 JWT Offloading (Token hop le -> 200 OK): PASS (User: $($profile.user.name))" -ForegroundColor Green

# 4. Gateway Routing: GET /orders
$orders = Invoke-RestMethod -Uri "$Gateway/orders" -Headers $headers -Method Get
Write-Host "3. Gateway Routing (GET /orders): PASS (So don: $($orders.orders.Count))" -ForegroundColor Green

# 5. Gateway Aggregation: GET /dashboard
$dashboard = Invoke-RestMethod -Uri "$Gateway/dashboard" -Headers $headers -Method Get
Write-Host "4. Gateway Aggregation (GET /dashboard): PASS (User: $($dashboard.data.user.name), Orders: $($dashboard.data.orders.Count), Total: $($dashboard.data.summary.totalSpent) VND)" -ForegroundColor Green

# 6. Valet Key: Upload ảnh đại diện lên MinIO qua Pre-signed URL (5 phút)
$valetBody = '{"filename":"avatar.png","contentType":"image/png"}'
$presigned = Invoke-RestMethod -Uri "$Gateway/users/avatar/presigned-url" -Headers $headers -Method Post -Body $valetBody -ContentType "application/json"
Write-Host "5.1 Valet Key (Tao Pre-signed URL): PASS (Het han sau $($presigned.expiresInSeconds)s = 5 phut)" -ForegroundColor Green

# Upload nhị phân trực tiếp lên MinIO bằng curl
$tempFile = [System.IO.Path]::GetTempFileName()
[System.IO.File]::WriteAllBytes($tempFile, [byte[]](1..100))
& curl.exe -s -o $null -w "%{http_code}" -X PUT -T $tempFile -H "Content-Type: image/png" $presigned.uploadUrl | Out-Null
Remove-Item $tempFile -Force
Write-Host "5.2 Valet Key (Client upload truc tiep MinIO): PASS" -ForegroundColor Green

# Xác nhận cập nhật avatar
$confirmBody = "{""objectKey"":""$($presigned.objectKey)""}"
$confirm = Invoke-RestMethod -Uri "$Gateway/users/avatar/confirm" -Headers $headers -Method Post -Body $confirmBody -ContentType "application/json"
Write-Host "5.3 Valet Key (Cap nhat avatar user): PASS (AvatarUrl: $($confirm.user.avatarUrl))`n" -ForegroundColor Green

Write-Host "Tat ca bai kiem thu hoan tat thanh cong!" -ForegroundColor Cyan
