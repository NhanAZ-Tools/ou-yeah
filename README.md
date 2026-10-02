# OU Yeah!

> Học OU, nhẹ cái đầu.

Chrome extension hỗ trợ theo dõi deadline, nhắc lịch VC, học và tải học liệu, xuất dữ liệu khóa học/bộ đề trên `elolms.ou.edu.vn`, cùng tải sách đang đọc trên `thuquan.ou.edu.vn` thành PDF.

## Tính năng

- Ghi dữ liệu Markdown/JSON cho AI vào `Downloads/OU Yeah!/<Tên khóa học>/00-AI/`, với `AGENTS.md` ở thư mục khóa học. Video/Slide/Script được lưu trong cây chương/chủ đề/phần bên cạnh và có chỉ mục `materials-download.json`.
- Thêm trang `Deadline` theo tháng với lọc môn học, tìm tên bài, `Cần làm hôm nay`, trễ hạn đã/chưa nộp và mặc định `Ẩn đã thực hiện`. Hạn gia hạn được đặt dưới bài gốc để tiện mở làm tiếp.
- Tô đỏ các mục cần thực hiện hôm nay, hiện đếm ngược, gộp lịch VC trùng từ nhiều nguồn và xuất lịch `.ics`.
- Nhắc deadline và VC bằng thông báo Chrome theo ngày lịch và số giờ còn lại, dùng múi giờ Việt Nam.
- Tua ngược / tua nhanh `5 giây`.
- Chọn tốc độ phát trực tiếp: `0.5x` đến `4x`.
- Tải video nếu trang cung cấp file trực tiếp hoặc HLS không mã hóa.
- Tự inject vào iframe Vimeo, dùng được khi học video ELOLMS.
- Thanh điều khiển tối gọn, dùng xanh OU tiết chế và bộ chữ [Space Grotesk từ best-fonts](https://github.com/NhanAZ-Web/best-fonts/tree/main/SpaceGrotesk) thống nhất.
- Chuẩn hóa giờ hiển thị trên toàn bộ ELOLMS sang định dạng 24 giờ, kể cả lịch, thông báo, popover và nội dung được tải động sau khi mở trang.
- Cố gắng hiện / ẩn cùng thanh điều khiển gốc của Vimeo.
- Thêm mini-toolbar tải PDF nổi theo cùng giao diện với thanh điều khiển video trên các trang `https://thuquan.ou.edu.vn/doc-truc-tuyen/sach/*`.
- Tự tải ảnh JPEG của từng trang, giữ nguyên thứ tự và đóng gói thành một tệp PDF.
- Hiển thị progress bar mượt, phần trăm tải trang, trạng thái tạo PDF và kết quả ngay trên mini-toolbar.
- Nâng cấp trang thông báo ELOLMS với tìm kiếm, lọc chưa đọc/loại/môn học, nhóm theo thời gian và bố cục một cột responsive.
- Làm lại TOC/Course Map trong trang khóa học ELOLMS: gọn hơn, phân cấp rõ hơn, có tìm nhanh, badge loại tài nguyên và highlight mục đang xem.
- Tải nhanh học liệu theo toàn khóa học, chương, chủ đề hoặc phần. Công cụ chỉ xếp hàng các Video/Slide/Script mà ELOLMS đang cho phép truy cập, giữ cấu trúc/tên hiển thị trên web và ghi rõ các mục bị khóa hoặc lỗi.
- Tạo `ou-yeah-course-manifest.json` bên cạnh học liệu đã tải để AI agent đọc đúng cây khóa học, URL nguồn, trạng thái hoàn thành, đường dẫn tệp cục bộ và lý do tài nguyên chưa có trên máy.
- Luồng `Tải toàn bộ` giữ tên manifest trên; các lần tải theo chương/chủ đề/phần dùng manifest theo phạm vi để không ghi đè chỉ mục của toàn khóa học.
- Xuất snapshot dữ liệu toàn khóa học cho AI agent: tổng quan/đề cương, cây nội dung, diễn đàn và Video Conference, bài tập, quiz đã làm được phép xem lại cùng ngân hàng Quiz Lab đã quét và lưu trên trình duyệt, lịch trình, điểm cá nhân và các nguồn tùy chọn như danh sách thành viên/thông báo tài khoản.
- Đóng gói song song Markdown dễ đọc, JSON có cấu trúc, tệp gốc/ảnh đính kèm, lịch `.ics`, báo cáo quyền truy cập và `snapshots/changes.json` để nhận diện dữ liệu mới, thay đổi hoặc không còn thấy giữa hai lần xuất.
- Xuất toàn bộ diễn đàn/kênh thông báo hoặc từng chủ đề riêng lẻ thành gói ZIP AI-ready, gồm Markdown, JSON có cấu trúc, ảnh và tài liệu đính kèm gốc.
- Tạo bộ ôn tập từ quiz tự đánh giá bằng một nút: tự làm và nộp bài cho đến khi 3 lượt liên tiếp không xuất hiện câu mới, gom đáp án đúng rồi tải README, Markdown, JSON và ảnh câu hỏi thành một thư mục AI-ready. Tiến trình chạy trong trang nền cùng ELOLMS nên tab chính không reload/nhấp nháy, vẫn dùng được nút `Dừng`; có trần an toàn 50 lượt để tránh vòng lặp vô hạn.

## Cài đặt thủ công

1. Tải ZIP từ [GitHub Releases](https://github.com/NhanAZ-Tools/ou-yeah/releases/latest) rồi giải nén, hoặc clone repo `ou-yeah`.
2. Mở Chrome và vào `chrome://extensions`.
3. Bật `Developer mode`.
4. Chọn `Load unpacked`.
5. Chọn thư mục chứa `manifest.json`.
6. Mở lại trang bài giảng ELOLMS hoặc trang đọc sách Thư Quán OU.

## Cách dùng

- Mở mục `Deadline` trên thanh điều hướng ELOLMS để xem theo tháng; chọn `Cần làm hôm nay` để lọc bài còn cần nộp trong ngày, hoặc các bộ lọc trễ hạn đã/chưa nộp. `Đồng bộ lại` cập nhật dữ liệu mới từ phiên đăng nhập hiện tại, còn `Xuất toàn bộ lịch .ics` tạo lịch để nhập vào ứng dụng lịch.
- Khi đọc cây `00-AI/` bằng Codex hoặc agent khác, chỉ nạp nội dung Script. Video và Slide vẫn được lưu cho người học nhưng phải loại khỏi AI context; chính sách này được ghi trong `AGENTS.md`, `course-index.json` và `materials-download.json`.
- Rê chuột vào vùng video để hiện thanh điều khiển nhanh.
- Bấm `-5s` hoặc `+5s` để tua.
- Bấm nút tốc độ để chọn nhanh tốc độ phát.
- Bấm nút tải xuống sau khi video đã phát vài giây.
- Trên trang đọc sách, bấm `Tải PDF` trong mini-toolbar tối nổi phía trên thanh công cụ màu xanh. Giữ trang mở đến khi Chrome báo đã gửi PDF sang Downloads.
- Trên trang khóa học, bấm nút `Tải toàn bộ` để mở một luồng duy nhất. Trong hộp thoại, chọn các nhóm dữ liệu cần lấy và, nếu chọn học liệu, lọc riêng Video/Slide/Script. Các nhóm dữ liệu thông thường được chọn sẵn để giữ thao tác nhanh; `Danh sách thành viên` và `Thông báo tài khoản` phải được bật riêng, còn danh sách thành viên cần thêm xác nhận. Bỏ chọn nhóm nào thì nhóm đó không được quét trong lần hiện tại. Hàng đợi chạy tuần tự và có `Tạm dừng`, `Tiếp tục`, `Hủy`; dữ liệu AI được ghi thành file rời vào `00-AI/`, còn học liệu nằm ở cây thư mục bên cạnh. Hãy giữ tab khóa học mở cho đến khi hoàn tất. Nút `Tải` ở chương/chủ đề/phần vẫn dùng cho học liệu theo phạm vi nhỏ hơn.
- Học liệu được lưu dưới `Downloads/OU Yeah!/<Tên khóa học>/<cây đề mục trên ELOLMS>/`. Tiện ích không tự hoàn thành bài, không tạo link cho mục bị khóa và không dùng phần trăm tiến độ làm điều kiện thay cho quyền truy cập thực tế.
- Luồng `Tải toàn bộ` tạo cây dữ liệu Markdown/JSON dễ đọc và xử lý tự động, bắt đầu từ `AGENTS.md`, `00-AI/course-context.md` và `00-AI/course-index.json`; Video/Slide/Script được chuyển qua bộ tải học liệu riêng để tránh nhét video lớn vào thư mục AI. Cây vẫn ghi rõ phạm vi truy cập, mục bị khóa và dữ liệu cá nhân để người dùng tự kiểm tra trước khi chia sẻ.
- Khi chọn `Bài kiểm tra + Quiz Lab`, gói hợp nhất kết hợp các lượt ELOLMS cho xem lại với câu hỏi Quiz Lab đã lưu cho từng quiz; trạng thái và nguồn câu hỏi được ghi trong `quiz-bank.json` và `quiz-bank.md`.
- `Danh sách thành viên` và `Thông báo tài khoản` bị tắt mặc định. Danh sách thành viên chỉ xuất sau xác nhận riêng và không lấy email, lần truy cập gần nhất, điểm hay bài nộp của người khác; báo cáo điểm/bài nộp chỉ thuộc tài khoản đang đăng nhập.
- Trên trang danh sách diễn đàn, bấm `Xuất toàn bộ` để gom mọi chủ đề hoặc bấm `Xuất` ngay tại từng dòng. Trên trang thảo luận riêng, bấm `Xuất chủ đề`.
- Gói diễn đàn chứa `forum.md` để đọc/nạp vào AI, `forum.json` để xử lý quan hệ phản hồi chính xác, `images/` chứa ảnh nội dung (không lấy avatar) và `attachments/` chứa PDF, Word, Excel, PowerPoint hoặc tệp đính kèm Moodle khác. Kiểm tra dữ liệu cá nhân trước khi chia sẻ gói này cho dịch vụ AI.
- Trên trang quiz tự đánh giá, bấm `Bắt đầu quét bộ đề` trong bảng `OU Yeah! Quiz Lab`. Tiện ích xử lý các lượt trong một trang nền cùng domain, còn trang đang nhìn được giữ nguyên để theo dõi hoặc bấm `Tạm dừng`; sau đó có thể `Tiếp tục quét` mà không mất câu đã gom. Bạn có thể đổi sang tab khác nhưng nên giữ tab quiz mở; nếu reload, đóng tab hoặc rời trang khi đang quét/tải, Chrome sẽ hỏi xác nhận. Khi quét xong, bảng kết quả tự thu thành một hàng gọn với `Tải bộ đề` và `Quét bổ sung`; nút `Tải bộ đề` lưu README, Markdown, JSON và ảnh vào một thư mục riêng bên trong `Downloads/OU Yeah!/Quiz Banks/`. Quét bổ sung giữ nguyên ngân hàng hiện tại rồi tìm thêm câu mới, không phải quét lại từ đầu.
- Phím tắt khi focus video/fullscreen:
  - `Alt + ←`: tua ngược 5 giây
  - `Alt + →`: tua nhanh 5 giây
  - `Alt + ↑`: đổi tốc độ theo vòng preset

## Lịch nhắc deadline và VC

Các mốc ngày được tính theo `Asia/Ho_Chi_Minh`. Tiện ích kết hợp nhắc theo ngày lịch với mốc giờ chính xác:

| Mục cần nhắc | Thời điểm |
| --- | --- |
| Deadline còn 3 ngày lịch | 20:00 |
| Deadline còn 1 ngày lịch | 20:00, 21:00, 22:00, 23:00 |
| Deadline còn đúng 72 giờ hoặc 24 giờ | Đúng mốc giờ tương ứng |
| VC/meeting diễn ra ngày mai | 20:00 |
| VC/meeting còn 3, 2 hoặc 1 giờ | Đúng từng mốc giờ trước buổi học |

Nhắc lịch dùng dữ liệu đã đồng bộ từ trang `Deadline` và chạy khi Chrome hoạt động. Mục đã hoàn thành hoặc đã quá hạn không được nhắc; cùng một mục không gửi lặp trong cùng khung giờ nếu hai cách tính trùng nhau. Bấm thông báo để mở trang Deadline. Khi bài nộp hoặc lịch VC thay đổi trên ELOLMS, mở trang Deadline hoặc bấm `Đồng bộ lại` để cập nhật.

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
- Tải hàng loạt học liệu vẫn phụ thuộc link mà ELOLMS cấp ở thời điểm quét. Khóa học đạt 100% thường mở đủ tài nguyên, nhưng tiện ích vẫn kiểm tra từng mục; khóa học chưa đạt 100% vẫn có thể tải riêng những Slide/Script/Video đã mở.
- Không đóng hoặc reload tab khóa học khi hàng đợi đang chạy. Video được xử lý tuần tự để tránh nhiều luồng HLS cùng chiếm bộ nhớ; mục lỗi và mục bị khóa vẫn được ghi vào manifest để đối chiếu sau.
- Cây dữ liệu AI chỉ phản ánh những gì phiên đăng nhập hiện tại nhìn thấy. `00-AI/access-report.json` phân biệt mục khả dụng, bị hạn chế, bỏ qua và lỗi; mục vắng mặt trong cây không đồng nghĩa là nó không tồn tại trên ELOLMS.
- Dòng `arclight.vimeo.com ... ERR_BLOCKED_BY_CLIENT` trong DevTools chỉ là telemetry Vimeo bị chặn, không phải yêu cầu tắt trình chặn quảng cáo. OU Yeah! ưu tiên đọc luồng từ cấu hình player đã nhúng trong trang.
- PDF được tạo từ ảnh trang mà viewer cung cấp, nên sách nhiều trang có thể cần thêm thời gian và bộ nhớ để hoàn tất.
- Xuất toàn diễn đàn cần đọc tuần tự các trang/chủ đề bằng phiên đăng nhập hiện tại. Diễn đàn nhiều bài hoặc nhiều ảnh có thể tạo tệp ZIP lớn; các ảnh không tải được vẫn giữ URL gốc và được ghi trong mục cảnh báo.
- Quiz Lab chỉ xuất hiện trên bài có dấu hiệu là quiz tự đánh giá/không tính điểm. Tính năng sẽ thực sự tạo và nộp các lượt làm bài, vì vậy chỉ dùng với bài không giới hạn lượt và không tính điểm như mô tả của giảng viên.

## Kiểm tra mã nguồn

```powershell
npm ci
npm run check
```

Lệnh `check` chạy ESLint (bao gồm kiểm tra Promise bị bỏ rơi), TypeScript `checkJs` với kiểu dữ liệu Chrome Extension và regression test cho trường hợp extension bị reload giữa chừng.

## Phát hành

```powershell
npm run release
```

Lệnh `release` chạy toàn bộ kiểm tra, xác nhận phiên bản trong `package.json`, `package-lock.json` và `manifest.json` khớp nhau, rồi đóng gói Chrome extension vào `dist/OU-Yeah-v<version>.zip` kèm tệp SHA-256.

Gói được kiểm tra các tệp runtime mà manifest khai báo, phiên bản manifest bên trong ZIP và việc loại bỏ tệp phát triển. Bản phát hành trên GitHub dùng tag `v<version>` cùng ZIP và SHA-256 của đúng commit đã kiểm tra.
