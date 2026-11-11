# Image cho workspace của Synchro Code và cho code chạy trong chat (run_code): mỗi người dùng một container chạy image này.
# Có sẵn Node 22, Python 3, git, Chromium (cho trình duyệt của agent) và các công cụ dòng lệnh thường dùng.
# Công cụ đa phương tiện / tài liệu để model tự làm trọn việc mà không cần mạng: dựng video (ffmpeg), xử lý ảnh, chuyển Word /
# PowerPoint sang PDF (LibreOffice), đọc PDF, nhận dạng chữ (Tesseract, có tiếng Việt), sơ đồ (Graphviz), âm thanh (SoX).
# Giữ khớp danh sách WS_TOOLS trong app/coderun.ts (mô tả công cụ run_code cho model).
# Video đồ họa chuyển động: Remotion 4.0.539 dựng sẵn ở /opt/remotion (4 mẫu, lệnh synchro-video), whisper.cpp + mô hình small cho phụ đề không cần mạng.
FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 LC_ALL=C.UTF-8
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fontconfig fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji fonts-liberation fonts-dejavu-core fonts-crosextra-carlito fonts-crosextra-caladea \
      python3 python3-pip python3-venv python-is-python3 \
      git curl wget ca-certificates socat procps less vim nano unzip zip file bc \
      ripgrep jq tree htop build-essential openssh-client \
      ffmpeg imagemagick librsvg2-bin poppler-utils qpdf ghostscript pandoc graphviz sox libsox-fmt-mp3 \
      tesseract-ocr tesseract-ocr-vie libcairo2 libsndfile1 espeak-ng \
      libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui \
  && rm -rf /var/lib/apt/lists/*

# Thư viện để code trong chat tạo tệp (Word, Excel, PowerPoint, PDF, biểu đồ, ảnh, âm thanh, video) và phân tích dữ liệu.
# moviepy<2: bản 2 bỏ moviepy.editor, cách model quen viết. espeak-ng (ở trên) là giọng đọc duy nhất chạy được khi không có mạng.
RUN pip install --break-system-packages --no-cache-dir \
      pandas numpy matplotlib openpyxl python-docx python-pptx reportlab \
      scipy scikit-learn statsmodels sympy networkx seaborn "plotly<6" "kaleido==0.2.1" pyarrow xlsxwriter tabulate \
      pillow imageio "moviepy<2" opencv-python-headless pydub cairosvg qrcode \
      pypdf pdfplumber pymupdf pytesseract beautifulsoup4 lxml requests markdown jinja2 pyyaml \
      edge-tts gTTS srt

# Phông có đủ dấu tiếng Việt mà bộ thiết kế dùng (app/designpresets.ts, app/designkit.ts): đồ họa, PDF dựng trong sandbox hiện đúng như khung artifact.
# Debian không có đủ các phông này nên lấy từ kho google/fonts, ghim commit và mã băm: tệp đổi hay tải hỏng thì dựng image báo lỗi, không ra image thiếu phông âm thầm.
RUN set -e; mkdir -p /usr/share/fonts/truetype/synchro; cd /usr/share/fonts/truetype/synchro; \
    printf '%s\n' \
      'cd1ef6e9d7db28ad5cdb88a65ccbe693870e60d340b791f349d248342b4fe4c3 ofl/bevietnampro/BeVietnamPro-Regular.ttf BeVietnamPro-Regular.ttf' \
      'b60832bfa0fcd015158112c64d7e3fdad3b0c6287d1823f85a3103636e845268 ofl/bevietnampro/BeVietnamPro-Medium.ttf BeVietnamPro-Medium.ttf' \
      'bd8e27eb02720b9d91e59e4f10a90878643219f25ce6a8d9a4f06a8a88d3bb71 ofl/bevietnampro/BeVietnamPro-SemiBold.ttf BeVietnamPro-SemiBold.ttf' \
      '7f738fe5c43c8872807b20e2d30d42163618de8a4daf7f48a939adac32c16847 ofl/bevietnampro/BeVietnamPro-Bold.ttf BeVietnamPro-Bold.ttf' \
      '29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031 ofl/inter/Inter%5Bopsz,wght%5D.ttf Inter.ttf' \
      '89b3fb38aa0d275d7a731d0d817a4f1622b316b4d7fbdedcf02ee9099ff68bc8 ofl/plusjakartasans/PlusJakartaSans%5Bwght%5D.ttf PlusJakartaSans.ttf' \
      'c40f2293766a503bc70cce9e512ef844a4ccb7cbcde792fe2ea31d191917d8d6 ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf PlayfairDisplay.ttf' \
      'acad6de1fc93436f5c0f1f4137751ef04f1aea3063e7036535970ffcfbd79f72 ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf SpaceGrotesk.ttf' \
      '48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf JetBrainsMono.ttf' \
    | while read -r sum src out; do \
        curl -fsSLg --retry 5 --retry-all-errors --connect-timeout 20 -o "$out" "https://raw.githubusercontent.com/google/fonts/bbda7253fc363238b05d97515ca71f8ae49c4fa9/$src"; \
        echo "$sum  $out" | sha256sum -c --quiet -; \
      done; \
    fc-cache -f; \
    for f in 'Be Vietnam Pro' 'Inter' 'Plus Jakarta Sans' 'Playfair Display' 'Space Grotesk' 'JetBrains Mono'; do fc-list : family | grep -qF "$f" || { echo "thiếu phông $f"; exit 1; }; done

# Điều khiển Chromium có sẵn từ Node (chụp trang HTML / canvas thành khung hình, xuất PDF): require("puppeteer-core").
RUN npm install -g --no-fund --no-audit puppeteer-core@23.11.1 && npm cache clean --force
# Chromium chạy trong container không có quyền đặc biệt nên cần --no-sandbox; Chromium không đọc HTTPS_PROXY nên khi lần chạy có mạng
# (dịch vụ workspace đặt SYNCHRO_CHROME_PROXY) thì đi qua proxy của Synchro. Trình khởi chạy /usr/bin/chromium đọc các tệp này.
RUN printf '%s\n' \
     'export CHROMIUM_FLAGS="$CHROMIUM_FLAGS --no-sandbox"' \
     'if [ -n "$SYNCHRO_CHROME_PROXY" ]; then export CHROMIUM_FLAGS="$CHROMIUM_FLAGS --proxy-server=$SYNCHRO_CHROME_PROXY"; fi' \
     > /etc/chromium.d/synchro
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium CHROME_PATH=/usr/bin/chromium PUPPETEER_SKIP_DOWNLOAD=1 \
    NODE_PATH=/usr/local/lib/node_modules:/home/user/.npm-global/lib/node_modules IMAGEIO_FFMPEG_EXE=/usr/bin/ffmpeg

# Người dùng không có quyền root; mọi dữ liệu nằm trong /home/user/work (volume trên máy chủ).
RUN useradd -m -u 1500 -s /bin/bash user \
  && mkdir -p /home/user/work /home/user/.synchro /opt/synchro \
  && chown -R user:user /home/user
COPY fsop.js browser.sh subfit.py xlsx_recalc.py /opt/synchro/
# Biến môi trường đặt ở /etc/profile.d để cả shell không tương tác (lệnh của agent, bash -lc) cũng nhận.
# LibreOffice mặc định không tính lại tệp .xlsx của "ứng dụng quen" (xlsxwriter tự xưng Excel), công thức ra 0 mà tự kiểm tra vẫn đạt: buộc luôn tính lại khi mở.
RUN chmod 755 /opt/synchro/browser.sh \
  && python3 /opt/synchro/xlsx_recalc.py --write-profile /home/user/.config/libreoffice/4/user && chown -R user:user /home/user/.config \
  && printf '%s\n' \
     'export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"' \
     'export NPM_CONFIG_PREFIX="$HOME/.npm-global"' \
     'export PIP_BREAK_SYSTEM_PACKAGES=1' \
     'export BROWSER=none' \
     > /etc/profile.d/synchro.sh \
  && printf '%s\n' "PS1='\\[\\e[32m\\]\\u\\[\\e[0m\\]:\\[\\e[34m\\]\\w\\[\\e[0m\\]\\$ '" >> /home/user/.bashrc

# ------------------------------------------------------------------ video Remotion (synchro-video)
# Đặt sau các lớp cũ để lớp đã dựng giữ nguyên trong bộ đệm. Mọi tệp tải về đều ghim phiên bản và mã băm như phông ở trên: đổi hay hỏng là build báo lỗi.
# Giấy phép: Remotion Free License (cá nhân và công ty tối đa 3 người, dùng thương mại không giới hạn): chủ dịch vụ là công ty 1 người — xem docs/remotion-license.md.
# cmake để dựng whisper.cpp; thư viện Chrome Headless Shell cần (danh sách Debian trong tài liệu Remotion).
RUN apt-get update && apt-get install -y --no-install-recommends cmake \
      libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2 libxrandr2 libxkbcommon-dev libxfixes3 libxcomposite1 libxdamage1 libpango-1.0-0 libcairo2 libcups2 libatk-bridge2.0-0 \
  && rm -rf /var/lib/apt/lists/*
# Hai độ đậm Be Vietnam Pro cho phụ đề kiểu TikTok (cùng commit google/fonts với phông ở trên).
RUN set -e; cd /usr/share/fonts/truetype/synchro; \
    printf '%s\n' \
      '44dbfa01553d227bec76ba6446c5618870a76a4a3297f41630dde859d0650d02 ofl/bevietnampro/BeVietnamPro-ExtraBold.ttf BeVietnamPro-ExtraBold.ttf' \
      'dd0ec461782da7f4a58698b431a67c455ced7c09deb9c40d7b47e61975d3ffdb ofl/bevietnampro/BeVietnamPro-Black.ttf BeVietnamPro-Black.ttf' \
    | while read -r sum src out; do \
        curl -fsSLg --retry 5 --retry-all-errors --connect-timeout 20 -o "$out" "https://raw.githubusercontent.com/google/fonts/bbda7253fc363238b05d97515ca71f8ae49c4fa9/$src"; \
        echo "$sum  $out" | sha256sum -c --quiet -; \
      done; \
    fc-cache -f
# whisper.cpp v1.9.5 (nhận dạng giọng nói tiếng Việt cho phụ đề "auto"): cờ CPU cố định (không -march=native) để chạy được trên máy khác máy build.
RUN set -e; cd /tmp; \
    curl -fsSL --retry 5 --retry-all-errors --connect-timeout 20 -o whisper.tgz https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.9.5.tar.gz; \
    echo "ff1a9053feb509ff9d7729703355541ae9690073a6b1c40eb692c962e0dc1720  whisper.tgz" | sha256sum -c --quiet -; \
    tar xzf whisper.tgz; cd whisper.cpp-1.9.5; \
    cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON \
      -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF >/dev/null; \
    cmake --build build --target whisper-cli -j2 >/dev/null; \
    install -D -m 755 build/bin/whisper-cli /opt/whisper/build/bin/whisper-cli; \
    cd /; rm -rf /tmp/whisper.tgz /tmp/whisper.cpp-1.9.5; \
    /opt/whisper/build/bin/whisper-cli --help >/dev/null 2>&1
# Mô hình đa ngôn ngữ ggml-small (488 MB, ~1 GB bộ nhớ khi chạy), ghim revision trên Hugging Face.
RUN set -e; \
    curl -fsSL --retry 5 --retry-all-errors --connect-timeout 20 -o /opt/whisper/ggml-small.bin \
      https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small.bin; \
    echo "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b  /opt/whisper/ggml-small.bin" | sha256sum -c --quiet -; \
    chmod 644 /opt/whisper/ggml-small.bin
# Chrome Headless Shell đúng bản Remotion 4.0.539 đã thử (TESTED_VERSION 157.0.8080.0): Chromium của Debian đổi bản theo apt nên không dùng để dựng.
RUN set -e; mkdir -p /opt/remotion; cd /opt/remotion; \
    curl -fsSL --retry 5 --retry-all-errors --connect-timeout 20 -o chs.zip "https://remotion.media/chromium-headless-shell-linux-x64-157.0.8080.0.zip?clear"; \
    echo "7c4a2751b361aeb3cff3ed788fa18b7a0849371b983d478bb9205b6cc25a8c52  chs.zip" | sha256sum -c --quiet -; \
    unzip -q chs.zip; rm chs.zip; test -x chrome-headless-shell-linux64/chrome-headless-shell
# Thư viện của dự án Remotion: phiên bản chính xác trong package.json, mã băm sha512 trong package-lock.json.
COPY remotion/package.json remotion/package-lock.json /opt/remotion/
RUN cd /opt/remotion && npm ci --omit=dev --no-fund --no-audit && npm cache clean --force
# Mã nguồn 4 mẫu, đóng gói một lần (bundle) để lúc dựng không cần mạng. Phông lấy từ thư mục phông của image (không tải lần hai).
COPY remotion/ /opt/remotion/
RUN set -e; cd /opt/remotion; mkdir -p public/fonts; cp /usr/share/fonts/truetype/synchro/*.ttf public/fonts/; \
    npx remotion bundle src/index.ts --out-dir bundle --log=error; test -f bundle/index.html; \
    chmod 755 cli/synchro-video.mjs; ln -sf /opt/remotion/cli/synchro-video.mjs /usr/local/bin/synchro-video; \
    chown -R root:root /opt/remotion /opt/whisper; chmod -R a+rX,go-w /opt/remotion /opt/whisper

USER user
# Tự kiểm tra lúc build bằng đúng người dùng của sandbox: mỗi mẫu dựng 1 giây 60 khung/giây (chữ tiếng Việt), âm thanh 48 kHz, whisper nhận ra giọng tiếng Việt.
# Lỗi ở đây làm build hỏng thay vì giao image có bộ dựng video hỏng.
RUN cd /tmp && synchro-video selftest
WORKDIR /home/user/work
CMD ["sleep", "infinity"]
