// Từ điển tiếng Việt: chuỗi gốc tiếng Anh → tiếng Việt. Tách khỏi i18n-dict.ts (chuỗi gốc tiếng Việt → tiếng Anh): trình duyệt chỉ tải từ điển của ngôn ngữ đang dùng (i18n.tsx).
import { DIRECTORY } from "./connectordir";
import { UX_EN2VI, UX_RULES_VI } from "./i18n-ux";
import { OPS_EN2VI, OPS_RULES_VI } from "./i18n-ops";
import { FX_EN2VI } from "./i18n-features";


// Chuỗi gốc tiếng Anh (Cài đặt, Skills…) → tiếng Việt
export const EN2VI: Record<string, string> = {
  "Enter a valid email address.": "Hãy nhập một địa chỉ email hợp lệ.",
  "New sign-ups are closed. Ask your administrator for an account.": "Synchro đang đóng đăng ký mới. Hãy nhờ quản trị viên cấp tài khoản.",
  "By continuing, you agree to the": "Khi tiếp tục, bạn đồng ý với",
  "Terms of Service": "Điều khoản sử dụng",
  "Privacy policy": "Chính sách quyền riêng tư",
  "Open ↗": "Mở ↗",
  "Couldn't check": "Không kiểm tra được",
  "Using your browser's voice.": "Đang dùng giọng của trình duyệt.",
  "Brain": "Bộ não", "Long-term memory": "Ký ức dài hạn", "Lasting facts Synchro remembers about you (name, work, preferences). They feed the brain’s “About you” note and every chat.": "Những điều bền vững Synchro nhớ về bạn (tên, công việc, sở thích). Chúng nuôi ghi chú “Về bạn” của bộ não và mọi đoạn chat.",
  "Get started": "Bắt đầu",
  "Continue with": "Tiếp tục với",
  "OR": "hoặc",
  "Email": "Email",
  "Password": "Mật khẩu",
  "Confirm Password": "Xác nhận mật khẩu",
  "Go back": "Quay lại",
  "Welcome back": "Chào mừng trở lại",
  "Create your password": "Tạo mật khẩu",
  "Your password must be at least 6 characters long.": "Mật khẩu phải có ít nhất 6 ký tự.",
  "Enter your password to sign in.": "Nhập mật khẩu để đăng nhập.",
  "One last step": "Bước cuối cùng",
  "Confirm your password to continue": "Xác nhận mật khẩu để tiếp tục",
  "Creating your account...": "Đang tạo tài khoản...",
  "Setting things up...": "Đang thiết lập...",
  "Finalizing...": "Đang hoàn tất...",
  "Welcome to Synchro!": "Chào mừng đến với Synchro!",
  "Incorrect password.": "Mật khẩu không đúng.",
  "Passwords do not match!": "Mật khẩu không khớp!",
  "Try Again": "Thử lại",
  "Continue with email": "Tiếp tục với email",
  "Submit password": "Gửi mật khẩu",
  "Finish sign-up": "Hoàn tất đăng ký",
  "Settings": "Cài đặt", "General": "Chung", "Account": "Tài khoản", "Privacy": "Quyền riêng tư", "Billing": "Thanh toán", "Capabilities": "Khả năng", "Memory": "Bộ nhớ", "Reflect": "Nhìn lại", "Time and focus": "Thời gian và tập trung", "Synchro Code": "Synchro Code", "Customize": "Tùy chỉnh",
  "Skills": "Kỹ năng", "Plugins": "Plugin", "Search": "Tìm kiếm",
  "Appearance": "Giao diện", "Theme": "Chủ đề", "Light": "Sáng", "Dark": "Tối", "System": "Hệ thống", "Chat font": "Phông chữ trò chuyện", "Serif": "Serif",
  "Transcript text size": "Cỡ chữ trò chuyện", "Size of the conversation transcript text.": "Kích thước chữ của đoạn hội thoại.", "Small": "Nhỏ", "Medium": "Vừa", "Large": "Lớn",
  "Motion": "Chuyển động", "Reduce animation in streaming responses and other interface elements.": "Giảm hoạt ảnh trong phản hồi dạng streaming và các thành phần giao diện khác.", "Reduced": "Giảm",
  "Voice": "Giọng nói", "Language": "Ngôn ngữ", "Style": "Phong cách", "Speed": "Tốc độ", "Normal": "Bình thường", "Slow": "Chậm", "Fast": "Nhanh",
  "Buttery": "Mượt mà", "Airy": "Nhẹ nhàng", "Mellow": "Êm dịu", "Glassy": "Trong trẻo", "Rounded": "Tròn trịa",
  "English": "Tiếng Anh", "Vietnamese": "Tiếng Việt",
  "Notifications": "Thông báo", "Response completions": "Hoàn tất phản hồi", "Get notified when Synchro has finished a response. Useful for long-running tasks.": "Nhận thông báo khi Synchro trả lời xong. Hữu ích cho các tác vụ chạy lâu.",
  "Mentions and replies": "Lượt nhắc và phản hồi", "Get an email when someone @mentions you on an artifact, or replies in a comment thread you're part of.": "Nhận email khi ai đó @nhắc đến bạn trong một artifact, hoặc trả lời trong chuỗi bình luận bạn tham gia.",
  "Comments on your artifacts": "Bình luận trên artifact của bạn", "Get an email when someone comments on an artifact you own, even when you're not mentioned. Follows “Mentions and replies” until you change it.": "Nhận email khi ai đó bình luận trên artifact của bạn, kể cả khi không nhắc đến bạn. Theo “Lượt nhắc và phản hồi” cho đến khi bạn thay đổi.",
  "Artifacts shared with you": "Artifact được chia sẻ với bạn", "Get an email when someone shares an artifact with you.": "Nhận email khi ai đó chia sẻ một artifact với bạn.",
  "Profile": "Hồ sơ", "Profile photo": "Ảnh đại diện", "PNG or JPG up to 10MB.": "PNG hoặc JPG, tối đa 10MB.", "Full name": "Họ và tên", "What should Synchro call you?": "Synchro nên gọi bạn là gì?", "What best describes your work?": "Điều gì mô tả đúng nhất công việc của bạn?",
  "Product management": "Quản lý sản phẩm", "Engineering": "Kỹ thuật", "Human resources": "Nhân sự", "Finance": "Tài chính", "Marketing": "Marketing", "Sales": "Bán hàng", "Operations": "Vận hành", "Data science": "Khoa học dữ liệu", "Design": "Thiết kế", "Legal": "Pháp lý", "Other": "Khác",
  "Instructions for Synchro": "Hướng dẫn cho Synchro", "Synchro will keep these in mind for this and any of your associated accounts across chats and Cowork within": "Synchro sẽ ghi nhớ những điều này cho tài khoản này và mọi tài khoản liên quan của bạn trong các đoạn chat và Cowork, trong phạm vi",
  "Anthropic's guidelines": "nguyên tắc của Anthropic", "Learn more": "Tìm hiểu thêm", "e.g. I primarily code in Python (not a coding beginner)": "VD: Tôi chủ yếu viết code bằng Python (không phải người mới học)",
  "Log out of all devices": "Đăng xuất khỏi mọi thiết bị", "Log out": "Đăng xuất", "Delete your account": "Xóa tài khoản của bạn", "Delete account": "Xóa tài khoản", "Organization ID": "ID tổ chức",
  "Trusted devices": "Thiết bị tin cậy", "Devices that can control your local machine through remote sessions.": "Các thiết bị có thể điều khiển máy của bạn qua phiên từ xa.", "No trusted devices.": "Không có thiết bị tin cậy.",
  "Active sessions": "Phiên đang hoạt động", "Device": "Thiết bị", "Location": "Vị trí", "Created": "Tạo lúc", "Updated": "Cập nhật", "Current": "Hiện tại", "Terminate": "Kết thúc",
  "Anthropic believes in transparent data practices. Learn how your information is protected when using Anthropic products, and visit our": "Anthropic tin vào cách xử lý dữ liệu minh bạch. Tìm hiểu cách thông tin của bạn được bảo vệ khi dùng sản phẩm Anthropic, và truy cập",
  "Privacy Center": "Trung tâm quyền riêng tư", "and": "và", "Privacy Policy": "Chính sách quyền riêng tư", "for more details.": "để biết thêm chi tiết.",
  "How we protect your data": "Cách chúng tôi bảo vệ dữ liệu của bạn", "How we use your data": "Cách chúng tôi dùng dữ liệu của bạn", "Preferences": "Tùy chọn",
  "Location metadata": "Siêu dữ liệu vị trí", "Allow Synchro to use coarse location metadata (city/region) to improve product experiences.": "Cho phép Synchro dùng siêu dữ liệu vị trí tương đối (thành phố/khu vực) để cải thiện trải nghiệm sản phẩm.",
  "Help improve our AI models": "Giúp cải thiện các model AI của chúng tôi", "Allow the use of your chats and coding sessions to train and improve Anthropic AI models.": "Cho phép dùng đoạn chat và phiên lập trình của bạn để huấn luyện và cải thiện các model AI của Anthropic.",
  "Your data": "Dữ liệu của bạn", "Export data": "Xuất dữ liệu", "Shared chats": "Đoạn chat đã chia sẻ", "Manage": "Quản lý", "Shared artifacts": "Artifact đã chia sẻ", "Uploaded files": "Tệp đã tải lên", "Your feedback": "Phản hồi của bạn", "Memory preferences": "Tùy chọn bộ nhớ", "Manage ↗": "Quản lý ↗",
  "No shared chats.": "Chưa có đoạn chat nào được chia sẻ.", "No shared artifacts.": "Chưa có artifact nào được chia sẻ.", "No uploaded files.": "Chưa có tệp nào được tải lên.", "You have not given any feedback yet.": "Bạn chưa gửi phản hồi nào.",
  "Free plan": "Gói Free", "Try Synchro": "Dùng thử Synchro", "Upgrade plan": "Nâng cấp gói",
  "Chat on web, iOS, Android, and on your desktop": "Trò chuyện trên web, iOS, Android và máy tính", "Generate code and visualize data": "Tạo code và trực quan hóa dữ liệu", "Write, edit, and create content": "Viết, chỉnh sửa và tạo nội dung", "Ability to search the web": "Khả năng tìm kiếm trên web", "Memory across conversations": "Bộ nhớ xuyên suốt các cuộc trò chuyện", "Create files and execute code": "Tạo tệp và thực thi code",
  "Unlock more from Synchro with desktop extensions": "Khai thác thêm từ Synchro với tiện ích mở rộng trên máy tính", "Connect Slack and Google Workspace services": "Kết nối Slack và các dịch vụ Google Workspace", "Integrate any context or tool through connectors with remote MCP": "Tích hợp mọi ngữ cảnh hoặc công cụ qua trình kết nối với MCP từ xa", "Extended thinking for complex work": "Tư duy mở rộng cho công việc phức tạp",
  "Invoices": "Hóa đơn", "We have not sent you an invoice yet.": "Chúng tôi chưa gửi hóa đơn nào cho bạn.",
  "Tool access mode": "Chế độ truy cập công cụ", "Controls how connector tools are loaded in conversations.": "Điều khiển cách công cụ của trình kết nối được tải trong các cuộc trò chuyện.", "Tools already loaded": "Công cụ đã tải sẵn", "Load when needed": "Tải khi cần",
  "Connector search": "Tìm kiếm trình kết nối", "Let Synchro search the connector directory and surface ones relevant to your conversations.": "Cho phép Synchro tìm trong thư mục trình kết nối và đề xuất những mục phù hợp với cuộc trò chuyện.",
    "Visuals": "Hình ảnh trực quan", "Build code, documents, and designs in a dedicated window alongside your conversation.": "Tạo code, tài liệu và thiết kế trong một cửa sổ riêng bên cạnh cuộc trò chuyện.",
  "AI-powered artifacts": "Artifact tích hợp AI", "Build apps and interactive documents that use Synchro inside the artifact.": "Tạo ứng dụng và tài liệu tương tác dùng Synchro ngay bên trong artifact.",
  "Save": "Lưu", "Budget": "Ngân sách", "Delete skill": "Xóa skill", "More": "Thêm", "Toggle password visibility": "Hiện / ẩn mật khẩu", "No memories yet": "Chưa có ghi nhớ nào",
  "Synchro keeps these in mind in every chat.": "Synchro ghi nhớ những điều này và áp dụng trong mọi đoạn chat.",
  "Introduce yourself and tell Synchro how you like to work. Synchro takes this in as what it already knows about you, together with your name above and what it remembers from your chats, in every chat, in Synchro Code and in voice conversations, with every model, on any device.": "Giới thiệu về bạn và dặn Synchro cách làm việc với bạn. Synchro coi đây là những gì nó vốn đã biết về bạn, cùng với tên gọi ở trên và những điều nó nhớ từ các cuộc trò chuyện, trong mọi đoạn chat, trong Synchro Code và khi trò chuyện bằng giọng nói, với mọi model, trên mọi thiết bị.",
  "e.g. I'm a high school student preparing for my exams and IELTS. Always answer in Vietnamese. Explain step by step, keep answers short and get to the point.": "Ví dụ: Mình là học sinh lớp 12 đang ôn thi THPT và IELTS. Luôn trả lời bằng tiếng Việt, giải thích từng bước, ngắn gọn và đi thẳng vào ý chính.",
  "> Fix the auth bug in signup flow": "> Sửa lỗi đăng nhập ở bước đăng ký",
  "Synchro runs on its owner’s own server. Your chats and projects are kept in this browser and synced to your account on that server (incognito chats are not synced, but still pass through the server to reach the model, and are removed from it about 10 minutes after each reply). The server also keeps what it needs to answer and run your tools: recent replies (7 days), the sessions of the AI plans you signed in to, memory and brain notes, uploaded files, skills, connectors, apps and your Synchro Code workspace. What you send to a model goes to that provider (Anthropic, OpenAI, Google or xAI), normally through the plan you signed in with.": "Synchro chạy trên máy chủ riêng của chủ sở hữu. Đoạn chat và dự án của bạn lưu trong trình duyệt này và đồng bộ vào tài khoản của bạn trên máy chủ đó (đoạn chat ẩn danh không đồng bộ, nhưng vẫn đi qua máy chủ để tới model và bị xóa khỏi máy chủ khoảng 10 phút sau mỗi câu trả lời). Máy chủ cũng giữ những gì cần để trả lời và chạy công cụ: các lượt trả lời gần đây (7 ngày), phiên của các gói AI bạn đã đăng nhập, bộ nhớ và ghi chú bộ não, tệp tải lên, skill, connector, ứng dụng và workspace Synchro Code. Nội dung gửi cho model đi tới nhà cung cấp đó (Anthropic, OpenAI, Google hoặc xAI), thường qua gói bạn đã đăng nhập.",
  "Rate limit reported by the provider for your API key. When it runs out, replies wait until it resets.": "Hạn mức do nhà cung cấp báo cho khóa API của bạn. Hết hạn mức thì câu trả lời chờ tới khi được đặt lại.",
  "Optional spending caps for yourself. Leave empty for no limit. When a cap is reached, chats pause until it resets.": "Giới hạn chi tiêu tự đặt (không bắt buộc). Để trống là không giới hạn. Chạm giới hạn thì chat tạm dừng tới khi được đặt lại.",
  "Starts with your first message.": "Bắt đầu từ tin nhắn đầu tiên.",
  "Models in the picker": "Model ở bộ chọn", "Choose which models appear in the model picker on the main screen. Hidden models stay connected and can be shown again any time.": "Chọn model hiện ở bộ chọn model trên màn hình chính. Model bị ẩn vẫn kết nối và hiện lại được bất cứ lúc nào.",
  "Used for new chats and when the chosen model is no longer available.": "Dùng cho đoạn chat mới và khi model đang chọn không còn dùng được.",
  "Pick your models": "Chọn model", "Under Model picker above, choose which models appear on the main screen and which one new chats start with.": "Ở mục Bộ chọn model phía trên, chọn model hiện trên màn hình chính và model mặc định cho đoạn chat mới.",
  "Self-fixes": "Bản tự sửa", "In use": "Đang dùng", "Waiting for approval": "Chờ duyệt", "Rejected": "Đã bỏ", "Undone": "Đã hoàn tác", "Skill updated, no longer applies": "Skill đã cập nhật, không còn áp dụng",
  "View changes": "Xem thay đổi", "Hide changes": "Ẩn thay đổi", "Reject": "Bỏ", "Approve fix": "Duyệt bản sửa", "Undo fix": "Hoàn tác bản sửa",
  "This script can change data outside the sandbox, so Synchro waits for your approval before using the fix.": "Script này có thể thay đổi dữ liệu bên ngoài sandbox nên Synchro chờ bạn duyệt rồi mới dùng bản sửa.",
  "Critic council": "Hội đồng phản biện", "After Synchro writes code, a web page, or an app, one or two models from other providers review it in the background and point out bugs by line, with a fix you can apply.": "Sau khi Synchro viết code, trang web hoặc ứng dụng, một hoặc hai model của hãng khác đọc lại ở nền và chỉ ra lỗi theo từng dòng, kèm bản sửa áp dụng được ngay.",
  "Inline visualizations": "Trực quan hóa nội tuyến", "Allow Synchro to create interactive visuals, charts, and diagrams within the conversation.": "Cho phép Synchro tạo hình ảnh tương tác, biểu đồ và sơ đồ ngay trong cuộc trò chuyện.",
  "Code execution and file creation": "Thực thi code và tạo tệp", "Synchro can execute code and create and edit docs, spreadsheets, presentations, PDFs, and data reports. Required for skills.": "Synchro có thể thực thi code, tạo và chỉnh sửa tài liệu, bảng tính, bản trình bày, PDF và báo cáo dữ liệu. Bắt buộc cho kỹ năng.",
  "Allow network egress": "Cho phép truy cập mạng ra ngoài", "Allow Synchro to access common package managers to install packages and libraries for data analysis, visualizations, and file processing.": "Cho phép Synchro truy cập các trình quản lý gói phổ biến để cài gói và thư viện phục vụ phân tích dữ liệu, trực quan hóa và xử lý tệp.",
  "View package manager domains": "Xem các miền của trình quản lý gói", ". Monitor chats closely as this comes with": ". Hãy theo dõi sát các đoạn chat vì tính năng này đi kèm", "security risks": "rủi ro bảo mật", "Skills have moved to": "Kỹ năng đã được chuyển sang",
  "Generate memory from chats": "Tạo bộ nhớ từ đoạn chat", "Allow Synchro to generate memory from your chats.": "Cho phép Synchro tạo bộ nhớ từ các đoạn chat của bạn.",
  "Include sensitive topics in memory": "Đưa chủ đề nhạy cảm vào bộ nhớ", "Allow Synchro to save details about sensitive topics like health conditions or religious beliefs to memory.": "Cho phép Synchro lưu chi tiết về các chủ đề nhạy cảm như tình trạng sức khỏe hoặc tín ngưỡng vào bộ nhớ.",
  "Import memory from other AI providers": "Nhập bộ nhớ từ nhà cung cấp AI khác", "Bring relevant context and data from another AI provider to Synchro. We'll provide a prompt you can use to fetch the memory from your other account.": "Đưa ngữ cảnh và dữ liệu liên quan từ nhà cung cấp AI khác vào Synchro. Chúng tôi sẽ cung cấp một câu lệnh để bạn lấy bộ nhớ từ tài khoản kia.",
  "Start import": "Bắt đầu nhập", "No files yet": "Chưa có tệp nào", "Stored memories": "Bộ nhớ đã lưu", "Import memory to Synchro": "Nhập bộ nhớ vào Synchro", "Paste your memory details here": "Dán chi tiết bộ nhớ của bạn vào đây", "Add to memory": "Thêm vào bộ nhớ", "This should only take a minute or so.": "Việc này chỉ mất khoảng một phút.",
  "Delete memory": "Xóa bộ nhớ", "Delete all memory?": "Xóa toàn bộ bộ nhớ?", "Delete all": "Xóa tất cả", "Memory cleared": "Đã xóa bộ nhớ", "Synchro will forget everything it has stored about you.": "Synchro sẽ quên mọi thứ đã lưu về bạn.",
  "Export all of my stored memories and any context you've learned about me from past conversations. Preserve my words verbatim, especially for instructions and preferences.": "Xuất toàn bộ bộ nhớ đã lưu và mọi ngữ cảnh bạn đã biết về tôi từ các cuộc trò chuyện trước. Giữ nguyên lời của tôi, đặc biệt là hướng dẫn và sở thích.",
  "Based on your conversations in Synchro chat.": "Dựa trên các cuộc trò chuyện của bạn trong Synchro.", "Past month": "Tháng qua", "Past 3 months": "3 tháng qua", "Past 6 months": "6 tháng qua", "Past year": "Năm qua",
  "No reflection yet.": "Chưa có nội dung nhìn lại.", "Generate": "Tạo", "Refresh": "Làm mới", "Surfacing themes and patterns.": "Đang tìm các chủ đề và quy luật.", "Not enough data yet.": "Chưa đủ dữ liệu.", "Start a few conversations and come back for a reflection.": "Hãy bắt đầu vài cuộc trò chuyện rồi quay lại để xem nhìn lại.",
  "Recent topics": "Chủ đề gần đây", "Recurring themes": "Chủ đề lặp lại",
  "Break reminders": "Nhắc nghỉ giải lao", "Get a nudge to take a break from Synchro. You can snooze or adjust anytime.": "Nhận lời nhắc nghỉ khỏi Synchro. Bạn có thể tạm hoãn hoặc điều chỉnh bất cứ lúc nào.",
  "Quiet hours": "Giờ yên tĩnh", "Set time limits for Synchro. You can dismiss or adjust anytime.": "Đặt giới hạn thời gian dùng Synchro. Bạn có thể bỏ qua hoặc điều chỉnh bất cứ lúc nào.",
  "Monday": "Thứ Hai", "Tuesday": "Thứ Ba", "Wednesday": "Thứ Tư", "Thursday": "Thứ Năm", "Friday": "Thứ Sáu", "Saturday": "Thứ Bảy", "Sunday": "Chủ Nhật",
  "Synchro understands your codebase and helps you build, debug, and ship faster. Upgrade your plan to get started.": "Synchro hiểu codebase của bạn và giúp bạn xây dựng, gỡ lỗi và phát hành nhanh hơn. Nâng cấp gói của bạn để bắt đầu.",
  "Upgrade to Max or Pro ↗": "Nâng cấp lên Max hoặc Pro ↗",
  "Classify session states": "Phân loại trạng thái phiên", "Allow Synchro to automatically classify sessions as blocked, ready for review, or done. Classifying sessions counts towards your plan usage. Applies to new sessions.": "Cho phép Synchro tự động phân loại phiên là bị chặn, sẵn sàng xem xét hoặc hoàn tất. Việc phân loại được tính vào mức sử dụng gói. Áp dụng cho phiên mới.",
  "Code appearance": "Giao diện code", "Code font": "Phông chữ code", "Set a custom monospace font for code and terminal.": "Đặt phông chữ monospace tùy chỉnh cho code và terminal.", "Interface font": "Phông chữ giao diện", "Font for the whole interface — menus, sidebars, and panels.": "Phông chữ cho toàn bộ giao diện — menu, thanh bên và bảng điều khiển.",
  "Transcript width": "Độ rộng hội thoại", "Maximum width of the transcript and composer columns.": "Độ rộng tối đa của cột hội thoại và ô soạn tin.", "Narrow": "Hẹp", "Wide": "Rộng",
  "Default transcript view": "Chế độ xem hội thoại mặc định", "View sessions open in. Picking a view from a session's Transcript view menu changes only that session.": "Chế độ xem khi mở phiên. Chọn chế độ từ menu Xem hội thoại của một phiên chỉ thay đổi phiên đó.", "Thinking": "Suy nghĩ", "Verbose": "Chi tiết",
  "Pull requests": "Pull request", "Branch prefix": "Tiền tố nhánh", "Prefix added to branch names for both local and cloud sessions.": "Tiền tố được thêm vào tên nhánh cho cả phiên cục bộ và phiên đám mây.",
  "Create pull requests automatically": "Tự động tạo pull request", "When Synchro pushes changes to a branch, it automatically opens a pull request without asking first. Applies to cloud sessions only.": "Khi Synchro đẩy thay đổi lên một nhánh, nó tự động mở pull request mà không hỏi trước. Chỉ áp dụng cho phiên đám mây.",
  "Auto-fix pull requests": "Tự động sửa pull request", "When you create a pull request, Synchro automatically monitors it for CI failures and review comments, then responds proactively.": "Khi bạn tạo pull request, Synchro tự động theo dõi lỗi CI và bình luận đánh giá, rồi chủ động phản hồi.",
  "Authorization tokens": "Token ủy quyền", "Created when you sign in to Synchro Code. Revoke a token to sign out from that device.": "Được tạo khi bạn đăng nhập Synchro Code. Thu hồi token để đăng xuất khỏi thiết bị đó.", "Application": "Ứng dụng", "Scopes": "Phạm vi", "No connected Synchro Code instances": "Chưa có phiên bản Synchro Code nào được kết nối", "When you sign in to Synchro Code, your authorization tokens will appear here.": "Khi bạn đăng nhập Synchro Code, token ủy quyền của bạn sẽ hiện ở đây.",
  "Top connectors": "Trình kết nối hàng đầu", "New plugins": "Plugin mới", "Yours": "Của bạn", "Discover": "Khám phá", "+ Add": "+ Thêm", "Add": "Thêm", "Add your first skills": "Thêm kỹ năng đầu tiên của bạn",
  "Skills teach Synchro how you work. Add them from Discover, or create your own.": "Kỹ năng dạy Synchro cách bạn làm việc. Thêm từ Khám phá, hoặc tự tạo.", "Discover skills": "Khám phá kỹ năng", "From Anthropic & Partners": "Từ Anthropic & đối tác", "from Anthropic": "từ Anthropic", "From Anthropic": "Từ Anthropic",
  "Default order": "Thứ tự mặc định", "Sort": "Sắp xếp", "Try": "Thử", "Install": "Cài đặt", "Installed": "Đã cài đặt", "Installed from Discover": "Đã cài từ Khám phá", "Uploaded": "Đã tải lên", "Remove": "Gỡ bỏ", "Clear": "Xóa", "Continue": "Tiếp tục", "Discard": "Bỏ", "Create": "Tạo", "Cancel": "Hủy", "Copy": "Sao chép", "Delete": "Xóa", "Enter": "Nhập", "Save changes": "Lưu thay đổi",
  "Create a skill": "Tạo kỹ năng", "Create a plugin": "Tạo plugin", "Create with Synchro": "Tạo cùng Synchro", "Upload skill": "Tải lên kỹ năng", "Upload plugin": "Tải lên plugin", "Add marketplace": "Thêm marketplace", "Add custom connector": "Thêm trình kết nối tùy chỉnh", "Browse connectors": "Duyệt trình kết nối",
  "No connectors yet. Browse Discover to add one.": "Chưa có trình kết nối nào. Hãy duyệt Khám phá để thêm.", "No plugins installed yet.": "Chưa cài plugin nào.", "No results": "Không có kết quả", "Only enable plugins from people you trust.": "Chỉ bật plugin từ những người bạn tin tưởng.", "Installing will grant access to everything available to Cowork.": "Cài đặt sẽ cấp quyền truy cập mọi thứ mà Cowork có.", "Plugin by Anthropic · installs": "Plugin của Anthropic · lượt cài", "For you": "Dành cho bạn",
  "Instructions saved": "Đã lưu hướng dẫn", "Prompt copied": "Đã sao chép câu lệnh", "Signed out of other devices": "Đã đăng xuất khỏi các thiết bị khác", "Account data deleted": "Đã xóa dữ liệu tài khoản", "Log out of all devices?": "Đăng xuất khỏi mọi thiết bị?", "Every other session will be signed out. You will stay signed in on this device.": "Mọi phiên khác sẽ bị đăng xuất. Bạn vẫn đăng nhập trên thiết bị này.", "Delete your account?": "Xóa tài khoản của bạn?", "All chats, projects and settings stored in this demo will be permanently erased.": "Mọi đoạn chat, dự án và cài đặt lưu trong bản demo này sẽ bị xóa vĩnh viễn.", "Stop sharing": "Dừng chia sẻ", "Synchro settings": "Cài đặt Synchro", "Messages you sent": "Tin nhắn bạn đã gửi", "Conversations": "Cuộc trò chuyện",
  "A → Z": "A → Z", "Z → A": "Z → A", "Just now": "Vừa xong", "Topic": "Chủ đề", "Department": "Phòng ban", "Industry": "Ngành", "Everyday life": "Đời sống", "Data": "Dữ liệu", "Books": "Sách", "Languages": "Ngôn ngữ", "Law": "Luật", "Maths": "Toán", "Medicine": "Y học", "Economics": "Kinh tế", "Finances": "Tài chính", "Small Business": "Doanh nghiệp nhỏ", "Product Management": "Quản lý sản phẩm", "Bio Research": "Nghiên cứu sinh học",
  "AI models & agents": "Mô hình & agent AI", "APIs": "API", "Automation & workflows": "Tự động hóa & quy trình", "Dependencies & packages": "Phụ thuộc & gói", "Designs & media": "Thiết kế & phương tiện", "Email & messages": "Email & tin nhắn", "Events & tickets": "Sự kiện & vé", "Files & documents": "Tệp & tài liệu", "Health & exercise data": "Dữ liệu sức khỏe & tập luyện",
  "Synchro Light": "Synchro Sáng", "Synchro Dark": "Synchro Tối", "Nimble": "Nhanh nhẹn",
  "Query, chart and explain your data — SQL, spreadsheets and dashboards in one place.": "Truy vấn, vẽ biểu đồ và giải thích dữ liệu của bạn — SQL, bảng tính và dashboard trong một nơi.",
  "Start a few conversations and come back for a reflection. ": "Hãy bắt đầu vài cuộc trò chuyện rồi quay lại để xem nhìn lại.",
  "hr": "giờ",
  "Write, debug and run code with Synchro. Pick a mode, attach files with @, and preview results right in the browser.": "Viết, gỡ lỗi và chạy code cùng Synchro. Chọn chế độ, đính kèm tệp bằng @ và xem kết quả ngay trên trình duyệt.",
  "Open Synchro Code": "Mở Synchro Code",
  "Defaults": "Mặc định",
  "Default mode": "Chế độ mặc định",
  "Mode used when you open Synchro Code. Plan only outlines steps, Code writes full files, Debug traces errors to the root cause.": "Chế độ dùng khi bạn mở Synchro Code. Kế hoạch chỉ phác các bước, Code viết tệp hoàn chỉnh, Gỡ lỗi truy tới nguyên nhân gốc.",
  "Tech stack rules": "Luật công nghệ",
  "Added to every Code request so answers follow your stack.": "Được thêm vào mọi yêu cầu Code để câu trả lời đúng công nghệ của bạn.",
  "Custom rules": "Luật tùy chỉnh",
  "No rules": "Không có luật",
  "e.g. Use Go 1.22, no global state, return errors explicitly": "VD: Dùng Go 1.22, không dùng biến toàn cục, trả lỗi tường minh",
  "Safety and context": "Bảo mật và ngữ cảnh",
  "Secret redaction": "Che thông tin bí mật",
  "API keys, tokens and passwords are masked before anything is sent, then restored in the code you get back.": "Khóa API, token và mật khẩu được che trước khi gửi đi, rồi khôi phục trong code bạn nhận lại.",
  "Always on": "Luôn bật",
  "Context window": "Cửa sổ ngữ cảnh",
  "Attached files and conversation history count toward this limit. Large files are trimmed to the most relevant parts.": "Tệp đính kèm và lịch sử hội thoại được tính vào giới hạn này. Tệp lớn được rút gọn còn phần liên quan nhất.",
  "128k tokens": "128k token",
  "Editor theme": "Giao diện trình soạn thảo",
  "Theme for the code editor panel. Auto follows the interface theme.": "Giao diện cho khung soạn code. Tự động sẽ theo giao diện chung.",
  "Auto": "Tự động",
  "Monospace font for code blocks and the editor. Must be installed on your device.": "Phông monospace cho khối code và trình soạn thảo. Phải được cài trên thiết bị của bạn.",
  "Code font size": "Cỡ chữ code",
  "Applies to code blocks and the editor.": "Áp dụng cho khối code và trình soạn thảo.",
  "Run code": "Chạy code",
  "HTML and JavaScript": "HTML và JavaScript",
  "Runs in a sandboxed preview frame next to the chat.": "Chạy trong khung xem trước cách ly bên cạnh đoạn chat.",
  "Runs in your browser with Pyodide. No server needed.": "Chạy ngay trong trình duyệt bằng Pyodide. Không cần máy chủ.",
  "Node.js": "Node.js",
  "Runs in a WebContainer in your browser. Needs HTTPS.": "Chạy trong WebContainer trên trình duyệt. Cần HTTPS.",
  "Ready": "Sẵn sàng",
  "Needs HTTPS": "Cần HTTPS",
  "Optional": "Tùy chọn",
  "Cloud sandbox": "Sandbox đám mây",
  "Optional server runtime (E2B) for heavier jobs. Enabled when the server has an E2B key.": "Môi trường chạy trên máy chủ (E2B) cho tác vụ nặng. Bật khi máy chủ có khóa E2B.",
  "Code sessions": "Phiên Code",
  "Clear all": "Xóa tất cả",
  "Clear all Code sessions?": "Xóa tất cả phiên Code?",
  "Every Synchro Code conversation saved in this browser will be deleted. This can't be undone.": "Mọi cuộc trò chuyện Synchro Code lưu trên trình duyệt này sẽ bị xóa. Không thể hoàn tác.",
  "Code sessions cleared": "Đã xóa các phiên Code",
  "e.g. JetBrains Mono": "VD: JetBrains Mono",
  "Add a skill": "Thêm kỹ năng",
  "Add your first skill": "Thêm kỹ năng đầu tiên",
  "Drop a .zip skill folder or a SKILL.md here. Synchro checks it, shows a preview, then the model loads it automatically when a request matches.": "Thả thư mục kỹ năng (.zip) hoặc file SKILL.md vào đây. Synchro sẽ kiểm tra, cho xem trước, rồi model tự nạp khi yêu cầu phù hợp.",
  "Checking…": "Đang kiểm tra…",
  "Your skills": "Kỹ năng của bạn",
  "In Artifacts": "Có ở Artifacts", "In this section of Artifacts": "Có trong mục này ở trang Artifacts", "Chosen by you": "Bạn tự chọn", "Detect automatically": "Để Synchro tự nhận diện",
  "Added automatically by Synchro": "Synchro tự nhận diện và thêm vào", "Not a docs, slides or design skill": "Không thuộc Tài liệu, Trình bày hay Thiết kế",
  "No matching skills.": "Không có kỹ năng phù hợp.",
  "No skills yet.": "Chưa có kỹ năng nào.",
  "Loading…": "Đang tải…",
  "View": "Xem",
  "Skills are instructions the model will follow. Only enable skills from sources you trust, and read the content below first.": "Kỹ năng là chỉ dẫn mà model sẽ làm theo. Chỉ bật kỹ năng từ nguồn bạn tin cậy và hãy đọc nội dung bên dưới trước.",
  "Files": "Tệp",
  "Upload new version": "Tải lên phiên bản mới",
  "Enable": "Bật",
  "Disable": "Tắt",
  "Add and enable": "Thêm và bật",
  "Update and keep state": "Cập nhật (giữ trạng thái bật/tắt)",
  "Saving…": "Đang lưu…",
  "(empty)": "(trống)",
  "All versions of this skill and its files will be deleted. This can't be undone.": "Mọi phiên bản và tệp của kỹ năng này sẽ bị xóa. Không thể hoàn tác.",
  // Tài khoản & quản trị
  "Your password must be at least 8 characters long.": "Mật khẩu phải có ít nhất 8 ký tự.",
  "Signing you in...": "Đang đăng nhập...",
  "Something went wrong. Please try again.": "Đã có lỗi xảy ra. Vui lòng thử lại.",
  "Administrator": "Quản trị viên",
  "Manage accounts, sessions and sign-in for Synchro. Every action here is recorded in the audit log.": "Quản lý tài khoản, phiên đăng nhập và cách đăng nhập của Synchro. Mọi thao tác ở đây đều được ghi vào nhật ký.",
  "Owner": "Chủ sở hữu",
  "This email is reserved for the administrator. Sign in with Google, or create the admin account on the server.": "Email này dành riêng cho quản trị viên. Hãy đăng nhập bằng Google, hoặc tạo tài khoản quản trị trên máy chủ.",
  "Server script": "Script máy chủ",
  "Users": "Người dùng",
  "Active in last 7 days": "Hoạt động trong 7 ngày",
  "New in last 7 days": "Mới trong 7 ngày",
  "Suspended": "Đã khóa",
  "Failed sign-ins (24h)": "Đăng nhập thất bại (24 giờ)",
  "Sign-in": "Đăng nhập",
  "New sign-ups": "Đăng ký mới",
  "Allow new accounts to be created. People who already have an account can still sign in.": "Cho phép tạo tài khoản mới. Người đã có tài khoản vẫn đăng nhập bình thường.",
  "Email and password": "Email và mật khẩu",
  "Passwords are hashed with scrypt. Accounts lock for 15 minutes after repeated failed attempts.": "Mật khẩu được băm bằng scrypt. Tài khoản bị tạm khóa 15 phút sau nhiều lần nhập sai liên tiếp.",
  "On": "Bật",
  "Not set up": "Chưa cấu hình",
  "Ready. Users can sign in with this provider.": "Sẵn sàng. Người dùng có thể đăng nhập bằng nhà cung cấp này.",
  "Not set up. Add": "Chưa cấu hình. Thêm",
  "to the server environment.": "vào biến môi trường của máy chủ.",
  "Search by name or email": "Tìm theo tên hoặc email",
  "All": "Tất cả",
  "Active": "Hoạt động",
  "User": "Người dùng",
  "Joined": "Tham gia",
  "Last active": "Hoạt động gần nhất",
  "Status": "Trạng thái",
  "You": "Bạn",
  "Admin": "Quản trị",
  "Email verified": "Email đã xác minh",
  "Yes": "Có",
  "No": "Không",
  "Last sign-in": "Đăng nhập gần nhất",
  "User ID": "ID người dùng",
  "No active sessions.": "Không có phiên nào đang hoạt động.",
  "End": "Kết thúc",
  "Owner accounts can't be suspended or deleted from here.": "Không thể khóa hoặc xóa tài khoản chủ sở hữu tại đây.",
  "Sign out everywhere": "Đăng xuất mọi nơi",
  "Suspend": "Khóa",
  "Restore": "Mở khóa",
  "Sign this user out everywhere?": "Đăng xuất người dùng này khỏi mọi nơi?",
  "Every active session for this account will end immediately.": "Mọi phiên đang hoạt động của tài khoản này sẽ kết thúc ngay.",
  "Sign out": "Đăng xuất",
  "Suspend this account?": "Khóa tài khoản này?",
  "They will be signed out everywhere and can't sign in until you restore the account.": "Người dùng sẽ bị đăng xuất khỏi mọi nơi và không thể đăng nhập cho đến khi bạn mở khóa.",
  "No users match.": "Không có người dùng phù hợp.",
  "Audit log": "Nhật ký hoạt động",
  "Sign-ins": "Đăng nhập",
  "Admin actions": "Thao tác quản trị",
  "No events yet.": "Chưa có sự kiện nào.",
  "Load more": "Tải thêm",
  "Delete this account?": "Xóa tài khoản này?",
  "The account, its sign-in methods and all of its sessions will be permanently removed. This can't be undone.": "Tài khoản, các cách đăng nhập và mọi phiên của nó sẽ bị xóa vĩnh viễn. Không thể hoàn tác.",
  "Type the user's email to confirm:": "Nhập email của người dùng để xác nhận:",
  "Signed up": "Đã đăng ký",
  "Signed in": "Đã đăng nhập",
  "Failed sign-in": "Đăng nhập thất bại",
  "Blocked sign-in": "Chặn đăng nhập (tài khoản bị khóa)",
  "Signed out": "Đã đăng xuất",
  "Linked sign-in method": "Liên kết cách đăng nhập",
  "Changed password": "Đổi mật khẩu",
  "Ended a session": "Kết thúc một phiên",
  "Signed out other devices": "Đăng xuất các thiết bị khác",
  "Deleted own account": "Tự xóa tài khoản",
  "Suspended account": "Khóa tài khoản",
  "Restored account": "Mở khóa tài khoản",
  "Signed user out everywhere": "Đăng xuất người dùng khỏi mọi nơi",
  "Deleted account": "Xóa tài khoản",
  "Ended user session": "Kết thúc phiên của người dùng",
  "Opened sign-ups": "Mở đăng ký",
  "Closed sign-ups": "Đóng đăng ký",
  "Admin account created": "Tạo tài khoản quản trị",
  "Admin password reset": "Đặt lại mật khẩu quản trị",
  "Sign-ups opened": "Đã mở đăng ký",
  "Sign-ups closed": "Đã đóng đăng ký",
  "Session ended": "Đã kết thúc phiên",
  "User signed out everywhere": "Đã đăng xuất người dùng khỏi mọi nơi",
  "Account suspended": "Đã khóa tài khoản",
  "Account restored": "Đã mở khóa tài khoản",
  "Account deleted": "Đã xóa tài khoản",
  "Try again": "Thử lại",
  "Sign in with": "Đăng nhập bằng",
  "Change the password you use to sign in with your email.": "Đổi mật khẩu bạn dùng để đăng nhập bằng email.",
  "Add a password so you can also sign in with your email.": "Thêm mật khẩu để bạn cũng có thể đăng nhập bằng email.",
  "Change password": "Đổi mật khẩu",
  "Set password": "Đặt mật khẩu",
  "The administrator account can't be deleted.": "Không thể xóa tài khoản quản trị viên.",
  "Account ID": "ID tài khoản",
  "Password saved": "Đã lưu mật khẩu",
  "Current password": "Mật khẩu hiện tại",
  "New password (at least 8 characters)": "Mật khẩu mới (ít nhất 8 ký tự)",
  "Confirm new password": "Xác nhận mật khẩu mới",
  "Your account, sign-in methods and sessions will be permanently removed, and chats stored in this browser will be erased. This can't be undone.": "Tài khoản, các cách đăng nhập và các phiên của bạn sẽ bị xóa vĩnh viễn; các đoạn chat lưu trên trình duyệt này cũng bị xóa. Không thể hoàn tác.",
  "Enter your password to confirm": "Nhập mật khẩu để xác nhận",
  // Hồ sơ & trạng thái đăng nhập
  "Signing you in…": "Đang đăng nhập…",
  "Creating your account…": "Đang tạo tài khoản…",
  "Securing your password…": "Đang bảo mật mật khẩu…",
  "Personalising Synchro for you…": "Đang cá nhân hóa Synchro cho bạn…",
  "Saving your profile…": "Đang lưu hồ sơ…",
  "Welcome back,": "Chào mừng trở lại,",
  "Welcome to Synchro,": "Chào mừng đến với Synchro,",
  "Tell us about you": "Giới thiệu về bạn",
  "Synchro uses this to make your experience feel personal.": "Synchro dùng những thông tin này để trải nghiệm mang dấu ấn riêng của bạn.",
  "Signed in as": "Đang đăng nhập với",
  "Date of birth": "Ngày sinh",
  "Date of birth (DD/MM/YYYY)": "Ngày sinh (DD/MM/YYYY)",
  "(optional)": "(không bắt buộc)",
  "Student": "Học sinh / Sinh viên",
  "Create account": "Tạo tài khoản",
  "Use a different account": "Dùng tài khoản khác",
  "Please enter your full name.": "Hãy nhập họ và tên của bạn.",
  "Please enter a valid date of birth (DD/MM/YYYY).": "Hãy nhập ngày sinh hợp lệ (DD/MM/YYYY).",
  "Profile saved": "Đã lưu hồ sơ",
  "Occupation": "Công việc",
  // Quyền truy cập
  "Access": "Quyền truy cập",
  "Choose which models and features people can use. Administrators always have full access. This page has no view of anyone's conversations or files, though chat data needed to answer, uploads and memory are stored on this server.": "Chọn model và tính năng mà mọi người được dùng. Quản trị viên luôn có toàn quyền. Trang này không có màn hình xem đoạn chat hay tệp của ai, nhưng dữ liệu chat cần để trả lời, tệp tải lên và bộ nhớ được lưu trên máy chủ này.",
  "Default for everyone": "Mặc định cho mọi người",
  "Applies to every account without custom access.": "Áp dụng cho mọi tài khoản không có quyền riêng.",
  "Models": "Model",
  "Features": "Tính năng",
  "No models selected: this person won't be able to chat.": "Chưa chọn model nào: người này sẽ không thể trò chuyện.",
  "Projects": "Dự án",
  "Projects with their own instructions, memory and context.": "Dự án với hướng dẫn, bộ nhớ và ngữ cảnh riêng.",
  "Code workspace with file editing and previews.": "Không gian code với chỉnh sửa tệp và xem trước.",
  "Text to speech, transcription and voice tools (ElevenLabs).": "Đọc văn bản, chép lời và công cụ giọng nói (ElevenLabs).",
  "Upload skills and let the model use them.": "Tải lên skill và cho model sử dụng.",
  "File uploads": "Tải tệp lên",
  "Attach files and convert documents to text.": "Đính kèm tệp và chuyển tài liệu thành văn bản.",
  "Web search": "Tìm kiếm web",
  "Read web pages to answer questions.": "Đọc trang web để trả lời câu hỏi.",
  "Run code on the server sandbox.": "Chạy code trên sandbox của máy chủ.",
  "Custom access": "Quyền riêng",
  "Default": "Mặc định",
  "Custom": "Tùy chỉnh",
  "Using default access": "Đang dùng quyền mặc định",
  "Custom access on": "Đã bật quyền riêng",
  "Follows the default access above. Switch to Custom to choose models and features just for this person.": "Theo quyền mặc định ở trên. Chuyển sang Tùy chỉnh để chọn model và tính năng riêng cho người này.",
  "Access saved": "Đã lưu quyền",
  "Default access saved": "Đã lưu quyền mặc định",
  "Set new password": "Đặt mật khẩu mới",
  "Set a new password": "Đặt mật khẩu mới",
  "Their current password isn't needed. Share the new password with them privately.": "Không cần mật khẩu hiện tại của họ. Hãy gửi mật khẩu mới cho họ một cách riêng tư.",
  "For": "Cho",
  "Sign them out of all devices": "Đăng xuất họ khỏi mọi thiết bị",
  "Save password": "Lưu mật khẩu",
  "Password updated": "Đã cập nhật mật khẩu",
  "Set user password": "Đặt mật khẩu cho người dùng",
  "Changed user access": "Đổi quyền người dùng",
  "Changed default access": "Đổi quyền mặc định",
  "Updated profile": "Cập nhật hồ sơ",
  // Skills
  "Or paste a GitHub link (repo, folder or SKILL.md)": "Hoặc dán link GitHub (repo, thư mục hoặc SKILL.md)",
  "Import": "Nhập",
  "Choose skills to add": "Chọn skill để thêm",
  "This package contains several skills. Preview one to check it before adding, or add every valid skill at once.": "Gói này có nhiều skill. Xem trước từng skill để kiểm tra trước khi thêm, hoặc thêm tất cả skill hợp lệ một lần.",
  "Installed · will update": "Đã có · sẽ cập nhật",
  "Preview": "Xem trước",
  "Skills are instructions the model will follow. Only add skills from sources you trust.": "Skill là chỉ dẫn mà model sẽ làm theo. Chỉ thêm skill từ nguồn bạn tin tưởng.",
  "Not used yet": "Chưa được dùng",
  "Versions:": "Phiên bản:",
  "Restore version": "Khôi phục",
  "The model will use this version from now on. Newer versions stay saved and can be restored later.": "Từ giờ model sẽ dùng phiên bản này. Các phiên bản mới hơn vẫn được giữ và có thể khôi phục lại.",
};
Object.assign(EN2VI, {
  "the whole directory": "cả danh mục", "libraries": "thư viện", "Every library of": "Mọi thư viện của",
  "that is not installed yet goes into Libraries for everyone. It runs on the server in the background: you can close this page. Libraries whose license does not allow copying are skipped and listed.": "chưa cài sẽ được cài vào Thư viện cho mọi người. Máy chủ cài ở nền: bạn có thể đóng trang này. Thư viện có giấy phép không cho sao chép được bỏ qua và liệt kê lại.",
  "Claude skill directory": "Danh mục skill của Claude", "installed": "đã cài", "not installed": "chưa cài được",
  "Every library with skills from Claude's public directory, sorted into the same categories as Claude. Each library is pinned to the commit Anthropic reviewed.": "Mọi thư viện có skill trong danh mục công khai của Claude, chia theo đúng các mục ngành nghề như Claude. Mỗi thư viện ghim đúng commit Anthropic đã duyệt.",
  "Installing libraries": "Đang cài thư viện", "Installation stopped": "Đã dừng cài", "Installation finished": "Đã cài xong", "Now:": "Đang cài:",
  "libraries have a license that does not allow copying; Synchro looks for open alternatives with the same skills.": "thư viện có giấy phép không cho sao chép; Synchro tìm thư viện mở có skill tương đương để thay.",
  "Categories": "Mục ngành nghề", "No libraries match.": "Không có thư viện nào khớp.",
  "Install all": "Cài tất cả", "Install all in": "Cài tất cả mục", "Not installed": "Chưa cài",
  "Only skills whose license allows copying are installed. Skills with a closed license (such as Anthropic's docx, pdf, pptx and xlsx) are skipped; Synchro creates those files with code execution instead.": "Chỉ cài skill có giấy phép cho phép sao chép. Skill có giấy phép đóng (như docx, pdf, pptx và xlsx của Anthropic) được bỏ qua; Synchro tạo các loại tệp đó bằng chạy code.",
  "Tickets & tasks": "Phiếu việc & nhiệm vụ", "Pipelines & jobs": "Pipeline & tác vụ", "Notes & memory": "Ghi chú & bộ nhớ", "Reference docs": "Tài liệu tham khảo",
  "Websites": "Trang web", "Databases": "Cơ sở dữ liệu", "Contacts & leads": "Liên hệ & khách tiềm năng", "Servers & cloud": "Máy chủ & đám mây", "Logs & errors": "Nhật ký & lỗi",
  "Product": "Sản phẩm", "Research": "Nghiên cứu", "Financial services": "Dịch vụ tài chính", "Jobs & career": "Việc làm & sự nghiệp", "IT & security": "CNTT & bảo mật",
  "Retail & e-commerce": "Bán lẻ & thương mại điện tử", "Music": "Âm nhạc", "Personal finance": "Tài chính cá nhân", "Events": "Sự kiện", "Healthcare & life sciences": "Y tế & khoa học sự sống",
  "Puzzles": "Giải đố", "Travel": "Du lịch", "Health & fitness": "Sức khỏe & thể hình", "Games": "Trò chơi", "Shopping": "Mua sắm", "Government": "Chính phủ",
  "Family & relationships": "Gia đình & các mối quan hệ", "Media & entertainment": "Truyền thông & giải trí", "Education": "Giáo dục", "Food": "Ẩm thực", "Sports": "Thể thao",
  "Faith": "Tín ngưỡng", "Travel & hospitality": "Du lịch & lưu trú", "Nonprofit": "Phi lợi nhuận",
  "Learning & study": "Học tập", "installed for everyone, sorted by category in Discover": "đã cài cho mọi người, xem theo mục ngành nghề ở Khám phá", "Paused: GitHub is limiting downloads": "Tạm nghỉ: GitHub đang giới hạn lượt tải, sẽ tự chạy tiếp", "Closed license, not installed.": "Giấy phép đóng, không cài.", "Open alternatives:": "Thư viện mở thay thế:", "No open alternative yet.": "Chưa có thư viện mở tương đương.", "Open alternative to": "Thư viện mở thay cho", "Closed license": "Giấy phép đóng", "Home & living": "Nhà cửa & đời sống", "More categories": "Thêm mục", "Fewer categories": "Thu gọn mục", "Partner": "Đối tác",
});

