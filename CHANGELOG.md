# Changelog

## 2.1.0 - 2026-07-26

- Nâng cấp TOC/course index ELOLMS thành Course Map gọn hơn, có tìm nhanh, phân cấp rõ, badge loại tài nguyên và highlight mục đang xem.
- Sửa item con trong Course Map bị ép chữ sau khi bấm từ TOC bên trái: bỏ cột completion gây nhiễu trong drawer và trả toàn bộ mục lục về một dòng ellipsis gọn.
- Đóng Course Map bên trái mặc định khi vừa vào trang khóa học; người dùng vẫn có thể mở lại thủ công bằng nút mục lục của Moodle.
- Cho phép kéo mép phải Course Map để đổi độ rộng TOC, lưu kích thước đã chọn và nhấp đúp mép kéo để reset về mặc định.
- Sửa resize TOC không hoạt động ở trang hoạt động như `/mod/page/view.php`: resize giờ chạy trên cả course page và module page, kèm vùng bắt kéo rộng hơn ở mép phải.
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
