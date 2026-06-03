// check_slots.js — Surveille créneaux Abaseo : semaine en cours + 7 jours glissants
const https = require("https");

const CONFIG = {
  officeId: "01934e61-5a55-7221-ab1d-1ca5190d2e24",
  practitionerId: "90aae816-a7f6-11ef-b00c-fa163ee7b3dd",
  appointmentTypeId: "01940b23-277d-7107-a963-7b9074d61110",
  nextAction: "40da493497eadff4d1d9243ce4ed01e619b1945b59",
  timezone: "Europe/Paris",
};

const BOOK_URL = "https://www.abaseo.fr/chiropracteur/44530-saint-gildas-des-bois/fanny-joly?officeId=01934e61-5a55-7221-ab1d-1ca5190d2e24";

const ROUTER_STATE = encodeURIComponent(JSON.stringify(
  ["", {children: ["fr", {children: ["(abaseo)", {children: ["profession", {children: ["chiropracteur",
  {children: ["locality", {children: ["44530-saint-gildas-des-bois", {children: ["practitioner",
  {children: ["fanny-joly", {children: ["__PAGE__", {}, null, null]}, null, null]},
  null, null]}, null, null]}, null, null]}, null, null]}, null, null]}, null, null]}]}]
));

// Retourne le lundi de la semaine contenant `date`
function getMondayOf(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// Formate une date en JJ/MM/AAAA
function formatDate(date) {
  const d = new Date(date);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();
  return day + "/" + month + "/" + year;
}

function checkSlotsForWeek(fromISO) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify([{
      practitionerId: CONFIG.practitionerId,
      appointmentTypeId: CONFIG.appointmentTypeId,
      officeId: CONFIG.officeId,
      from: fromISO,
      timezone: CONFIG.timezone,
    }]);

    const options = {
      hostname: "www.abaseo.fr",
      path: "/chiropracteur/44530-saint-gildas-des-bois/fanny-joly?officeId=" + CONFIG.officeId,
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
        "Content-Length": Buffer.byteLength(payload),
        "Accept": "text/x-component",
        "Next-Action": CONFIG.nextAction,
        "Next-Router-State-Tree": ROUTER_STATE,
        "Origin": "https://www.abaseo.fr",
        "Referer": BOOK_URL,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36",
        "Accept-Language": "fr-FR,fr;q=0.9",
        "Cache-Control": "no-cache",
      },
    };

    let data = "";
    const req = https.request(options, (res) => {
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const match = data.match(/^1:(\{.+\})/m);
        if (!match) {
          console.log("Réponse inattendue :", data.substring(0, 200));
          return resolve([]);
        }
        try {
          const cleaned = match[1].replace(/"\$D/g, '"');
          const parsed = JSON.parse(cleaned);
          const available = [];
          for (const day of parsed.availabilities || []) {
            if (day.slots && day.slots.length > 0) {
              available.push({ date: day.date, slots: day.slots });
            }
          }
          resolve(available);
        } catch (e) {
          console.error("Erreur parsing :", e.message);
          resolve([]);
        }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// Filtre pour ne garder que les créneaux dans la fenêtre [today, today+7j]
function filterWindow(allSlots) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const limit = new Date(today);
  limit.setDate(today.getDate() + 7);

  return allSlots.filter((s) => {
    const d = new Date(s.date);
    return d >= today && d <= limit;
  });
}

async function sendMail(slots) {
  const emailTo = process.env.NOTIFY_EMAIL;
  const resendKey = process.env.RESEND_API_KEY;

  if (!resendKey || !emailTo) {
    console.error("Variables RESEND_API_KEY ou NOTIFY_EMAIL manquantes !");
    process.exit(1);
  }

  // Lignes texte
  const lines = slots.map((s) => "• " + formatDate(s.date) + " : " + s.slots.join(", ")).join("\n");

  // Lignes HTML : une ligne par jour, créneaux listés
  const htmlRows = slots.map((s) => {
    const slotsSpans = s.slots.map((h) => {
      return "<span style=\"display:inline-block;background:#E1F5EE;color:#0F6E56;padding:4px 10px;border-radius:4px;margin:2px;font-weight:500\">" + h + "</span>";
    }).join(" ");
    return "<tr><td style=\"padding:8px 0;border-bottom:1px solid #eee;font-weight:500;width:110px\">" + formatDate(s.date) + "</td><td style=\"padding:8px 0;border-bottom:1px solid #eee\">" + slotsSpans + "</td></tr>";
  }).join("");

  const html = "<div style=\"font-family:sans-serif;max-width:520px;margin:0 auto\">"
    + "<h2 style=\"color:#0F6E56;margin-bottom:4px\">Créneau disponible chez Fanny Joly</h2>"
    + "<p style=\"color:#888;margin-top:0;margin-bottom:20px\">Chiropracteur — Saint-Gildas-Des-Bois</p>"
    + "<table style=\"width:100%;border-collapse:collapse\">" + htmlRows + "</table>"
    + "<p style=\"margin-top:24px\">"
    + "<a href=\"" + BOOK_URL + "\" style=\"background:#1D9E75;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:500\">Réserver sur Abaseo</a>"
    + "</p></div>";

  const body = JSON.stringify({
    from: "monitor@qa-craftlab.com",
    to: emailTo,
    subject: "Créneau dispo chez Fanny Joly — " + slots.map((s) => formatDate(s.date)).join(", "),
    text: "Créneaux disponibles :\n\n" + lines + "\n\n👉 " + BOOK_URL,
    html: html,
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.resend.com",
      path: "/emails",
      method: "POST",
      headers: {
        "Authorization": "Bearer " + resendKey,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => { console.log("Mail envoyé :", d); resolve(); });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────
(async () => {
  console.log("[" + new Date().toISOString() + "] Vérification créneaux...");

  const now = new Date();
  const mondayThisWeek = getMondayOf(now);
  const mondayNextWeek = getMondayOf(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));

  // Toujours 2 requêtes : semaine courante + semaine suivante
  const fromSet = [mondayThisWeek.toISOString()];
  if (mondayNextWeek.toISOString() !== mondayThisWeek.toISOString()) {
    fromSet.push(mondayNextWeek.toISOString());
  }

  const allSlots = [];
  for (const from of fromSet) {
    console.log("  Scan semaine du " + formatDate(from) + "...");
    const slots = await checkSlotsForWeek(from);
    allSlots.push(...slots);
    if (fromSet.indexOf(from) < fromSet.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // Filtrer sur la fenêtre [aujourd'hui, aujourd'hui + 7j]
  const filtered = filterWindow(allSlots);

  if (filtered.length === 0) {
    console.log("Aucun créneau dans les 7 prochains jours.");
    process.exit(0);
  }

  console.log("Créneaux trouvés :", JSON.stringify(filtered));
  await sendMail(filtered);
  console.log("Notification envoyée !");
})();
