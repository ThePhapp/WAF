# Benchmark Script: Đo độ trễ khi đi qua Gateway so với gọi trực tiếp Service
$DirectUrl = "http://localhost:3001/users/profile"
$GatewayUrl = "http://localhost:8081/users/profile"
$LoginUrl = "http://localhost:8081/users/login"
$NumRequests = 50

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "       KIẾN TRÚC PHẦN MỀM: BENCHMARK ĐỘ TRỄ API GATEWAY" -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Cyan

# 1. Đăng nhập lấy JWT
$loginBody = @{ email = "vana@example.com"; password = "password123" } | ConvertTo-Json
$loginResponse = Invoke-RestMethod -Uri $LoginUrl -Method Post -Body $loginBody -ContentType "application/json"
$token = $loginResponse.token
$headers = @{ "Authorization" = "Bearer $token" }

Write-Host "JWT Token lấy thành công cho: $($loginResponse.user.name)`n" -ForegroundColor Green

# 2. Đo Direct Call
Write-Host "[1/2] Đo gọi TRỰC TIẾP tới User Service ($NumRequests requests)..." -ForegroundColor Yellow
$directTimes = @()
for ($i = 1; $i -le $NumRequests; $i++) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $null = Invoke-RestMethod -Uri $DirectUrl -Headers $headers -Method Get
    $sw.Stop()
    $directTimes += $sw.Elapsed.TotalMilliseconds
    Start-Sleep -Milliseconds 30
}

# 3. Đo Gateway Call
Write-Host "[2/2] Đo gọi QUA API GATEWAY ($NumRequests requests)..." -ForegroundColor Yellow
$gatewayTimes = @()
for ($i = 1; $i -le $NumRequests; $i++) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $null = Invoke-RestMethod -Uri $GatewayUrl -Headers $headers -Method Get
    $sw.Stop()
    $gatewayTimes += $sw.Elapsed.TotalMilliseconds
    # Nghỉ 110ms để không vượt rate limit 10 req/s của gateway
    Start-Sleep -Milliseconds 110
}

# 4. Tính toán thống kê
$avgDirect = ($directTimes | Measure-Object -Average).Average
$minDirect = ($directTimes | Measure-Object -Minimum).Minimum
$maxDirect = ($directTimes | Measure-Object -Maximum).Maximum

$avgGateway = ($gatewayTimes | Measure-Object -Average).Average
$minGateway = ($gatewayTimes | Measure-Object -Minimum).Minimum
$maxGateway = ($gatewayTimes | Measure-Object -Maximum).Maximum

$diff = $avgGateway - $avgDirect
$pct = ($diff / $avgDirect) * 100

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "                    KẾT QUẢ ĐO ĐỘ TRỄ" -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ("Gọi trực tiếp: Min = {0:N2} ms | Max = {1:N2} ms | Avg = {2:N2} ms" -f $minDirect, $maxDirect, $avgDirect) -ForegroundColor White
Write-Host ("Qua Gateway:   Min = {0:N2} ms | Max = {1:N2} ms | Avg = {2:N2} ms" -f $minGateway, $maxGateway, $avgGateway) -ForegroundColor White
Write-Host "----------------------------------------------------------------"
Write-Host ("Độ trễ tăng thêm (Overhead): +{0:N2} ms (+{1:N1}%)" -f $diff, $pct) -ForegroundColor Magenta
Write-Host "================================================================`n" -ForegroundColor Cyan
