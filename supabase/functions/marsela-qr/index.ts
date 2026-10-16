import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });
const todayJakarta = () => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
};
const sha256Hex = async (value: string) => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
};
function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function constantTimeEqual(a: string, b: string) {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let diff = aa.length ^ bb.length;
  const max = Math.max(aa.length, bb.length);
  for (let i = 0; i < max; i++) diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}
function eligible(event: any, category: string) {
  if (event.jenis_pengajian === "Caberawit") return ["PAUD", "SD / Caberawit"].includes(category);
  if (event.jenis_pengajian === "Muda-Mudi") return category === "Muda - Mudi";
  if (event.jenis_pengajian === "Kelompok") {
    return ["Bapak - Bapak", "Ibu - Ibu", "Duda", "Janda"].includes(category) ||
      (event.include_mudamudi === true && category === "Muda - Mudi");
  }
  return false;
}
function validStatus(status: unknown): status is "Hadir" | "Izin" | "Sakit" {
  return status === "Hadir" || status === "Izin" || status === "Sakit";
}

async function saveAttendance(event: any, memberId: number, status: "Hadir" | "Izin" | "Sakit") {
  const { data: member, error: memberError } = await db!.from("marsela_members")
    .select("id,kategori,is_active").eq("id", memberId).maybeSingle();
  if (memberError) throw memberError;
  if (!member || !member.is_active) return json({ error: "Anggota tidak aktif atau tidak ditemukan." }, 404);
  if (!eligible(event, member.kategori)) return json({ error: "Kategori anggota tidak sesuai dengan kegiatan ini." }, 403);
  const { error: insertError } = await db!.from("marsela_attendance")
    .insert({ event_id: event.id, member_id: member.id, status });
  if (insertError) {
    if (insertError.code === "23505") return json({ error: "Presensi anggota ini sudah tercatat dan tidak dapat dikirim ulang." }, 409);
    throw insertError;
  }
  return json({ ok: true, eventId: event.id, eventTitle: event.title, eventDate: event.event_date, status });
}

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const adminPin = Deno.env.get("MARSELA_QR_ADMIN_PIN") ?? "";
const db = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

