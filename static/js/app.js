(() => {
  const META_BY_DOW = { 1: 510, 2: 510, 3: 510, 4: 510, 5: 450, 6: 0, 7: 0 };
  const DEFAULT_TIPOS = [
    { nombre: "Ticket", clase: "Gestion", requiereNumero: true, requiereAsunto: true, sistema: true, activo: true },
    { nombre: "Pausa", clase: "Pausa", requiereNumero: false, requiereAsunto: true, sistema: true, activo: true },
    { nombre: "Reunión", clase: "Gestion", requiereNumero: false, requiereAsunto: true, sistema: true, activo: true },
  ];

  let state = {
    usuarios: [],
    tickets: [],
    actividades: [],
    tipos: [],
    config: { metaSemanal: 2490, almuerzo: 60, jornada: META_BY_DOW },
  };

  let chartWeek;
  let chartCasos;
  let adminUnlocked = false;
  let adminCurrentTab = "usuarios";
  let adminCurrentData = null;

  // Sesión temporal de Ingeniero / Admin para corrección de tiempos
  let misRegSesion = {
    pin: null,
    usuario: null,
    rol: null,
    tickets: [],
    actividades: [],
  };

  const $ = (id) => document.getElementById(id);

  function nowInBogota() {
    return new Date(
      new Date().toLocaleString("en-US", { timeZone: "America/Bogota" })
    );
  }

  function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function isoTime(d) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function weekday2(d) {
    const js = d.getDay();
    return js === 0 ? 7 : js;
  }

  function startOfWeek(d) {
    const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    copy.setDate(copy.getDate() - (weekday2(copy) - 1));
    return copy;
  }

  function parseDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    const s = String(value).slice(0, 10);
    const [y, m, d] = s.split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function setStatus(kind, text, syncText) {
    const dot = $("statusDot");
    dot.className = "status-dot" + (kind === "ok" ? " ok" : kind === "err" ? " err" : "");
    $("statusText").textContent = text;
    $("lastSync").textContent = syncText || "";
  }

  function updateClock() {
    const d = nowInBogota();
    const days = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    const dayName = days[d.getDay()];
    const hours = String(d.getHours()).padStart(2, "0");
    const mins = String(d.getMinutes()).padStart(2, "0");
    const secs = String(d.getSeconds()).padStart(2, "0");
    const lbl = $("clockLabel");
    if (lbl) lbl.textContent = `${dayName} ${hours}:${mins}:${secs}`;
  }

  async function loadData() {
    setStatus("load", "Cargando registros...");
    try {
      const res = await fetch("/api/dashboard?_=" + Date.now());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      state = {
        usuarios: data.usuarios || [],
        tipos: (data.tipos && data.tipos.length ? data.tipos : DEFAULT_TIPOS).filter(t => t.activo !== false),
        config: data.config || { metaSemanal: 2490, almuerzo: 60, jornada: META_BY_DOW },
        tickets: data.tickets || [],
        actividades: data.actividades || []
      };

      populateUserFilter();
      populateTipos();
      renderAll();
      setStatus("ok", "Conectado · Base de datos SQLite activa", `Actualizado: ${isoTime(nowInBogota())}`);
    } catch (err) {
      console.error(err);
      setStatus("err", "Error al cargar datos locales", err.message);
    }
  }

  function populateUserFilter() {
    const sel = $("filterUser");
    const prev = sel.value;
    const users = state.usuarios.filter((u) => u.activo !== false);

    sel.innerHTML = '<option value="__all__">Equipo completo</option>';
    users.forEach((u) => {
      const opt = document.createElement("option");
      opt.value = u.nombre;
      opt.textContent = `${u.nombre} (${u.rol || 'Técnico'})`;
      sel.appendChild(opt);
    });
    if (users.some((u) => u.nombre === prev)) sel.value = prev;
    else sel.value = "__all__";
  }

  function populateTipos() {
    const sel = $("regTipo");
    const prev = sel.value;
    sel.innerHTML = "";
    state.tipos.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.nombre;
      opt.textContent = t.nombre;
      sel.appendChild(opt);
    });
    if (prev && state.tipos.some((t) => t.nombre === prev)) sel.value = prev;
    else if (state.tipos.length) sel.value = state.tipos[0].nombre;
    updateTipoFields();
  }

  function selectedUser() {
    const v = $("filterUser").value;
    return v === "__all__" ? null : v;
  }

  function filterByUser(list) {
    const u = selectedUser();
    if (!u) return list;
    return list.filter((r) => String(r.usuario || "").trim().toLowerCase() === u.toLowerCase());
  }

  function claseDe(tipoNombre) {
    const t = state.tipos.find((x) => x.nombre.toLowerCase() === String(tipoNombre || "").toLowerCase());
    return t ? t.clase : "Gestion";
  }

  function normTicket(n) {
    const s = String(n || "").replace(/^#/, "").trim();
    const d = s.replace(/\D/g, "");
    if (d.length >= 3 && d.length >= s.replace(/[.,]/g, "").length) return d;
    return s.toLowerCase();
  }

  function sumMin(list, pred) {
    return list.filter(pred).reduce((acc, cur) => acc + (Number(cur.minutos) || 0), 0);
  }

  function computeMetrics() {
    const today = nowInBogota();
    const todayIso = isoDate(today);
    const dow = weekday2(today);
    const metaHoyBase = state.config.jornada[dow] ?? META_BY_DOW[dow] ?? 0;
    const nUsers = Math.max(1, state.usuarios.length);
    const metaHoy = selectedUser() ? metaHoyBase : metaHoyBase * nUsers;

    const tickets = filterByUser(state.tickets);
    const acts = filterByUser(state.actividades);

    const gestionHoy =
      sumMin(tickets, (r) => r.fecha === todayIso) +
      sumMin(acts, (r) => r.fecha === todayIso && claseDe(r.tipo) === "Gestion");
    const pausaHoy = sumMin(acts, (r) => r.fecha === todayIso && claseDe(r.tipo) === "Pausa");
    const netoHoy = gestionHoy + pausaHoy;

    const weekStart = startOfWeek(today);
    const inWeek = (fecha) => {
      const d = parseDate(fecha);
      if (!d) return false;
      const t0 = d.getTime();
      return t0 >= weekStart.getTime() && t0 <= new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    };

    const gestionSem =
      sumMin(tickets, (r) => inWeek(r.fecha)) +
      sumMin(acts, (r) => inWeek(r.fecha) && claseDe(r.tipo) === "Gestion");
    const pausaSem = sumMin(acts, (r) => inWeek(r.fecha) && claseDe(r.tipo) === "Pausa");
    const netoSem = gestionSem + pausaSem;
    const metaSemanaVista = selectedUser() ? state.config.metaSemanal : state.config.metaSemanal * nUsers;

    const days = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      const iso = isoDate(d);
      const meta = state.config.jornada[i + 1] ?? META_BY_DOW[i + 1];
      const metaVista = selectedUser() ? meta : meta * nUsers;
      const gestion =
        sumMin(tickets, (r) => r.fecha === iso) +
        sumMin(acts, (r) => r.fecha === iso && claseDe(r.tipo) === "Gestion");
      const pausa = sumMin(acts, (r) => r.fecha === iso && claseDe(r.tipo) === "Pausa");
      days.push({
        label: ["Lun", "Mar", "Mié", "Jue", "Vie"][i],
        meta: metaVista,
        neto: gestion + pausa,
      });
    }

    const dayNames = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
    const casosUltimos7 = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const iso = isoDate(d);
      const vistos = new Set();
      tickets.forEach((t) => {
        if (String(t.fecha || "").slice(0, 10) !== iso) return;
        const n = normTicket(t.numero);
        if (n) vistos.add(n);
      });
      casosUltimos7.push({
        label: `${dayNames[weekday2(d) - 1]} ${d.getDate()}`,
        casos: vistos.size,
      });
    }

    return {
      metaHoy,
      brutaHoy: gestionHoy,
      ocioHoy: pausaHoy,
      netoHoy,
      deficit: Math.max(0, metaHoy - netoHoy),
      excedente: Math.max(0, netoHoy - metaHoy),
      pct: metaHoy ? netoHoy / metaHoy : 0,
      brutaSem: gestionSem,
      ocioSem: pausaSem,
      netoSem,
      metaSemanaVista,
      deficitSem: Math.max(0, metaSemanaVista - netoSem),
      excedenteSem: Math.max(0, netoSem - metaSemanaVista),
      days,
      casosUltimos7,
    };
  }

  function renderKpis(m) {
    const items = [
      { label: "Meta hoy", value: m.metaHoy, cls: "" },
      { label: "Gestión (tickets)", value: m.brutaHoy, cls: "" },
      { label: "Pausas/Otras", value: m.ocioHoy, cls: "kpi--ocio" },
      { label: "Neto real", value: m.netoHoy, cls: "kpi--neto" },
      { label: "Déficit", value: m.deficit, cls: "kpi--deficit" },
      { label: "Excedente", value: m.excedente, cls: "kpi--excedente" },
    ];
    $("kpiGrid").innerHTML = items
      .map(
        (k) => `
      <article class="kpi ${k.cls}">
        <span class="kpi-label">${k.label}</span>
        <div class="kpi-value">${k.value}<small>min</small></div>
      </article>`
      )
      .join("");
  }

  function renderWeekStats(m) {
    $("weekStats").innerHTML = `
      <li><span>Meta semana</span><strong>${m.metaSemanaVista} min</strong></li>
      <li><span>Neto semana</span><strong>${m.netoSem} min</strong></li>
      <li><span>Pausas semana</span><strong>${m.ocioSem} min</strong></li>
      <li><span>Déficit acumulado</span><strong class="stat-deficit">${m.deficitSem} min</strong></li>
      <li><span>Excedente acumulado</span><strong class="stat-excedente">${m.excedenteSem} min</strong></li>
      <li><span>Cumplimiento hoy</span><strong>${Math.round(m.pct * 100)}%</strong></li>
    `;
  }

  function renderRecent() {
    const tickets = filterByUser(state.tickets).map((t) => ({
      tipo: "ticket",
      usuario: t.usuario,
      detalle: `#${t.numero} ${t.caso}${t.estado === "Cerrado" ? " · cerrado" : ""}`,
      minutos: t.minutos,
      fecha: t.fecha,
      hora: t.hora,
    }));
    const acts = filterByUser(state.actividades).map((a) => ({
      tipo: a.tipo.toLowerCase() === "pausa" ? "pausa" : "actividad",
      usuario: a.usuario,
      detalle: `${a.tipo}${a.asunto ? " · " + a.asunto : ""}`,
      minutos: a.minutos,
      fecha: a.fecha,
      hora: a.hora,
    }));
    const rows = [...tickets, ...acts]
      .sort((a, b) => `${b.fecha} ${b.hora}`.localeCompare(`${a.fecha} ${a.hora}`))
      .slice(0, 15);

    const tbody = $("recentTable").querySelector("tbody");
    tbody.innerHTML = rows
      .map(
        (r) => `
      <tr>
        <td><span class="badge badge-${r.tipo === "ticket" ? "ticket" : "ocio"}">${escapeHtml(r.tipo)}</span></td>
        <td>${escapeHtml(r.usuario)}</td>
        <td>${escapeHtml(r.detalle)}</td>
        <td><strong>${r.minutos}</strong></td>
        <td>${r.fecha}</td>
        <td>${r.hora || ""}</td>
      </tr>`
      )
      .join("");
  }

  function renderCharts(m) {
    if (typeof Chart === "undefined") return;
    const css = getComputedStyle(document.documentElement);
    const read = (name, fallback) => (css.getPropertyValue(name) || fallback).trim();
    const blue = read("--blue-bright", "#4d8cff");
    const muted = read("--muted", "#8b9bb8");
    const grid = read("--chart-grid", "rgba(255,255,255,0.06)");
    const metaFill = document.documentElement.getAttribute("data-theme") === "light"
      ? "rgba(92, 109, 134, 0.22)"
      : "rgba(139, 155, 184, 0.25)";

    if (chartWeek) chartWeek.destroy();
    if (chartCasos) chartCasos.destroy();

    chartWeek = new Chart($("chartWeek"), {
      type: "bar",
      data: {
        labels: m.days.map((d) => d.label),
        datasets: [
          {
            label: "Meta jornada",
            data: m.days.map((d) => d.meta),
            backgroundColor: metaFill,
            borderRadius: 8,
          },
          {
            label: "Neto registrado",
            data: m.days.map((d) => d.neto),
            backgroundColor: blue,
            borderRadius: 8,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: muted } } },
        scales: {
          x: { ticks: { color: muted }, grid: { color: grid } },
          y: { ticks: { color: muted }, grid: { color: grid } },
        },
      },
    });

    const serie = m.casosUltimos7 || [];
    const fill = document.documentElement.getAttribute("data-theme") === "light"
      ? "rgba(47, 107, 255, 0.12)"
      : "rgba(77, 140, 255, 0.18)";
    chartCasos = new Chart($("chartCasos"), {
      type: "line",
      data: {
        labels: serie.map((d) => d.label),
        datasets: [
          {
            label: "Casos únicos",
            data: serie.map((d) => d.casos),
            borderColor: blue,
            backgroundColor: fill,
            fill: true,
            tension: 0.3,
            pointRadius: 4,
            pointBackgroundColor: blue,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(item) {
                const n = item.parsed.y || 0;
                return n === 1 ? "1 caso" : `${n} casos`;
              },
            },
          },
        },
        scales: {
          x: { ticks: { color: muted }, grid: { color: grid } },
          y: {
            beginAtZero: true,
            ticks: { color: muted, stepSize: 1, precision: 0 },
            grid: { color: grid },
          },
        },
      },
    });
  }

  function renderAll() {
    const m = computeMetrics();
    renderKpis(m);
    renderWeekStats(m);
    renderRecent();
    renderCharts(m);
  }

  // ----------------------------------------------------
  // CRONÓMETRO
  // ----------------------------------------------------
  let cronoSeconds = 0;
  let cronoTimer = null;
  const CRONO_TICKS_COUNT = 30;

  function initCronoTicks() {
    const g = $("cronoTicks");
    if (!g) return;
    g.innerHTML = "";
    const cx = 50, cy = 50, r = 40;
    for (let i = 0; i < CRONO_TICKS_COUNT; i++) {
      const angle = (i / CRONO_TICKS_COUNT) * 2 * Math.PI - Math.PI / 2;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", x.toFixed(2));
      circle.setAttribute("cy", y.toFixed(2));
      circle.setAttribute("r", "2.8");
      circle.setAttribute("class", "crono-tick");
      circle.setAttribute("id", `cronoTick-${i}`);
      g.appendChild(circle);
    }
  }

  function updateCronoUI() {
    const mins = Math.floor(cronoSeconds / 60);
    $("cronoDisplay").textContent = mins;
    const activeTicks = Math.min(CRONO_TICKS_COUNT, Math.floor((cronoSeconds % 3600) / 120));
    for (let i = 0; i < CRONO_TICKS_COUNT; i++) {
      const t = $(`cronoTick-${i}`);
      if (t) t.classList.toggle("is-on", i <= activeTicks);
    }
    if (mins > 0) $("regMinutos").value = mins;
  }

  function startCrono() {
    if (cronoTimer) return;
    $("cronometroBox").classList.add("is-running");
    cronoTimer = setInterval(() => {
      cronoSeconds++;
      updateCronoUI();
    }, 1000);
  }

  function stopCrono() {
    if (!cronoTimer) return;
    clearInterval(cronoTimer);
    cronoTimer = null;
    $("cronometroBox").classList.remove("is-running");
    updateCronoUI();
  }

  function resetCrono() {
    stopCrono();
    cronoSeconds = 0;
    updateCronoUI();
  }

  // ----------------------------------------------------
  // EVENTOS DEL FORMULARIO DE REGISTRO
  // ----------------------------------------------------
  function updateTipoFields() {
    const tipoVal = $("regTipo").value;
    const isTicket = tipoVal.toLowerCase() === "ticket";
    $("fieldsTicket").classList.toggle("is-hidden", !isTicket);
    $("fieldsTicketObs").classList.toggle("is-hidden", !isTicket);
    $("cronometroBox").classList.toggle("is-hidden", !isTicket);
    $("fieldsAsunto").classList.toggle("is-hidden", isTicket);
  }

  $("regTipo").addEventListener("change", updateTipoFields);

  $("regNumero").addEventListener("blur", () => {
    const num = normTicket($("regNumero").value);
    if (!num) return;
    const existing = state.tickets.find((t) => normTicket(t.numero) === num && t.caso);
    if (existing && !$("regCaso").value) {
      $("regCaso").value = existing.caso;
    }
  });

  $("btnCronoStart").addEventListener("click", startCrono);
  $("btnCronoStop").addEventListener("click", stopCrono);
  $("btnCronoReset").addEventListener("click", resetCrono);

  $("formRegistro").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("btnSubmit");
    const msg = $("formMsg");
    btn.disabled = true;
    btn.classList.add("is-loading");
    msg.textContent = "Guardando...";
    msg.className = "form-msg";

    const payload = {
      tipoActividad: $("regTipo").value,
      pin: $("regPin").value.trim(),
      minutos: Number($("regMinutos").value),
      numeroTicket: $("regNumero").value.trim(),
      nombreCaso: $("regCaso").value.trim(),
      estado: $("regEstado").value,
      observaciones: $("regObservaciones").value.trim(),
      asunto: $("regAsunto").value.trim(),
    };

    try {
      const res = await fetch("/api/registro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.mensaje || "Error al guardar el registro.");
      }

      msg.textContent = data.mensaje;
      msg.className = "form-msg ok";

      // Resetear campos
      $("regMinutos").value = "";
      $("regNumero").value = "";
      $("regCaso").value = "";
      $("regObservaciones").value = "";
      $("regAsunto").value = "";
      resetCrono();

      await loadData();
    } catch (err) {
      msg.textContent = err.message;
      msg.className = "form-msg err";
    } finally {
      btn.disabled = false;
      btn.classList.remove("is-loading");
    }
  });

  // ----------------------------------------------------
  // CONSULTA DE CASOS
  // ----------------------------------------------------
  $("formConsulta").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("casoQuery").value.trim().toLowerCase();
    const cont = $("casoResultado");
    const msg = $("casoMsg");
    if (!q) {
      msg.textContent = "Ingresa un número o término de búsqueda.";
      cont.innerHTML = "";
      return;
    }
    msg.textContent = "";

    const matched = state.tickets.filter((t) => {
      const n = normTicket(t.numero);
      const c = (t.caso || "").toLowerCase();
      return n.includes(q) || c.includes(q);
    });

    if (!matched.length) {
      cont.innerHTML = '<p class="muted">No se encontraron tickets con ese criterio.</p>';
      return;
    }

    const totalMin = matched.reduce((acc, t) => acc + (Number(t.minutos) || 0), 0);
    const first = matched[0];

    cont.innerHTML = `
      <div class="caso-card">
        <div class="caso-head">
          <h3>#${first.numero} — ${escapeHtml(first.caso || "Sin nombre")}</h3>
          <span class="badge ${first.estado === "Cerrado" ? "badge-cerrado" : "badge-abierto"}">${first.estado}</span>
        </div>
        <p style="margin:6px 0 10px;"><strong>Total acumulado por el equipo:</strong> ${totalMin} min (${(totalMin / 60).toFixed(1)} h) en ${matched.length} registros.</p>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>Fecha</th><th>Hora</th><th>Técnico</th><th>Minutos</th><th>Obs</th></tr></thead>
            <tbody>
              ${matched
                .map(
                  (t) => `
                <tr>
                  <td>${t.fecha}</td>
                  <td>${t.hora || ""}</td>
                  <td>${escapeHtml(t.usuario)}</td>
                  <td><strong>${t.minutos}</strong></td>
                  <td>${escapeHtml(t.observaciones || "—")}</td>
                </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  });

  // ----------------------------------------------------
  // MÓDULO: CORRECCIÓN Y EDICIÓN DE TIEMPOS (INGENIEROS Y ADMINS)
  // ----------------------------------------------------
  $("btnOpenMisRegistros").addEventListener("click", () => {
    $("modalMisRegistros").classList.remove("is-hidden");
    if (!misRegSesion.pin) {
      $("misRegAuthBox").classList.remove("is-hidden");
      $("misRegContentBox").classList.add("is-hidden");
      $("misRegPin").value = "";
      $("misRegAuthMsg").textContent = "";
    } else {
      cargarMisRegistrosTabla();
    }
  });

  $("btnCloseMisRegistros").addEventListener("click", () => {
    $("modalMisRegistros").classList.add("is-hidden");
    $("formEditarRegistroActivo").classList.add("is-hidden");
  });

  $("formMisRegAuth").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pin = $("misRegPin").value.trim();
    const msg = $("misRegAuthMsg");
    msg.textContent = "Verificando rol...";
    msg.className = "form-msg";

    try {
      const res = await fetch("/api/mis-registros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.mensaje || "Error de autorización.");
      }

      misRegSesion = {
        pin,
        usuario: data.usuario,
        rol: data.rol,
        tickets: data.tickets || [],
        actividades: data.actividades || [],
      };

      $("misRegAuthBox").classList.add("is-hidden");
      $("misRegContentBox").classList.remove("is-hidden");
      $("misRegUserBadge").textContent = `${data.usuario} (${data.rol})`;
      cargarMisRegistrosTabla();
    } catch (err) {
      msg.textContent = err.message;
      msg.className = "form-msg err";
    }
  });

  function cargarMisRegistrosTabla() {
    const list = [
      ...misRegSesion.tickets.map(t => ({ ...t, _tipo: 'ticket' })),
      ...misRegSesion.actividades.map(a => ({ ...a, _tipo: 'actividad' }))
    ].sort((a, b) => `${b.fecha} ${b.hora}`.localeCompare(`${a.fecha} ${a.hora}`));

    const tbody = $("misRegTable").querySelector("tbody");
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="muted" style="text-align:center;">No tienes actividades registradas aún.</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(r => `
      <tr>
        <td><span class="badge ${r._tipo === 'ticket' ? 'badge-ticket' : 'badge-ocio'}">${r._tipo === 'ticket' ? 'Ticket' : escapeHtml(r.tipo)}</span></td>
        <td>${r._tipo === 'ticket' ? `#${escapeHtml(r.numero)} ${escapeHtml(r.caso)}` : escapeHtml(r.asunto || '—')}</td>
        <td><strong style="color:var(--heading);">${r.minutos} min</strong></td>
        <td>${r.fecha}</td>
        <td>${r.hora || '—'}</td>
        <td>
          <button type="button" class="btn btn-tiny btn-primary" onclick="window.iniciarEdicionRegistro('${r._tipo}', ${r.id})">✏️ Editar</button>
        </td>
      </tr>
    `).join("");
  }

  window.iniciarEdicionRegistro = (tipo, id) => {
    const form = $("formEditarRegistroActivo");
    const msg = $("editMsg");
    msg.textContent = "";

    let r;
    if (tipo === "ticket") {
      r = misRegSesion.tickets.find(x => x.id === id);
    } else {
      r = misRegSesion.actividades.find(x => x.id === id);
    }
    if (!r) return;

    $("editRegTipo").value = tipo;
    $("editRegId").value = id;
    $("editRegMinutos").value = r.minutos;
    $("editRegFecha").value = r.fecha;
    $("editRegHora").value = r.hora || "09:00";

    const isTicket = tipo === "ticket";
    $("editFieldTicket").classList.toggle("is-hidden", !isTicket);
    $("editFieldEstado").classList.toggle("is-hidden", !isTicket);
    $("editFieldObs").classList.toggle("is-hidden", !isTicket);
    $("editFieldActividad").classList.toggle("is-hidden", isTicket);

    if (isTicket) {
      $("editRegNumero").value = r.numero || "";
      $("editRegCaso").value = r.caso || "";
      $("editRegEstado").value = r.estado || "Abierto";
      $("editRegObservaciones").value = r.observaciones || "";
    } else {
      $("editRegAsunto").value = r.asunto || "";
    }

    form.classList.remove("is-hidden");
    form.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  $("btnCancelarEdicion").addEventListener("click", () => {
    $("formEditarRegistroActivo").classList.add("is-hidden");
  });

  $("formEditarRegistroActivo").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("btnGuardarEdicion");
    const msg = $("editMsg");
    btn.disabled = true;
    msg.textContent = "Actualizando...";

    const tipo = $("editRegTipo").value;
    const id = Number($("editRegId").value);
    const payload = {
      pin: misRegSesion.pin,
      tipo,
      id,
      datos: {
        minutos: Number($("editRegMinutos").value),
        fecha: $("editRegFecha").value,
        hora: $("editRegHora").value,
        numero: $("editRegNumero").value.trim(),
        caso: $("editRegCaso").value.trim(),
        estado: $("editRegEstado").value,
        observaciones: $("editRegObservaciones").value.trim(),
        asunto: $("editRegAsunto").value.trim(),
      }
    };

    try {
      const res = await fetch("/api/editar-registro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.mensaje || "Error al actualizar.");

      msg.textContent = data.mensaje;
      msg.className = "form-msg ok";

      // Actualizar registro en sesión local
      if (tipo === "ticket") {
        const item = misRegSesion.tickets.find(x => x.id === id);
        if (item) Object.assign(item, payload.datos);
      } else {
        const item = misRegSesion.actividades.find(x => x.id === id);
        if (item) Object.assign(item, payload.datos);
      }

      cargarMisRegistrosTabla();
      await loadData();

      setTimeout(() => {
        $("formEditarRegistroActivo").classList.add("is-hidden");
      }, 1200);
    } catch (err) {
      msg.textContent = err.message;
      msg.className = "form-msg err";
    } finally {
      btn.disabled = false;
    }
  });

  // ----------------------------------------------------
  // PANEL DE ADMINISTRACIÓN (SOLO ADMINISTRADOR)
  // ----------------------------------------------------
  $("formAdminLock").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pin = $("adminPin").value.trim();
    const msg = $("adminMsg");
    msg.textContent = "Verificando permisos de administrador...";
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, accion: "listar" }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.mensaje || "PIN de administrador no reconocido.");
      }
      adminUnlocked = true;
      adminCurrentData = data;
      $("adminBody").classList.remove("is-hidden");
      $("btnAdminUnlock").classList.add("is-hidden");
      $("btnAdminLogout").classList.remove("is-hidden");
      msg.textContent = "Administración desbloqueada con éxito.";
      msg.className = "form-msg ok";
      renderAdminTab();
    } catch (err) {
      msg.textContent = err.message;
      msg.className = "form-msg err";
    }
  });

  $("btnAdminLogout").addEventListener("click", () => {
    adminUnlocked = false;
    adminCurrentData = null;
    $("adminPin").value = "";
    $("adminBody").classList.add("is-hidden");
    $("btnAdminUnlock").classList.remove("is-hidden");
    $("btnAdminLogout").classList.add("is-hidden");
    $("adminMsg").textContent = "";
  });

  $("adminTabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".admin-tab");
    if (!btn) return;
    $("adminTabs").querySelectorAll(".admin-tab").forEach((b) => b.classList.remove("is-on"));
    btn.classList.add("is-on");
    adminCurrentTab = btn.dataset.tab;
    renderAdminTab();
  });

  function renderAdminTab() {
    if (!adminCurrentData) return;
    const t = adminCurrentTab;
    const table = $("adminTable");
    const form = $("formAdminEdit");

    if (t === "usuarios") {
      form.innerHTML = `
        <input type="hidden" id="admUserId" />
        <div class="form-row">
          <label>Nombre<input type="text" id="admUserNombre" required /></label>
          <label>Rol
            <select id="admUserRol">
              <option value="Administrador">Administrador (Total)</option>
              <option value="Ingeniero">Ingeniero (Corregir tiempos)</option>
              <option value="Técnico">Técnico (Solo registro)</option>
            </select>
          </label>
          <label>PIN (Contraseña)
            <input type="password" id="admUserPin" placeholder="•••• (En blanco para no cambiar)" autocomplete="off" />
          </label>
          <label class="check" style="margin-top:22px;"><input type="checkbox" id="admUserActivo" checked /> Usuario Activo</label>
        </div>
        <div class="form-row">
          <label class="grow">Notas / Cargo<input type="text" id="admUserNotas" placeholder="Notas de rol o departamento" /></label>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-primary" id="btnSaveUser" onclick="window.saveAdminItem('usuarios')">Guardar Usuario</button>
          <button type="button" class="btn btn-secondary is-hidden" id="btnCancelEditUser" onclick="window.cancelAdminEdit('usuarios')">Cancelar Edición</button>
        </div>
      `;
      table.innerHTML = `
        <thead><tr><th>Nombre</th><th>Rol</th><th>PIN</th><th>Activo</th><th>Notas</th><th>Acciones</th></tr></thead>
        <tbody>
          ${(adminCurrentData.usuarios || [])
            .map(
              (u) => `
            <tr>
              <td><strong>${escapeHtml(u.nombre)}</strong></td>
              <td><span class="badge ${u.rol === 'Administrador' ? 'badge-ticket' : u.rol === 'Ingeniero' ? 'badge-abierto' : 'badge-ocio'}">${escapeHtml(u.rol)}</span></td>
              <td><span style="letter-spacing:2px; font-weight:bold;">••••</span></td>
              <td>${u.activo}</td>
              <td>${escapeHtml(u.notas || "—")}</td>
              <td>
                <button type="button" class="btn btn-tiny btn-primary" onclick="window.editAdminUser(${u.id})">✏️ Editar</button>
                <button type="button" class="btn btn-tiny btn-danger" onclick="window.deleteAdminItem('usuarios', ${u.id})">🗑️ Borrar</button>
              </td>
            </tr>`
            )
            .join("")}
        </tbody>
      `;
    } else if (t === "tipos") {
      form.innerHTML = `
        <input type="hidden" id="admTipoId" />
        <div class="form-row">
          <label>Nombre del Tipo<input type="text" id="admTipoNombre" required /></label>
          <label>Clase
            <select id="admTipoClase"><option value="Gestion">Gestion</option><option value="Pausa">Pausa</option></select>
          </label>
          <label class="check" style="margin-top:22px;"><input type="checkbox" id="admTipoReqNum" /> Requiere Nº Ticket</label>
          <label class="check" style="margin-top:22px;"><input type="checkbox" id="admTipoReqAsu" checked /> Requiere Asunto</label>
          <label class="check" style="margin-top:22px;"><input type="checkbox" id="admTipoActivo" checked /> Activo</label>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-primary" id="btnSaveTipo" onclick="window.saveAdminItem('tipos')">Guardar Tipo</button>
          <button type="button" class="btn btn-secondary is-hidden" id="btnCancelEditTipo" onclick="window.cancelAdminEdit('tipos')">Cancelar Edición</button>
        </div>
      `;
      table.innerHTML = `
        <thead><tr><th>Nombre</th><th>Clase</th><th>Req Nº</th><th>Req Asunto</th><th>Sistema</th><th>Activo</th><th>Acciones</th></tr></thead>
        <tbody>
          ${(adminCurrentData.tipos || [])
            .map(
              (x) => `
            <tr>
              <td><strong>${escapeHtml(x.nombre)}</strong></td>
              <td>${x.clase}</td>
              <td>${x.requiere_numero}</td>
              <td>${x.requiere_asunto}</td>
              <td>${x.sistema}</td>
              <td>${x.activo}</td>
              <td>
                <button type="button" class="btn btn-tiny btn-primary" onclick="window.editAdminTipo(${x.id})">✏️ Editar</button>
                ${x.sistema !== "Sí" ? `<button type="button" class="btn btn-tiny btn-danger" onclick="window.deleteAdminItem('tipos', ${x.id})">🗑️ Borrar</button>` : '<span class="muted" style="font-size:11px;">(Sistema)</span>'}
              </td>
            </tr>`
            )
            .join("")}
        </tbody>
      `;
    } else if (t === "jornada") {
      form.innerHTML = "";
      table.innerHTML = `
        <thead><tr><th>Día</th><th>Minutos Laborales</th><th>Horas Equivalentes</th><th>Activo</th><th>Acción</th></tr></thead>
        <tbody>
          ${(adminCurrentData.jornada || [])
            .map(
              (j) => `
            <tr>
              <td><strong>${j.dia}</strong></td>
              <td><input type="number" id="jornadaMin-${j.codigo}" value="${j.minutos}" style="width:90px;" /> min</td>
              <td>${j.horas} h</td>
              <td>
                <select id="jornadaAct-${j.codigo}">
                  <option value="Sí" ${j.activo === "Sí" ? "selected" : ""}>Sí</option>
                  <option value="No" ${j.activo === "No" ? "selected" : ""}>No</option>
                </select>
              </td>
              <td>
                <button type="button" class="btn btn-tiny btn-primary" onclick="window.saveJornadaItem(${j.codigo})">Guardar</button>
              </td>
            </tr>`
            )
            .join("")}
        </tbody>
      `;
    } else if (t === "tickets") {
      form.innerHTML = "";
      table.innerHTML = `
        <thead><tr><th>ID</th><th>Fecha</th><th>Técnico</th><th>Nº</th><th>Caso</th><th>Min</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>
          ${(adminCurrentData.tickets || [])
            .slice(0, 50)
            .map(
              (tk) => `
            <tr>
              <td>${tk.id}</td>
              <td>${tk.fecha}</td>
              <td>${escapeHtml(tk.usuario)}</td>
              <td>#${escapeHtml(tk.numero)}</td>
              <td>${escapeHtml(tk.caso)}</td>
              <td><strong>${tk.minutos} min</strong></td>
              <td><span class="badge ${tk.estado === 'Cerrado' ? 'badge-cerrado' : 'badge-abierto'}">${tk.estado}</span></td>
              <td>
                <button type="button" class="btn btn-tiny btn-primary" onclick="window.editAdminTicket(${tk.id})">✏️ Editar</button>
                <button type="button" class="btn btn-tiny btn-danger" onclick="window.deleteAdminItem('tickets', ${tk.id})">🗑️ Borrar</button>
              </td>
            </tr>`
            )
            .join("")}
        </tbody>
      `;
    } else if (t === "actividades") {
      form.innerHTML = "";
      table.innerHTML = `
        <thead><tr><th>ID</th><th>Fecha</th><th>Técnico</th><th>Tipo</th><th>Asunto</th><th>Min</th><th>Acciones</th></tr></thead>
        <tbody>
          ${(adminCurrentData.actividades || [])
            .slice(0, 50)
            .map(
              (ac) => `
            <tr>
              <td>${ac.id}</td>
              <td>${ac.fecha}</td>
              <td>${escapeHtml(ac.usuario)}</td>
              <td>${escapeHtml(ac.tipo)}</td>
              <td>${escapeHtml(ac.asunto)}</td>
              <td><strong>${ac.minutos} min</strong></td>
              <td>
                <button type="button" class="btn btn-tiny btn-primary" onclick="window.editAdminActividad(${ac.id})">✏️ Editar</button>
                <button type="button" class="btn btn-tiny btn-danger" onclick="window.deleteAdminItem('actividades', ${ac.id})">🗑️ Borrar</button>
              </td>
            </tr>`
            )
            .join("")}
        </tbody>
      `;
    } else if (t === "config") {
      form.innerHTML = `
        <div class="form-row">
          <label>Parámetro<input type="text" id="admCfgParam" required /></label>
          <label>Valor<input type="text" id="admCfgVal" required /></label>
          <label>Unidad<input type="text" id="admCfgUni" /></label>
          <label class="grow">Descripción<input type="text" id="admCfgDesc" /></label>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-primary" onclick="window.saveAdminItem('config')">Guardar Parámetro</button>
        </div>
      `;
      table.innerHTML = `
        <thead><tr><th>Parámetro</th><th>Valor</th><th>Unidad</th><th>Descripción</th></tr></thead>
        <tbody>
          ${(adminCurrentData.config || [])
            .map(
              (c) => `
            <tr>
              <td><strong>${escapeHtml(c.parametro)}</strong></td>
              <td>${escapeHtml(c.valor)}</td>
              <td>${escapeHtml(c.unidad || "")}</td>
              <td>${escapeHtml(c.descripcion || "")}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      `;
    }
  }

  // EDICIÓN EN PANEL DE ADMINISTRACIÓN
  window.editAdminUser = (id) => {
    const u = (adminCurrentData.usuarios || []).find(x => x.id === id);
    if (!u) return;
    $("admUserId").value = u.id;
    $("admUserNombre").value = u.nombre;
    $("admUserRol").value = u.rol || "Técnico";
    $("admUserPin").value = "";
    $("admUserActivo").checked = u.activo.toLowerCase() !== "no";
    $("admUserNotas").value = u.notas || "";
    $("btnSaveUser").textContent = "Actualizar Usuario";
    $("btnCancelEditUser").classList.remove("is-hidden");
    $("admUserNombre").focus();
  };

  window.editAdminTipo = (id) => {
    const t = (adminCurrentData.tipos || []).find(x => x.id === id);
    if (!t) return;
    $("admTipoId").value = t.id;
    $("admTipoNombre").value = t.nombre;
    $("admTipoClase").value = t.clase || "Gestion";
    $("admTipoReqNum").checked = t.requiere_numero.toLowerCase() === "sí";
    $("admTipoReqAsu").checked = t.requiere_asunto.toLowerCase() !== "no";
    $("admTipoActivo").checked = t.activo.toLowerCase() !== "no";
    $("btnSaveTipo").textContent = "Actualizar Tipo";
    $("btnCancelEditTipo").classList.remove("is-hidden");
    $("admTipoNombre").focus();
  };

  window.cancelAdminEdit = (tabla) => {
    renderAdminTab();
  };

  window.editAdminTicket = (id) => {
    const tk = (adminCurrentData.tickets || []).find(x => x.id === id);
    if (!tk) return;
    const nuevosMin = prompt(`Editar minutos para el Ticket #${tk.numero} (${tk.caso}):`, tk.minutos);
    if (nuevosMin === null) return;
    const minVal = Number(nuevosMin);
    if (isNaN(minVal) || minVal <= 0) {
      alert("Por favor ingresa un número de minutos válido mayor a 0.");
      return;
    }
    const nuevoObs = prompt(`Observaciones del ticket:`, tk.observaciones || "");
    window.guardarEdicionDirectaAdmin('tickets', {
      id: tk.id,
      fecha: tk.fecha,
      hora: tk.hora,
      usuario: tk.usuario,
      numero: tk.numero,
      caso: tk.caso,
      minutos: minVal,
      estado: tk.estado,
      observaciones: nuevoObs !== null ? nuevoObs : tk.observaciones
    });
  };

  window.editAdminActividad = (id) => {
    const ac = (adminCurrentData.actividades || []).find(x => x.id === id);
    if (!ac) return;
    const nuevosMin = prompt(`Editar minutos para la actividad ${ac.tipo} (${ac.asunto}):`, ac.minutos);
    if (nuevosMin === null) return;
    const minVal = Number(nuevosMin);
    if (isNaN(minVal) || minVal <= 0) {
      alert("Por favor ingresa un número de minutos válido mayor a 0.");
      return;
    }
    const nuevoAsunto = prompt(`Asunto / detalle de la actividad:`, ac.asunto || "");
    window.guardarEdicionDirectaAdmin('actividades', {
      id: ac.id,
      fecha: ac.fecha,
      hora: ac.hora,
      usuario: ac.usuario,
      tipo: ac.tipo,
      asunto: nuevoAsunto !== null ? nuevoAsunto : ac.asunto,
      minutos: minVal
    });
  };

  window.guardarEdicionDirectaAdmin = async (tabla, datos) => {
    const pin = $("adminPin").value.trim();
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, accion: "guardar", tabla, datos }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.mensaje || "Error al actualizar.");
      adminCurrentData = data;
      renderAdminTab();
      await loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  window.saveAdminItem = async (tabla) => {
    const pin = $("adminPin").value.trim();
    let datos = {};
    if (tabla === "usuarios") {
      const uid = $("admUserId").value;
      datos = {
        id: uid ? Number(uid) : null,
        nombre: $("admUserNombre").value.trim(),
        rol: $("admUserRol").value,
        pin: $("admUserPin").value.trim(),
        activo: $("admUserActivo").checked ? "Sí" : "No",
        notas: $("admUserNotas").value.trim(),
      };
    } else if (tabla === "tipos") {
      const tid = $("admTipoId").value;
      datos = {
        id: tid ? Number(tid) : null,
        nombre: $("admTipoNombre").value.trim(),
        clase: $("admTipoClase").value,
        requiereNumero: $("admTipoReqNum").checked ? "Sí" : "No",
        requiereAsunto: $("admTipoReqAsu").checked ? "Sí" : "No",
        activo: $("admTipoActivo").checked ? "Sí" : "No",
      };
    } else if (tabla === "config") {
      datos = {
        parametro: $("admCfgParam").value.trim(),
        valor: $("admCfgVal").value.trim(),
        unidad: $("admCfgUni").value.trim(),
        descripcion: $("admCfgDesc").value.trim(),
      };
    }

    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, accion: "guardar", tabla, datos }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.mensaje || "Error al guardar.");
      adminCurrentData = data;
      renderAdminTab();
      await loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  window.saveJornadaItem = async (codigo) => {
    const pin = $("adminPin").value.trim();
    const minutos = Number($(`jornadaMin-${codigo}`).value);
    const activo = $(`jornadaAct-${codigo}`).value;
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pin,
          accion: "guardar",
          tabla: "jornada",
          datos: { codigo, minutos, activo },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.mensaje || "Error al guardar jornada.");
      adminCurrentData = data;
      renderAdminTab();
      await loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  window.deleteAdminItem = async (tabla, id) => {
    if (!confirm("¿Seguro que deseas eliminar este registro?")) return;
    const pin = $("adminPin").value.trim();
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pin,
          accion: "borrar",
          tabla,
          datos: { id },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.mensaje || "Error al eliminar.");
      adminCurrentData = data;
      renderAdminTab();
      await loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  // ----------------------------------------------------
  // MANEJO DE EXPORTACIÓN A EXCEL
  // ----------------------------------------------------
  function openExportModal() {
    const sel = $("exportUsuario");
    sel.innerHTML = '<option value="__all__">Equipo completo (Todos los técnicos)</option>';
    state.usuarios.forEach((u) => {
      const opt = document.createElement("option");
      opt.value = u.nombre;
      opt.textContent = `${u.nombre} (${u.rol || 'Técnico'})`;
      sel.appendChild(opt);
    });

    const cur = selectedUser();
    if (cur) sel.value = cur;

    const today = nowInBogota();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    $("exportFechaInicio").value = isoDate(firstDay);
    $("exportFechaFin").value = isoDate(today);

    $("modalExport").classList.remove("is-hidden");
  }

  function closeExportModal() {
    $("modalExport").classList.add("is-hidden");
  }

  $("btnOpenExport").addEventListener("click", openExportModal);
  $("btnCloseExport").addEventListener("click", closeExportModal);
  $("btnCancelExport").addEventListener("click", closeExportModal);

  $("modalExport").addEventListener("click", (e) => {
    if (e.target === $("modalExport")) closeExportModal();
  });

  $("btnDownloadExport").addEventListener("click", () => {
    const usuario = $("exportUsuario").value;
    const fi = $("exportFechaInicio").value;
    const ff = $("exportFechaFin").value;

    const params = new URLSearchParams();
    if (usuario) params.set("usuario", usuario);
    if (fi) params.set("fecha_inicio", fi);
    if (ff) params.set("fecha_fin", ff);

    const downloadUrl = `/api/export/excel?${params.toString()}`;
    window.location.href = downloadUrl;
    closeExportModal();
  });

  // ----------------------------------------------------
  // TEMA Y ACTUALIZAR
  // ----------------------------------------------------
  $("btnTheme").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    document.documentElement.style.colorScheme = next;
    try { localStorage.setItem("rt_theme", next); } catch (e) {}
    renderAll();
  });

  $("filterUser").addEventListener("change", renderAll);
  $("btnRefresh").addEventListener("click", loadData);

  // Inicialización
  initCronoTicks();
  setInterval(updateClock, 1000);
  updateClock();
  loadData();
})();
