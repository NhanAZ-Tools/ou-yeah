# Changelog

## Chưa phát hành

## 2.2.1 - 2026-08-03

- Thêm trình tải học liệu theo toàn khóa học/chương/chủ đề/phần: quét chính xác `[Xem] Video`, `[Tải về] Slide`, `[Tải về] Script`, chỉ tải link ELOLMS đang mở và hiển thị riêng các mục bị khóa cùng điều kiện tiên quyết.
- Giữ cây thư mục và tên hiển thị trên ELOLMS trong `Downloads/OU Yeah!`, kèm hàng đợi tuần tự có tạm dừng/tiếp tục/hủy, theo dõi hoàn tất thật của Chrome và không reload tab chính.
- Xuất `ou-yeah-course-manifest.json` làm chỉ mục AI-ready cho cây khóa học, URL nguồn, trạng thái hoàn thành/tải xuống, đường dẫn cục bộ, lỗi và điều kiện khóa; khóa học chưa đạt 100% vẫn tải được mọi tài nguyên hiện đang khả dụng.
- Sửa tải hàng loạt video Vimeo khi trình chặn nội dung chặn API/telemetry của player: đọc trực tiếp `playerConfig` nhúng sẵn, rút gọn đường dẫn dài nhưng vẫn giữ đuôi tệp và liệt kê rõ từng mục lỗi để thử lại sau khi reload.
- Chuẩn hóa toàn bộ giờ hiển thị trên `elolms.ou.edu.vn` từ AM/PM sang định dạng 24 giờ; áp dụng cả nội dung Moodle tải động nhưng không can thiệp ô soạn thảo hay đoạn mã.
- Biến section đầu khóa học ELOLMS thành nhóm `Chung` có thể thu gọn/mở rộng; đồng bộ hai tài nguyên mặc định như `Thông báo` và `Thảo luận chung` với nút điều khiển tất cả.
- Thêm Quiz Lab một nút cho bài tự đánh giá: tự chạy đến khi 3 lượt liên tiếp không xuất hiện câu mới (tối đa 50 lượt), chọn phương án đầu tiên, nộp tuần tự, đọc đáp án đúng từ trang xem lại và xuất ZIP AI-ready gồm Markdown, JSON cùng ảnh câu hỏi.
- Chuẩn hóa fingerprint câu hỏi trước khi so sánh, nên việc Moodle xáo trộn thứ tự đáp án không còn tạo câu trùng hoặc kéo dài quá trình quét giả tạo; dữ liệu Quiz Lab cũ cũng được tự gộp lại khi tải.
- Sửa race condition khi quiz chuyển thẳng sang trang làm bài mà không có hộp xác nhận: trang cũ trong back/forward cache không còn báo lỗi giả hoặc ghi đè tiến trình mới.
- Chuyển toàn bộ vòng quét Quiz Lab sang iframe nền cùng ELOLMS: tab chính không còn reload/nhấp nháy giữa các lượt, nút `Tạm dừng` luôn khả dụng và khóa phiên ngăn tác vụ cũ tiếp tục sau khi người dùng tạm dừng.
- Giữ nguyên ngân hàng câu hỏi khi tiếp tục hoặc quét bổ sung; đổi nhãn hành động thành `Tiếp tục quét`, `Tải bộ đề`, `Tải bộ đề hiện có` và `Quét bổ sung`, kèm icon phân biệt tải, tạm dừng, tiếp tục và quét.
- Thu gọn Quiz Lab thành một hàng sau khi hoàn tất; phân biệt rõ giai đoạn quét và tạo ZIP, cảnh báo/chặn nhầm reload hoặc rời trang khi tác vụ còn chạy, cho tải lại dữ liệu đã gom nếu quá trình đóng gói bị gián đoạn và báo rõ khi phiên ELOLMS hết hạn.

## 2.2.0 - 2026-07-30

