This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Tài khoản, đăng nhập và quản trị

Tài khoản lưu trong `data/synchro.db` (SQLite, không vào git, không bị deploy ghi đè). Mật khẩu băm bằng scrypt, phiên đăng nhập là cookie `httpOnly` lưu dạng băm SHA-256 trên máy chủ.

**Tạo tài khoản quản trị** (web không cho đăng ký bằng mật khẩu với email quản trị):

```bash
node scripts/create-admin.mjs
```

Trên VPS: `su - synchro -c "cd /var/www/synchro && node scripts/create-admin.mjs"`.

**Bật đăng nhập Google / GitHub / Apple**: thêm biến vào `.env.production` (xem `.env.example`) rồi khởi động lại app. Redirect URI cần khai báo ở mỗi nhà cung cấp:

| Nhà cung cấp | Nơi tạo | Redirect URI |
|---|---|---|
| Google | Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application) | `https://synchro.net.nz/api/auth/oauth/google/callback` |
| GitHub | GitHub → Settings → Developer settings → OAuth Apps | `https://synchro.net.nz/api/auth/oauth/github/callback` |
| Apple | Apple Developer → Certificates, IDs & Profiles: tạo App ID bật Sign in with Apple, một Services ID (= `APPLE_CLIENT_ID`) và một Key (.p8) | `https://synchro.net.nz/api/auth/oauth/apple/callback` |