export const RULES_VI: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^Used (\d+) times$/, (m) => `Đã dùng ${m[1]} lần`],
  [/^Restore v(\d+)\?$/, (m) => `Khôi phục v${m[1]}?`],
  [/^Adding (\d+)\/(\d+)…$/, (m) => `Đang thêm ${m[1]}/${m[2]}…`],
  [/^Add all \((\d+)\)$/, (m) => `Thêm tất cả (${m[1]})`],
  [/^(\d+) found$/, (m) => `Tìm thấy ${m[1]}`],
  [/^This account signs in with (.+)\. Use that button above\.$/, (m) => `Tài khoản này đăng nhập bằng ${m[1]}. Hãy dùng nút đó ở phía trên.`],
  [/^(Google|GitHub|Apple) sign-in isn't set up on the server yet\.$/, (m) => `Đăng nhập bằng ${m[1]} chưa được cấu hình trên máy chủ.`],
  [/^Add ([a-z0-9-]+)$/, (m) => `Thêm ${m[1]}`],
  [/^Update (.+) to v(\d+)$/, (m) => `Cập nhật ${m[1]} lên v${m[2]}`],
  [/^(\d+) files?$/, (m) => `${m[1]} tệp`],
  [/^(\d+) enabled$/, (m) => `${m[1]} đang bật`],
  [/^(\d+) warnings?$/, (m) => `${m[1]} cảnh báo`],
  [/^Delete skill "(.+)"\?$/, (m) => `Xóa kỹ năng "${m[1]}"?`],
  [/^v(\d+) · (.+?)(?: · (\d+) files)?$/, (m) => `v${m[1]} · ${m[2]}${m[3] ? ` · ${m[3]} tệp` : ""}`],
  [/^(\d+) sessions? stored in this browser\.$/, (m) => `${m[1]} phiên được lưu trên trình duyệt này.`],
  [/^(\d+) hr$/, (m) => `${m[1]} giờ`],
  [/^(\d+) min$/, (m) => `${m[1]} phút`],
  [/^Uploaded (.+)$/, (m) => `Đã tải lên ${m[1]}`],
];

