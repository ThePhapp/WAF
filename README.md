# WAF lab: Nginx + ModSecurity + OWASP CRS + Juice Shop

Bài thực hành này dựng một lab bảo mật chỉ trên máy local. OWASP Juice Shop được mở trực tiếp ở port `3000` để làm đường đối chứng, đồng thời được đặt sau Nginx + ModSecurity + OWASP Core Rule Set (CRS) ở port `8080`.

## Kiến trúc

```text
Browser / Client
      |
      +--> http://localhost:3000  ------> Juice Shop (trực tiếp, không qua WAF)
      |
      +--> http://localhost:8080  ------> Nginx + ModSecurity + OWASP CRS
                                                |
                                                +--> http://web:3000
```

Request đáng ngờ đi qua WAF có thể bị chặn trước khi tới Juice Shop:

```text
Client --> WAF --> X 403/4xx (blocked)
                  |
                  +--> Juice Shop nếu request được cho phép
```

## Yêu cầu

- Docker Engine hoặc Docker Desktop.
- Docker Compose v2 (`docker compose`).
- Port `3000` và `8080` còn trống.
- Chỉ thực hành trên `localhost`; không gửi các request kiểm thử này tới hệ thống bên ngoài.

## Khởi chạy

Từ thư mục chứa `docker-compose.yml`:

```bash
docker compose config
docker compose pull
docker compose up -d
docker compose ps
```

Hai service cần ở trạng thái `Up` hoặc `running`:

- `web`: Juice Shop, ánh xạ `localhost:3000` tới container port `3000`.
- `waf`: Nginx + ModSecurity + CRS, ánh xạ `localhost:8080` tới container port `8080`.

## Truy cập và kiểm tra cơ bản

- Juice Shop trực tiếp: <http://localhost:3000>
- Juice Shop qua WAF: <http://localhost:8080>

```bash
curl -I http://localhost:3000
curl -I http://localhost:8080
```

Juice Shop có thể trả về `200`, `304` hoặc một status HTTP hợp lệ khác tùy route và phiên bản image. Điều quan trọng là cả hai endpoint đều kết nối được; endpoint `8080` phải được reverse proxy tới service `web`.

## Cấu hình WAF

Trong `docker-compose.yml`:

- `BACKEND: "http://web:3000"`: địa chỉ backend được Nginx dùng trong mạng Compose. `web` là tên service và được Docker DNS phân giải tự động; `3000` là port bên trong container Juice Shop.
- `MODSEC_RULE_ENGINE: "On"`: bật ModSecurity ở chế độ thực thi. Rule được đánh giá và request vi phạm có thể bị từ chối. Đây là cấu hình cuối cùng của lab.
- `BLOCKING_PARANOIA: "1"`: dùng Paranoia Level 1 (PL1), mức cơ bản, phù hợp để bắt đầu thực hành và giảm false positive.
- `depends_on`: khởi động service `web` trước service `waf`; cả hai dùng mạng Compose mặc định.
- `restart: unless-stopped`: tự khởi động lại container khi gặp lỗi hoặc sau khi Docker restart, trừ khi người dùng chủ động dừng stack.

`DetectionOnly` chỉ phát hiện và ghi log, không chặn request. Không dùng `DetectionOnly` cho kết quả cuối của bài này; `MODSEC_RULE_ENGINE` phải là `On`.

Paranoia Level 2–4 bổ sung nhiều kiểm tra hơn nhưng cũng có thể làm tăng false positive. Lab này giữ PL1 theo mục tiêu bài thực hành.

## Xem log

```bash
docker compose logs --tail=100 web
docker compose logs --tail=100 waf
docker compose logs -f waf
```

Trong log WAF, tìm các dấu hiệu sau:

- Nginx đã khởi động và nhận request.
- ModSecurity/CRS được nạp trong startup log.
- Request bị chặn thường trả `403` hoặc một status `4xx` và log có nội dung như `Access denied`, mã rule CRS hoặc `ModSecurity`.
- Request hợp lệ được proxy tới upstream `web:3000`.

Nếu cần xem trạng thái và cấu hình đã render:

```bash
docker compose ps
docker compose config
```

## Kiểm thử WAF an toàn trên localhost

Các lệnh dưới đây chỉ mô phỏng mẫu SQL injection, XSS và path traversal; không khai thác Juice Shop, không lấy dữ liệu và không thực hiện persistence.

### 1. SQL injection mẫu

```bash
curl.exe -i "http://localhost:3000/?id=1%20OR%201%3D1"
curl.exe -i "http://localhost:8080/?id=1%20OR%201%3D1"
```

### 2. XSS mẫu

```bash
curl.exe -i "http://localhost:3000/?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E"
curl.exe -i "http://localhost:8080/?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E"
```

### 3. Path traversal mẫu

`--path-as-is` giúp giữ nguyên đường dẫn để phục vụ kiểm thử rule, thay vì để client tự chuẩn hóa `..` trước khi gửi:

```bash
curl.exe -i --path-as-is "http://localhost:3000/%2e%2e/%2e%2e/etc/passwd"
curl.exe -i --path-as-is "http://localhost:8080/%2e%2e/%2e%2e/etc/passwd"
```

Kết quả cần đối chiếu:

- Port `3000` là đường trực tiếp tới Juice Shop, không có lớp WAF.
- Port `8080` đi qua ModSecurity + CRS. Một hoặc nhiều mẫu có thể nhận `403`/`4xx` và xuất hiện trong log WAF.
- Status chính xác phụ thuộc vào phiên bản image, route và cách Nginx/CRS chuẩn hóa request. Đây là bài kiểm thử hành vi chặn, không phải yêu cầu phải có cùng một status ở mọi phiên bản.

Sau khi kiểm thử, xem log để liên hệ status với rule:

```bash
docker compose logs --tail=200 waf
```

## Dừng và dọn lab

Dừng container:

```bash
docker compose down
```

Lệnh trên xóa container và network của project nhưng không xóa image hoặc dữ liệu ngoài project.

## Lỗi thường gặp

### Port đã được sử dụng

Kiểm tra port trên Windows PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 3000,8080 -State Listen
```

Dừng ứng dụng đang dùng port hoặc đổi port phía host, ví dụ `"3001:3000"` hay `"8081:8080"`, rồi cập nhật URL kiểm tra tương ứng.

### WAF trả 502 Bad Gateway

Kiểm tra service backend, DNS nội bộ và log:

```bash
docker compose ps
docker compose logs --tail=200 web
docker compose logs --tail=200 waf
```

`BACKEND` phải là `http://web:3000`, không phải `localhost:3000` bên trong container WAF. Nếu Juice Shop vừa khởi động, đợi vài giây rồi kiểm tra lại; `restart: unless-stopped` giúp container tự thử lại sau lỗi.

### Container restart hoặc không pull được image

```bash
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=200 web
docker compose logs --tail=200 waf
```

Kiểm tra Docker Desktop đang chạy và máy có kết nối tới registry. Không đổi sang `DetectionOnly` để che giấu lỗi khởi động; hãy đọc log và sửa nguyên nhân.

## Dọn dẹp hoàn toàn image (tùy chọn)

Chỉ thực hiện nếu muốn giải phóng image đã pull:

```bash
docker compose down
docker image rm bkimminich/juice-shop owasp/modsecurity-crs:nginx
```

Đây là thao tác tùy chọn và sẽ yêu cầu pull lại image ở lần chạy sau.