async function findActiveSession(token: string) {
  if (token.length < 30 || token.length > 200) return { session: null, error: "Token QR tidak valid." };
  const tokenHash = await sha256Hex(token);
  const { data, error } = await db!.from("marsela_qr_sessions")
    .select("id,event_id,expires_at,closed_at")
    .eq("token_hash", tokenHash).maybeSingle();
  if (error) throw error;
  if (!data || data.closed_at || new Date(data.expires_at).getTime() <= Date.now()) {
    return { session: null, error: "Sesi QR sudah ditutup atau kedaluwarsa. Minta QR terbaru kepada pengurus." };
  }
  const { data: event, error: eventError } = await db!.from("marsela_events")
    .select("id,title,event_date,is_open,jenis_pengajian,include_mudamudi")
    .eq("id", data.event_id).maybeSingle();
  if (eventError) throw eventError;
  if (!event || !event.is_open || event.event_date !== todayJakarta()) {
    return { session: null, error: "Kegiatan tidak lagi membuka presensi hari ini." };
  }
  return { session: data, event, error: null };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Metode tidak didukung." }, 405);
  if (!db) return json({ error: "Konfigurasi server Supabase belum lengkap." }, 500);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Format permintaan tidak valid." }, 400); }
  const action = String(body.action ?? "");

  try {
    if (action === "create") {
      const pin = String(body.adminPin ?? "");
      const eventId = Number(body.eventId);
      if (!adminPin || adminPin.length < 20) {
        return json({ error: "PIN pengurus server belum dikonfigurasi dengan kuat. Hubungi pengelola website." }, 503);
      }
      if (!constantTimeEqual(pin, adminPin)) return json({ error: "PIN pengurus salah." }, 401);
      if (!Number.isSafeInteger(eventId) || eventId <= 0) return json({ error: "ID kegiatan tidak valid." }, 400);

      const { data: event, error: eventError } = await db.from("marsela_events")
        .select("id,title,event_date,is_open").eq("id", eventId).maybeSingle();
      if (eventError) throw eventError;
      if (!event || !event.is_open || event.event_date !== todayJakarta()) {
        return json({ error: "QR hanya dapat dibuat untuk kegiatan yang dibuka pada hari ini." }, 409);
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
      // Hanya satu sesi aktif per kegiatan: membuat sesi baru otomatis menutup sesi lama.
      const { error: closeOldError } = await db.from("marsela_qr_sessions")
        .update({ closed_at: now.toISOString() }).eq("event_id", eventId).is("closed_at", null);
      if (closeOldError) throw closeOldError;

      const token = newToken();
      const tokenHash = await sha256Hex(token);
      const { data: session, error: insertError } = await db.from("marsela_qr_sessions")
        .insert({ event_id: eventId, token_hash: tokenHash, expires_at: expiresAt.toISOString() })
        .select("id,expires_at").single();
      if (insertError) throw insertError;
      return json({ sessionId: session.id, eventId: event.id, eventTitle: event.title, token, expiresAt: session.expires_at });
    }

    if (action === "close") {
      const pin = String(body.adminPin ?? "");
      const sessionId = String(body.sessionId ?? "");
      if (!adminPin || adminPin.length < 20) return json({ error: "PIN pengurus server belum dikonfigurasi." }, 503);
      if (!constantTimeEqual(pin, adminPin)) return json({ error: "PIN pengurus salah." }, 401);
      if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return json({ error: "ID sesi tidak valid." }, 400);
      const { data, error } = await db.from("marsela_qr_sessions")
        .update({ closed_at: new Date().toISOString() }).eq("id", sessionId).is("closed_at", null)
        .select("id").maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: "Sesi sudah ditutup atau tidak ditemukan." }, 404);
      return json({ ok: true, message: "Sesi QR ditutup." });
    }

    if (action === "validate") {
      const token = String(body.token ?? "");
      if (!token) return json({ error: "Token QR tidak tersedia." }, 400);
      const result = await findActiveSession(token);
      if (!result.session || !result.event) return json({ error: result.error || "Sesi QR tidak valid." }, 410);
      return json({ ok: true, eventId: result.event.id, eventTitle: result.event.title, expiresAt: result.session.expires_at });
    }

    if (action === "submit") {
      const token = String(body.token ?? "");
      const memberId = Number(body.memberId);
      const status = body.status;
      if (!token || !Number.isSafeInteger(memberId) || memberId <= 0 || !validStatus(status)) {
        return json({ error: "Data presensi tidak lengkap atau tidak valid." }, 400);
      }
      const result = await findActiveSession(token);
      if (!result.session || !result.event) return json({ error: result.error || "Sesi QR tidak valid." }, 410);
      return await saveAttendance(result.event, memberId, status);
    }

    if (action === "submit_manual") {
      const pin = String(body.adminPin ?? "");
      const eventId = Number(body.eventId);
      const memberId = Number(body.memberId);
      const status = body.status;
      if (!adminPin || adminPin.length < 20) return json({ error: "Kunci pengurus server belum dikonfigurasi." }, 503);
      if (!constantTimeEqual(pin, adminPin)) return json({ error: "Kunci pengurus salah." }, 401);
      if (!Number.isSafeInteger(eventId) || eventId <= 0 || !Number.isSafeInteger(memberId) || memberId <= 0 || !validStatus(status)) {
        return json({ error: "Data presensi manual tidak lengkap atau tidak valid." }, 400);
      }
      const { data: event, error: eventError } = await db.from("marsela_events")
        .select("id,title,event_date,is_open,jenis_pengajian,include_mudamudi").eq("id", eventId).maybeSingle();
      if (eventError) throw eventError;
      if (!event || !event.is_open || event.event_date !== todayJakarta()) {
        return json({ error: "Presensi manual hanya tersedia untuk kegiatan yang dibuka hari ini." }, 409);
      }
      return await saveAttendance(event, memberId, status);
    }

    return json({ error: "Aksi tidak dikenal." }, 400);
  } catch (error) {
    console.error("marsela-qr error", error);
    return json({ error: "Permintaan tidak dapat diproses. Periksa konfigurasi fungsi dan database." }, 500);
  }
});