// Bổ sung sau lượt quét toàn web (giao diện tiếng Việt): danh mục connector/plugin và nhãn tab Code.
Object.assign(EN2VI, {
  "Search, read, and upload files instantly": "Tìm, đọc và tải tệp lên tức thì",
  "Draft replies, summarize threads, and search your inbox": "Soạn thư trả lời, tóm tắt chuỗi thư và tìm trong hộp thư",
  "Manage your schedule and coordinate meetings effortlessly": "Quản lý lịch và sắp xếp cuộc họp dễ dàng",
  "Search, create, autofill, and export Canva designs": "Tìm, tạo, tự điền và xuất thiết kế Canva",
  "Access your company's SharePoint, OneDrive, Outlook, and Teams directly": "Truy cập trực tiếp SharePoint, OneDrive, Outlook và Teams của công ty",
  "Connect your Notion workspace to search, update, and power workflows": "Kết nối không gian Notion để tìm kiếm, cập nhật và chạy quy trình",
  "Generate diagrams and better code from Figma context": "Tạo sơ đồ và code tốt hơn từ ngữ cảnh Figma",
  "Send messages, create canvases, and fetch black data": "Gửi tin nhắn, tạo canvas và lấy dữ liệu",
  "CRM context for every answer, insight, and action": "Ngữ cảnh CRM cho mọi câu trả lời, nhận định và hành động",
  "Connect to Asana to coordinate tasks, projects, and goals": "Kết nối Asana để điều phối việc, dự án và mục tiêu",
  "Build QuickBooks integrations with the Intuit…": "Xây dựng tích hợp QuickBooks với Intuit…",
  "Bring product decisions, customer evidence, and…": "Đưa quyết định sản phẩm, bằng chứng từ khách hàng và…",
  "Configure, deploy and troubleshoot Umbraco 13/…": "Cấu hình, triển khai và xử lý sự cố Umbraco 13/…",
  "Use this skill when the user wants intellectual…": "Dùng skill này khi người dùng muốn trao đổi học thuật…",
  "Guide users through a structured workflow for co…": "Dẫn người dùng qua quy trình có cấu trúc để cùng…",
  "Suite of tools for creating elaborate, multi-…": "Bộ công cụ để tạo các artifact phức tạp, nhiều…",
  "by": "bởi", "Session rail": "Bảng phiên", "File": "Tệp",
});

