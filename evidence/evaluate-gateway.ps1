$ErrorActionPreference = 'Stop'

$Gateway = 'http://localhost:8081'
$DirectUser = 'http://localhost:3001'
$WafDirect = 'http://localhost:3000'
$WafProtected = 'http://localhost:8080'

function Invoke-CheckedRequest {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [ValidateSet('GET', 'POST', 'PUT')][string]$Method = 'GET',
        [hashtable]$Headers = @{},
        [object]$Body = $null,
        [string]$ContentType = $null
    )

    for ($attempt = 1; $attempt -le 8; $attempt++) {
    try {
        $params = @{
            Uri = $Uri
            Method = $Method
            Headers = $Headers
            TimeoutSec = 20
            ErrorAction = 'Stop'
        }
        if ($null -ne $Body) {
            $params.Body = $Body
            $params.ContentType = if ($ContentType) { $ContentType } else { 'application/json' }
        }
        $response = Invoke-WebRequest @params
        $result = [pscustomobject]@{
            Status = [int]$response.StatusCode
            Content = [string]$response.Content
        }
    }
    catch {
        $status = 0
        if ($_.Exception.Response) {
            $status = [int]$_.Exception.Response.StatusCode
        }
        $result = [pscustomobject]@{
            Status = $status
            Content = ''
        }
    }
    if ($result.Status -ne 429 -or $attempt -eq 8) { return $result }
    Start-Sleep -Milliseconds 300
    }
}

function Get-Percentile {
    param([double[]]$Values, [double]$Percentile)
    $sorted = @($Values | Sort-Object)
    if ($sorted.Count -eq 0) { return 0 }
    $index = [math]::Max(0, [math]::Ceiling($sorted.Count * $Percentile) - 1)
    return [math]::Round([double]$sorted[$index], 2)
}

function Measure-Latency {
    param([string]$Uri, [hashtable]$Headers, [int]$Count = 20)
    $values = [System.Collections.Generic.List[double]]::new()
    $statusCodes = [System.Collections.Generic.List[int]]::new()
    $client = [System.Net.Http.HttpClient]::new()
    for ($warmup = 0; $warmup -lt 2; $warmup++) {
        $warmupRequest = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $Uri)
        if ($Headers.Authorization) {
            $warmupRequest.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::Parse($Headers.Authorization)
        }
        $warmupResponse = $client.SendAsync($warmupRequest).GetAwaiter().GetResult()
        $warmupResponse.Dispose()
        $warmupRequest.Dispose()
    }
    for ($i = 0; $i -lt $Count; $i++) {
        $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $Uri)
        if ($Headers.Authorization) {
            $request.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::Parse($Headers.Authorization)
        }
        $watch = [System.Diagnostics.Stopwatch]::StartNew()
        $response = $client.SendAsync($request).GetAwaiter().GetResult()
        $watch.Stop()
        $statusCodes.Add([int]$response.StatusCode)
        if ([int]$response.StatusCode -eq 200) {
            $values.Add($watch.Elapsed.TotalMilliseconds)
        }
        $response.Dispose()
        $request.Dispose()
        Start-Sleep -Milliseconds 120
    }
    $client.Dispose()
    $array = @($values)
    return [pscustomobject]@{
        Uri = $Uri
        Requests = $Count
        Successful = $array.Count
        Statuses = (($statusCodes | Group-Object | Sort-Object Name | ForEach-Object { "$($_.Name)x$($_.Count)" }) -join ',')
        MeanMs = if ($array.Count) { [math]::Round(($array | Measure-Object -Average).Average, 2) } else { 0 }
        P50Ms = Get-Percentile -Values $array -Percentile 0.50
        P95Ms = Get-Percentile -Values $array -Percentile 0.95
    }
}

Write-Output '=== REFERENCE GATEWAY EVALUATION ==='
Start-Sleep -Seconds 2

$gatewayHealth = Invoke-CheckedRequest -Uri "$Gateway/health"
$userHealth = Invoke-CheckedRequest -Uri "$DirectUser/health"
$wafDirectHealth = Invoke-CheckedRequest -Uri $WafDirect
$wafProtectedHealth = Invoke-CheckedRequest -Uri $WafProtected

