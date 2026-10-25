import { handle, limit, requireUser, sameOrigin } from "../../authstore";
import { createMeeting, listMeetings, MeetingError } from "../../meetings";
import { STT_MAX, sttAvailable } from "../../stt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Cuộc họp của tài khoản; stt cho biết máy chủ có dịch vụ chép lời không (không có thì chỉ dán ghi chép).
export const GET = handle(async (req: Request) => Response.json({ meetings: listMeetings(requireUser(req).user.id), stt: sttAvailable() }));

// Tạo cuộc họp: multipart (title, date, tz, model, audio) hoặc JSON { title, date, tz, model, transcript } → { id, run }.
export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("meeting:" + user.id, 30, 60 * 60_000);
  try {
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const fd = await req.formData();
      const f = fd.get("audio");
      if (!(f instanceof File) || !f.size) return Response.json({ error: "Thiếu tệp ghi âm." }, { status: 400 });
      if (f.size > STT_MAX) return Response.json({ error: "Tệp ghi âm quá lớn (tối đa 100 MB)." }, { status: 413 });
      if (!sttAvailable()) return Response.json({ error: "Synchro chưa có dịch vụ chép lời (cần khóa ElevenLabs hoặc OpenAI). Hãy dán nội dung cuộc họp thay vì tải tệp." }, { status: 503 });
      const x = Object.fromEntries(["title", "date", "tz", "model"].map((k) => [k, fd.get(k)]));
      return Response.json(createMeeting(user, x, { buf: Buffer.from(await f.arrayBuffer()), name: f.name || "ghi-am.mp3", mime: f.type }));
    }
    return Response.json(createMeeting(user, await req.json().catch(() => ({}))));
  } catch (e) { if (e instanceof MeetingError) return Response.json({ error: e.message }, { status: e.status }); throw e; }
});
