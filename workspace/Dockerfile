# Image cho workspace của Synchro Code và cho code chạy trong chat (run_code): mỗi người dùng một container chạy image này.
# Có sẵn Node 22, Python 3, git, Chromium (cho trình duyệt của agent) và các công cụ dòng lệnh thường dùng.
# Công cụ đa phương tiện / tài liệu để model tự làm trọn việc mà không cần mạng: dựng video (ffmpeg), xử lý ảnh, chuyển Word /
# PowerPoint sang PDF (LibreOffice), đọc PDF, nhận dạng chữ (Tesseract, có tiếng Việt), sơ đồ (Graphviz), âm thanh (SoX).
# Giữ khớp danh sách WS_TOOLS trong app/coderun.ts (mô tả công cụ run_code cho model).
# Video đồ họa chuyển động: Remotion 4.0.539 dựng sẵn ở /opt/remotion (4 mẫu, lệnh synchro-video), whisper.cpp + mô hình small cho phụ đề không cần mạng.
# Tài liệu PDF / Word: Typst 0.15.1 (+ 0.12.0 cho basic-report), WeasyPrint 70.0, thư viện docx 9.15.3; lệnh synchro-doc, mẫu ở /opt/synchro/doc.
# Biểu đồ / sơ đồ: ECharts 6.1.0 (require("echarts"), lệnh synchro-chart) và D2 v0.9.0 (lệnh d2).
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