$loginBody = (@{ email = 'vana@example.com'; password = 'password123' } | ConvertTo-Json -Compress)
$login = Invoke-CheckedRequest -Uri "$Gateway/users/login" -Method POST -Body $loginBody
if ($login.Status -ne 200 -or -not $login.Content) { throw "Gateway login failed: HTTP $($login.Status)" }
$loginJson = $login.Content | ConvertFrom-Json
$token = [string]$loginJson.token
$authHeaders = @{ Authorization = "Bearer $token" }

$missingToken = Invoke-CheckedRequest -Uri "$Gateway/users/profile"
$invalidToken = Invoke-CheckedRequest -Uri "$Gateway/users/profile" -Headers @{ Authorization = 'Bearer invalid-token' }
$validProfile = Invoke-CheckedRequest -Uri "$Gateway/users/profile" -Headers $authHeaders
$orders = Invoke-CheckedRequest -Uri "$Gateway/orders" -Headers $authHeaders
$dashboard = Invoke-CheckedRequest -Uri "$Gateway/dashboard" -Headers $authHeaders
if ($dashboard.Status -ne 200 -or -not $dashboard.Content) { throw "Dashboard failed: HTTP $($dashboard.Status)" }
$dashboardJson = $dashboard.Content | ConvertFrom-Json

$presignedBody = (@{ filename = 'evidence-avatar.png'; contentType = 'image/png' } | ConvertTo-Json -Compress)
$presigned = Invoke-CheckedRequest -Uri "$Gateway/users/avatar/presigned-url" -Method POST -Headers $authHeaders -Body $presignedBody
if ($presigned.Status -ne 200 -or -not $presigned.Content) { throw "Presigned URL failed: HTTP $($presigned.Status)" }
$presignedJson = $presigned.Content | ConvertFrom-Json
if (-not $presignedJson.uploadUrl) { throw 'Presigned response has no uploadUrl' }
$uploadBytes = [byte[]](0..99)
$upload = Invoke-CheckedRequest -Uri $presignedJson.uploadUrl -Method PUT -Headers @{} -Body $uploadBytes -ContentType 'image/png'
$confirmBody = (@{ objectKey = $presignedJson.objectKey } | ConvertTo-Json -Compress)
$confirm = Invoke-CheckedRequest -Uri "$Gateway/users/avatar/confirm" -Method POST -Headers $authHeaders -Body $confirmBody

$rateClient = [System.Net.Http.HttpClient]::new()
$rateTasks = [System.Collections.Generic.List[System.Threading.Tasks.Task[System.Net.Http.HttpResponseMessage]]]::new()
$rateAuth = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $token)
for ($i = 0; $i -lt 30; $i++) {
    $rateRequest = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, "$Gateway/users/profile")
    $rateRequest.Headers.Authorization = $rateAuth
    $rateTasks.Add($rateClient.SendAsync($rateRequest))
}
$rateAll = [System.Threading.Tasks.Task[System.Net.Http.HttpResponseMessage]]::WhenAll($rateTasks)
$rateResponses = $rateAll.GetAwaiter().GetResult()
$rateStatuses = [System.Collections.Generic.List[int]]::new()
foreach ($rateResponse in $rateResponses) {
    $rateStatuses.Add([int]$rateResponse.StatusCode)
}
$rateClient.Dispose()
$rate429 = @($rateStatuses | Where-Object { $_ -eq 429 }).Count

Start-Sleep -Seconds 2
$benchmark = @(
    (Measure-Latency -Uri "$DirectUser/users/profile" -Headers $authHeaders),
    (Measure-Latency -Uri "$Gateway/users/profile" -Headers $authHeaders)
)

$sqliPayload = 'http://localhost:3000/?id=1%20OR%201%3D1'
$sqliDirect = Invoke-CheckedRequest -Uri $sqliPayload
$sqliWaf = Invoke-CheckedRequest -Uri ($sqliPayload -replace 'localhost:3000', 'localhost:8080')

