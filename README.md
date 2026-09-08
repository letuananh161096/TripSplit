# 🌴 TripSplit - Sổ Chi Tiêu & Quyết Toán Du Lịch Nhóm (Tối Ưu Cho Android)

**TripSplit** là ứng dụng di động chuẩn **PWA (Progressive Web App)** giúp bạn và nhóm bạn bè, đồng nghiệp khi đi du lịch cùng nhau có thể ghi chép chi tiêu minh bạch, chia tiền thông minh, tự động tối ưu hóa nợ và chuyển khoản tức thì qua mã **VietQR** chuẩn ngân hàng Việt Nam (Napas 247).

---

## 🌟 Điểm Nổi Bật

- **Không tốn tiền mua server (0 đồng chi phí)**: Chạy hoàn toàn trên nền tảng Web App PWA & Cloud miễn phí.
- **Tối ưu tuyệt đối cho Android**:
  - Giao diện Dark Luxury Travel hiện đại, thanh điều hướng đáy (Bottom Bar), thao tác 1 tay thuận tiện.
  - Cài đặt trực tiếp lên màn hình chính điện thoại Android thông qua Chrome ("Thêm vào màn hình chính"), mở toàn màn hình mượt mà như app tải từ CH Play.
  - Hoạt động mượt mà kể cả khi **mất mạng / rớt 4G** (Offline-First với Service Worker & LocalStorage).
- **Tính năng Thủ Quỹ & Quỹ Nhóm Thông Minh (Group Fund)**:
  - Cho phép chọn 1 người làm **Thủ quỹ** giữ tiền chung.
  - Gom quỹ ban đầu (ví dụ: mỗi người góp 500k, 1 triệu): Tạo mã **VietQR nộp quỹ 1-chạm** trực tiếp vào tài khoản Thủ quỹ.
  - Khi phát sinh chi phí chung: Chọn người thanh toán là **"🏦 Quỹ Nhóm (Thủ quỹ chi)"** để trừ dần vào số dư quỹ.
  - **Tự động chuyển sang chi tiền túi khi hết quỹ**: Nếu quỹ hết hoặc khoản chi riêng, thành viên chọn tự trả tiền túi.
  - **Tự động quyết toán & hoàn tiền quỹ thừa**: Nếu kết thúc chuyến đi mà quỹ còn dư, hệ thống tự động tính toán số tiền hoàn trả cho từng người chính xác từng đồng!
- **Quản lý & Xóa Chuyến Đi Linh Hoạt**:
  - Dễ dàng tạo nhiều chuyến đi khác nhau (mỗi chuyến có 1 mã phòng riêng).
  - Có thể chuyển đổi qua lại giữa các chuyến đi cũ/mới.
  - **Xóa chuyến đi**: Có thể xóa chuyến đi trực tiếp trong danh sách các chuyến đi hoặc trong tab Báo cáo khi chuyến đi đã kết thúc và quyết toán xong.
- **Thuật toán Tối ưu hóa Nợ (Debt Minimization)**:
  - Tự động gom và bù trừ nợ chéo giữa các thành viên. Thay vì A trả B, B trả C, C trả D... thuật toán rút gọn về số lần chuyển tiền ít nhất có thể (tối đa $N-1$ giao dịch).
- **Tích hợp VietQR 1-Chạm (Napas 247)**:
  - Tự động sinh mã VietQR của tất cả ngân hàng Việt Nam (MB, Vietcombank, Techcombank, VPBank, ACB, BIDV, TPBank, Sacombank, OCB, VIB, Timo, Cake...).
  - Mã QR tự động điền **đúng số tiền nợ** và **nội dung chuyển khoản chuẩn** (`DALAT26 Hung tra no`), người nợ chỉ cần mở app ngân hàng quét mã hoặc copy STK là xong!
- **Chia tiền linh hoạt**:
  - *Chia đều*: Cho tất cả mọi người.
  - *Chia chọn lọc*: Tích chọn những ai tham gia (ví dụ: tách tiền rượu/bia cho người uống).
  - *Chia theo số suất*: Người lớn 1 suất, trẻ nhỏ 0.5 suất.
  - *Chia số tiền cụ thể*.
- **Đính kèm hóa đơn & Báo cáo đa dạng**:
  - Chụp ảnh / đính kèm ảnh hóa đơn bill thanh toán.
  - Phân tích biểu đồ tỷ trọng danh mục (Ăn uống, Di chuyển, Khách sạn, Vé tour, Cafe...).
  - Xuất bảng chi tiết ra **File Excel (.csv)** (chuẩn UTF-8 mở trực tiếp bằng Excel không bị lỗi font tiếng Việt).
  - Tạo **Phiếu Tổng Kết Chuyến Đi (Infographic Summary Card)** dạng ảnh chất lượng cao để gửi ngay vào nhóm Zalo/Telegram.

---

