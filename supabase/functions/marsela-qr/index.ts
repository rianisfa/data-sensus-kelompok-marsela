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
type AttendanceEvent = {
  id: number;
  title: string;
  event_date: string;
  jenis_pengajian: string;
  include_mudamudi: boolean | null;
};

function eligible(
  event: Pick<AttendanceEvent, "jenis_pengajian" | "include_mudamudi">,
  category: string
) {
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

async function saveAttendance(
  event: AttendanceEvent,
  memberId: number,
  status: "Hadir" | "Izin" | "Sakit"
) {
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


// Sesi pengurus disimpan sebagai hash; token mentah hanya diberikan saat login.
async function adminAuthorized(body: Record<string, unknown>): Promise<boolean> {
  const token = typeof body.adminToken === "string" ? body.adminToken : "";
  if (token) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
    const { data, error } = await db!.from("marsela_admin_sessions")
      .select("id").eq("token_hash", await sha256Hex(token))
      .is("revoked_at", null).maybeSingle();
    if (error) throw error;
    if (!data) return false;
    const { error: touchError } = await db!.from("marsela_admin_sessions")
      .update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
    if (touchError) throw touchError;
    return true;
  }
  // Kompatibilitas sementara dengan frontend lama sampai migrasi selesai.
  const pin = typeof body.adminPin === "string" ? body.adminPin : "";
  return adminPin.length >= 20 && constantTimeEqual(pin, adminPin);
}

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
    .select("id,title,event_date,is_open,jenis_pengajian,include_mudamudi,is_archived")
    .eq("id", data.event_id).maybeSingle();
  if (eventError) throw eventError;
  if (!event || event.is_archived || !event.is_open || event.event_date !== todayJakarta()) {
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
    if (action === "admin_login") {
      const pin = typeof body.adminPin === "string" ? body.adminPin : "";
      if (adminPin.length < 20) return json({ error: "PIN server belum dikonfigurasi." }, 503);
      if (!constantTimeEqual(pin, adminPin)) return json({ error: "PIN pengurus salah." }, 401);
      const token = newToken();
      const { error } = await db.from("marsela_admin_sessions")
        .insert({ token_hash: await sha256Hex(token) });
      if (error) throw error;
      return json({ ok: true, adminToken: token });
    }
    if (action === "admin_check") {
      return (await adminAuthorized({ adminToken: body.adminToken }))
        ? json({ ok: true }) : json({ error: "Sesi pengurus tidak valid." }, 401);
    }
    if (action === "admin_logout") {
      const token = typeof body.adminToken === "string" ? body.adminToken : "";
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return json({ error: "Token tidak valid." }, 401);
      const { data, error } = await db.from("marsela_admin_sessions")
        .update({ revoked_at: new Date().toISOString() })
        .eq("token_hash", await sha256Hex(token)).is("revoked_at", null)
        .select("id").maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: "Sesi sudah tidak aktif." }, 401);
      return json({ ok: true });
    }
    // Verifikasi PIN hanya untuk membuka tampilan pengurus. Tidak menerbitkan token otorisasi.
    // Setiap operasi sensitif tetap harus memvalidasi PIN di server.
    if (action === "verify_admin") {
      const pin = String(body.adminPin ?? "");
      if (!adminPin || adminPin.length < 20) return json({ error: "PIN pengurus server belum dikonfigurasi." }, 503);
      if (!constantTimeEqual(pin, adminPin)) return json({ error: "PIN pengurus salah." }, 401);
      return json({ ok: true });
    }

    // Tambah kegiatan melalui PIN pengurus. Tidak mengubah presensi yang ada.
    if (action === "create_event") {
      if (!(await adminAuthorized(body))) return json({ error: "Akses pengurus tidak valid." }, 401);

      const title = typeof body.title === "string" ? body.title.trim() : "";
      const eventDate = typeof body.event_date === "string" ? body.event_date : "";
      const jenis = typeof body.jenis_pengajian === "string" ? body.jenis_pengajian : "";
      const notes = typeof body.notes === "string" ? body.notes.trim() : "";
      if (title.length < 3 || title.length > 150 || notes.length > 1000) return json({ error: "Nama kegiatan harus 3–150 karakter; keterangan maksimal 1000 karakter." }, 400);
      if (!["Kelompok", "Caberawit", "Muda-Mudi"].includes(jenis)) return json({ error: "Jenis pengajian tidak valid." }, 400);
      if (typeof body.include_mudamudi !== "boolean" || typeof body.is_open !== "boolean") return json({ error: "Pilihan kegiatan tidak valid." }, 400);
      if (body.include_mudamudi && jenis !== "Kelompok") return json({ error: "Menyertakan Muda-Mudi hanya untuk kegiatan Kelompok." }, 400);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return json({ error: "Format tanggal harus YYYY-MM-DD." }, 400);
      const parsedDate = new Date(`${eventDate}T00:00:00Z`);
      if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== eventDate) return json({ error: "Tanggal kegiatan tidak valid." }, 400);
      if (body.is_open && eventDate !== todayJakarta()) return json({ error: "Presensi hanya dapat dibuka untuk kegiatan hari ini (WIB)." }, 409);

      const { data: existing, error: checkError } = await db.from("marsela_events")
        .select("id").eq("event_date", eventDate).eq("jenis_pengajian", jenis).ilike("title", title).limit(1);
      if (checkError) throw checkError;
      if (existing && existing.length > 0) return json({ error: "Kegiatan dengan nama, tanggal, dan jenis sama sudah ada." }, 409);

      const { data: created, error: insertError } = await db.from("marsela_events")
        .insert({ title, event_date: eventDate, jenis_pengajian: jenis, notes: notes || null,
          include_mudamudi: body.include_mudamudi, is_open: body.is_open })
        .select("id,title,event_date,jenis_pengajian,notes,include_mudamudi,is_open").single();
      if (insertError) throw insertError;
      return json({ ok: true, event: created }, 201);
    }

    // Kelola anggota hanya dengan sesi pengurus yang diverifikasi server.
    if (["create_member", "update_member", "set_member_active"].includes(action)) {
      if (!(await adminAuthorized({ adminToken: body.adminToken }))) {
        return json({ error: "Sesi pengurus tidak valid. Silakan login ulang." }, 401);
      }
      const memberId = Number(body.memberId);
      if (action === "set_member_active") {
        if (!Number.isSafeInteger(memberId) || memberId <= 0 || typeof body.is_active !== "boolean") {
          return json({ error: "ID atau status anggota tidak valid." }, 400);
        }
        const { data: changed, error } = await db.from("marsela_members")
          .update({ is_active: body.is_active }).eq("id", memberId)
          .select("id,nama,is_active").maybeSingle();
        if (error) throw error;
        if (!changed) return json({ error: "Anggota tidak ditemukan." }, 404);
        return json({ ok: true, member: changed });
      }
      if (action === "update_member" && (!Number.isSafeInteger(memberId) || memberId <= 0)) {
        return json({ error: "ID anggota tidak valid." }, 400);
      }
      const nama = typeof body.nama === "string" ? body.nama.trim().replace(/\s+/g, " ") : "";
      const kelamin = body.kelamin == null || body.kelamin === "" ? null : body.kelamin;
      const kategori = body.kategori == null || body.kategori === "" ? null : body.kategori;
      const status = body.status == null || body.status === "" ? null : body.status;
      const tglLahir = body.tgl_lahir == null || body.tgl_lahir === "" ? null : body.tgl_lahir;
      if (nama.length < 2 || nama.length > 150) return json({ error: "Nama harus 2–150 karakter." }, 400);
      if (kelamin !== null && !["L", "P"].includes(String(kelamin))) return json({ error: "Jenis kelamin harus L atau P." }, 400);
      if (kategori !== null && (typeof kategori !== "string" || kategori.length > 100)) return json({ error: "Kategori tidak valid." }, 400);
      if (status !== null && (typeof status !== "string" || status.length > 100)) return json({ error: "Status keluarga tidak valid." }, 400);
      if (tglLahir !== null) {
        if (typeof tglLahir !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(tglLahir)) return json({ error: "Format tanggal lahir tidak valid." }, 400);
        const parsed = new Date(tglLahir + "T00:00:00Z");
        if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== tglLahir || tglLahir > todayJakarta()) {
          return json({ error: "Tanggal lahir tidak valid atau di masa depan." }, 400);
        }
      }
      const payload = { nama, kelamin, kategori: kategori === null ? null : kategori.trim(),
        status: status === null ? null : status.trim(), tgl_lahir: tglLahir };
      if (action === "create_member") {
        // ID ditentukan sequence database; jangan menerima ID dari browser.
        const { data: created, error } = await db.from("marsela_members")
          .insert(payload).select("id,nama,kelamin,kategori,status,tgl_lahir,is_active").single();
        if (error) throw error;
        return json({ ok: true, member: created }, 201);
      }
      const { data: changed, error } = await db.from("marsela_members")
        .update(payload).eq("id", memberId)
        .select("id,nama,kelamin,kategori,status,tgl_lahir,is_active").maybeSingle();
      if (error) throw error;
      if (!changed) return json({ error: "Anggota tidak ditemukan." }, 404);
      return json({ ok: true, member: changed });
    }

    // Kelola kegiatan: edit, arsip, pulihkan, hapus dengan pemeriksaan relasi.
    if (["update_event", "archive_event", "restore_event", "delete_event"].includes(action)) {
      if (!(await adminAuthorized(body))) return json({ error: "Akses pengurus tidak valid." }, 401);
      const eventId = Number(body.eventId);
      if (!Number.isSafeInteger(eventId) || eventId <= 0) return json({ error: "ID kegiatan tidak valid." }, 400);
      const { data: event, error: eventError } = await db.from("marsela_events")
        .select("id,title,event_date,jenis_pengajian,notes,is_open,include_mudamudi,is_archived")
        .eq("id", eventId).maybeSingle();
      if (eventError) throw eventError;
      if (!event) return json({ error: "Kegiatan tidak ditemukan." }, 404);

      if (action === "delete_event") {
        if (body.confirmTitle !== event.title) return json({ error: "Konfirmasi nama kegiatan tidak cocok." }, 400);
        const { data: result, error } = await db.rpc("marsela_delete_empty_event", { p_event_id: eventId });
        if (error) throw error;
        if (!result?.ok) return json({ error: result?.error || "Kegiatan tidak dapat dihapus." }, 409);
        return json({ ok: true, deletedId: eventId });
      }
      if (action === "archive_event" || action === "restore_event") {
        const archived = action === "archive_event";
        const { data: changed, error } = await db.from("marsela_events")
          .update({ is_archived: archived, ...(archived ? { is_open: false } : {}) })
          .eq("id", eventId).select("id,is_archived,is_open").single();
        if (error) throw error;
        return json({ ok: true, event: changed });
      }
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const eventDate = typeof body.event_date === "string" ? body.event_date : "";
      const jenis = typeof body.jenis_pengajian === "string" ? body.jenis_pengajian : "";
      const notes = typeof body.notes === "string" ? body.notes.trim() : "";
      if (title.length < 3 || title.length > 150 || notes.length > 1000) return json({ error: "Nama atau keterangan kegiatan tidak valid." }, 400);
      if (!["Kelompok", "Caberawit", "Muda-Mudi"].includes(jenis)) return json({ error: "Jenis pengajian tidak valid." }, 400);
      if (typeof body.include_mudamudi !== "boolean" || typeof body.is_open !== "boolean") return json({ error: "Pilihan kegiatan tidak valid." }, 400);
      if (body.include_mudamudi && jenis !== "Kelompok") return json({ error: "Muda-Mudi hanya dapat disertakan pada kegiatan Kelompok." }, 400);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || Number.isNaN(Date.parse(eventDate + "T00:00:00Z")) || new Date(eventDate + "T00:00:00Z").toISOString().slice(0,10) !== eventDate) return json({ error: "Tanggal kegiatan tidak valid." }, 400);
      if (body.is_open && (eventDate !== todayJakarta() || event.is_archived)) return json({ error: "Presensi hanya boleh dibuka untuk kegiatan aktif hari ini." }, 409);
      const sensitiveChanged = eventDate !== event.event_date || jenis !== event.jenis_pengajian || body.include_mudamudi !== event.include_mudamudi;
      if (sensitiveChanged) {
        const [{ count: attendanceCount, error: aErr }, { count: qrCount, error: qErr }] = await Promise.all([
          db.from("marsela_attendance").select("event_id", { count: "exact", head: true }).eq("event_id", eventId),
          db.from("marsela_qr_sessions").select("id", { count: "exact", head: true }).eq("event_id", eventId),
        ]);
        if (aErr) throw aErr; if (qErr) throw qErr;
        if ((attendanceCount ?? 0) > 0 || (qrCount ?? 0) > 0) return json({ error: "Tanggal, jenis, dan peserta kegiatan tidak boleh diubah setelah ada presensi atau sesi QR." }, 409);
      }
      const { data: duplicates, error: dErr } = await db.from("marsela_events")
        .select("id").eq("event_date", eventDate).eq("jenis_pengajian", jenis).ilike("title", title).neq("id", eventId).limit(1);
      if (dErr) throw dErr;
      if (duplicates?.length) return json({ error: "Kegiatan dengan nama, tanggal, dan jenis yang sama sudah ada." }, 409);
      const { data: changed, error: updateError } = await db.from("marsela_events")
        .update({ title, event_date: eventDate, jenis_pengajian: jenis, notes, include_mudamudi: body.include_mudamudi, is_open: body.is_open })
        .eq("id", eventId).select("id,title,event_date,jenis_pengajian,notes,include_mudamudi,is_open,is_archived").single();
      if (updateError) throw updateError;
      return json({ ok: true, event: changed });
    }

    if (action === "create") {
      const eventId = Number(body.eventId);
      if (!(await adminAuthorized(body))) return json({ error: "Akses pengurus tidak valid." }, 401);
      if (!Number.isSafeInteger(eventId) || eventId <= 0) return json({ error: "ID kegiatan tidak valid." }, 400);

      const { data: event, error: eventError } = await db.from("marsela_events")
        .select("id,title,event_date,is_open,is_archived").eq("id", eventId).maybeSingle();
      if (eventError) throw eventError;
      if (!event || event.is_archived || !event.is_open || event.event_date !== todayJakarta()) {
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
      const sessionId = String(body.sessionId ?? "");
      if (!(await adminAuthorized(body))) return json({ error: "Akses pengurus tidak valid." }, 401);
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

    // Tahap 9C: presensi mandiri pada tanggal kegiatan (WIB), tanpa QR/PIN.
    // Perhatian: memilih nama tidak membuktikan identitas anggota.
    if (action === "submit_self") {
      const eventId = Number(body.eventId);
      const memberId = Number(body.memberId);
      const status = body.status;
      if (!Number.isSafeInteger(eventId) || eventId <= 0 ||
          !Number.isSafeInteger(memberId) || memberId <= 0 || !validStatus(status)) {
        return json({ error: "Data presensi mandiri tidak valid." }, 400);
      }
      const { data: event, error: eventError } = await db.from("marsela_events")
        .select("id,title,event_date,is_open,jenis_pengajian,include_mudamudi,is_archived")
        .eq("id", eventId).maybeSingle();
      if (eventError) throw eventError;
      if (!event || event.is_archived || event.event_date !== todayJakarta() || !event.is_open) {
        return json({
          error: "Presensi mandiri hanya tersedia pada tanggal kegiatan (WIB) selama kegiatan masih dibuka oleh pengurus."
        }, 409);
      }
      return await saveAttendance(event, memberId, status);
    }

    if (action === "submit_manual") {
      const eventId = Number(body.eventId);
      const memberId = Number(body.memberId);
      const status = body.status;
      if (!(await adminAuthorized(body))) return json({ error: "Akses pengurus tidak valid." }, 401);
      if (!Number.isSafeInteger(eventId) || eventId <= 0 || !Number.isSafeInteger(memberId) || memberId <= 0 || !validStatus(status)) {
        return json({ error: "Data presensi manual tidak lengkap atau tidak valid." }, 400);
      }
      const { data: event, error: eventError } = await db.from("marsela_events")
        .select("id,title,event_date,is_open,jenis_pengajian,include_mudamudi,is_archived").eq("id", eventId).maybeSingle();
      if (eventError) throw eventError;
      const today = todayJakarta();
      if (!event || event.is_archived || event.event_date > today || (event.event_date === today && !event.is_open)) {
        return json({ error: "Input manual hanya diizinkan untuk kegiatan lampau atau kegiatan hari ini yang masih dibuka." }, 409);
      }
      return await saveAttendance(event, memberId, status);
    }

    return json({ error: "Aksi tidak dikenal." }, 400);
  } catch (error) {
    console.error("marsela-qr error", error);
    return json({ error: "Permintaan tidak dapat diproses. Periksa konfigurasi fungsi dan database." }, 500);
  }
});