// Cài đặt → Providers, bộ chọn model và mục "Bộ chọn model" của Quản trị viên (giao diện tiếng Việt).
Object.assign(EN2VI, {
  "Connect Synchro to AI providers with your own API keys. One key unlocks every model that provider offers your account.": "Kết nối Synchro với các nhà cung cấp AI bằng khóa API của bạn. Mỗi khóa cho phép dùng mọi model mà nhà cung cấp đó cấp cho tài khoản của bạn.",
  "Providers connected": "Nhà cung cấp đã kết nối", "Chat models available": "Model chat dùng được",
  "Keys are encrypted on the server and never sent back to the browser.": "Khóa được mã hóa trên máy chủ và không bao giờ gửi ngược về trình duyệt.",
  "Chat models": "Model chat", "Test a model": "Gửi thử tới model", "How it works": "Cách hoạt động",
  "Chat, Code and Projects": "Chat, Code và Dự án", "Speech and voice conversation": "Speech và trò chuyện bằng giọng nói",
  "· from server environment": "· từ biến môi trường của máy chủ",
  "Not connected": "Chưa kết nối", "Needs attention": "Cần kiểm tra lại", "Connected": "Đã kết nối",
  "Add key": "Thêm khóa", "Change key": "Đổi khóa", "Remove key": "Gỡ khóa", "Key removed": "Đã gỡ khóa",
  "Refresh model list": "Làm mới danh sách model", "Check key and refresh models": "Kiểm tra khóa và làm mới danh sách model",
  "Model list updated": "Đã cập nhật danh sách model", "Hide models": "Ẩn danh sách model",
  "Speech and voice conversation will stop working until you add a key again.": "Speech và trò chuyện bằng giọng nói sẽ ngừng hoạt động cho tới khi bạn thêm lại khóa.",
  "Models from this provider will disappear from the model picker until you add a key again.": "Các model của nhà cung cấp này sẽ biến mất khỏi bộ chọn model cho tới khi bạn thêm lại khóa.",
  "API key": "Khóa API", "· leave empty to keep the current key": "· để trống nếu muốn giữ khóa hiện tại",
  "Paste your API key": "Dán khóa API của bạn", "Show key": "Hiện khóa", "Hide key": "Ẩn khóa", "Advanced": "Nâng cao", "Base URL": "Base URL",
  "· optional, for proxies or compatible gateways": "· không bắt buộc, dùng cho proxy hoặc cổng tương thích",
  "Verify and save": "Kiểm tra và lưu", "· only for keys not tied to one workspace": "· chỉ dùng cho khóa không gắn với một workspace", "Choose a workspace": "Chọn workspace", "Find the ID in Claude Console": "Tìm ID trong Claude Console",
  "Add a key above, then send a test message to any model here.": "Thêm khóa ở trên, rồi gửi thử tin nhắn tới bất kỳ model nào tại đây.",
  "Model": "Model", "Message (optional)": "Tin nhắn (không bắt buộc)", "Sending…": "Đang gửi…", "Send test": "Gửi thử", "Works": "Hoạt động tốt",
  "Create a key": "Tạo khóa", "Sign in to the provider's console, add billing, and create an API key.": "Đăng nhập trang quản lý của nhà cung cấp, thêm phương thức thanh toán rồi tạo khóa API.",
  "Paste it here": "Dán khóa vào đây", "Synchro checks the key and loads every model it can use.": "Synchro kiểm tra khóa và tải mọi model mà khóa đó dùng được.",
  "Choose what people see": "Chọn model mọi người thấy", "In Administrator, pick which models appear in the model picker and who may use them.": "Ở mục Quản trị viên, chọn model nào hiện trong bộ chọn model và ai được dùng.",
  "Model picker": "Bộ chọn model", "Choose which models appear in the model picker on the main screen, and which model new chats start with.": "Chọn model nào hiện trong bộ chọn model ở màn hình chính, và model mặc định cho đoạn chat mới.",
  "Models on the main screen": "Model ở màn hình chính", "Hidden models can't be picked by anyone. Per-person access below still applies.": "Model bị ẩn thì không ai chọn được. Quyền riêng của từng người ở bên dưới vẫn được áp dụng.",
  "Show every model": "Hiện mọi model", "New models appear automatically when a provider adds them.": "Model mới tự xuất hiện khi nhà cung cấp bổ sung.",
  "Default model": "Model mặc định", "Used for new chats and when someone's chosen model is no longer available.": "Dùng cho đoạn chat mới và khi model ai đó đã chọn không còn dùng được.",
  "Default model saved": "Đã lưu model mặc định", "Automatic": "Tự động",
  "All models": "Mọi model", "Includes models added later.": "Gồm cả model được thêm sau này.", "Search models": "Tìm model", "Select all": "Chọn tất cả",
  "No models selected: this person won't be able to chat.": "Chưa chọn model nào: người này sẽ không chat được.",
  "No models yet. Add an API key in Settings → Providers first.": "Chưa có model nào. Hãy nhập khóa API ở Cài đặt → Providers trước.",
});
RULES_VI.push(
  [/^Connected · (\d+) models?$/, (m) => `Đã kết nối · ${m[1]} model`],
  [/^Connected · (.+) plan$/, (m) => `Đã kết nối · gói ${m[1]}`],
  [/^Connected (.+) · (\d+) models?$/, (m) => `Đã kết nối ${m[1]} · ${m[2]} model`],
  [/^Connected (.+)$/, (m) => `Đã kết nối ${m[1]}`],
  [/^View (\d+) models?$/, (m) => `Xem ${m[1]} model`],
  [/^· checked (.+)$/, (m) => `· kiểm tra ${m[1]}`],
  [/^Get a key from (.+)$/, (m) => `Lấy khóa từ ${m[1]}`],
  [/^Remove the (.+) key\?$/, (m) => `Gỡ khóa ${m[1]}?`],
  [/^Synchro checks the key with (.+) first, then stores it encrypted on the server\. It is never shown again in full\.$/, (m) => `Synchro kiểm tra khóa với ${m[1]} trước, rồi mã hóa và lưu trên máy chủ. Khóa đầy đủ sẽ không bao giờ hiện lại.`],
);
// Giới hạn mức nỗ lực trong Quyền truy cập (giao diện tiếng Việt).
Object.assign(EN2VI, {
  "Effort limit": "Giới hạn mức nỗ lực", "Max (no limit)": "Tối đa (không giới hạn)", "Extra high": "Cao hơn", "High": "Cao", "Medium": "Trung bình", "Low": "Thấp",
  "Highest level this person can pick. Higher effort gives more thorough answers but uses more tokens.": "Mức cao nhất người này được chọn. Mức nỗ lực cao cho câu trả lời kỹ hơn nhưng tốn nhiều token hơn.",
  "Effort limit for all models": "Giới hạn mức nỗ lực cho mọi model",
});
RULES_VI.push(
  [/^Same as all models \((.+)\)$/, (m) => `Theo mức chung (${EN2VI[m[1]] ?? m[1]})`],
  [/^(.+) \(model max\)$/, (m) => `${EN2VI[m[1]] ?? m[1]} (mức cao nhất của model)`],
  [/^Effort limit for (.+)$/, (m) => `Giới hạn mức nỗ lực cho ${m[1]}`],
);

// ===== Connectors (Cài đặt → Connectors, thẻ duyệt công cụ trong chat, lỗi từ máy chủ) =====
Object.assign(EN2VI, {
  "Let Synchro use your other apps and services for more context, and take actions in them for you.": "Cho Synchro dùng các ứng dụng và dịch vụ khác của bạn để có thêm ngữ cảnh, và thay bạn thao tác trong đó.",
  "Browse connectors": "Duyệt connector", "Add custom connector": "Thêm connector tùy chỉnh", "No connectors yet": "Chưa có connector nào",
  "Connect Notion, Linear, Figma and more, or any remote MCP server, so Synchro can search and work in them during your chats.": "Kết nối Notion, Linear, Figma và nhiều ứng dụng khác, hoặc bất kỳ máy chủ MCP từ xa nào, để Synchro tìm kiếm và làm việc trong đó khi bạn chat.",
  "Sign-ins are encrypted on the server. Tools that change data ask before running unless you allow them.": "Thông tin đăng nhập được mã hóa trên máy chủ. Công cụ thay đổi dữ liệu sẽ hỏi bạn trước khi chạy, trừ khi bạn cho phép luôn.",
  "Always allow": "Luôn cho phép", "Needs approval": "Hỏi trước", "Blocked": "Chặn", "Turned off": "Đã tắt", "Needs to be connected": "Cần kết nối", "Connection problem": "Lỗi kết nối",
  "Turn off connector": "Tắt connector", "Turn on connector": "Bật connector", "Connect": "Kết nối", "More options": "Tùy chọn khác", "Refresh tools": "Làm mới công cụ",
  "Reconnect account": "Kết nối lại tài khoản", "Disconnect": "Ngắt kết nối", "Search tools": "Tìm công cụ", "This server doesn't offer any tools yet.": "Máy chủ này chưa có công cụ nào.",
  "Read-only tools": "Công cụ chỉ đọc", "Look things up without changing anything.": "Chỉ tra cứu, không thay đổi gì.",
  "Tools that can make changes": "Công cụ có thể thay đổi dữ liệu", "May create, change or delete data, or the server doesn't say they're read-only.": "Có thể tạo, sửa hoặc xóa dữ liệu, hoặc máy chủ không cho biết là chỉ đọc.",
  "No tools match your search.": "Không có công cụ nào khớp.", "Tools refreshed": "Đã làm mới công cụ",
  "Synchro will stop using this connector and forget its sign-in. You can connect it again later.": "Synchro sẽ ngừng dùng connector này và quên thông tin đăng nhập. Bạn có thể kết nối lại sau.",
  "Connect the apps you use so Synchro can find information and take actions for you.": "Kết nối các ứng dụng bạn dùng để Synchro tìm thông tin và thay bạn thao tác.",
  "Search connectors": "Tìm connector", "Close": "Đóng", "Productivity": "Năng suất", "Development": "Lập trình", "Knowledge": "Tra cứu", "Payments": "Thanh toán", "Customer support": "Chăm sóc khách hàng",
  "Finish": "Hoàn tất", "No connectors match your search.": "Không có connector nào khớp.", "Don't see the app you need?": "Không thấy ứng dụng bạn cần?", "Add a custom connector": "Thêm connector tùy chỉnh",
  "Beta": "Beta", "Connect Synchro to any remote MCP server. If the server needs you to sign in, a window opens so you can approve access.": "Kết nối Synchro với bất kỳ máy chủ MCP từ xa nào. Nếu máy chủ cần đăng nhập, một cửa sổ sẽ mở ra để bạn cấp quyền.",
  "Name": "Tên", "e.g. Company wiki": "VD: Wiki công ty", "Remote MCP server URL": "Địa chỉ máy chủ MCP từ xa", "Advanced settings": "Cài đặt nâng cao", "· optional": "· không bắt buộc",
  "Only needed when the server doesn't let apps register themselves. Use this callback URL in that app's settings:": "Chỉ cần khi máy chủ không cho ứng dụng tự đăng ký. Dùng địa chỉ quay về này trong phần cài đặt ứng dụng đó:",
  "Only use connectors from developers you trust. Synchro doesn't review custom connectors, and a connector can read what you share with it and act in that service on your behalf.": "Chỉ dùng connector của nhà phát triển bạn tin tưởng. Synchro không kiểm duyệt connector tùy chỉnh, và connector đọc được những gì bạn chia sẻ với nó cũng như thay bạn thao tác trong dịch vụ đó.",
  "Connecting…": "Đang kết nối…",
});
for (const e of DIRECTORY) EN2VI[e.desc] = e.descVi;
RULES_VI.push(
  [/^(\d+) tools?$/, (m) => `${m[1]} công cụ`],
  [/^Disconnect (.+)\?$/, (m) => `Ngắt kết nối ${m[1]}?`],
  [/^Disconnected (.+)$/, (m) => `Đã ngắt kết nối ${m[1]}`],
  [/^Permission for all: (.+)$/, (m) => `Quyền cho cả nhóm: ${EN2VI[m[1]] ?? m[1]}`],
  [/^Permission for (.+)$/, (m) => `Quyền cho ${m[1]}`],
);

// Connectors: quyền chi tiết (giao diện tiếng Việt / tiếng Anh).
Object.assign(EN2VI, {
  "Ask once per chat": "Hỏi một lần mỗi cuộc trò chuyện", "Ask every time": "Hỏi mỗi lần", "Use in": "Dùng trong", "Where Synchro may use this connector.": "Nơi Synchro được dùng connector này.",
  "Chats": "Cuộc trò chuyện", "New tools": "Công cụ mới", "Permission for tools the server adds later.": "Quyền cho công cụ máy chủ thêm sau này.", "Permission for new tools": "Quyền cho công cụ mới",
  "Automatic (read-only: allow, others: ask)": "Tự động (chỉ đọc: cho phép, còn lại: hỏi)", "Tools that delete data": "Công cụ xóa dữ liệu",
  "Let Synchro use tools the server marks as able to delete data.": "Cho Synchro dùng công cụ được máy chủ đánh dấu là có thể xóa dữ liệu.",
  "Calls per message": "Số lần gọi mỗi tin nhắn", "Most times Synchro may call this connector while answering one message.": "Số lần nhiều nhất Synchro được gọi connector này khi trả lời một tin nhắn.",
  "No limit": "Không giới hạn", "Turned off by this connector's setting for tools that delete data.": "Đang tắt theo cài đặt công cụ xóa dữ liệu của connector này.",
  "Your administrator doesn't allow tools that delete data.": "Quản trị viên không cho dùng công cụ xóa dữ liệu.", "Turned off by your administrator": "Quản trị viên đã tắt",
  "Not allowed": "Không được phép", "Your administrator hasn't allowed this connector for your account.": "Quản trị viên chưa cho phép tài khoản của bạn dùng connector này.",
  "Custom connectors": "Connector tùy chỉnh", "Add any remote MCP server by URL.": "Tự thêm bất kỳ máy chủ MCP từ xa nào bằng địa chỉ.",
  "Use tools the server marks as able to delete data. When off, those tools are blocked everywhere.": "Dùng công cụ được máy chủ đánh dấu là có thể xóa dữ liệu. Khi tắt, các công cụ đó bị chặn ở mọi nơi.",
  "All directory connectors": "Mọi connector trong danh mục", "Includes connectors added to the directory later.": "Gồm cả connector được thêm vào danh mục sau này.",
});
EN2VI["Connect apps and services through MCP so the model can use their tools."] = "Kết nối ứng dụng và dịch vụ qua MCP để model dùng được công cụ của chúng.";

// Cài đặt → Khả năng, Artifacts, hình minh họa trong chat, tệp code đã tạo.
Object.assign(EN2VI, {
  "Turn on Artifacts first.": "Hãy bật Artifacts trước.",
  "Your administrator has turned off Cloud sandbox for your account.": "Quản trị viên đã tắt Cloud sandbox cho tài khoản của bạn.",
  "This server has no place to run code yet. An administrator needs to set up the workspace service or an E2B key.": "Máy chủ chưa có nơi chạy code. Quản trị viên cần bật dịch vụ workspace hoặc nhập khóa E2B.",
  "Code runs in a fresh, isolated container on the Synchro server and is deleted right after.": "Code chạy trong một container mới, cô lập trên máy chủ Synchro và được xóa ngay sau khi chạy.",
  "Code runs in an isolated E2B cloud sandbox that is deleted right after.": "Code chạy trong sandbox đám mây E2B cô lập và được xóa ngay sau khi chạy.",
  "Local simulation: code runs on this computer inside the macOS sandbox (no access to your files).": "Giả lập cục bộ: code chạy trên máy này trong sandbox của macOS (không đọc được tệp của bạn).",
  "Skills are paused while code execution and file creation is off.": "Skills đang tạm dừng vì Thực thi code và tạo tệp đang tắt.",
  "Package manager domains": "Tên miền của trình quản lý gói",
  "With network egress on, code can only reach these registries (and their subdomains). Every other address is blocked.": "Khi bật truy cập mạng, code chỉ tới được các kho thư viện này (và tên miền con của chúng). Mọi địa chỉ khác đều bị chặn.",
  "GitHub (packages, releases)": "GitHub (gói, bản phát hành)",
  "Security risks of network egress": "Rủi ro bảo mật khi cho truy cập mạng",
  "Packages from public registries can contain malicious code. It runs inside the isolated sandbox, which is deleted after each run.": "Gói từ kho công khai có thể chứa mã độc. Mã đó chỉ chạy trong sandbox cô lập, bị xóa sau mỗi lần chạy.",
  "Content Synchro reads (web pages, files, connector results) could try to trick it into installing a package or sending data out. Only package registries are reachable, which limits but does not remove that risk.": "Nội dung Synchro đọc (trang web, tệp, kết quả connector) có thể tìm cách lừa nó cài gói hoặc gửi dữ liệu ra ngoài. Chỉ kho thư viện là truy cập được, nên rủi ro giảm bớt nhưng không mất hẳn.",
  "Review what Synchro runs, especially in chats that use files or connectors you don't fully trust. Turn this off when you don't need extra packages.": "Hãy xem Synchro chạy gì, nhất là trong cuộc trò chuyện dùng tệp hoặc connector bạn không hoàn toàn tin tưởng. Tắt mục này khi không cần cài thêm gói.",
  "Done": "Xong",
});

