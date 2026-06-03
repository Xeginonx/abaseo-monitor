// check_slots.js — Vérifie les créneaux Abaseo (semaines à venir) et envoie un mail si dispo
const https = require("https");

const CONFIG = {
  officeId: "01934e61-5a55-7221-ab1d-1ca5190d2e24",
  practitionerId: "90aae816-a7f6-11ef-b00c-fa163ee7b3dd",
  appointmentTypeId: "01940b23-277d-7107-a963-7b9074d61110",
  nextAction: "40da493497eadff4d1d9243ce4ed01e619b1945b59",
  timezone: "Europe/Paris",
  weeksAhead: 6,
};

const ROUTER_STATE = encodeURIComponent(JSON.stringify(
  ["", {children: ["fr", {children: ["(abaseo)", {children: ["profession", {children: ["chiropracteur",
  {children: ["locality", {children: ["44530-saint-gildas-des-bois", {children: ["practitioner",
  {children: ["fanny-joly", {children: ["__PAGE__", {}, null, null]}, null, null]},
  null, null]}, null, null]}, null, null]}, null, null]}, null, null]}, null, null]}]}]
));

function getMondayISO(weeksOffset = 0) {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff + weeksOffset * 7);
  monday.setUTCHours(0, 0, 0, 0);
  return monday.toISOString();
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
        "Referer": "https://www.abaseo.fr/chiropracteur/44530-saint-gildas-des-bois/fanny-joly?officeId=" + CONFIG.officeId,
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
              const dateStr = new Date(day.date).toLocaleDateString("fr-FR", {
                weekday: "long", day: "numeric", month: "long",
              });
              available.push({ date: dateStr, slots: day.slots });
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

async function sendMail(slots) {
  const emailTo = process.env.NOTIFY_EMAIL;
  const resendKey = process.env.RESEND_API_KEY;

  if (!resendKey || !emailTo) {
    console.error("Variables RESEND_API_KEY ou NOTIFY_EMAIL manquantes !");
    process.exit(1);
  }

  const lines = slots.map((s) => "• " + s.date + " : " + s.slots.join(", ")).join("\n");
  const listItems = slots.map((s) => "<li><strong>" + s.date + "</strong> : " + s.slots.join(", ") + "</li>").join("");
  const bookUrl = "https://www.abaseo.fr/chiropracteur/44530-saint-gildas-des-bois/fanny-joly?officeId=" + CONFIG.officeId;

  const body = JSON.stringify({
    from: "monitor@qa-craftlab.com",
    to: emailTo,
    subject: "🟢 Créneau disponible chez Fanny Joly !",
    text: "Un créneau est disponible :\n\n" + lines + "\n\n👉 Réserver : " + bookUrl,
    html: "<h2 style=\"color:#1D9E75\">Créneau disponible chez Fanny Joly !</h2><ul>" + listItems + "</ul><p><a href=\"" + bookUrl + "\" style=\"background:#1D9E75;color:white;padding:10px 20px;text-decoration:none;border-radius:6px\">Réserver maintenant</a></p>",
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

(async () => {
  console.log("[" + new Date().toISOString() + "] Scan sur " + CONFIG.weeksAhead + " semaines...");

  const allSlots = [];

  for (let w = 0; w < CONFIG.weeksAhead; w++) {
    const from = getMondayISO(w);
    console.log("  Semaine +" + w + " (from " + from.substring(0, 10) + ")...");
    const slots = await checkSlotsForWeek(from);
    allSlots.push(...slots);
    if (w < CONFIG.weeksAhead - 1) await new Promise(r => setTimeout(r, 500));
  }

  if (allSlots.length === 0) {
    console.log("Aucun créneau disponible sur les " + CONFIG.weeksAhead + " prochaines semaines.");
    process.exit(0);
  }

  console.log("Créneaux trouvés :", JSON.stringify(allSlots));
  await sendMail(allSlots);
  console.log("Notification envoyée !");
})();
