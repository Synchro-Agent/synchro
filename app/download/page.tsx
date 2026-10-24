import type { Metadata } from "next";
import { DownloadView } from "./view";

export const metadata: Metadata = { title: "Tải ứng dụng – Synchro", description: "Synchro cho macOS, Windows, iPhone và Android." };

export default function Download() {
  return <DownloadView />;
}