# ------------------------------------------------------------------ tài liệu PDF / Word (synchro-doc)
# Đặt sau lớp Remotion để đổi mẫu tài liệu không phải dựng lại video. Mọi tệp tải về ghim phiên bản và mã băm như trên; chạy không cần mạng.
# Typst 0.15.1 (bản ổn định mới nhất) cho ilm 1.4.0, charged-ieee 0.1.3 và Typst model tự viết; Typst 0.12.0 đặt riêng chỉ cho basic-report 0.1.0
# (gói này và gói phụ thuộc hydra 0.5.1 → oxifmt 0.2.0 lỗi biên dịch từ Typst 0.13; workspace/doc/selftest.sh giữ điều này).
# Gói @preview đúng phiên bản chủ dự án chọn nằm sẵn ở TYPST_PACKAGE_PATH, nên typst init / compile không tải gì.
# fonts-texgyre: TeX Gyre Termes / Cursor mà charged-ieee dùng (đủ dấu tiếng Việt). Pango / HarfBuzz cho WeasyPrint.
RUN apt-get update && apt-get install -y --no-install-recommends fonts-texgyre libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz-subset0 \
  && rm -rf /var/lib/apt/lists/*
RUN set -e; cd /tmp; \
    fetch() { curl -fsSLg --retry 5 --retry-all-errors --connect-timeout 20 -o "$3" "$2"; echo "$1  $3" | sha256sum -c --quiet -; }; \
    fetch a6d077d0a95eed5a2eba715b2dae06be954f624ccbf85758a03f389ded33118c https://github.com/typst/typst/releases/download/v0.15.1/typst-x86_64-unknown-linux-musl.tar.xz t.tar.xz; \
    tar xJf t.tar.xz; install -m 755 typst-x86_64-unknown-linux-musl/typst /usr/local/bin/typst; rm -r t.tar.xz typst-x86_64-unknown-linux-musl; \
    fetch 605130a770ebd59a4a579673079cb913a13e75985231657a71d6239a57539ec3 https://github.com/typst/typst/releases/download/v0.12.0/typst-x86_64-unknown-linux-musl.tar.xz t.tar.xz; \
    tar xJf t.tar.xz; install -D -m 755 typst-x86_64-unknown-linux-musl/typst /usr/local/lib/synchro-doc/typst-0.12.0; rm -r t.tar.xz typst-x86_64-unknown-linux-musl; \
    printf '%s\n' \
      '6ed00d8a7fbcd882abdd21a0e1ab27807019d1aef447d14a87ecd8daefd32293 basic-report 0.1.0' \
      '40723a565b981b0cb8b9cdfe193c8dbf31944cf6c42c55d8ae60d25eee27f1ac hydra 0.5.1' \
      '260d4db5173286a79e26f88e885b3cecb89d85807d92110d839511d82152e862 oxifmt 0.2.0' \
      '2448904f8bbff54c68ddd700e3b01788053f3b48417aac4553a4a17008a60219 ilm 1.4.0' \
      'f665c7de234a86be9b59b2df920df023f742b7f094fd71f8159a52808bb51d42 charged-ieee 0.1.3' \
    | while read -r sum n v; do \
        fetch "$sum" "https://packages.typst.org/preview/$n-$v.tar.gz" p.tgz; \
        mkdir -p "/opt/synchro/typst-packages/preview/$n/$v"; tar xzf p.tgz -C "/opt/synchro/typst-packages/preview/$n/$v"; rm p.tgz; \
      done; \
    mkdir -p /opt/synchro/doc/invoice; \
    printf '%s\n' \
      'e31e2437f6c4ebd67d6bbbfa730ba077dbeb10deda42784fbac02559bcbfee45 https://raw.githubusercontent.com/FAlthausen/Vollkorn-Typeface/38ab7a896bd6b163ac7f834ec696d6c68e5dedd6/fonts/ttf/Vollkorn-Regular.ttf /usr/share/fonts/truetype/synchro/Vollkorn-Regular.ttf' \
      '0c81f214910a95a995958da221efc50bfaa4d07aa2be6429de1b7accc6764536 https://raw.githubusercontent.com/FAlthausen/Vollkorn-Typeface/38ab7a896bd6b163ac7f834ec696d6c68e5dedd6/fonts/ttf/Vollkorn-Bold.ttf /usr/share/fonts/truetype/synchro/Vollkorn-Bold.ttf' \
      '6b6befba6011682be28b200331c37babb944f0aa510e8181cf26eab3d4828004 https://raw.githubusercontent.com/FAlthausen/Vollkorn-Typeface/38ab7a896bd6b163ac7f834ec696d6c68e5dedd6/fonts/ttf/Vollkorn-Italic.ttf /usr/share/fonts/truetype/synchro/Vollkorn-Italic.ttf' \
      'a808799b2add65edca00c568ca319db70e73e20e4294887c2a51ac91ed256bee https://raw.githubusercontent.com/FAlthausen/Vollkorn-Typeface/38ab7a896bd6b163ac7f834ec696d6c68e5dedd6/fonts/ttf/Vollkorn-BoldItalic.ttf /usr/share/fonts/truetype/synchro/Vollkorn-BoldItalic.ttf' \
      '156424e672f26cdd52da0674d0dd3ef85728f9a63e3f224528d87627eda87505 https://raw.githubusercontent.com/CourtBouillon/weasyprint-samples/6dc675b05a5cba59576dfaa8881ea6ccdccb13cc/invoice/invoice.css /opt/synchro/doc/invoice/invoice.css' \
      'b6f34ba6edb868acf6f6d8a37e6345970a0ad70eb57d96cd5ec07f7138d28cd7 https://raw.githubusercontent.com/CourtBouillon/weasyprint-samples/6dc675b05a5cba59576dfaa8881ea6ccdccb13cc/invoice/invoice.html /opt/synchro/doc/invoice/invoice.original.html' \
      '393fb5b878ceed04aebc34b097e853ae5138c51d0c34b496ce8e2b47e0d0b94a https://raw.githubusercontent.com/CourtBouillon/weasyprint-samples/6dc675b05a5cba59576dfaa8881ea6ccdccb13cc/invoice/SourceSans3-Regular.ttf /opt/synchro/doc/invoice/SourceSans3-Regular.ttf' \
      '7109021766e915ecd9721e28d11dfc732d57affda49e4ca15bb6d1529add7fdd https://raw.githubusercontent.com/CourtBouillon/weasyprint-samples/6dc675b05a5cba59576dfaa8881ea6ccdccb13cc/invoice/SourceSans3-Bold.ttf /opt/synchro/doc/invoice/SourceSans3-Bold.ttf' \
      '5b6c0d5334a7bf77dea52b975c5a0c408878c0f7115ed5b6fb151f634b7bf701 https://raw.githubusercontent.com/google/fonts/bbda7253fc363238b05d97515ca71f8ae49c4fa9/ofl/pacifico/Pacifico-Regular.ttf /opt/synchro/doc/invoice/pacifico.ttf' \
    | while read -r sum url out; do fetch "$sum" "$url" "$out"; done; \
    fc-cache -f; fc-list : family | grep -qF Vollkorn
# WeasyPrint từ pip, ghim bản 70.0 (Debian chỉ có 57.2, chưa hiểu CSS lồng nhau mà invoice.css dùng; 70.0 có bản vá CVE-2025-68616, CVE-2026-49452,
# CVE-2026-55073). Các gói phụ thuộc mới cũng ghim; tinycss2, cssselect2, fonttools, Pillow, cffi dùng bản đã có ở lớp pip phía trên.
RUN pip install --break-system-packages --no-cache-dir "weasyprint==70.0" "pydyf==0.13.0" "tinyhtml5==2.1.0" "pyphen==0.18.1" "brotli==1.2.1" "zopfli==0.4.3" \
  && python3 -c "import weasyprint; assert weasyprint.__version__ == '70.0', weasyprint.__version__"
# Bản Word: thư viện docx 9.15.3 của npm (tài liệu của chủ dự án chọn cho đầu ra Word), mã băm sha512 trong package-lock.json.
COPY doc/docx/package.json doc/docx/package-lock.json /opt/synchro/doc/docx/
RUN cd /opt/synchro/doc/docx && npm ci --omit=dev --no-fund --no-audit && npm cache clean --force
# Mẫu (main.typ đọc payload JSON), hợp đồng JSON, synchro-doc, CSS hóa đơn, bộ dựng Word, tự kiểm tra.
COPY doc/ /opt/synchro/doc/
RUN set -e; install -m 755 /opt/synchro/doc/synchro-doc.py /usr/local/bin/synchro-doc; \
    chown -R root:root /opt/synchro/doc /opt/synchro/typst-packages /usr/local/lib/synchro-doc; chmod -R a+rX,go-w /opt/synchro/doc /opt/synchro/typst-packages; \
    printf '%s\n' \
      'export TYPST_PACKAGE_PATH=/opt/synchro/typst-packages' \
      'export TYPST_FONT_PATHS=/usr/share/texmf/fonts/opentype/public/tex-gyre' \
      >> /etc/profile.d/synchro.sh
ENV TYPST_PACKAGE_PATH=/opt/synchro/typst-packages TYPST_FONT_PATHS=/usr/share/texmf/fonts/opentype/public/tex-gyre

# ------------------------------------------------------------------ biểu đồ ECharts (synchro-chart) và sơ đồ D2
# Đặt sau các lớp nặng (Remotion, tài liệu) để đổi mẫu biểu đồ không phải dựng lại chúng. Chạy không cần mạng.
# ECharts 6.1.0 (Apache-2.0) cài theo package-lock.json (mã băm sha512): require("echarts") ở đâu cũng được (NODE_PATH), SSR ra SVG không cần trình duyệt.
# synchro-chart dùng đúng cấu hình biểu đồ của khung artifact (workspace/charts/synchro-charts.js sinh từ app/design-engine/charts/echarts-presets.ts).
COPY charts/package.json charts/package-lock.json /opt/synchro/charts/
RUN cd /opt/synchro/charts && npm ci --omit=dev --no-fund --no-audit && npm cache clean --force
COPY charts/ /opt/synchro/charts/
# D2 v0.9.0 (MPL-2.0), bản Linux x86_64 phát hành chính thức, ghim mã băm theo SHA256SUMS của bản phát hành. Chỉ dùng bố cục dagre / elk đi kèm (mở);
# TALA là phần mềm thương mại nên không dùng.
RUN set -e; chmod 755 /opt/synchro/charts/synchro-chart.mjs; ln -sf /opt/synchro/charts/synchro-chart.mjs /usr/local/bin/synchro-chart; \
    cd /tmp; curl -fsSL --retry 5 --retry-all-errors --connect-timeout 20 -o d2.tgz https://github.com/d2lang/d2/releases/download/v0.9.0/d2-v0.9.0-linux-amd64.tar.gz; \
    echo "5669ddc46b99e942cc96078f4a4e36d5e62103348f4c05179ede27802fdd87a9  d2.tgz" | sha256sum -c --quiet -; \
    tar xzf d2.tgz; install -m 755 d2-v0.9.0/bin/d2 /usr/local/bin/d2; install -D -m 644 d2-v0.9.0/LICENSE.txt /usr/share/doc/d2/LICENSE.txt; rm -rf d2.tgz d2-v0.9.0; \
    d2 --version | grep -qx v0.9.0; \
    chown -R root:root /opt/synchro/charts; chmod -R a+rX,go-w /opt/synchro/charts; \
    printf '%s\n' 'export NODE_PATH="$NODE_PATH:/opt/synchro/charts/node_modules"' >> /etc/profile.d/synchro.sh
ENV NODE_PATH=/usr/local/lib/node_modules:/home/user/.npm-global/lib/node_modules:/opt/synchro/charts/node_modules

# ------------------------------------------------------------------ đủ bộ phông (shared/designrefs.ts KIT_FONTS)
# Phần còn lại của 17 phông khung artifact tự phục vụ (/kitfonts/v1/): PDF, ảnh và video dựng trong sandbox dùng đúng
# phông của bản xem. Cùng commit google/fonts và cách ghim mã băm như lớp phông ở trên; tất cả là OFL-1.1.
# Đặt sau các lớp nặng để thêm phông không phải dựng lại Remotion và bộ tài liệu.
RUN set -e; cd /usr/share/fonts/truetype/synchro; \
    base=https://raw.githubusercontent.com/google/fonts/bbda7253fc363238b05d97515ca71f8ae49c4fa9; \
    printf '%s %s %s\n' \
      '0f7b311b2f3279e4eef9b2f968bcdbab6e28f4daeb1f049f4f278a902bcd82f7' \
        'ofl/montserrat/Montserrat%5Bwght%5D.ttf' 'Montserrat.ttf' \
      '3b031aa4216174205bd8471f88a49b91f093169e9e87bd5262242bc5967fe2e3' \
        'ofl/ibmplexsans/IBMPlexSans%5Bwdth,wght%5D.ttf' 'IBMPlexSans.ttf' \
      '0e094a7d3c7c4c25cf1310c4b30014f1dae9332220b1c2c88f4fa996f0b05053' \
        'ofl/archivo/Archivo%5Bwdth,wght%5D.ttf' 'Archivo.ttf' \
      '413e7357809ddd12fd80a96a8a396de0e401638d4acd3cb3e37532f0472ac682' \
        'ofl/bricolagegrotesque/BricolageGrotesque%5Bopsz,wdth,wght%5D.ttf' 'BricolageGrotesque.ttf' \
      '3add53e641fbc81da64da4bb254285e2831b52b029527bc0714e2b9610832ee6' \
        'ofl/lexend/Lexend%5Bwght%5D.ttf' 'Lexend.ttf' \
      '323b511be380c8d474ef030686b71aedde501f8d9cd46da558b7c40454372c3f' \
        'ofl/unbounded/Unbounded%5Bwght%5D.ttf' 'Unbounded.ttf' \
      '5b38c246e255a12f5712d640d56bcced0472466fc68983d2d0410ec0457c2817' \
        'ofl/oswald/Oswald%5Bwght%5D.ttf' 'Oswald.ttf' \
      'a4ba3a92350ebb031da0cb47630ac49eb265082ca1bc0450442f4a83ab947cab' \
        'ofl/anton/Anton-Regular.ttf' 'Anton-Regular.ttf' \
      '177ff6c0f14e5550a3c624247cd1189611d4eb65d000b14944c63d967958abbb' \
        'ofl/fraunces/Fraunces%5BSOFT,WONK,opsz,wght%5D.ttf' 'Fraunces.ttf' \
      'b24448c43702fac4ee856781d461a0dfba8d8e594b6e8e190234b75fed2c0e01' \
        'ofl/fraunces/Fraunces-Italic%5BSOFT,WONK,opsz,wght%5D.ttf' 'Fraunces-Italic.ttf' \
      '97b2d4da6e3cb494b5a1e66ae176914d852ccabef49e0c02c0df25f3e39aca0b' \
        'ofl/sourceserif4/SourceSerif4%5Bopsz,wght%5D.ttf' 'SourceSerif4.ttf' \
      '15fbc7e4679489a501998c3669272637a6646388ef7e4bd77eebb5bf967a1f42' \
        'ofl/sourceserif4/SourceSerif4-Italic%5Bopsz,wght%5D.ttf' 'SourceSerif4-Italic.ttf' \
      'b20b7d9626dd956b2c5e558692ad328b1f19e3275e2782db4fa07670d83f35e0' \
        'ofl/cormorantgaramond/CormorantGaramond%5Bwght%5D.ttf' 'CormorantGaramond.ttf' \
      '0f48ea6abb2084537854f7174c470991a463b13036309e3b50a81511611c530d' \
        'ofl/cormorantgaramond/CormorantGaramond-Italic%5Bwght%5D.ttf' 'CormorantGaramond-Italic.ttf' \
      'a5e26dc5e2e77fb2803a0bf02fd4f81ee136ec8dea863ccdb0c59a263b21378b' \
        'ofl/playfairdisplay/PlayfairDisplay-Italic%5Bwght%5D.ttf' 'PlayfairDisplay-Italic.ttf' \
    | while read -r sum src out; do \
        curl -fsSLg --retry 5 --retry-all-errors --connect-timeout 20 -o "$out" "$base/$src"; \
        echo "$sum  $out" | sha256sum -c --quiet -; \
      done; \
    fc-cache -f; \
    for f in 'Montserrat' 'IBM Plex Sans' 'Archivo' 'Bricolage Grotesque' 'Lexend' 'Unbounded' 'Oswald' 'Anton' \
      'Fraunces' 'Source Serif 4' 'Cormorant Garamond'; do \
      fc-list : family | grep -qF "$f" || { echo "thiếu phông $f"; exit 1; }; \
    done

USER user
# Biểu đồ và sơ đồ: 8 loại ra SVG hợp lệ và PNG, require("echarts") từ thư mục bất kỳ, D2 có chữ tiếng Việt, tất cả không mạng.
RUN set -e; cd /tmp; synchro-chart example > ex.json; \
    node -e 'const ex=require("/tmp/ex.json");for(const [k,v] of Object.entries(ex))require("fs").writeFileSync("/tmp/c-"+k+".json",JSON.stringify(v))'; \
    for t in bar line area doughnut pie waterfall sankey radar; do synchro-chart c-$t.json c-$t.svg --preset midnight-tech >/dev/null; grep -q '<svg' c-$t.svg; done; \
    synchro-chart c-waterfall.json c-w.png --scale 2 >/dev/null; file c-w.png | grep -q 'PNG image data, 1920 x 1080'; \
    node -e 'const e=require("echarts");const c=e.init(null,null,{renderer:"svg",ssr:true,width:300,height:200});c.setOption({animation:false,xAxis:{data:["a"]},yAxis:{},series:[{type:"bar",data:[1]}]});if(!c.renderToSVGString().includes("<svg"))process.exit(1);c.dispose()'; \
    printf 'a: Khách hàng\nb: Máy chủ dữ liệu\na -> b: Truy vấn\n' > s.d2; d2 --layout=elk s.d2 s.svg >/dev/null 2>&1; grep -q '<svg' s.svg; \
    rm -f /tmp/ex.json /tmp/c-* /tmp/s.d2 /tmp/s.svg
# Tự kiểm tra lúc build bằng đúng người dùng của sandbox: mỗi mẫu dựng 1 giây 60 khung/giây (chữ tiếng Việt), âm thanh 48 kHz, whisper nhận ra giọng tiếng Việt.
# Lỗi ở đây làm build hỏng thay vì giao image có bộ dựng video hỏng.
RUN cd /tmp && synchro-video selftest
# Tài liệu: 3 mẫu Typst + hóa đơn WeasyPrint + bản Word, chữ tiếng Việt, phông đúng, không mạng, payload sai bị từ chối.
RUN bash /opt/synchro/doc/selftest.sh
WORKDIR /home/user/work
CMD ["sleep", "infinity"]
