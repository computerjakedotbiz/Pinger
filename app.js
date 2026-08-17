/* Pinger — front-end logic
   Talks to Supabase (reminders + push_subscriptions tables) and manages the Web Push subscription. */

const cfg = window.PINGER_CONFIG;
const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone; // e.g. "America/Chicago"
const DAY_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

let reminders = [];
let editingId = null;
let selectedDays = [1,2,3,4,5];

// ---------- device identity ----------
// A stable per-install id so this device's push subscription is tracked as one row.
function deviceId(){
  let id = null;
  try { id = window.name && window.name.startsWith("dev_") ? window.name : null; } catch(e){}
  if(!id){ id = "dev_" + crypto.randomUUID(); try{ window.name = id; }catch(e){} }
  return id;
}
const DEVICE = deviceId();

// ---------- service worker + push ----------
async function registerSW(){
  if(!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("./sw.js");
}

function urlBase64ToUint8Array(base64){
  const pad = "=".repeat((4 - base64.length % 4) % 4);
  const b64 = (base64 + pad).replace(/-/g,"+").replace(/_/g,"/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function enableNotifications(){
  try{
    const perm = await Notification.requestPermission();
    if(perm !== "granted"){ alert("Notifications were not allowed. On iPhone: add this app to your Home Screen first, open it from there, then tap Enable."); return; }
    const reg = await registerSW();
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(cfg.VAPID_PUBLIC_KEY)
    });
    const json = sub.toJSON();
    await sb.from("push_subscriptions").upsert({
      device_id: DEVICE,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      tz: TZ
    }, { onConflict: "device_id" });
    setStatus(true);
  }catch(e){ console.error(e); alert("Could not enable notifications: " + e.message); }
}

function setStatus(on){
  const el = document.getElementById("status");
  el.textContent = on ? "notifications on" : "notifications off";
  el.classList.toggle("on", on);
}

async function checkStatus(){
  if(!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && await reg.pushManager.getSubscription();
  setStatus(!!sub);
}

// ---------- data ----------
async function loadReminders(){
  const { data, error } = await sb.from("reminders")
    .select("*").eq("device_id", DEVICE).order("created_at");
  if(error){ console.error(error); return; }
  reminders = data || [];
  render();
}

async function saveReminder(){
  const rec = {
    device_id: DEVICE,
    emoji: val("fEmoji") || "🔔",
    label: val("fLabel") || "Reminder",
    interval_min: toMinutes(),
    window_start: val("fStart"),
    window_end: val("fEnd"),
    days: selectedDays.slice().sort(),
    tz: TZ,
    active: true
  };
  if(editingId){
    await sb.from("reminders").update(rec).eq("id", editingId);
  }else{
    await sb.from("reminders").insert(rec);
  }
  closeSheet(); await loadReminders();
}

async function toggleActive(r){
  await sb.from("reminders").update({ active: !r.active }).eq("id", r.id);
  await loadReminders();
}

async function deleteReminder(){
  if(editingId) await sb.from("reminders").delete().eq("id", editingId);
  closeSheet(); await loadReminders();
}

// ---------- rendering ----------
function fmtTime(t){ // "09:00" -> "9am", "18:30" -> "6:30pm"
  const [h,m]=t.split(":").map(Number); const ap=h<12?"am":"pm"; const hr=((h+11)%12)+1;
  return m? `${hr}:${String(m).padStart(2,"0")}${ap}` : `${hr}${ap}`;
}
function fmtEvery(min){ return min%60===0 ? `every ${min/60}h` : `every ${min} min`; }
function fmtDays(days){
  if(days.length===7) return "every day";
  if(JSON.stringify(days)===JSON.stringify([1,2,3,4,5])) return "weekdays";
  if(JSON.stringify(days)===JSON.stringify([0,6])) return "weekends";
  return days.map(d=>DAY_LABELS[d]).join(" ");
}
function render(){
  const list = document.getElementById("list");
  if(!reminders.length){ list.innerHTML = `<div class="empty">No reminders yet.<br>Tap “+ New reminder” to start 👇</div>`; return; }
  list.innerHTML = "";
  reminders.forEach(r=>{
    const card = document.createElement("div"); card.className="card";
    card.innerHTML = `
      <div class="emoji">${r.emoji}</div>
      <div class="body">
        <div class="title ${r.active?"":"off"}">${escapeHtml(r.label)}</div>
        <div class="meta">${fmtEvery(r.interval_min)} · ${fmtTime(r.window_start)}–${fmtTime(r.window_end)} · ${fmtDays(r.days)}</div>
      </div>
      <div class="toggle ${r.active?"on":""}"></div>`;
    card.querySelector(".toggle").addEventListener("click", e=>{ e.stopPropagation(); toggleActive(r); });
    card.querySelector(".body").addEventListener("click", ()=> openSheet(r));
    list.appendChild(card);
  });
}
function escapeHtml(s){ return s.replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

// ---------- editor sheet ----------
function buildDayPicker(){
  const wrap = document.getElementById("fDays"); wrap.innerHTML="";
  DAY_LABELS.forEach((lbl,i)=>{
    const el = document.createElement("div"); el.className="day"; el.textContent=lbl.charAt(0);
    el.addEventListener("click", ()=>{
      const idx = selectedDays.indexOf(i);
      if(idx>=0) selectedDays.splice(idx,1); else selectedDays.push(i);
      paintDays();
    });
    wrap.appendChild(el);
  });
}
function paintDays(){
  [...document.getElementById("fDays").children].forEach((el,i)=> el.classList.toggle("on", selectedDays.includes(i)));
}
function openSheet(r){
  editingId = r ? r.id : null;
  document.getElementById("sheetTitle").textContent = r ? "Edit reminder" : "New reminder";
  document.getElementById("delBtn").style.display = r ? "block" : "none";
  set("fEmoji", r?r.emoji:"🔔"); set("fLabel", r?r.label:"");
  const min = r?r.interval_min:60;
  if(min%60===0){ set("fEvery", min/60); set("fUnit","hour"); } else { set("fEvery", min); set("fUnit","min"); }
  set("fStart", r?r.window_start:"09:00"); set("fEnd", r?r.window_end:"18:00");
  selectedDays = r ? r.days.slice() : [1,2,3,4,5];
  paintDays();
  document.getElementById("sheetBg").classList.add("show");
  document.getElementById("sheet").classList.add("show");
}
function closeSheet(){
  document.getElementById("sheetBg").classList.remove("show");
  document.getElementById("sheet").classList.remove("show");
  editingId=null;
}
function toMinutes(){ const n=parseInt(val("fEvery")||"1",10); return val("fUnit")==="hour"? n*60 : n; }

// ---------- helpers ----------
const val = id => document.getElementById(id).value.trim();
const set = (id,v) => document.getElementById(id).value = v;

// ---------- wire up ----------
document.getElementById("enableBtn").addEventListener("click", enableNotifications);
document.getElementById("addBtn").addEventListener("click", ()=>openSheet(null));
document.getElementById("cancelBtn").addEventListener("click", closeSheet);
document.getElementById("sheetBg").addEventListener("click", closeSheet);
document.getElementById("saveBtn").addEventListener("click", saveReminder);
document.getElementById("delBtn").addEventListener("click", deleteReminder);

buildDayPicker();
registerSW();
checkStatus();
loadReminders();
