# OU Yeah!

> Học OU, nhẹ cái đầu.

Chrome extension hỗ trợ học video trên `elolms.ou.edu.vn` và tải sách đang đọc trên `thuquan.ou.edu.vn` thành PDF.

## Tính năng

- Tua ngược / tua nhanh `5 giây`.
- Chọn tốc độ phát trực tiếp: `0.5x` đến `4x`.
- Tải video nếu trang cung cấp file trực tiếp hoặc HLS không mã hóa.
- Tự inject vào iframe Vimeo, dùng được khi học video ELOLMS.
- Thanh điều khiển sáng, gọn, màu xanh Đại học Mở `#3659A2`.
- Cố gắng hiện / ẩn cùng thanh điều khiển gốc của Vimeo.
- Thêm mini-toolbar tải PDF nổi theo cùng giao diện với thanh điều khiển video trên các trang `https://thuquan.ou.edu.vn/doc-truc-tuyen/sach/*`.
- Tự tải ảnh JPEG của từng trang, giữ nguyên thứ tự và đóng gói thành một tệp PDF.
- Hiển thị progress bar mượt, phần trăm tải trang, trạng thái tạo PDF và kết quả ngay trên mini-toolbar.

## Cài đặt thủ công

1. Tải hoặc clone repo `ou-yeah`.
2. Mở Chrome và vào `chrome://extensions`.
3. Bật `Developer mode`.
4. Chọn `Load unpacked`.
5. Chọn thư mục repo `ou-yeah`.
6. Mở lại trang bài giảng ELOLMS hoặc trang đọc sách Thư Quán OU.

## Cách dùng

- Rê chuột vào vùng video để hiện thanh điều khiển nhanh.
- Bấm `-5s` hoặc `+5s` để tua.
- Bấm nút tốc độ để chọn nhanh tốc độ phát.
- Bấm nút tải xuống sau khi video đã phát vài giây.
- Trên trang đọc sách, bấm `Tải PDF` trong mini-toolbar tối nổi phía trên thanh công cụ màu xanh. Giữ trang mở đến khi Chrome báo đã gửi PDF sang Downloads.
- Phím tắt khi focus video/fullscreen:
  - `Alt + ←`: tua ngược 5 giây
  - `Alt + →`: tua nhanh 5 giây
  - `Alt + ↑`: đổi tốc độ theo vòng preset

## Lưu ý

- Extension cần quyền `<all_urls>` để bắt link video nếu ELOLMS/Vimeo phát video từ CDN khác.
- Nếu stream có DRM hoặc mã hóa, extension không giải mã hoặc vượt bảo vệ.
- Nếu chưa bắt được link tải, hãy bấm Play video vài giây rồi thử lại.
- PDF được tạo từ ảnh trang mà viewer cung cấp, nên sách nhiều trang có thể cần thêm thời gian và bộ nhớ để hoàn tất.

## Kiểm tra mã nguồn

```powershell
npm install
npm run check
```

Lệnh `check` chạy ESLint (bao gồm kiểm tra Promise bị bỏ rơi), TypeScript `checkJs` với kiểu dữ liệu Chrome Extension và regression test cho trường hợp extension bị reload giữa chừng.
