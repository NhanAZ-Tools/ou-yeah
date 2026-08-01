# OU Yeah!

> Học OU, nhẹ cái đầu.

Chrome extension hỗ trợ học video trên `elolms.ou.edu.vn` và tải sách đang đọc trên `thuquan.ou.edu.vn` thành PDF.

## Tính năng

- Tua ngược / tua nhanh `5 giây`.
- Chọn tốc độ phát trực tiếp: `0.5x` đến `4x`.
- Tải video nếu trang cung cấp file trực tiếp hoặc HLS không mã hóa.
- Tự inject vào iframe Vimeo, dùng được khi học video ELOLMS.
- Thanh điều khiển tối gọn, dùng xanh OU tiết chế và bộ chữ [Space Grotesk từ best-fonts](https://github.com/NhanAZ-Web/best-fonts/tree/main/SpaceGrotesk) thống nhất.
- Cố gắng hiện / ẩn cùng thanh điều khiển gốc của Vimeo.
- Thêm mini-toolbar tải PDF nổi theo cùng giao diện với thanh điều khiển video trên các trang `https://thuquan.ou.edu.vn/doc-truc-tuyen/sach/*`.
- Tự tải ảnh JPEG của từng trang, giữ nguyên thứ tự và đóng gói thành một tệp PDF.
- Hiển thị progress bar mượt, phần trăm tải trang, trạng thái tạo PDF và kết quả ngay trên mini-toolbar.
- Nâng cấp trang thông báo ELOLMS với tìm kiếm, lọc chưa đọc/loại/môn học, nhóm theo thời gian và bố cục một cột responsive.
- Làm lại TOC/Course Map trong trang khóa học ELOLMS: gọn hơn, phân cấp rõ hơn, có tìm nhanh, badge loại tài nguyên và highlight mục đang xem.
- Xuất toàn bộ diễn đàn/kênh thông báo hoặc từng chủ đề riêng lẻ thành gói ZIP AI-ready, gồm Markdown, JSON có cấu trúc, ảnh và tài liệu đính kèm gốc.
- Tạo bộ ôn tập từ quiz tự đánh giá bằng một nút: tự làm và nộp bài cho đến khi 3 lượt liên tiếp không xuất hiện câu mới, gom đáp án đúng rồi đóng gói Markdown, JSON cùng ảnh câu hỏi thành ZIP AI-ready. Tiến trình chạy trong trang nền cùng ELOLMS nên tab chính không reload/nhấp nháy, vẫn dùng được nút `Dừng`; có trần an toàn 50 lượt để tránh vòng lặp vô hạn.

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
- Trên trang danh sách diễn đàn, bấm `Xuất toàn bộ` để gom mọi chủ đề hoặc bấm `Xuất` ngay tại từng dòng. Trên trang thảo luận riêng, bấm `Xuất chủ đề`.
- Gói diễn đàn chứa `forum.md` để đọc/nạp vào AI, `forum.json` để xử lý quan hệ phản hồi chính xác, `images/` chứa ảnh nội dung (không lấy avatar) và `attachments/` chứa PDF, Word, Excel, PowerPoint hoặc tệp đính kèm Moodle khác. Kiểm tra dữ liệu cá nhân trước khi chia sẻ gói này cho dịch vụ AI.
- Trên trang quiz tự đánh giá, bấm `Bắt đầu quét bộ đề` trong bảng `OU Yeah! Quiz Lab`. Tiện ích xử lý các lượt trong một trang nền cùng domain, còn trang đang nhìn được giữ nguyên để theo dõi hoặc bấm `Tạm dừng`; sau đó có thể `Tiếp tục quét` mà không mất câu đã gom. Bạn có thể đổi sang tab khác nhưng nên giữ tab quiz mở; nếu reload, đóng tab hoặc rời trang khi đang quét/đóng gói, Chrome sẽ hỏi xác nhận. Khi tải xong `quiz-bank.zip`, bảng kết quả tự thu thành một hàng gọn với `Tải bộ đề ZIP` và `Quét bổ sung`; quét bổ sung giữ nguyên ngân hàng hiện tại rồi tìm thêm câu mới.
- Phím tắt khi focus video/fullscreen:
  - `Alt + ←`: tua ngược 5 giây
  - `Alt + →`: tua nhanh 5 giây
  - `Alt + ↑`: đổi tốc độ theo vòng preset

## Tuyên bố từ chối trách nhiệm

OU Yeah! là tiện ích được làm trước hết cho nhu cầu học tập cá nhân. Mình thấy nó hữu ích trong quá trình học nên chia sẻ lại cho người dùng tự cân nhắc sử dụng. Đây không phải tiện ích chính thức của Trường Đại học Mở TP. Hồ Chí Minh, ELOLMS, Thư Quán OU hay bất kỳ đơn vị liên quan nào.

Tiện ích có các tính năng như tải video bài giảng khi trang cung cấp nguồn tải phù hợp, tạo PDF từ ảnh trang sách đang đọc trên Thư Quán OU và chỉnh sửa giao diện ELOLMS để dễ theo dõi hơn. Các tính năng này chỉ nên dùng cho mục đích học tập, lưu trữ và tra cứu cá nhân trong phạm vi bạn được phép truy cập.

Người dùng tự chịu trách nhiệm về cách sử dụng tiện ích. Tác giả không khuyến khích, không hỗ trợ và không chịu trách nhiệm cho mọi hành vi sử dụng tiện ích để vi phạm nội quy nhà trường, điều khoản sử dụng của hệ thống, quyền sở hữu trí tuệ, bản quyền, quy định chia sẻ tài liệu, quy định bảo mật hoặc pháp luật hiện hành. Ví dụ: in lậu, phát tán lại sách/tài liệu, chia sẻ video bài giảng trái phép, dùng dữ liệu tải được cho mục đích thương mại hoặc bất kỳ hành vi vượt quá quyền truy cập hợp lệ của bạn.

Do tiện ích có can thiệp giao diện website, có thể xảy ra lỗi hiển thị, lỗi thao tác, phân loại nhầm thông báo, ẩn/hiện sai nội dung, hoặc làm bạn bỏ sót thông báo học tập, lịch học, hạn nộp bài, cập nhật môn học và các thông tin quan trọng khác. Hãy luôn kiểm tra lại thông tin quan trọng trên giao diện gốc/chính thức của ELOLMS, Thư Quán OU hoặc các kênh thông báo chính thức của trường. Tác giả không chịu trách nhiệm cho thiệt hại, mất mát, trễ hạn, bỏ lỡ thông tin hoặc hậu quả phát sinh từ việc sử dụng tiện ích.

Tiện ích không được thiết kế để vượt DRM, phá mã hóa, vượt kiểm soát truy cập hoặc né tránh các cơ chế bảo vệ của hệ thống.

## Lưu ý

- Extension cần quyền `<all_urls>` để bắt link video nếu ELOLMS/Vimeo phát video từ CDN khác.
- Nếu stream có DRM hoặc mã hóa, extension không giải mã hoặc vượt bảo vệ.
- Nếu chưa bắt được link tải, hãy bấm Play video vài giây rồi thử lại.
- PDF được tạo từ ảnh trang mà viewer cung cấp, nên sách nhiều trang có thể cần thêm thời gian và bộ nhớ để hoàn tất.
- Xuất toàn diễn đàn cần đọc tuần tự các trang/chủ đề bằng phiên đăng nhập hiện tại. Diễn đàn nhiều bài hoặc nhiều ảnh có thể tạo tệp ZIP lớn; các ảnh không tải được vẫn giữ URL gốc và được ghi trong mục cảnh báo.
- Quiz Lab chỉ xuất hiện trên bài có dấu hiệu là quiz tự đánh giá/không tính điểm. Tính năng sẽ thực sự tạo và nộp các lượt làm bài, vì vậy chỉ dùng với bài không giới hạn lượt và không tính điểm như mô tả của giảng viên.

## Kiểm tra mã nguồn

```powershell
npm install
npm run check
```

Lệnh `check` chạy ESLint (bao gồm kiểm tra Promise bị bỏ rơi), TypeScript `checkJs` với kiểu dữ liệu Chrome Extension và regression test cho trường hợp extension bị reload giữa chừng.

## Phát hành

```powershell
npm run release
```

Lệnh `release` chạy toàn bộ kiểm tra, xác nhận version trong `package.json` và `manifest.json` khớp nhau, rồi đóng gói Chrome extension vào `dist/OU-Yeah-v<version>.zip` kèm file SHA-256.