// Mức dùng API (Cài đặt → Usage, Quản trị viên → Usage limits).
Object.assign(EN2VI, {
  "Usage": "Mức dùng", "Usage limits": "Giới hạn sử dụng",
  "Synchro uses AI models through their APIs, so usage is measured in real API cost: the tokens each model reads and writes, at that model's price.": "Synchro dùng model AI qua API, nên mức dùng được tính bằng chi phí API thật: số token mỗi model đọc và viết, nhân với giá của model đó.",
  "Current session": "Phiên hiện tại", "Weekly · all models": "Hằng tuần · mọi model",
  "Starts with your first message and lasts 5 hours.": "Bắt đầu từ tin nhắn đầu tiên và kéo dài 5 giờ.", "Resets at the same time every week.": "Đặt lại vào cùng giờ mỗi tuần.",
  "No limit": "Không giới hạn", "Rate limit reported by the provider for the whole Synchro server. When it runs out, replies wait until it resets.": "Hạn mức do nhà cung cấp báo cho cả máy chủ Synchro. Khi hết, câu trả lời phải chờ tới lúc hạn mức được đặt lại.",
  "Last 30 days": "30 ngày qua", "API cost": "Chi phí API", "Input tokens": "Token đầu vào", "Output tokens": "Token đầu ra", "Read from cache": "Đọc từ cache",
  "Daily cost": "Chi phí theo ngày", "Hover a day for details": "Rê chuột vào một ngày để xem chi tiết", "30 days ago": "30 ngày trước", "Today": "Hôm nay",
  "By model": "Theo model", "By feature": "Theo tính năng", "No usage yet. Start a chat and it shows up here.": "Chưa có mức dùng nào. Bắt đầu một cuộc trò chuyện và số liệu sẽ hiện ở đây.",
  "AI-powered artifacts": "Artifact dùng AI", "Memory and titles": "Bộ nhớ và tiêu đề", "API key tests": "Thử khóa API",
  "Cost is estimated from each provider's list price, including cache reads and writes. Your provider's invoice is the final amount.": "Chi phí được ước tính theo giá niêm yết của từng nhà cung cấp, gồm cả đọc và ghi cache. Hóa đơn của nhà cung cấp là số tiền cuối cùng.",
  "Administrators can change limits and prices in": "Quản trị viên đổi hạn mức và bảng giá ở", "Administrator → Usage limits": "Quản trị viên → Giới hạn sử dụng",
  "Synchro uses models through their APIs. Usage is the real API cost of each call, so you can cap how much each person spends.": "Synchro dùng model qua API. Mức dùng là chi phí API thật của mỗi lần gọi, nên bạn đặt được hạn mức chi tiêu cho từng người.",
  "Default limits": "Hạn mức mặc định", "API cost each person can use. Leave empty for no limit. When a limit is reached, chats pause until it resets.": "Chi phí API mỗi người được dùng. Để trống là không giới hạn. Khi chạm hạn mức, chat tạm dừng tới khi được đặt lại.",
  "Per session (5 hours)": "Mỗi phiên (5 giờ)", "Starts with a person's first message.": "Bắt đầu từ tin nhắn đầu tiên của người đó.", "Per week": "Mỗi tuần",
  "Apply to administrators": "Áp dụng cho quản trị viên", "Off: administrators have no limit unless you set one for them below.": "Tắt: quản trị viên không bị giới hạn, trừ khi bạn đặt riêng bên dưới.",
  "People": "Mọi người", "Cost in the last 30 days and limits for each account. A custom limit replaces the default.": "Chi phí 30 ngày qua và hạn mức của từng tài khoản. Hạn mức riêng thay cho hạn mức mặc định.",
  "30 days": "30 ngày", "Session": "Phiên", "Week": "Tuần", "Use default limits": "Dùng hạn mức mặc định",
  "Model prices": "Bảng giá model", "USD per 1 million tokens, used to turn tokens into cost. Claude prices are official; others are estimates you should check against each provider's pricing page.": "USD cho mỗi 1 triệu token, dùng để quy token ra chi phí. Giá Claude là giá chính thức; các hãng khác là giá ước tính, bạn nên đối chiếu với trang giá của từng hãng.",
  "Model": "Model", "Input": "Đầu vào", "Output": "Đầu ra", "Cache read": "Đọc cache", "Official": "Chính thức", "Custom": "Tùy chỉnh", "Estimate": "Ước tính", "Reset price": "Đặt lại giá",
  "Session limit saved": "Đã lưu hạn mức phiên", "Weekly limit saved": "Đã lưu hạn mức tuần", "Limits now apply to administrators": "Hạn mức giờ áp dụng cả cho quản trị viên",
  "Administrators have no limit": "Quản trị viên không bị giới hạn", "Limit saved": "Đã lưu hạn mức", "Using default limits": "Đang dùng hạn mức mặc định", "Price saved": "Đã lưu giá", "Price reset": "Đã đặt lại giá",
});
EN2VI["Usage limits"] = "Giới hạn sử dụng";