## 🚀 Cách 1: Chạy Ngay Trên Mạng Wi-Fi Nội Bộ (Không Cần Internet)

Nếu bạn đang ngồi cùng team hoặc mang theo laptop:

1. Mở Terminal trong thư mục này và chạy:
   ```bash
   python3 server.py
   ```
2. Terminal sẽ hiển thị địa chỉ mạng nội bộ, ví dụ: `http://192.168.1.15:8080`.
3. Cho điện thoại Android của bạn và bạn bè kết nối vào cùng Wi-Fi (hoặc bắt Hotspot từ điện thoại của bạn).
4. Mở trình duyệt Chrome trên Android và truy cập địa chỉ trên để dùng ngay!

---

## ☁️ Cách 2: Triển Khai Miễn Phí 100% Vĩnh Viễn Lên Mây (Khuyên Dùng)

Để cả team đi bất kỳ đâu (dùng 4G khác nhau) vẫn vào chung được:

### Triển khai bằng Cloudflare Pages hoặc Vercel (0 đồng, 2 phút):
1. **Qua Vercel**:
   - Truy cập [vercel.com](https://vercel.com) (đăng ký miễn phí bằng tài khoản GitHub/Google).
   - Bấm **"Add New Project"** -> Chọn thư mục mã nguồn này (hoặc đẩy lên GitHub rồi import).
   - Bấm **Deploy**.
   - Bạn sẽ có ngay một đường link bảo mật HTTPS, ví dụ: `https://tripsplit-team.vercel.app`.
2. **Qua Cloudflare Pages**:
   - Truy cập [pages.cloudflare.com](https://pages.cloudflare.com) -> Upload thư mục này lên -> Nhận link miễn phí vĩnh viễn không giới hạn băng thông.

---

## 🍎 Cách Tham Gia & Cài Đặt Dành Cho Bạn Bè Dùng iPhone (iOS)

Bạn bè dùng **iPhone / iPad** hoàn toàn có thể tham gia chung một cách mượt mà và không cần phải lên App Store tải app:

1. **Vào dùng ngay**:
   - Bạn gửi link chuyến đi qua Zalo/iMessage (hoặc đưa mã QR trên app cho họ quét).
   - Bạn bè dùng iPhone bấm vào link sẽ mở ngay trên trình duyệt **Safari** và có thể xem/ghi chép chi tiêu lập tức.
2. **Cài đặt như ứng dụng thật lên màn hình chính iPhone**:
   - Khi đang mở trang web trên Safari của iPhone, bấm vào biểu tượng **Chia sẻ** (hình ô vuông có mũi tên chỉ lên `⎋` ở thanh điều hướng dưới đáy Safari).
   - Cuộn xuống chọn **"Thêm vào MH chính" (Add to Home Screen)**.
   - Bấm **"Thêm" (Add)** ở góc trên bên phải.
   - Ứng dụng **TripSplit** với icon sang trọng sẽ xuất hiện ngay trên màn hình iPhone, mở lên toàn màn hình (không có thanh URL Safari) mượt mà như app tải từ App Store!

---

1. Mở đường dẫn TripSplit trên trình duyệt **Google Chrome** của điện thoại Android.
2. Bạn sẽ thấy thanh thông báo **"Cài đặt TripSplit vào màn hình chính"** -> Bấm **Cài đặt**.
3. (Hoặc bấm vào biểu tượng menu **3 chấm** ở góc trên bên phải Chrome -> Chọn **"Thêm vào màn hình chính"** / **"Cài đặt ứng dụng"**).
4. Biểu tượng ứng dụng TripSplit sẽ xuất hiện trên màn hình điện thoại, bấm vào sẽ mở toàn màn hình, mượt mà và không còn thanh địa chỉ web.

---

## 📂 Cấu Trúc Mã Nguồn

```
├── index.html            # Khung giao diện PWA Mobile-first
├── manifest.json         # Cấu hình PWA cài đặt Android (Icons, Standalone)
├── sw.js                 # Service Worker xử lý Offline Cache
├── server.py             # Server mini hỗ trợ phát nội bộ mạng LAN / Wi-Fi
├── css/
│   └── styles.css        # Hệ thống CSS Design Tokens, Glassmorphism, Theme
├── js/
│   ├── app.js            # Controller chính, xử lý luồng sự kiện và tabs
│   ├── banks.js          # Danh mục ngân hàng Napas 247 và mã BIN
│   ├── vietqr.js         # Sinh mã VietQR chuẩn chuyển khoản ngân hàng
│   ├── debt.js           # Thuật toán tối ưu nợ & thống kê thu chi
│   ├── export.js         # Xuất Excel có BOM và tạo ảnh tóm tắt Zalo
│   └── realtime.js       # Module đồng bộ thời gian thực đa thiết bị
└── icons/                # Icon ứng dụng kích thước 192x192 và 512x512
```