- Thêm exporter diễn đàn ELOLMS: xuất toàn bộ diễn đàn/kênh thông báo hoặc từng chủ đề thành ZIP AI-ready gồm `forum.md`, `forum.json`, ảnh nội dung và tài liệu Moodle đính kèm theo thư mục tương đối.
- Giữ metadata khóa học/diễn đàn, tác giả, thời gian, permalink, cây phản hồi, bảng, danh sách và liên kết; tải PDF, Word, Excel, PowerPoint cùng các tệp đính kèm khác nhưng không thu thập avatar người dùng.
- Thêm nút xuất đồng bộ giao diện OU Yeah!, tiến trình đọc chủ đề/tải ảnh/đóng gói và cơ chế tiếp tục khi một chủ đề hoặc ảnh riêng lẻ bị lỗi.

## 2.1.0 - 2026-07-26

- Nâng cấp TOC/course index ELOLMS thành Course Map gọn hơn, có tìm nhanh, phân cấp rõ, badge loại tài nguyên và highlight mục đang xem.
- Sửa item con trong Course Map bị ép chữ sau khi bấm từ TOC bên trái: bỏ cột completion gây nhiễu trong drawer và trả toàn bộ mục lục về một dòng ellipsis gọn.
- Khôi phục hành vi mặc định của TOC Moodle: extension không tự đóng Course Map bên trái khi vừa vào trang khóa học.
- Cho phép kéo mép phải Course Map để đổi độ rộng TOC, lưu kích thước đã chọn và nhấp đúp mép kéo để reset về mặc định.
- Sửa resize TOC không hoạt động ở trang hoạt động như `/mod/page/view.php`: resize giờ chạy trên cả course page và module page, kèm vùng bắt kéo rộng hơn ở mép phải.
- Tinh gọn toolbar Course Map khi TOC mở sẵn theo mặc định: giảm chiều cao header/search/stats và áp dụng cùng density/ellipsis cho TOC ở cả trang activity.
- Sửa Course Map bị giãn dọc khi section đã thu gọn nhưng vùng content collapse vẫn chiếm khoảng trắng.
- Siết tiếp spacing của TOC khi section đang mở: reset margin/padding dọc mặc định của Moodle trong item con và giảm chiều cao mỗi dòng.
- Hạ section cha trong Course Map về row một dòng như mục con: cố định chiều cao title, thu nhỏ số thứ tự/chevron và chặn Moodle padding làm phình card.
- Chuẩn hóa click section cha cấp 1 trong Course Map: giữ đúng semantics `#section-N`, scroll/highlight section hiện tại và không lẫn với activity/module con.
- Sửa highlight section cha trong Course Map theo URL `#section-N`: ưu tiên đọc `location.hash`, cập nhật khi `hashchange` và tăng độ tương phản trạng thái đang chọn.
- Làm nổi bật mục đang xem trong TOC ở các trang hoạt động (`/mod/*/view.php`) bằng viền brand, nền rõ hơn, nhãn "Đang xem" và tự cuộn TOC tới mục hiện tại.
- Sửa link TOC dạng `#module-...`/course overview trên trang hoạt động để không bị đá ngược về `/course/view.php?id=...#` khi bấm các mục như `Chuẩn đầu ra`.
- Siết lại heading trang khóa học thành dense row một dòng: font nhỏ hơn, icon thu gọn, bỏ padding dọc dư và dùng ellipsis cho tiêu đề dài.
- Đồng bộ size phần tử con trong section: activity card, icon tài nguyên, deadline/availability và nút hoàn thành nhỏ gọn hơn nhưng vẫn dễ đọc.
- Cân lại tỷ lệ giữa đề mục và activity con: đề mục rõ vai trò nhóm hơn, activity card bớt lấn át hierarchy.
- Làm rõ trạng thái section đang mở trên trang khóa học: không phụ thuộc drawer TOC, bỏ qua nút mở rộng tất cả, thêm panel/rail/header accent và badge `Mở`.
- Sửa false-positive trạng thái section mở: bỏ fallback CSS `:has()`, chỉ highlight section có class JS đã xác thực và cập nhật lại sau click/transition collapse.
- Mặc định thu gọn toàn bộ section khóa học sau khi tải trang; đồng bộ lại badge `Mở` khi bấm `Mở rộng tất cả`/`Thu gọn toàn bộ`.
- Thiết kế lại trang `Các thông báo` của ELOLMS theo bố cục rộng, rõ phân cấp và responsive.
- Thêm tìm kiếm, lọc thông báo chưa đọc, lọc theo loại và môn học.
- Tự nhận diện loại thông báo, tô màu, gắn badge môn học và nhóm theo thời gian.
- Giữ nguyên markup sự kiện cốt lõi của Moodle để thao tác chọn/xem chi tiết tiếp tục hoạt động.
- Thống nhất Space Grotesk cho toàn bộ giao diện extension và làm lại bảng màu theo hướng trung tính, giảm gradient, glow, pill và bóng đổ.
- Phủ Space Grotesk trên toàn bộ `elolms.ou.edu.vn`, gồm cả header/sidebar/form/table mặc định của Moodle nhưng vẫn chừa icon font để không vỡ biểu tượng.
- Sửa popup chuông ELOLMS bị mất icon header do rule font toàn cục đè lên FontAwesome của Moodle.
- Bỏ chấm trạng thái online không có ý nghĩa; tinh gọn HUD video, thanh tải PDF và trang thông báo.
- Chuyển trang thông báo sang cuộn trang tự nhiên bằng con lăn, đồng bộ nút về đầu trang và thay ô chọn môn học mặc định bằng dropdown riêng có hỗ trợ bàn phím.
- Thêm fallback `wheel` ở capture phase để cuộn trực tiếp document khi theme ELOLMS nuốt gesture mặc định.
- Chuẩn hóa toàn bộ asset Space Grotesk theo nguồn `NhanAZ-Web/best-fonts` và lưu provenance theo commit trong `src/fonts/README.md`.
- Hiển thị tên môn học làm nội dung chính trong dropdown; giữ mã học phần và số thông báo ở dòng metadata.
- Đăng ký Space Grotesk bằng FontFace API để Chrome tải font thật từ extension thay vì rơi về font Moodle.
- Tinh gọn danh sách thông báo thành row một dòng; đẩy thời gian, loại và mã môn học sang bên phải.
- Thay icon thông báo bằng bộ SVG riêng cho chưa đọc, bài tập, thảo luận, lịch và thông báo.
- Làm lại popup chuông ELOLMS: đổi `See all`/`View full notification`, đồng bộ list item, icon và nút hành động với trang thông báo đầy đủ.
- Sửa phân loại để thông báo hướng dẫn kiểm tra không bị nhận nhầm là bài tập.
- Làm gọn nút `Go to` và để trang chi tiết thông báo ngắn tự co theo nội dung, không tạo khoảng trắng lớn.
- Thêm script `npm run release` để kiểm tra, đóng gói `dist/OU-Yeah-v<version>.zip` và tạo SHA-256.

## 2.0.0 - 2026-07-23

- Đổi tên dự án và Chrome extension thành **OU Yeah!**; repo mới là `ou-yeah`.
- Thêm công cụ tải sách PDF trên Thư Quán OU với tiến trình trực quan.
- Làm mới HUD video, icon, animation và vị trí thông báo theo nút được bấm.
- Thêm tiến trình tải video HLS, giữ HUD hiển thị trong lúc tải và xử lý trạng thái hoàn tất/lỗi.
- Khắc phục lỗi worker HLS và lỗi Promise khi extension context bị reload.
- Thêm ESLint, TypeScript `checkJs` và regression tests.
- Tự động migrate thiết lập tốc độ từ phiên bản ELOLMS Video Tools cũ.