// Plugins và trang Tùy chỉnh.
Object.assign(EN2VI, {
  "Plugins": "Plugins",
  "Install a whole set of skills in one step from GitHub. Link a plugin to the Design, Slides or Docs button and Synchro gets its entire library for that work.": "Cài cả một bộ skill từ GitHub chỉ trong một bước. Gắn plugin với nút Thiết kế, Trình bày hoặc Tài liệu để Synchro có cả thư viện chuyên môn cho việc đó.",
  "Preview": "Xem trước", "Studios": "Studio",
  "The Design, Slides and Docs buttons on the Artifacts page. Each one loads its plugin's library, so Synchro already knows how to do the work well.": "Các nút Thiết kế, Trình bày và Tài liệu ở trang Artifacts. Mỗi nút nạp thư viện của plugin tương ứng, nên Synchro biết sẵn cách làm việc đó cho đẹp.",
  "Manage": "Quản lý", "Install": "Cài đặt", "Ask an administrator to install it.": "Hãy nhờ quản trị viên cài.", "Installed": "Đã cài", "Browse": "Khám phá",
  "Synchro only installs skills whose license allows copying. Anthropic's docx, pdf, pptx and xlsx skills are proprietary and are skipped; Synchro creates those files with code execution instead.": "Synchro chỉ cài skill có giấy phép cho phép sao chép. Skill docx, pdf, pptx và xlsx của Anthropic là độc quyền nên bị bỏ qua; Synchro tạo các tệp đó bằng chạy code.",
  "Reading the repository and checking every skill…": "Đang đọc repo và kiểm tra từng skill…", "Everyone": "Mọi người", "Install once for every account on this Synchro": "Cài một lần cho mọi tài khoản trên Synchro này",
  "Only me": "Chỉ mình tôi", "A personal plugin in your account": "Plugin riêng trong tài khoản của bạn", "Cancel": "Hủy", "Installing…": "Đang cài…",
  "Personal": "Cá nhân", "Turned on": "Đang bật", "Turn it off just for you.": "Tắt cho riêng bạn.", "Off: no skill of this plugin is used anywhere.": "Tắt: không skill nào của plugin này được dùng.",
  "List every skill directly": "Liệt kê thẳng từng skill", "Off: Synchro opens this library on its own when a request needs it. On: each skill is listed in every chat, which uses more context.": "Tắt: Synchro tự mở thư viện này khi yêu cầu cần tới. Bật: từng skill được liệt kê trong mọi cuộc trò chuyện, tốn ngữ cảnh hơn.",
  "Studio button": "Nút studio", "Pressing this Artifacts button gives Synchro the whole library of this plugin.": "Bấm nút này ở trang Artifacts là Synchro có cả thư viện của plugin.",
  "Auto-detect": "Tự động nhận diện", "Synchro sorts each skill of this plugin into Docs, Slides or Design by itself.": "Synchro tự xếp từng skill của plugin này vào Tài liệu, Trình bày hoặc Thiết kế.",
  "This plugin's skills are not put into any category. Synchro can still open them in chat when a request needs them.": "Skill của plugin này không được xếp vào mục nào. Synchro vẫn mở được chúng trong chat khi yêu cầu cần tới.",
  "None": "Không", "Design": "Thiết kế", "Slides": "Trình bày", "Docs": "Tài liệu", "Uninstall": "Gỡ cài đặt", "Add skills from zip": "Thêm skill từ file zip", "Export .zip": "Xuất .zip",
  "Update": "Cập nhật", "Check for updates": "Kiểm tra cập nhật", "No scripts": "Không có script", "Scripts, sandboxed": "Có script, chạy trong sandbox",
  "Review scripts": "Nên xem script", "High risk": "Rủi ro cao", "files": "tệp", "skills": "skill",
});
Object.assign(EN2VI, {
  "Installed": "Đã cài", "Duplicate of": "Trùng với", "An update is available": "Có bản cập nhật mới", "Already up to date": "Đang là bản mới nhất",
  "Plugin updated": "Đã cập nhật plugin", "Added": "Đã thêm", "Plugin uninstalled": "Đã gỡ plugin", "Updated": "Cập nhật",
  "for everyone": "cho mọi người", "personal": "cá nhân", "every chat": "mọi cuộc trò chuyện",
});
Object.assign(EN2VI, { "https://github.com/owner/repo  (every SKILL.md inside is found automatically)": "https://github.com/chủ-sở-hữu/repo  (tự tìm mọi SKILL.md bên trong)", "Close": "Đóng" });
Object.assign(EN2VI, {
  "Yours": "Của bạn", "Discover": "Khám phá", "Add": "Thêm", "Add from a GitHub repository": "Thêm từ repo GitHub",
  "Paste a link to a public repository or a folder inside it. Synchro finds every SKILL.md, checks licenses and scripts, and shows you everything before installing.": "Dán link repo công khai hoặc một thư mục trong đó. Synchro tự tìm mọi SKILL.md, kiểm tra giấy phép và script, rồi cho bạn xem hết trước khi cài.",
  "Manage": "Quản lý", "Turn off for me": "Tắt cho tôi", "Turn off": "Tắt", "Turn on": "Bật", "Studios": "Studio", "Development & testing": "Lập trình & kiểm thử", "Writing": "Viết",
  "Browse Synchro directory": "Duyệt danh mục của Synchro", "Curated plugins with checked licenses": "Plugin chọn lọc, đã kiểm tra giấy phép",
  "Add from a repository": "Thêm từ repo", "Install skills from a GitHub repository": "Cài skill từ một repo GitHub",
  "Add your first plugins": "Thêm plugin đầu tiên", "Give Synchro role-level expertise with plugins. Add them from Discover.": "Cho Synchro chuyên môn theo từng vai trò bằng plugin. Thêm từ mục Khám phá.",
  "Discover plugins": "Khám phá plugin", "For everyone": "Cho mọi người", "Just for you": "Riêng bạn", "No plugins match your search.": "Không có plugin nào khớp.",
  "Just chat: Synchro looks through every installed library and picks the skills that fit your request. The Design, Slides and Docs buttons on the Artifacts page only force that mode.": "Cứ chat bình thường: Synchro tự xem mọi thư viện đã cài và chọn skill hợp với yêu cầu. Các nút Thiết kế, Trình bày, Tài liệu ở trang Artifacts chỉ để ép vào chế độ đó.",
  "From Synchro": "Từ Synchro", "Directory plugins only contain skills whose license allows copying. Anthropic's docx, pdf, pptx and xlsx skills are proprietary and are skipped; Synchro creates those files with code execution instead.": "Plugin trong danh mục chỉ gồm skill có giấy phép cho phép sao chép. Skill docx, pdf, pptx, xlsx của Anthropic là độc quyền nên bị bỏ qua; Synchro tạo các tệp đó bằng chạy code.",
  "Off": "Tắt", "Install": "Cài đặt",
});
Object.assign(EN2VI, { "is installed and ready to use": "đã cài và sẵn sàng dùng" });
// Ô "Thêm từ GitHub" dùng chung (Kỹ năng + Plugins)
Object.assign(EN2VI, {
  "Who can use this skill?": "Ai được dùng skill này?", "Only me": "Chỉ mình tôi", "Everyone": "Mọi người",
  "Goes to Your skills. Only your account uses it.": "Vào Skill của bạn, chỉ tài khoản của bạn dùng.",
  "Goes to the Library for everyone. Every account can use it.": "Vào Thư viện cho mọi người, mọi tài khoản đều dùng được.",
  "Only administrators can add to the Library for everyone.": "Chỉ quản trị viên thêm được vào Thư viện cho mọi người.",
  "Add for everyone": "Thêm cho mọi người",
  "Paste a git repository link (GitHub, GitLab, Bitbucket…): one skill or any repository": "Dán link repo git (GitHub, GitLab, Bitbucket…): một skill hoặc bất kỳ repo nào",
  "Synchro looks at the link for you. One skill goes to Your skills. A repository with several skills is installed as a library, with license and script checks and one-click updates. A repository without SKILL.md: Synchro reads every file in it and writes the skill from it.": "Synchro tự xem link. Một skill thì vào mục Skill của bạn. Repo có nhiều skill thì cài thành một thư viện, có kiểm tra giấy phép, script và cập nhật một chạm. Repo không có SKILL.md: Synchro đọc mọi tệp trong repo rồi tự viết skill từ đó.",
  "This repository has no SKILL.md. Synchro is reading every file in it and writing the skill. This can take a minute.": "Repo này không có SKILL.md. Synchro đang đọc mọi tệp trong repo và viết skill, có thể mất khoảng một phút.",
  "Reading the repository…": "Đang đọc repo…", "Add from a repository link": "Thêm từ link repo", "GitHub, GitLab… One skill or any repository, detected for you": "GitHub, GitLab… Một skill hay bất kỳ repo nào, Synchro tự nhận ra",
  "Paste a GitHub link: one skill or a whole repository": "Dán link GitHub: một skill hoặc cả repo",
  "Synchro looks at the link for you. One skill goes to Your skills. A repository with several skills is installed as a library, with license and script checks and one-click updates.": "Synchro tự xem link. Một skill thì vào mục Skill của bạn. Repo có nhiều skill thì cài thành một thư viện, có kiểm tra giấy phép, script và cập nhật một chạm.",
  "Checking…": "Đang kiểm tra…", "Add from GitHub": "Thêm từ GitHub", "One skill or a whole repository, detected for you": "Một skill hay cả repo, Synchro tự nhận ra",
  "Paste a link to a public repository, a folder inside it, or a single SKILL.md. Synchro checks licenses and scripts and shows you everything before installing.": "Dán link repo công khai, một thư mục trong đó hoặc một file SKILL.md. Synchro kiểm tra giấy phép, script và cho bạn xem hết trước khi cài.",
  "Install for everyone": "Cài cho mọi người", "Installed as a one-skill library so every account can use it.": "Cài thành thư viện một skill để mọi tài khoản cùng dùng được.",
  "It's a single skill, so it was added to Skills": "Đây là một skill lẻ nên đã được thêm vào Kỹ năng", "No SKILL.md found at this link.": "Không tìm thấy SKILL.md nào ở link này.",
});
RULES_VI.push([/^This link has (\d+) skills, so Synchro installs them together as one library\. Untick any skill you don't need\.$/, (m) => `Link này có ${m[1]} skill nên Synchro cài chung thành một thư viện. Bỏ chọn những skill không cần.`]);
// Kho kỹ năng (gộp Skills và Plugins)
Object.assign(EN2VI, {
  "Skill Hub": "Kho kỹ năng", "Libraries for everyone": "Thư viện cho mọi người", "Your libraries": "Thư viện của bạn", "Your skills": "Skill của bạn",
  "Upload a skill": "Tải lên skill", "A .zip skill folder or a SKILL.md file": "Thư mục skill dạng .zip hoặc file SKILL.md",
  "Describe what you need, Synchro writes the skill": "Mô tả điều bạn cần, Synchro viết skill giúp bạn", "Curated libraries with checked licenses": "Thư viện chọn lọc, đã kiểm tra giấy phép",
  "Just chat: Synchro looks through every library and skill here and picks the ones that fit your request. A library is a set of skills installed together; a single skill is one you added on its own.": "Cứ chat bình thường: Synchro tự xem mọi thư viện và skill ở đây rồi chọn cái hợp với yêu cầu. Thư viện là một bộ nhiều skill cài cùng lúc; skill lẻ là skill bạn thêm riêng từng cái.",
  "Single skills you add show up here. Paste a GitHub link above, or drop a .zip skill folder or a SKILL.md anywhere on this page.": "Skill lẻ bạn thêm sẽ hiện ở đây. Dán link GitHub ở trên, hoặc thả thư mục skill .zip hay file SKILL.md vào bất kỳ đâu trên trang này.",
  "Drop to add the skill": "Thả vào để thêm skill", ".zip skill folder or SKILL.md": "Thư mục skill .zip hoặc SKILL.md", "Scripts": "Có script",
  "Skills and plugins live in the": "Skill và plugin nằm trong",
});
Object.assign(EN2VI, {
  "Xuất bản thành ứng dụng": "Xuất bản thành ứng dụng", "Chép đường dẫn": "Chép đường dẫn", "Gỡ ứng dụng": "Gỡ ứng dụng",
});
Object.assign(EN2VI, { "So sánh với bản trước": "So sánh với bản trước", "Chỉ vào phần muốn sửa": "Chỉ vào phần muốn sửa", "Chỉ và sửa": "Chỉ và sửa" });
Object.assign(EN2VI, {
  "Often unhelpful": "Hay bị chê", "Most answers that used this skill were rated unhelpful. Consider updating it or turning it off.": "Phần lớn câu trả lời dùng skill này bị đánh giá không hữu ích. Hãy cập nhật hoặc tắt skill.",
});
RULES_VI.push([/^Rated helpful (\d+) · unhelpful (\d+)$/, (m) => `Hữu ích ${m[1]} · không hữu ích ${m[2]}`]);
RULES_VI.push([/^Fixed automatically after (\d+) tr(?:y|ies)(?: · used (\d+) more times)?$/, (m) => `Tự sửa sau ${m[1]} lần thử${m[2] ? ` · đã dùng thêm ${m[2]} lần` : ""}`]);

// Cài đặt → Providers: đăng nhập gói subscription (Claude, ChatGPT, Gemini), khóa API dùng chung, số dư API đã nạp.
Object.assign(EN2VI, {
  "Use the AI plans you already pay for. Sign in once and every model your plan allows shows up in the model picker, only for your account.": "Dùng gói AI bạn đang trả tiền. Đăng nhập một lần là mọi model gói cho phép hiện trong bộ chọn model, chỉ cho tài khoản của bạn.",
  "Your plans": "Gói của bạn", "Shared API keys": "Khóa API dùng chung",
  "Only administrators see this. Keys here are shared with everyone on this Synchro. Voice (ElevenLabs) works with an API key only.": "Chỉ quản trị viên thấy phần này. Khóa ở đây dùng chung cho mọi người trên Synchro này. Giọng nói (ElevenLabs) chỉ dùng khóa API.",
  "Shared API keys are managed by an administrator.": "Khóa API dùng chung do quản trị viên quản lý.",
  "Sign in on the provider's page": "Đăng nhập trên trang của hãng",
  "Synchro runs the provider's official app on the server and shows you its sign-in link. Your password never passes through Synchro.": "Synchro chạy ứng dụng chính chủ của hãng trên máy chủ và hiện link đăng nhập của nó. Mật khẩu của bạn không bao giờ đi qua Synchro.",
  "Chat with your plan": "Chat bằng gói của bạn",
  "Pick a model under “Your plan” in the model picker. The usage ring shows your plan's own limits.": "Chọn model trong nhóm “Gói của bạn” ở bộ chọn model. Vòng tròn mức dùng hiện đúng hạn mức của gói.",
  "The server restarted during sign-in. Click Sign in to start again.": "Máy chủ vừa khởi động lại trong lúc đăng nhập. Hãy bấm Đăng nhập để bắt đầu lại.",
  "Keep going when the plan runs out": "Không bị gián đoạn khi gói hết hạn mức",
  "If your plan hits its limit and an administrator added an API key for the same provider, Synchro continues with that key.": "Khi gói chạm giới hạn và quản trị viên đã thêm khóa API của cùng hãng, Synchro tự chuyển sang khóa đó.",
  "Claude Pro or Max plan": "Gói Claude Pro hoặc Max", "ChatGPT Plus, Pro or Business plan": "Gói ChatGPT Plus, Pro hoặc Business", "Google AI Pro or Ultra plan": "Gói Google AI Pro hoặc Ultra",
  "Checking…": "Đang kiểm tra…", "Not installed": "Chưa cài", "Signed in": "Đã đăng nhập", "Not signed in": "Chưa đăng nhập",
  "Sign in": "Đăng nhập", "Starting…": "Đang mở…", "Sign out": "Đăng xuất", "Open sign-in page": "Mở trang đăng nhập",
  "Use claude.ai sign-in instead": "Đăng nhập bằng tài khoản claude.ai", "Copy code": "Sao chép mã", "Copied": "Đã sao chép",
  "Enter this code": "Nhập mã này", "It expires in 15 minutes. Never share it with anyone.": "Mã hết hạn sau 15 phút. Không chia sẻ mã cho bất kỳ ai.",
  "Waiting for you to approve…": "Đang chờ bạn cho phép…", "Paste the code here": "Dán mã vào đây", "Paste the code from the sign-in page": "Dán mã từ trang đăng nhập",
  "Sign in to ChatGPT, then enter the one-time code below.": "Đăng nhập ChatGPT, rồi nhập mã một lần bên dưới.",
  "Claude Code creates a long-lived sign-in token for this account. Synchro stores it encrypted and only hands it to Claude Code.": "Claude Code tạo token đăng nhập dài hạn cho tài khoản này. Synchro lưu token đã mã hóa và chỉ trao cho Claude Code.",
  "Sign-in failed.": "Đăng nhập không thành công.", "The code was not accepted.": "Mã không được chấp nhận.", "Install failed.": "Cài đặt không thành công.",
  "Claude · Your plan": "Claude · Gói của bạn", "ChatGPT · Your plan": "ChatGPT · Gói của bạn", "Gemini · Your plan": "Gemini · Gói của bạn", "Grok · Your plan": "Grok · Gói của bạn",
  "SuperGrok or X Premium+ plan": "Gói SuperGrok hoặc X Premium+", "Grok (plan default)": "Grok (mặc định của gói)", "Grok account": "tài khoản Grok",
  "API key only": "Chỉ khóa API", "No plan sign-in for this provider.": "Hãng này không có đăng nhập bằng gói.", "Check this code": "Kiểm tra mã này",
  "Sign in with the account that has your SuperGrok or X Premium+ plan, then confirm the code below.": "Đăng nhập bằng tài khoản có gói SuperGrok hoặc X Premium+, rồi xác nhận mã bên dưới.",
  "The sign-in page should show the same code. It expires in 10 minutes. Never share it with anyone.": "Trang đăng nhập phải hiện đúng mã này. Mã hết hạn sau 10 phút. Đừng chia sẻ mã cho bất kỳ ai.",
  "SuperGrok and X Premium+ have rolling usage limits. The Grok CLI doesn't report how much is left, so Synchro counts your messages and tells you when Grok says the limit is reached.": "SuperGrok và X Premium+ có hạn mức cuốn chiếu. Grok CLI không báo còn bao nhiêu, nên Synchro đếm số tin nhắn và báo khi Grok nói đã chạm giới hạn.",
  "ChatGPT (plan default)": "ChatGPT (mặc định của gói)", "Gemini (plan default)": "Gemini (mặc định của gói)",
  "Prepaid balance": "Số dư đã nạp", "Not tracked. Enter what you loaded into this key to get a warning before it runs out.": "Chưa theo dõi. Nhập số tiền đã nạp cho khóa này để được báo trước khi hết.",
  "Top up": "Nạp thêm", "Set balance": "Đặt số dư", "Track balance": "Theo dõi số dư", "Stop tracking balance": "Ngừng theo dõi số dư",
  "Amount added": "Số tiền nạp thêm", "Current balance": "Số dư hiện tại",
});
RULES_VI.push(
  [/^Signed in with your (.+?)(?: · (\d+) models?)?$/, (m) => `Đã đăng nhập bằng ${({ "long-lived token": "token dài hạn", "claude.ai account": "tài khoản claude.ai", "ChatGPT account": "tài khoản ChatGPT", "API key": "khóa API", "Google account": "tài khoản Google", "Grok account": "tài khoản Grok", account: "tài khoản" } as Record<string, string>)[m[1]] ?? m[1]}${m[2] ? ` · ${m[2]} model` : ""}`],
  [/^An administrator needs to install (.+) on the server first\.$/, (m) => `Quản trị viên cần cài ${m[1]} trên máy chủ trước.`],
  [/^Downloading the official (.+)\. This can take a minute\.$/, (m) => `Đang tải ${m[1]} chính chủ. Có thể mất khoảng một phút.`],
  [/^Open the (.+) sign-in page$/, (m) => `Mở trang đăng nhập ${m[1]}`],
  [/^Sign in with the account that has your (.+), then copy the code the page shows you\.$/, (m) => `Đăng nhập bằng tài khoản có ${m[1].replace(/^(Claude|ChatGPT|Google AI) /, "gói $1 ").replace(" or ", " hoặc ")}, rồi chép mã trang đó hiện ra.`],
  [/^(.+) keeps your sign-in in a folder only your account uses on the server\.$/, (m) => `${m[1]} giữ thông tin đăng nhập trong thư mục chỉ tài khoản của bạn dùng trên máy chủ.`],
  [/^Sign out of (.+)\?$/, (m) => `Đăng xuất khỏi ${m[1]}?`],
  [/^Synchro removes this sign-in from the server\. (.+) models from your plan disappear from the model picker until you sign in again\.$/, (m) => `Synchro xóa thông tin đăng nhập này khỏi máy chủ. Model ${m[1]} của gói sẽ biến mất khỏi bộ chọn model cho tới khi bạn đăng nhập lại.`],
  [/^Signed in to (.+)\. Its models are now in the model picker\.$/, (m) => `Đã đăng nhập ${m[1]}. Model của gói đã có trong bộ chọn model.`],
  [/^Signed out of (.+)$/, (m) => `Đã đăng xuất khỏi ${m[1]}`],
  [/^Installed (.+)$/, (m) => `Đã cài ${m[1]}`],
  [/^(\$[\d.,]+) left of (\$[\d.,]+)$/, (m) => `Còn ${m[1]} / ${m[2]}`],
  [/^Added (\$[\d.,]+) to (.+)$/, (m) => `Đã nạp thêm ${m[1]} cho ${m[2]}`],
  [/^(.+) balance set to (\$[\d.,]+)$/, (m) => `Số dư ${m[1]} đặt là ${m[2]}`],
);

// Cài đặt → Providers gộp theo hãng: chọn đăng nhập gói hay liên kết khóa API; hỏi trước khi dùng khóa API thay gói.
const viOf = (t: string): string => {
  if (Object.prototype.hasOwnProperty.call(EN2VI, t)) return EN2VI[t];
  for (const [re, f] of RULES_VI) { const m = t.match(re); if (m) return f(m); }
  return t;
};
Object.assign(EN2VI, {
  "Connect Claude, ChatGPT, Gemini, Grok and DeepSeek with your own plan or with an API key shared by everyone.": "Kết nối Claude, ChatGPT, Gemini, Grok và DeepSeek bằng gói của chính bạn hoặc bằng khóa API dùng chung cho mọi người.",
  "Sign in with your plan": "Đăng nhập gói của bạn", "Link an API key": "Liên kết khóa API",
  "Shared with everyone on this Synchro, billed to the key.": "Dùng chung cho mọi người trên Synchro này, tính tiền vào khóa.",
  "Creates images in chat when you ask for a photo, illustration, logo or poster.": "Tạo ảnh ngay trong khung chat khi bạn xin ảnh chụp, hình minh họa, logo hay poster.", "May create images on paid plans. The Free plan can't.": "Có thể tạo ảnh ở gói trả phí. Gói Free thì không.", "May create images on paid plans, depending on your xAI account limits.": "Có thể tạo ảnh ở gói trả phí, tùy giới hạn của tài khoản xAI.",
  "Sign in again": "Cần đăng nhập lại", "Back to my plan": "Quay lại gói", "Use the shared API key": "Dùng khóa API dùng chung",
  "Synchro never switches from your plan to an API key on its own. When your plan hits its limit, it asks you first.": "Synchro không bao giờ tự chuyển từ gói sang khóa API. Khi gói chạm giới hạn, Synchro sẽ hỏi bạn trước.",
  "Other providers": "Nhà cung cấp khác", "API key only. Voice (ElevenLabs) works with an API key only.": "Chỉ dùng khóa API. Giọng nói (ElevenLabs) chỉ dùng khóa API.",
  "Pick a provider, then how to connect it": "Chọn hãng, rồi chọn cách kết nối",
  "Sign in with your own plan, or link an API key that everyone on this Synchro can use.": "Đăng nhập gói của chính bạn, hoặc liên kết khóa API để mọi người trên Synchro này cùng dùng.",
  "Sign in with your own plan. Synchro runs the provider's official app on the server and shows you its sign-in link. Your password never passes through Synchro.": "Đăng nhập gói của chính bạn. Synchro chạy ứng dụng chính chủ của hãng trên máy chủ và hiện link đăng nhập của nó. Mật khẩu của bạn không bao giờ đi qua Synchro.",
  "Chat with it": "Chat với model",
  "The model picker keeps one group per provider. A group shows your plan's models while you are signed in, otherwise the shared API models.": "Bộ chọn model có một nhóm cho mỗi hãng. Khi bạn đã đăng nhập gói, nhóm hiện model của gói; nếu không thì hiện model của khóa API dùng chung.",
  "When your plan runs out": "Khi gói hết hạn mức",
  "Synchro asks before switching to the shared API key. You switch back to your plan automatically when it resets.": "Synchro hỏi bạn trước khi chuyển sang khóa API dùng chung. Khi gói hồi lại, Synchro tự quay về gói.",
});
RULES_VI.push(
  [/^Plan: (.+)$/, (m) => `Gói: ${viOf(m[1])}`],
  [/^API: (.+)$/, (m) => `API: ${viOf(m[1])}`],
  [/^Use your own (.+)\. Only your account uses it\.$/, (m) => (/^Tài khoản/.test(viOf(m[1])) ? `Dùng ${viOf(m[1]).replace(/^Tài/, "tài")}. Chỉ tài khoản của bạn dùng.` : `Dùng ${viOf(m[1]).replace(/^Gói/, "gói")} của chính bạn. Chỉ tài khoản của bạn dùng.`)],
  [/^How to use (.+)$/, (m) => `Cách dùng ${m[1]}`],
  [/^Balance (.+?)( \(top up needed\))?$/, (m) => `Số dư ${m[1]}${m[2] ? " (cần nạp thêm)" : ""}`],
  [/^(.+) has no plan sign-in for other apps, so it connects with an API key only\.$/, (m) => `${m[1]} không cho ứng dụng khác đăng nhập bằng gói, nên chỉ kết nối bằng khóa API.`],
  [/^(.+ plan) · (.+)$/, (m) => `${viOf(m[1])} · ${m[2]}`],
  [/^Using the shared API key instead of your plan until (.+)\.$/, (m) => `Đang dùng khóa API dùng chung thay gói tới ${m[1]}.`],
  [/^Your plan hit its limit\. It resets (.+)\.$/, (m) => `Gói đã hết hạn mức, hồi lại ${m[1]}.`],
  [/^(.+) now uses the shared API key until your plan resets$/, (m) => `${m[1]} đang dùng khóa API dùng chung tới khi gói hồi lại`],
  [/^(.+) is back on your plan$/, (m) => `${m[1]} đã quay lại gói của bạn`],
);
Object.assign(EN2VI, {
  "Antigravity is waiting for you to finish its first-run setup: pick a color scheme, then accept its terms and choose whether Google may use your interactions. Synchro never answers these for you. Until then, chat works but plan limits can't be read.":
    "Antigravity đang chờ bạn hoàn tất bước làm quen lần đầu: chọn bảng màu, đồng ý điều khoản và chọn có cho Google dùng dữ liệu tương tác hay không. Synchro không bao giờ chọn thay bạn. Trong lúc chờ, chat vẫn dùng được nhưng chưa đọc được hạn mức của gói.",
});
Object.assign(EN2VI, {
  "Use the code from the page you just opened. Each time you press Sign in, a new link is created and older codes stop working.": "Dùng mã của đúng trang vừa mở. Mỗi lần bấm Đăng nhập là một link mới, mã của link cũ không dùng được nữa.",
});
// Khóa ElevenLabs giới hạn quyền.
Object.assign(EN2VI, {
  "Restricted keys work too. Turn on the features you use; User access is optional and only shows your plan here.": "Khóa giới hạn quyền cũng dùng được. Bật quyền cho các tính năng bạn dùng; quyền User không bắt buộc, chỉ để hiện tên gói ở đây.",
});
Object.assign(EN2VI, {
  "ElevenLabs voice for reading answers aloud and voice conversation. Auto picks a voice in the answer's language.": "Giọng ElevenLabs để đọc to câu trả lời và trò chuyện bằng giọng nói. Tự động: chọn giọng theo ngôn ngữ của câu trả lời.",
  "Using your browser's voice. Add an ElevenLabs key in Settings → Providers for natural AI voices.": "Đang dùng giọng của trình duyệt. Thêm khóa ElevenLabs ở Cài đặt → Providers để có giọng AI tự nhiên.",
  "Browser": "Trình duyệt",
});
// Bộ nhớ (Cài đặt → Bộ nhớ, giao diện tiếng Việt).
Object.assign(EN2VI, {
  "Allow Synchro to remember lasting details from your chats (name, work, preferences) and use them in later chats.": "Cho phép Synchro ghi nhớ những điều lâu dài từ các đoạn chat (tên, công việc, sở thích) và dùng lại trong các đoạn chat sau.",
});
RULES_VI.push(
  [/^Added (\d+) memories$/, (m) => `Đã thêm ${m[1]} mục vào bộ nhớ`],
  [/^(\d)\s+Copy this prompt into a chat with your other AI provider$/, (m) => `${m[1]}  Chép câu lệnh này vào một đoạn chat với nhà cung cấp AI kia`],
  [/^(\d)\s+Paste results below to add to Synchro's memory$/, (m) => `${m[1]}  Dán kết quả vào bên dưới để thêm vào bộ nhớ của Synchro`],
);
// Chữ tiếng Anh còn sót ở giao diện tiếng Việt (rà bằng scripts/i18n-audit.mjs và rà trên giao diện).
Object.assign(EN2VI, {
  "Your plan needs you to sign in again in Settings → Providers.": "Gói của bạn cần đăng nhập lại ở Cài đặt → Providers.",
  "From your plan": "Từ gói của bạn", "Limit reached ·": "Đã chạm hạn mức ·", "Plan limits": "Hạn mức gói", "View usage details": "Xem chi tiết mức dùng",
  "Antigravity is waiting for you to finish its first-run setup (color scheme, terms and data sharing). See Settings → Providers → Gemini.":
    "Antigravity đang chờ bạn hoàn tất bước làm quen lần đầu (bảng màu, điều khoản và chia sẻ dữ liệu). Xem Cài đặt → Providers → Gemini.",
  "Synchro could not read the plan's quota yet.": "Synchro chưa đọc được hạn mức của gói.",
  "Send a message with this plan to see its limits.": "Gửi một tin nhắn bằng gói này để xem hạn mức.",
  "(estimated price)": "(giá ước tính)", "Default: none": "Mặc định: ∞", "of": "trên",
  "Weekly · model limit": "Hàng tuần · hạn mức theo model", "Usage credits": "Credit sử dụng",
  "Open": "Mở", "Toggle confirm password visibility": "Hiện / ẩn mật khẩu xác nhận",
  "Auto-Fix": "Tự sửa lỗi", "Inline Edit": "Sửa tại chỗ", "Secret Vault": "Kho bí mật", "Codebase": "Mã nguồn", "Folder": "Thư mục", "Function": "Hàm",
  "Diff": "So sánh thay đổi", "Plan": "Kế hoạch", "Debug": "Gỡ lỗi", "Seed": "Hạt giống", "Remix": "Phối lại",
});
RULES_VI.push(
  [/^Default: (\$[\d.,]+)$/, (m) => `Mặc định: ${m[1]}`],
  [/^Add a file to (.+)$/, (m) => `Thêm tệp vào ${viOf(m[1])}`],
  [/^More options for (.+)$/, (m) => `Tùy chọn khác cho ${viOf(m[1])}`],
);
RULES_VI.push(
  [/^(.+) sign-in isn't set up on the server yet\.$/, (m) => `Máy chủ chưa thiết lập đăng nhập bằng ${m[1]}.`],
  [/^Fixed automatically after (\d+) (.+?)( · used (\d+) more times)?$/, (m) => `Tự sửa sau ${m[1]} ${m[2] === "runs" || m[2] === "run" ? "lần chạy" : m[2]}${m[4] ? ` · đã dùng thêm ${m[4]} lần` : ""}`],
);
// Bộ đếm ký tự của phần giới thiệu (Cài đặt → Tài khoản) khi dán quá dài.
RULES_VI.push([/^([\d,]+) characters over the limit · ([\d,]+) \/ 20,000$/, (m) => `Quá giới hạn ${m[1].replace(/,/g, ".")} ký tự · ${m[2].replace(/,/g, ".")} / 20.000`]);
Object.assign(EN2VI, {
  "Updated the task list": "Đã cập nhật danh sách việc", "Ran a command": "Đã chạy một lệnh", "Weekly": "Hằng tuần", "Gemini models": "Model Gemini", "· admin": "· quản trị",
  "Antigravity is waiting for you to finish its first-run setup (color scheme, terms and data sharing) before it shows plan limits.": "Antigravity đang chờ bạn hoàn tất bước làm quen lần đầu (bảng màu, điều khoản, chia sẻ dữ liệu) rồi mới hiện hạn mức của gói.",
  "Synchro could not read the quota panel yet.": "Synchro chưa đọc được bảng hạn mức.",
  "Architect / Plan": "Kiến trúc / Kế hoạch", "Write / Code": "Viết code", "sandbox server": "sandbox máy chủ", "🔧 Auto-Fix": "🔧 Tự sửa", "E2B (server)": "E2B (máy chủ)", "Format": "Định dạng",
  "24 images": "24 ảnh", "My Files": "Tệp của tôi", "Close folder": "Đóng thư mục", "Open folder": "Mở thư mục",
  "⏱ Time": "⏱ Thời gian", "▤ Space": "▤ Bộ nhớ", "ChatGPT account": "tài khoản ChatGPT", "Google account": "tài khoản Google", "claude.ai account": "tài khoản claude.ai", "long-lived token": "token dài hạn",
  "· updated": "· cập nhật", "to": "đến", "next day": "hôm sau", "(binary file)": "(tệp nhị phân)", "warning": "cảnh báo",
});
RULES_VI.push(
  [/^(.*) Synchro could not read the quota panel yet\.$/, (m) => `${viOf(m[1])} Synchro chưa đọc được bảng hạn mức.`],
  [/^Send a message with this plan to see its limits\. (.*)$/, (m) => `Gửi một tin nhắn bằng gói này để xem hạn mức. ${viOf(m[1])}`],
  [/^Added (.+) to (.+)$/, (m) => `Đã cộng ${m[1]} vào ${m[2]}`], [/^(.+) balance set to (.+)$/, (m) => `Đã đặt số dư ${m[1]} thành ${m[2]}`], [/^(.+) left of (.+)$/, (m) => `Còn ${m[1]} / ${m[2]}`],
  [/^Error (\d+)$/, (m) => `Lỗi ${m[1]}`], [/^Run (\d+)$/, (m) => `Lỗi ${m[1]}`], [/^Install (.+)$/, (m) => `Cài ${m[1]}`],
  [/^Signed in with your (.+?)(?: · (\d+) models)?$/, (m) => `Đã đăng nhập bằng ${viOf(m[1]) === m[1] && m[1] === "account" ? "tài khoản" : viOf(m[1])}${m[2] ? ` · ${m[2]} model` : ""}`],
);
EN2VI["Default access"] = "Quyền mặc định";
EN2VI["Web design guidelines, React best practices, view transitions, deploy."] = "Hướng dẫn thiết kế web, React best practices, view transitions, triển khai.";
Object.assign(EN2VI, {
  "Restored this version": "Đã quay lại bản này", "Synchro keeps this up to date from what it learns in your chats": "Synchro tự cập nhật phần này từ những gì học được trong các đoạn chat",
  "Automatic updates from your chats are off": "Đang tắt tự cập nhật từ các đoạn chat", "Update automatically from my chats": "Tự cập nhật từ các đoạn chat của tôi",
  "Hide history": "Ẩn lịch sử", "History": "Lịch sử", "Written by Synchro": "Synchro viết", "Written by you": "Bạn viết", "Use this version": "Dùng bản này", "Current": "Đang dùng",
});
RULES_VI.push([/^Synchro updated this from your chats on (.+)$/, (m) => `Synchro đã cập nhật phần này từ các đoạn chat lúc ${m[1]}`]);
Object.assign(EN2VI, {
  "Browser": "Trình duyệt", "Browser control": "Điều khiển trình duyệt",
  "Synchro can open websites in its own browser and click, type, fill in forms, and finish tasks on the web for you, with any model. You watch it live next to the chat and can take over or stop it at any time. Sign-ins you make there are kept for next time.":
    "Synchro mở trang web trong trình duyệt của mình rồi tự bấm, gõ, điền biểu mẫu và làm xong việc trên web cho bạn, với mọi model. Bạn xem trực tiếp cạnh khung chat và giành lại quyền điều khiển hay dừng bất cứ lúc nào. Các lần đăng nhập ở đó được giữ cho lần sau.",
  "Your administrator has not enabled Synchro Code and Cloud sandbox for your account.": "Quản trị viên chưa bật Synchro Code và Cloud sandbox cho tài khoản của bạn.",
  "This server has no workspace service yet, so there is no browser.": "Máy chủ chưa bật dịch vụ workspace nên chưa có trình duyệt.",
});
Object.assign(EN2VI, {
  "Synchro can open websites and click, type, fill in forms, and finish tasks on the web for you, with any model: in its own browser, which you watch live next to the chat, or in your own Chrome through the Synchro extension. You can take over or stop it at any time. Sign-ins are kept for next time.":
    "Synchro mở trang web rồi tự bấm, gõ, điền biểu mẫu và làm xong việc trên web cho bạn, với mọi model: trong trình duyệt của nó (bạn xem trực tiếp cạnh khung chat), hoặc ngay trên Chrome của bạn qua tiện ích Synchro. Bạn giành lại quyền điều khiển hay dừng bất cứ lúc nào. Các lần đăng nhập được giữ cho lần sau.",
  "Your administrator has not enabled Synchro Code and Cloud sandbox for your account, so Synchro's own browser is off. Your own Chrome still works through the extension.":
    "Quản trị viên chưa bật Synchro Code và Cloud sandbox cho tài khoản của bạn nên trình duyệt của Synchro đang tắt. Chrome của bạn vẫn dùng được qua tiện ích.",
  "Your browser": "Trình duyệt của bạn",
  "Like Claude in Chrome: install the Synchro extension in Chrome, Edge or Brave and pair it with your account. Synchro then works right in your browser, with the sites you are already signed in to. It has full control of every tab by default; you can limit it to the Synchro tab group in the extension. Each Synchro account pairs its own browsers, on any computer.":
    "Giống Claude trong Chrome: cài tiện ích Synchro vào Chrome, Edge hoặc Brave rồi ghép nối với tài khoản của bạn. Từ đó Synchro làm việc ngay trên trình duyệt của bạn, với các trang bạn đã đăng nhập sẵn. Mặc định Synchro có toàn quyền trên mọi tab; bạn có thể giới hạn chỉ nhóm tab Synchro trong cửa sổ tiện ích. Mỗi tài khoản Synchro ghép nối trình duyệt của mình, trên bất kỳ máy nào.",
  "When this is on, Synchro works in your browser unless you ask for its own browser. You can also just say “on my Chrome” in a message.":
    "Khi bật, Synchro làm trên trình duyệt của bạn trừ khi bạn nhờ dùng trình duyệt của Synchro. Bạn cũng có thể chỉ cần nói “trên Chrome của tôi” trong tin nhắn.",
});
// Nhật ký quản trị: ghép nối trình duyệt qua tiện ích Synchro.
EN2VI["Paired a browser (Synchro extension)"] = "Ghép nối trình duyệt (tiện ích Synchro)";
// Synchro Code: chế độ quyền, thẻ duyệt, kiểu xem / kiểu trả lời, trạng thái phiên, đồng bộ, trang được phép, cookie, tự sửa / tự lưu trữ PR.
// Chỉ thêm mục chưa có (không ghi đè bản dịch sẵn có của cùng chữ ở chỗ khác).
const addNew = (d: Record<string, string>, o: Record<string, string>) => { for (const [k, v] of Object.entries(o)) if (!Object.prototype.hasOwnProperty.call(d, k)) d[k] = v; };
addNew(EN2VI, UX_EN2VI);
RULES_VI.push(...UX_RULES_VI);
addNew(EN2VI, OPS_EN2VI);
RULES_VI.push(...OPS_RULES_VI);
addNew(EN2VI, FX_EN2VI);
addNew(EN2VI, {
  "Transcript width": "Độ rộng khung hội thoại", "Narrow": "Hẹp", "Wide": "Rộng",
  "Maximum width of the conversation and the message box, in chat and in Synchro Code.": "Độ rộng tối đa của đoạn hội thoại và ô soạn tin, ở khung chat và Synchro Code.",
  "Sessions": "Phiên làm việc", "Classify session states": "Tự phân loại trạng thái phiên",
  "After every turn, a fast model marks the session in the sidebar as needs you, ready for review, or done. Counts toward your usage.": "Sau mỗi lượt, một model nhanh đánh dấu phiên ở thanh bên là cần bạn, chờ xem lại hay đã xong. Tính vào mức dùng của bạn.",
  "Sync sessions across devices": "Đồng bộ phiên giữa các thiết bị",
  "Keep Code sessions on this Synchro server so you can continue them on another computer or your phone. Work Synchro does in the background, like fixing a pull request, also shows up in the session.": "Lưu phiên Code trên máy chủ Synchro này để mở tiếp ở máy tính khác hay trên điện thoại. Việc Synchro làm nền, như tự sửa pull request, cũng hiện trong phiên.",
  "Allow auto mode": "Cho phép chế độ Tự động",
  "Let sessions run in Auto mode, where Synchro edits files and runs commands without asking. Needed for auto-fixing pull requests, which run while you're away.": "Cho phép phiên chạy ở chế độ Tự động: Synchro tự sửa tệp và chạy lệnh mà không hỏi. Cần cho việc tự sửa pull request, vốn chạy khi bạn vắng mặt.",
  "Default permission mode": "Chế độ quyền mặc định",
  "Ask first: Synchro asks before every file edit and every command that can change something. Edit files: edits freely, asks before such commands. Auto: never asks. Change it for one session from the message box.": "Hỏi trước: Synchro hỏi trước mỗi lần sửa tệp và mỗi lệnh có thể thay đổi gì đó. Tự sửa tệp: tự sửa tệp, chỉ hỏi trước những lệnh như vậy. Tự động: không bao giờ hỏi. Đổi cho từng phiên ngay dưới ô soạn tin.",
  "Ask first": "Hỏi trước", "Edit files": "Tự sửa tệp",
  "Prompt suggestions": "Gợi ý câu nhắn",
  "After Synchro replies, show a suggested next message in the message box. Press Tab to use it. Adds a little to your usage.": "Sau khi Synchro trả lời, hiện gợi ý câu nhắn tiếp theo trong ô soạn tin. Bấm Tab để dùng. Tốn thêm một chút mức dùng.",
  "Archive inactive sessions": "Tự lưu trữ phiên không hoạt động",
  "Move Code sessions with no activity for this long to Archived in the sidebar. Running and pinned sessions are never archived. Opening an archived session brings it back.": "Chuyển phiên Code không hoạt động quá thời gian này vào mục Code đã lưu trữ ở thanh bên. Phiên đang chạy hay đã ghim không bao giờ bị lưu trữ. Mở phiên đã lưu trữ là phiên quay lại danh sách.",
  "Never": "Không bao giờ", "After 1 day": "Sau 1 ngày", "After 3 days": "Sau 3 ngày", "After 7 days": "Sau 7 ngày", "After 30 days": "Sau 30 ngày",
  "Output style": "Kiểu trả lời",
  "How Synchro writes its responses in new Code sessions. Explanatory adds short notes on why the code is written that way. Learning leaves small, meaningful parts for you to write and reviews them. The session menu can change it for one session.": "Cách Synchro viết câu trả lời ở phiên Code mới. Giải thích: thêm ghi chú ngắn vì sao code viết như vậy. Học cùng: để lại vài phần nhỏ, có ý nghĩa cho bạn tự viết rồi xem lại giúp bạn. Menu của phiên đổi được cho từng phiên.",
  "Explanatory": "Giải thích", "Learning": "Học cùng",
  "Default transcript view": "Kiểu xem mặc định",
  "Normal keeps tool steps folded. Thinking also shows the model's reasoning when the model returns it. Verbose opens every step with its input and output. The session menu can change it for one session.": "Bình thường: gọn các bước dùng công cụ. Suy nghĩ: hiện thêm phần suy nghĩ của model khi model trả về. Chi tiết: mở mọi bước kèm đầu vào và đầu ra. Menu của phiên đổi được cho từng phiên.",
  "Thinking": "Suy nghĩ", "Verbose": "Chi tiết",
  "Keep cookies": "Giữ cookie",
  "How Synchro's browser keeps cookies and sign-ins. Always: until you clear them. Until the browser stops: cleared each time it starts again (it stops after a while without use). Per session: each chat or Code session starts signed out, so sessions never see each other's sign-ins.": "Cách trình duyệt của Synchro giữ cookie và đăng nhập. Luôn giữ: tới khi bạn xóa. Đến khi trình duyệt tắt: xóa mỗi lần trình duyệt bật lại (trình duyệt tự tắt sau một lúc không dùng). Riêng từng phiên: mỗi đoạn chat hay phiên Code bắt đầu ở trạng thái chưa đăng nhập, phiên này không thấy đăng nhập của phiên khác.",
  "Always": "Luôn giữ", "Until the browser stops": "Đến khi trình duyệt tắt", "Per session": "Riêng từng phiên",
  "Clear browsing data": "Xóa dữ liệu duyệt web", "Sign Synchro's browser out of every site and clear its cookies and site data now.": "Đăng xuất trình duyệt của Synchro khỏi mọi trang và xóa ngay cookie cùng dữ liệu trang.",
  "Clear now": "Xóa ngay", "Clearing…": "Đang xóa…", "Browsing data cleared": "Đã xóa dữ liệu duyệt web", "Couldn't clear browsing data": "Không xóa được dữ liệu duyệt web",
  "Ask before using new sites": "Hỏi trước khi dùng trang mới",
  "In chat and in Code, Synchro asks before using its browser on a site that isn't in your allowed sites. Blocked sites are always refused, even when this is off. Your workspace's local servers never ask.": "Ở khung chat và Code, Synchro hỏi trước khi dùng trình duyệt trên trang chưa có trong danh sách trang được phép. Trang bị chặn luôn bị từ chối, kể cả khi tắt mục này. Server chạy trong workspace của bạn không bao giờ hỏi.",
  "Allowed and blocked sites": "Trang được phép và bị chặn", "Allowed sites": "Trang được phép", "Blocked sites": "Trang bị chặn",
  "No sites yet. Sites you allow with “Always allow” appear here.": "Chưa có trang nào. Trang bạn chọn “Luôn cho phép” sẽ hiện ở đây.", "No blocked sites.": "Chưa chặn trang nào.",
  "Added to the branches Synchro creates, for example synchro/fix-login.": "Thêm vào đầu tên nhánh Synchro tạo, ví dụ synchro/fix-login.",
  "When you push from a Code session, Synchro opens a pull request without asking. Pushing from the default branch first moves the work to a new branch with your prefix.": "Khi bạn push từ phiên Code, Synchro tự mở pull request mà không hỏi. Push từ nhánh chính thì Synchro chuyển thay đổi sang nhánh mới theo tiền tố của bạn trước.",
  "Synchro watches the pull requests it opened. When CI fails or someone leaves a comment, it works on the fix in the same session, pushes to the branch, and replies on the pull request.": "Synchro theo dõi các pull request nó đã mở. Khi CI lỗi hay có người góp ý, Synchro sửa ngay trong phiên đó, đẩy lên nhánh và trả lời trên pull request.",
  "Turn on Allow auto mode above: fixes run while you're away, with nobody to approve them.": "Bật Cho phép chế độ Tự động ở trên: việc tự sửa chạy khi bạn vắng mặt, không có ai bấm duyệt.",
  "Archive after merge or close": "Tự lưu trữ khi PR được gộp hay đóng",
  "When a pull request is merged or closed, archive its session. After a merge Synchro also deletes the branch on GitHub and the session's workspace folder, unless something there isn't pushed yet.": "Khi pull request được gộp hay đóng, lưu trữ phiên của nó. Sau khi gộp, Synchro xóa luôn nhánh trên GitHub và thư mục workspace của phiên, trừ khi trong đó còn thay đổi chưa đẩy.",
});
RULES_VI.push([/^(\d+) allowed · (\d+) blocked$/, (m) => `${m[1]} được phép · ${m[2]} bị chặn`]);
addNew(EN2VI, { "Pull request": "Pull request" });
// Bảo mật, quyền riêng tư, xóa dữ liệu
Object.assign(EN2VI, {
  "Privacy policy": "Chính sách quyền riêng tư",
  "Password saved. Other devices were signed out.": "Đã lưu mật khẩu. Các thiết bị khác đã được đăng xuất.",
  "Password saved. Other devices were signed out and the Synchro extension must be paired again.": "Đã lưu mật khẩu. Các thiết bị khác đã được đăng xuất và cần ghép nối lại tiện ích Synchro.",
  "Create reset link": "Tạo đường dẫn đặt lại", "Reset link created": "Đã tạo đường dẫn đặt lại", "Password reset link": "Đường dẫn đặt lại mật khẩu", "Copy link": "Sao chép đường dẫn", "Link copied": "Đã sao chép đường dẫn", "Couldn't copy the link": "Không sao chép được đường dẫn",
  "Send this link to them privately. It works once, expires in 24 hours, and signs them out everywhere. It is shown only now.": "Hãy gửi đường dẫn này cho họ qua kênh riêng. Đường dẫn dùng được một lần, hết hạn sau 24 giờ và đăng xuất họ khỏi mọi thiết bị. Đường dẫn chỉ hiện lúc này.",
  "Replies started (24h)": "Lượt trả lời (24 giờ)", "Replies failed (24h)": "Lượt trả lời lỗi (24 giờ)",
  "Sign-in failing": "Đăng nhập đang lỗi", "Last sign-in failed": "Lần đăng nhập gần nhất lỗi",
  "Connected GitHub": "Đã kết nối GitHub", "Failed provider sign-in": "Đăng nhập qua nhà cung cấp lỗi", "Requested a password reset email": "Yêu cầu email đặt lại mật khẩu", "Forgot your password?": "Quên mật khẩu?", "Reset password with a link": "Đặt lại mật khẩu bằng đường dẫn", "Created password reset link": "Đã tạo đường dẫn đặt lại mật khẩu",
  "Saved API key": "Đã lưu khóa API", "Removed API key": "Đã gỡ khóa API", "Changed API credit": "Đã đổi hạn mức API", "Changed default model": "Đã đổi model mặc định", "Changed main models": "Đã đổi các model chính",
});

// Giao diện "Instrument": đầu trang, tab, nút mới.
Object.assign(EN2VI, { "Libraries and skills Synchro uses when it works for you: add one from a repository link, upload one, or browse the license-checked directory.": "Thư viện và skill Synchro dùng khi làm việc cho bạn: thêm từ link repo, tải lên, hoặc khám phá danh mục đã kiểm tra giấy phép." });
Object.assign(EN2VI, { "Search by email or IP": "Tìm theo email hoặc IP", "Previous page": "Trang trước", "Next page": "Trang sau" });
// Kho kỹ năng → Quét skill rác (skillscanui.tsx, skillscan.ts)
Object.assign(EN2VI, {
  "Scan for junk skills": "Quét skill rác", "Scanning skills…": "Đang quét skill…",
  "A model reads every skill in your Skill Hub: your skills, your libraries and the libraries for everyone. It points out junk skills and skills with no real use, and explains why for each one.": "Model đọc từng skill trong Kho kỹ năng: Skill của bạn, Thư viện của bạn và Thư viện cho mọi người, rồi chỉ ra skill rác và skill không có tác dụng, kèm lý do cho từng skill.",
  "Junk": "Skill rác", "No real use": "Không có tác dụng", "Fine": "Ổn", "Not read": "Chưa đọc được",
  "No junk skills found.": "Không tìm thấy skill rác nào.", "Every skill serves a real profession or task.": "Skill nào cũng phục vụ một ngành nghề hay công việc cụ thể.", "No skill passed yet.": "Chưa có skill nào đạt.",
  "Empty, placeholder or test content, only a README or links, broken text, or an exact copy of another skill.": "Nội dung trống, chữ mẫu hay skill thử, chỉ là README hoặc danh sách link, chữ lộn xộn, hoặc bản sao y hệt một skill khác.",
  "Readable, but it doesn't serve any profession, field or concrete task, or only repeats what the model already does.": "Đọc được nhưng không phục vụ ngành nghề, lĩnh vực hay công việc cụ thể nào, hoặc chỉ dặn lại điều model vốn đã làm.",
  "Concrete instructions for a real profession, field or workflow, shown with the field it serves.": "Hướng dẫn cụ thể cho một ngành nghề, lĩnh vực hay quy trình làm việc thật, kèm ngành nghề skill phục vụ.",
  "Auto (Synchro chooses)": "Tự động (Synchro tự chọn)",
  "The model reads each skill's name, description and the start of its instructions. Nothing is turned off or deleted unless you choose to.": "Model đọc tên, mô tả và phần đầu hướng dẫn của từng skill. Synchro không tự tắt hay xóa skill nào, chỉ bạn quyết định.",
  "Only an admin can change libraries for everyone.": "Chỉ quản trị viên đổi được thư viện cho mọi người.", "Only an admin can change libraries for everyone": "Chỉ quản trị viên đổi được thư viện cho mọi người",
  "Turn off all": "Tắt hết", "Delete your skills": "Xóa skill của bạn", "Results show up here as the model reads.": "Kết quả hiện dần ở đây khi model đọc xong từng lô skill.",
  "Scan again": "Quét lại", "Keeps running if you close this window.": "Vẫn chạy tiếp khi bạn đóng cửa sổ này.", "Stop": "Dừng",
});
// Quyền truy cập → Your Chrome (tiện ích Synchro cho Chrome)
Object.assign(EN2VI, {
  "Your Chrome": "Chrome của người dùng",
  "Let Synchro work in the person's own Chrome, Edge or Brave through the Synchro extension, with the sites they are signed in to.": "Cho Synchro làm việc trên Chrome, Edge hoặc Brave của chính người đó qua tiện ích Synchro, với các trang họ đã đăng nhập.",
  "Your administrator has not allowed your account to use your own Chrome with Synchro.": "Quản trị viên chưa cho phép tài khoản của bạn dùng Chrome của bạn với Synchro.",
  "Your administrator has not enabled a browser for your account: Synchro's own browser needs Synchro Code and Cloud sandbox, and your own Chrome needs Your Chrome.": "Quản trị viên chưa bật trình duyệt nào cho tài khoản của bạn: trình duyệt của Synchro cần Synchro Code và Sandbox đám mây, còn Chrome của bạn cần quyền Chrome của người dùng.",
});
Object.assign(EN2VI, { "Paste a git repository link (GitHub, GitLab…)": "Dán link repo git (GitHub, GitLab…)", "Paste a git repository link": "Dán link repo git" });

// Chạy code ra mọi trang web công khai (Cài đặt → Khả năng).
Object.assign(EN2VI, {
  "Reach the whole public web": "Truy cập mọi trang web công khai",
  "Code can also download images, fonts and data from any public website and call public APIs, not just package registries. Addresses inside the server and private networks stay blocked.": "Code tải được cả ảnh, phông chữ, dữ liệu từ mọi trang web công khai và gọi API công khai, không chỉ kho thư viện. Địa chỉ bên trong máy chủ và mạng riêng vẫn bị chặn.",
  "With network egress on, code can reach these registries (and their subdomains). Turn on “Reach the whole public web” to let it reach any public website as well. Addresses inside the server and private networks are always blocked.": "Khi bật truy cập mạng, code tới được các kho thư viện này (và tên miền con của chúng). Bật “Truy cập mọi trang web công khai” để code tới được cả mọi trang web công khai. Địa chỉ bên trong máy chủ và mạng riêng luôn bị chặn.",
  "Packages from public registries can contain malicious code. It runs inside an isolated sandbox, separate from the server and from other accounts.": "Gói từ kho công khai có thể chứa mã độc. Mã đó chỉ chạy trong sandbox cô lập, tách khỏi máy chủ và các tài khoản khác.",
  "Content Synchro reads (web pages, files, connector results) could try to trick it into installing a package or sending data out. Keeping “Reach the whole public web” off leaves only package registries reachable, which limits but does not remove that risk.": "Nội dung Synchro đọc (trang web, tệp, kết quả connector) có thể tìm cách lừa nó cài gói hoặc gửi dữ liệu ra ngoài. Tắt “Truy cập mọi trang web công khai” thì chỉ kho thư viện là truy cập được, nên rủi ro giảm bớt nhưng không mất hẳn.",
});
Object.assign(EN2VI, {
  "Your browser blocked the sign-in window.": "Trình duyệt đã chặn cửa sổ đăng nhập.", "Open sign-in window": "Mở cửa sổ đăng nhập",
  "Checked just now": "Vừa kiểm tra", "Needs vendor approval": "Cần nhà cung cấp duyệt", "Waiting for you to sign in…": "Đang chờ bạn đăng nhập…", "Token rejected": "Token bị từ chối",
  "Update token": "Nhập lại token", "Update OAuth client": "Đổi OAuth client", "Try sign-in anyway": "Vẫn thử đăng nhập", "Reconnect": "Kết nối lại", "Use a token instead": "Dùng token thay thế", "Use my OAuth client": "Dùng OAuth client của tôi",
  "You can try your own token or API key, though this vendor may not accept one. If the vendor gave you an OAuth client, you can use that instead.": "Bạn có thể thử bằng token hoặc API key của mình, dù hãng này có thể không nhận. Nếu hãng đã cấp cho bạn một OAuth client, bạn có thể dùng client đó.",
  "A tool needs more access than this sign-in allows. Other tools keep working.": "Một công cụ cần nhiều quyền hơn lần đăng nhập này cho phép. Các công cụ khác vẫn chạy bình thường.",
  "Grant more access": "Cấp thêm quyền", "Last check failed. Tools keep working with the list from the last good check.": "Lần kiểm tra gần nhất không thành công. Công cụ vẫn chạy theo danh sách của lần kiểm tra tốt gần nhất.",
  "Unclassified": "Chưa phân loại", "The server doesn't say whether this tool changes data. Synchro judged it read-only from its name. Set it to Ask every time if you prefer.": "Máy chủ không cho biết công cụ này có thay đổi dữ liệu không. Synchro xếp nó vào chỉ đọc theo tên công cụ. Bạn có thể đặt thành Hỏi mỗi lần nếu muốn.",
  "Dismiss": "Đóng", "How to sign in": "Cách đăng nhập", "Automatic": "Tự động", "Token or API key": "Token hoặc API key", "My OAuth client": "OAuth client của tôi", "Header name": "Tên header", "OAuth Client ID": "OAuth Client ID",
  "Sent as Authorization: Bearer … unless you name another header, such as X-API-Key. Saved encrypted and never shown again.": "Gửi dưới dạng Authorization: Bearer …, trừ khi bạn đặt header khác như X-API-Key. Được lưu mã hóa và không bao giờ hiện lại.",
  "Connect with your own credentials. They are encrypted on the server and never shown again.": "Kết nối bằng thông tin đăng nhập của bạn. Chúng được mã hóa trên máy chủ và không bao giờ hiện lại.",
  "Connect Notion, Linear, Supabase and more, or any remote MCP server, so Synchro can search and work in them during your chats.": "Kết nối Notion, Linear, Supabase và nhiều ứng dụng khác, hoặc bất kỳ máy chủ MCP từ xa nào, để Synchro tìm kiếm và làm việc trong đó ngay khi trò chuyện.",
});
RULES_VI.push(
  [/^Checked (\d+) min ago$/, (m) => `Kiểm tra ${m[1]} phút trước`], [/^Checked (\d+) h ago$/, (m) => `Kiểm tra ${m[1]} giờ trước`], [/^Checked (\d+) d ago$/, (m) => `Kiểm tra ${m[1]} ngày trước`],
  [/^(\d+) of (\d+) tools$/, (m) => `${m[1]} trên ${m[2]} công cụ`],
);
if (!Object.prototype.hasOwnProperty.call(EN2VI, "artifact")) EN2VI["artifact"] = "artifact";
for (const e of DIRECTORY) if (e.access) EN2VI[e.access.why] = e.access.whyVi;
Object.assign(EN2VI, {
  "Files attached to your chats. They are deleted with your account.": "Tệp đã đính kèm trong các đoạn chat. Chúng bị xóa cùng tài khoản.",
  "Replies you rated. Press the thumb again on a reply to take the rating back.": "Các câu trả lời bạn đã chấm. Bấm lại nút ở câu trả lời đó để bỏ chấm.",
  "View": "Xem", "No results": "Không có kết quả",
  "Your account and everything stored with it on the server (chats, projects, files, Brain, connectors, sessions) are permanently deleted, and the copy in this browser is erased. This can't be undone.": "Tài khoản và mọi thứ lưu kèm trên máy chủ (đoạn chat, dự án, tệp, Bộ não, connector, phiên đăng nhập) bị xóa vĩnh viễn, bản trong trình duyệt này cũng bị xóa. Không hoàn tác được.",
});
Object.assign(EN2VI, {
  "System health": "Tình trạng hệ thống", "Backups": "Sao lưu", "No backup recorded on this server yet.": "Máy chủ này chưa ghi nhận bản sao lưu nào.", "Backups have stopped. Check the backup log on the server.": "Sao lưu đã ngừng. Hãy xem nhật ký sao lưu trên máy chủ.", "Nightly backups are running.": "Sao lưu hằng đêm vẫn chạy.",
  "Replies in the last 24 hours": "Câu trả lời trong 24 giờ qua", "Errors in the last 24 hours": "Lỗi trong 24 giờ qua", "Page and server errors, with emails and secrets removed.": "Lỗi của trang và máy chủ, đã bỏ email và mã bí mật.",
});

// Dồn từ i18n-dict.ts khi gộp nhánh.
Object.assign(EN2VI, { "Paste a git repository link (GitHub, GitLab…)": "Dán link repo git (GitHub, GitLab…)", "Paste a git repository link": "Dán link repo git" });
Object.assign(EN2VI, {
  "Reach the whole public web": "Truy cập mọi trang web công khai",
  "Code can also download images, fonts and data from any public website and call public APIs, not just package registries. Addresses inside the server and private networks stay blocked.": "Code tải được cả ảnh, phông chữ, dữ liệu từ mọi trang web công khai và gọi API công khai, không chỉ kho thư viện. Địa chỉ bên trong máy chủ và mạng riêng vẫn bị chặn.",
  "With network egress on, code can reach these registries and voice-over services (and their subdomains). Voice-over text is sent to Microsoft (edge-tts) or Google (gTTS) to be read aloud. Turn on “Reach the whole public web” to let code reach any public website as well. Addresses inside the server and private networks are always blocked.": "Khi bật truy cập mạng, code tới được các kho thư viện và dịch vụ giọng đọc này (và tên miền con của chúng). Lời cần đọc được gửi tới Microsoft (edge-tts) hoặc Google (gTTS) để đọc thành tiếng. Bật “Truy cập mọi trang web công khai” để code tới được cả mọi trang web công khai. Địa chỉ bên trong máy chủ và mạng riêng luôn bị chặn.",
  "Voice-over (edge-tts, gTTS)": "Giọng đọc (edge-tts, gTTS)",
  "Reported shared links": "Liên kết chia sẻ bị báo cáo", "No reports.": "Chưa có báo cáo nào.", "Take down": "Gỡ", "Taken down": "Đã gỡ", "Shared link taken down": "Đã gỡ liên kết chia sẻ",
  "Take down this shared link?": "Gỡ liên kết chia sẻ này?", "The snapshot is deleted and the link stops working for everyone. This can't be undone.": "Bản chụp bị xóa và liên kết hết hiệu lực với mọi người. Không hoàn tác được.",
  "Packages from public registries can contain malicious code. It runs inside an isolated sandbox, separate from the server and from other accounts.": "Gói từ kho công khai có thể chứa mã độc. Mã đó chỉ chạy trong sandbox cô lập, tách khỏi máy chủ và các tài khoản khác.",
  "Content Synchro reads (web pages, files, connector results) could try to trick it into installing a package or sending data out. Keeping “Reach the whole public web” off leaves only package registries and voice-over services reachable, which limits but does not remove that risk.": "Nội dung Synchro đọc (trang web, tệp, kết quả connector) có thể tìm cách lừa nó cài gói hoặc gửi dữ liệu ra ngoài. Tắt “Truy cập mọi trang web công khai” thì chỉ kho thư viện và dịch vụ giọng đọc là truy cập được, nên rủi ro giảm bớt nhưng không mất hẳn.",
});
Object.assign(EN2VI, {
  "A tool needs more access than this token allows. Other tools keep working.": "Một công cụ cần nhiều quyền hơn token này cho phép. Các công cụ khác vẫn chạy bình thường.", "Sign-in not finished": "Chưa đăng nhập xong", "Access refused": "Bị từ chối truy cập", "Connect again": "Kết nối lại", "Didn't finish? Connect again": "Chưa xong? Hãy kết nối lại",
  "Your browser blocked the sign-in window.": "Trình duyệt đã chặn cửa sổ đăng nhập.", "Open sign-in window": "Mở cửa sổ đăng nhập",
  "Checked just now": "Vừa kiểm tra", "Needs vendor approval": "Cần nhà cung cấp duyệt", "Waiting for you to sign in…": "Đang chờ bạn đăng nhập…", "Token rejected": "Token bị từ chối",
  "Update token": "Nhập lại token", "Reconnect": "Kết nối lại", "Use a token instead": "Dùng token thay thế", "Use my OAuth client": "Dùng OAuth client của tôi",
  "You can try your own token or API key, though this vendor may not accept one. Synchro tests it first and saves it only if it works. If the vendor gave you an OAuth client, you can use that instead.": "Bạn có thể thử bằng token hoặc API key của mình, dù hãng này có thể không nhận. Synchro thử trước và chỉ lưu khi dùng được. Nếu hãng đã cấp cho bạn một OAuth client, bạn có thể dùng client đó.",
  "A tool needs more access than this sign-in allows. Other tools keep working.": "Một công cụ cần nhiều quyền hơn lần đăng nhập này cho phép. Các công cụ khác vẫn chạy bình thường.",
  "Grant more access": "Cấp thêm quyền", "Last check failed. Tools keep working with the list from the last good check.": "Lần kiểm tra gần nhất không thành công. Công cụ vẫn chạy theo danh sách của lần kiểm tra tốt gần nhất.",
  "Unclassified": "Chưa phân loại", "The server doesn't say whether this tool changes data. Synchro judged it read-only from its name. Set it to Ask every time if you prefer.": "Máy chủ không cho biết công cụ này có thay đổi dữ liệu không. Synchro xếp nó vào chỉ đọc theo tên công cụ. Bạn có thể đặt thành Hỏi mỗi lần nếu muốn.",
  "Dismiss": "Đóng", "How to sign in": "Cách đăng nhập", "Automatic": "Tự động", "Token or API key": "Token hoặc API key", "My OAuth client": "OAuth client của tôi", "Header name": "Tên header", "OAuth Client ID": "OAuth Client ID",
  "Sent as Authorization: Bearer … unless you name another header, such as X-API-Key. Saved encrypted and never shown again.": "Gửi dưới dạng Authorization: Bearer …, trừ khi bạn đặt header khác như X-API-Key. Được lưu mã hóa và không bao giờ hiện lại.",
  "Connect with your own credentials. They are encrypted on the server and never shown again.": "Kết nối bằng thông tin đăng nhập của bạn. Chúng được mã hóa trên máy chủ và không bao giờ hiện lại.",
  "Connect Notion, Linear, Supabase and more, or any remote MCP server, so Synchro can search and work in them during your chats.": "Kết nối Notion, Linear, Supabase và nhiều ứng dụng khác, hoặc bất kỳ máy chủ MCP từ xa nào, để Synchro tìm kiếm và làm việc trong đó ngay khi trò chuyện.",
});
RULES_VI.push(
  [/^Checked (\d+) min ago$/, (m) => `Kiểm tra ${m[1]} phút trước`], [/^Checked (\d+) h ago$/, (m) => `Kiểm tra ${m[1]} giờ trước`], [/^Checked (\d+) d ago$/, (m) => `Kiểm tra ${m[1]} ngày trước`],
  [/^(\d+) of (\d+) tools$/, (m) => `${m[1]} trên ${m[2]} công cụ`],
);
Object.assign(EN2VI, {
  "No license stated": "Chưa ghi giấy phép",
  "Synchro runs on an AI plan you already pay for: Claude, ChatGPT, Gemini or Grok. You connect it after signing up.": "Synchro chạy bằng gói AI bạn đang trả tiền: Claude, ChatGPT, Gemini hoặc Grok. Bạn kết nối gói sau khi đăng ký.",
  "Synchro tells you when it resets and offers another plan you have connected.": "Synchro báo lúc gói hồi lại và gợi ý gói khác bạn đã kết nối.",
  "The model picker keeps one group per provider. A group shows your plan's models while you are signed in.": "Bộ chọn model có một nhóm cho mỗi hãng. Nhóm đó hiện các model của gói khi bạn đã đăng nhập.",
});
Object.assign(EN2VI, { "Changed email verification rule": "Đã đổi quy tắc xác minh email", "Marked email as verified": "Đã đánh dấu email là đã xác minh", "Background replies, last 24 hours": "Câu trả lời chạy nền, 24 giờ qua" });
// Chữ chỉ model hoặc bản giả lập thấy, không hiện cho người dùng.
Object.assign(EN2VI, { "550 5.1.1 mailbox does not exist": "550 5.1.1 hộp thư không tồn tại" });
RULES_VI.push([/^(.*)\(object, written as a JSON string\)$/, (m) => `${m[1]}(đối tượng, viết thành chuỗi JSON)`]);
Object.assign(EN2VI, { "Forgot your current password?": "Quên mật khẩu hiện tại?", "Sending…": "Đang gửi…", "We sent a reset link to": "Đã gửi đường dẫn đặt lại tới", ". It works for 60 minutes. Check Spam if you don't see it.": ". Đường dẫn có hiệu lực 60 phút. Không thấy thư thì xem cả mục Spam." });
Object.assign(EN2VI, { "Refresh plan and models": "Làm mới gói và danh sách model" });
RULES_VI.push([/^Checked (.+) again: (.+)$/, (m) => `Đã kiểm tra lại ${m[1]}: ${m[2]}`], [/^Checked (.+) again$/, (m) => `Đã kiểm tra lại ${m[1]}`], [/^Sign in to (.+) again$/, (m) => `Hãy đăng nhập lại ${m[1]}`]);
RULES_VI.push([/^(Connect|Disconnect) (.+)$/, (m) => `${m[1] === "Connect" ? "Kết nối" : "Gỡ"} ${m[2]}`]);
// Xác minh hai bước.
Object.assign(EN2VI, { "Two-step verification": "Xác minh hai bước", "Enter the 6-digit code from your authenticator app, or a recovery code.": "Nhập mã 6 số trong ứng dụng tạo mã, hoặc một mã dự phòng.", "Verification code": "Mã xác minh", "Submit code": "Gửi mã", "Two-step verification turned off": "Đã tắt xác minh hai bước", "Ask for a code from an authenticator app each time you sign in.": "Mỗi lần đăng nhập, hỏi thêm mã từ ứng dụng tạo mã.", "Turn off": "Tắt", "Turn on": "Bật", "Turn on two-step verification": "Bật xác minh hai bước", "Add this key to your authenticator app (Google Authenticator, Authy, 1Password…), then enter the code it shows.": "Thêm khóa này vào ứng dụng tạo mã (Google Authenticator, Authy, 1Password…), rồi nhập mã ứng dụng hiện ra.", "Open in authenticator app": "Mở trong ứng dụng tạo mã", "Save your recovery codes": "Lưu các mã dự phòng", "Each code works once if you lose your authenticator app. They are shown only now. Without them or the app, you can't sign in.": "Mỗi mã dùng được một lần khi bạn mất ứng dụng tạo mã. Các mã chỉ hiện lúc này. Không có chúng hoặc ứng dụng thì bạn không đăng nhập được.", "I saved them": "Tôi đã lưu", "Turn off two-step verification": "Tắt xác minh hai bước", "Enter a code from your authenticator app, or a recovery code.": "Nhập mã trong ứng dụng tạo mã, hoặc một mã dự phòng.", "Couldn't copy": "Không sao chép được" });
RULES_VI.push([/^On\. (\d+) recovery codes? left\.$/, (m) => `Đang bật. Còn ${m[1]} mã dự phòng.`]);
