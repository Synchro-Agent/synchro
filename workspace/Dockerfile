# Image cho workspace của Synchro Code: mỗi người dùng một container chạy image này.
# Có sẵn Node 22, Python 3, git, Chromium (cho trình duyệt của agent) và các công cụ dòng lệnh thường dùng.
FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 LC_ALL=C.UTF-8
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji \
      python3 python3-pip python3-venv python-is-python3 \
      git curl wget ca-certificates socat procps less vim nano unzip zip \
      ripgrep jq tree htop build-essential openssh-client \
  && rm -rf /var/lib/apt/lists/*

# Thư viện để code trong chat tạo tệp (Word, Excel, PowerPoint, PDF, biểu đồ) và phân tích dữ liệu.
RUN pip install --break-system-packages --no-cache-dir \
      pandas numpy matplotlib openpyxl python-docx python-pptx reportlab

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
