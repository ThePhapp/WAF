# Kết quả đánh giá WAF và API Gateway microservices

Môi trường: Docker Desktop trên Windows, chỉ truy cập qua `127.0.0.1`. Stack microservices chạy trên `8081`; WAF + Juice Shop chạy tại `8080`/`3000`.

## Kết quả

**14/14 phép kiểm tra PASS.** Dữ liệu thô không chứa JWT hoặc pre-signed URL nằm trong [results.json](results.json). Chạy lại bằng `pwsh -File evidence/evaluate-gateway.ps1` từ thư mục gốc.

| Hạng mục | Đường kiểm tra | Kết quả |
|---|---|---|
| WAF, request thường | `3000` và `8080` | `200` / `200` |
| WAF, SQLi mô phỏng | `3000` và `8080` | `200` / `403`; CRS `942100`, chặn theo `949110` |
| Gateway routing | `POST :8081/users/login`, `GET :8081/orders` | `200` / `200` |
| JWT offloading | thiếu token / token sai / token đúng | `401` / `401` / `200` |
| Aggregation | `GET :8081/dashboard` | `200`; 2 đơn, tổng 44.200.000 VND |
| Valet key | tạo URL / thời hạn / PUT MinIO / xác nhận | `200` / `300s` / `200` / `200` |
| Rate limit | 30 request đồng thời tới `/users/profile` | `200×6`, `429×24` |

## Độ trễ

Đo **20 request HTTP 200** cho mỗi đường, sau 2 request warmup; mỗi mẫu cách nhau 120 ms. Số đo trong lab local có thể thay đổi theo tải Docker/Windows.

| Đường | Mean | p50 | p95 |
|---|---:|---:|---:|
| User Service trực tiếp `:3001` | 3,38 ms | 3,11 ms | 5,16 ms |
| Qua Nginx Gateway `:8081` | 3,89 ms | 3,82 ms | 4,68 ms |

Mean tăng 0,51 ms (~15,1%) trong lượt đo này. p95 của gateway thấp hơn direct trong mẫu nhỏ này, nên không suy luận hiệu năng tổng quát từ một lượt benchmark.

## Tệp ảnh EVD

- `01-waf-juice-shop.png`: Juice Shop qua WAF.
- `02-waf-sqli-block.png`: WAF trả 403 cho URL SQLi mô phỏng.
- `03-gateway-health.png`: Gateway trả trạng thái UP.
- `04-evaluation-report.png`: bảng kết quả và số đo từ lượt đánh giá.

Ảnh là trạng thái được chụp tại localhost. Bằng chứng máy đọc được là `results.json`; rule WAF có thể đối chiếu bằng `docker compose logs --tail=100 waf`.

## Vận hành

```powershell
docker compose up -d
docker compose -f api-gateway-reference/docker-compose.yml up -d
pwsh -File evidence/evaluate-gateway.ps1
```

Để dừng riêng stack tham khảo: `docker compose -f api-gateway-reference/docker-compose.yml down`. Để dừng WAF/Juice Shop: `docker compose down`.