$summary = [ordered]@{
    Waf = [ordered]@{
        DirectStatus = $wafDirectHealth.Status
        ProtectedStatus = $wafProtectedHealth.Status
        SqliDirectStatus = $sqliDirect.Status
        SqliProtectedStatus = $sqliWaf.Status
    }
    Gateway = [ordered]@{
        HealthStatus = $gatewayHealth.Status
        LoginStatus = $login.Status
        MissingJwtStatus = $missingToken.Status
        InvalidJwtStatus = $invalidToken.Status
        ValidJwtStatus = $validProfile.Status
        OrdersStatus = $orders.Status
        DashboardStatus = $dashboard.Status
        DashboardOrders = @($dashboardJson.data.orders).Count
        DashboardTotalSpent = $dashboardJson.data.summary.totalSpent
        PresignedStatus = $presigned.Status
        PresignedExpiresInSeconds = $presignedJson.expiresInSeconds
        MinioUploadStatus = $upload.Status
        AvatarConfirmStatus = $confirm.Status
        RateLimit429Count = $rate429
        RateLimitStatuses = (($rateStatuses | Group-Object | Sort-Object Name | ForEach-Object { "$($_.Name)x$($_.Count)" }) -join ',')
    }
    Benchmark = $benchmark
}

$checks = @(
    [pscustomobject]@{ Name = 'WAF direct backend'; Expected = 200; Actual = $wafDirectHealth.Status; Pass = $wafDirectHealth.Status -eq 200 }
    [pscustomobject]@{ Name = 'WAF protected endpoint'; Expected = 200; Actual = $wafProtectedHealth.Status; Pass = $wafProtectedHealth.Status -eq 200 }
    [pscustomobject]@{ Name = 'Gateway health'; Expected = 200; Actual = $gatewayHealth.Status; Pass = $gatewayHealth.Status -eq 200 }
    [pscustomobject]@{ Name = 'Gateway routing login'; Expected = 200; Actual = $login.Status; Pass = $login.Status -eq 200 -and $token.Length -gt 20 }
    [pscustomobject]@{ Name = 'JWT missing token blocked'; Expected = 401; Actual = $missingToken.Status; Pass = $missingToken.Status -eq 401 }
    [pscustomobject]@{ Name = 'JWT invalid token blocked'; Expected = 401; Actual = $invalidToken.Status; Pass = $invalidToken.Status -eq 401 }
    [pscustomobject]@{ Name = 'JWT valid token allowed'; Expected = 200; Actual = $validProfile.Status; Pass = $validProfile.Status -eq 200 }
    [pscustomobject]@{ Name = 'Routing orders'; Expected = 200; Actual = $orders.Status; Pass = $orders.Status -eq 200 }
    [pscustomobject]@{ Name = 'Aggregation dashboard'; Expected = 200; Actual = $dashboard.Status; Pass = $dashboard.Status -eq 200 }
    [pscustomobject]@{ Name = 'Valet key expiry 300s'; Expected = 300; Actual = $presignedJson.expiresInSeconds; Pass = $presigned.Status -eq 200 -and $presignedJson.expiresInSeconds -eq 300 }
    [pscustomobject]@{ Name = 'MinIO direct upload'; Expected = 200; Actual = $upload.Status; Pass = $upload.Status -eq 200 }
    [pscustomobject]@{ Name = 'Avatar confirmation'; Expected = 200; Actual = $confirm.Status; Pass = $confirm.Status -eq 200 }
    [pscustomobject]@{ Name = 'Rate limit triggered'; Expected = '>=1 x 429'; Actual = $rate429; Pass = $rate429 -gt 0 }
    [pscustomobject]@{ Name = 'WAF SQLi blocking'; Expected = 403; Actual = $sqliWaf.Status; Pass = $sqliDirect.Status -eq 200 -and $sqliWaf.Status -eq 403 }
)

$checks | Format-Table -AutoSize
Write-Output ("PASS_COUNT={0}" -f @($checks | Where-Object Pass).Count)
Write-Output ("TOTAL_COUNT={0}" -f $checks.Count)
Write-Output ('SUMMARY_JSON=' + ($summary | ConvertTo-Json -Depth 8 -Compress))

$record = [ordered]@{
    Checks = $checks
    PassCount = @($checks | Where-Object Pass).Count
    TotalCount = $checks.Count
    Measurements = $summary
}
$record | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'results.json') -Encoding utf8
