# Image cho workspace của Synchro Code và cho code chạy trong chat (run_code): mỗi người dùng một container chạy image này.
# Có sẵn Node 22, Python 3, git, Chromium (cho trình duyệt của agent) và các công cụ dòng lệnh thường dùng.
# Công cụ đa phương tiện / tài liệu để model tự làm trọn việc mà không cần mạng: dựng video (ffmpeg), xử lý ảnh, chuyển Word /
# PowerPoint sang PDF (LibreOffice), đọc PDF, nhận dạng chữ (Tesseract, có tiếng Việt), sơ đồ (Graphviz), âm thanh (SoX).
# Giữ khớp danh sách WS_TOOLS trong app/coderun.ts (mô tả công cụ run_code cho model).
FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 LC_ALL=C.UTF-8
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji fonts-liberation fonts-dejavu-core \
      python3 python3-pip python3-venv python-is-python3 \
      git curl wget ca-certificates socat procps less vim nano unzip zip file bc \
      ripgrep jq tree htop build-essential openssh-client \
      ffmpeg imagemagick librsvg2-bin poppler-utils qpdf ghostscript pandoc graphviz sox libsox-fmt-mp3 \
      tesseract-ocr tesseract-ocr-vie libcairo2 libsndfile1 \
      libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui \
  && rm -rf /var/lib/apt/lists/*

# Thư viện để code trong chat tạo tệp (Word, Excel, PowerPoint, PDF, biểu đồ, ảnh, âm thanh, video) và phân tích dữ liệu.
RUN pip install --break-system-packages --no-cache-dir \
      pandas numpy matplotlib openpyxl python-docx python-pptx reportlab \
      scipy scikit-learn statsmodels sympy networkx seaborn "plotly<6" "kaleido==0.2.1" pyarrow xlsxwriter tabulate \
      pillow imageio moviepy opencv-python-headless pydub cairosvg qrcode \
      pypdf pdfplumber pymupdf pytesseract beautifulsoup4 lxml requests markdown jinja2 pyyaml

# Điều khiển Chromium có sẵn từ Node (chụp trang HTML / canvas thành khung hình, xuất PDF): require("puppeteer-core").
RUN npm install -g --no-fund --no-audit puppeteer-core@23.11.1 && npm cache clean --force
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium CHROME_PATH=/usr/bin/chromium PUPPETEER_SKIP_DOWNLOAD=1 \
    NODE_PATH=/usr/local/lib/node_modules:/home/user/.npm-global/lib/node_modules IMAGEIO_FFMPEG_EXE=/usr/bin/ffmpeg

# Người dùng không có quyền root; mọi dữ liệu nằm trong /home/user/work (volume trên máy chủ).
RUN useradd -m -u 1500 -s /bin/bash user \
  && mkdir -p /home/user/work /home/user/.synchro /opt/synchro \
  && chown -R user:user /home/user
COPY fsop.js browser.sh /opt/synchro/
# Biến môi trường đặt ở /etc/profile.d để cả shell không tương tác (lệnh của agent, bash -lc) cũng nhận.
RUN chmod 755 /opt/synchro/browser.sh \
  && printf '%s\n' \
     'export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"' \
     'export NPM_CONFIG_PREFIX="$HOME/.npm-global"' \
     'export PIP_BREAK_SYSTEM_PACKAGES=1' \
     'export BROWSER=none' \
     > /etc/profile.d/synchro.sh \
  && printf '%s\n' "PS1='\\[\\e[32m\\]\\u\\[\\e[0m\\]:\\[\\e[34m\\]\\w\\[\\e[0m\\]\\$ '" >> /home/user/.bashrc

USER user
WORKDIR /home/user/work
CMD ["sleep", "infinity"]
