/**
 * JB TIME — backend Google Apps Script (ligado al Sheet "JB TIME — Datos")
 *
 * El Sheet es la fuente oficial: usuarios, PIN, tipos, jornada y parámetros.
 * El /exec no muestra PIN. Validación solo en el servidor.
 *
 * Extensiones → Apps Script → pegar este archivo como Code.gs
 * Implementar → Aplicación web:
 *   Ejecutar como: yo
 *   Quién tiene acceso: Cualquiera
 *
 * Si getActive() falla, pega el ID de la URL del Sheet:
 *   https://docs.google.com/spreadsheets/d/ESTE_ID/edit
 */

var TZ = "America/Bogota";
var SPREADSHEET_ID = "";

function doGet() {
  var out = HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("JB TIME")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
  out.setSandboxMode(HtmlService.SandboxMode.IFRAME);
  return out;
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function book() {
  var ss = null;
  try {
    ss = SpreadsheetApp.getActive();
  } catch (e) {
    ss = null;
  }
  if (ss) return ss;
  if (SPREADSHEET_ID) return SpreadsheetApp.openById(SPREADSHEET_ID);
  throw new Error(
    "El script no está ligado al Sheet. Ábrelo desde Extensiones → Apps Script " +
      "o pega SPREADSHEET_ID en Code.gs."
  );
}

function sh(name) {
  var s = book().getSheetByName(name);
  if (!s) throw new Error("No existe la pestaña " + name + ". Ejecuta setupSheet() una vez.");
  return s;
}

function cellStr(v) {
  if (v === null || v === undefined) return "";
  if (Object.prototype.toString.call(v) === "[object Date]") {
    return Utilities.formatDate(v, TZ, "yyyy-MM-dd");
  }
  return String(v).trim();
}

function cellTime(v) {
  if (v === null || v === undefined || v === "") return "";
  if (Object.prototype.toString.call(v) === "[object Date]") {
    return Utilities.formatDate(v, TZ, "HH:mm");
  }
  return String(v).trim().substring(0, 5);
}

function toNum(v) {
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

function esSi(v) {
  var s = cellStr(v).toLowerCase();
  return s === "sí" || s === "si" || s === "true" || s === "1";
}

function leerTabla(sheetName, startCol, endCol) {
  var s = sh(sheetName);
  var last = Math.max(s.getLastRow(), 1);
  if (last < 2) return [];
  return s.getRange(2, startCol, last - 1, endCol - startCol + 1).getValues();
}

function ensureSheet(ss, name, headers, seedRows) {
  var s = ss.getSheetByName(name);
  if (!s) s = ss.insertSheet(name);
  if (s.getLastRow() < 1) {
    s.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (seedRows && seedRows.length) {
      s.getRange(2, 1, seedRows.length, headers.length).setValues(seedRows);
    }
  }
  return s;
}

/** Ejecutar una vez desde el editor: crea pestañas faltantes (jornada, config, etc.). */
function setupSheet() {
  var ss = book();
  ensureSheet(ss, "Tbl_Usuarios", ["Usuario", "PIN", "Activo", "Admin", "Notas"], [
    ["Brayan", "2811", "Sí", "Sí", "PIN personal"],
    ["Johan", "6060", "Sí", "No", "PIN personal"],
  ]);
  ensureSheet(ss, "Tbl_Tipos", ["Nombre", "Clase", "Requiere_Numero", "Requiere_Asunto", "Sistema", "Activo"], [
    ["Ticket", "Gestion", "Sí", "Sí", "Sí", "Sí"],
    ["Pausa", "Pausa", "No", "Sí", "Sí", "Sí"],
    ["Reunión", "Gestion", "No", "Sí", "Sí", "Sí"],
  ]);
  ensureSheet(ss, "Tbl_Tickets", ["ID_Ticket", "Fecha", "Usuario", "Numero_Ticket", "Nombre_Caso", "Minutos_Invertidos", "Hora", "Estado", "Observaciones"], []);
  asegurarColumnaTickets();
  ensureSheet(ss, "Tbl_Actividades", ["ID_Actividad", "Fecha", "Usuario", "Tipo_Actividad", "Asunto", "Minutos_Invertidos", "Hora"], []);
  ensureSheet(ss, "Tbl_Jornada", ["Dia_Semana", "Codigo_Dia", "Minutos_Laborales", "Horas_Equivalentes", "Activo"], [
    ["Lunes", 1, 510, 8.5, "Sí"],
    ["Martes", 2, 510, 8.5, "Sí"],
    ["Miércoles", 3, 510, 8.5, "Sí"],
    ["Jueves", 4, 510, 8.5, "Sí"],
    ["Viernes", 5, 450, 7.5, "Sí"],
    ["Sábado", 6, 0, 0, "No"],
    ["Domingo", 7, 0, 0, "No"],
  ]);
  ensureSheet(ss, "Tbl_Config", ["Parametro", "Valor", "Unidad", "Descripcion"], [
    ["Almuerzo_Estandar_Min", 60, "minutos", "Almuerzo descontado por defecto"],
    ["Meta_Semanal_Min", 2490, "minutos", "510×4 + 450"],
    ["Umbral_Alerta_Deficit", 30, "minutos", "Alerta si déficit diario > N"],
    ["Zona_Horaria", "America/Bogota", "IANA", "UTC-5 Colombia"],
  ]);
  return "Pestañas listas en " + ss.getName();
}

function leerConfig() {
  var jornada = { 1: 510, 2: 510, 3: 510, 4: 510, 5: 450, 6: 0, 7: 0 };
  var meta = 2490;
  var almuerzo = 60;
  try {
    leerTabla("Tbl_Jornada", 1, 5).forEach(function (r) {
      var codigo = toNum(r[1]);
      if (codigo >= 1 && codigo <= 7) jornada[codigo] = toNum(r[2]);
    });
  } catch (e) {}
  try {
    leerTabla("Tbl_Config", 1, 2).forEach(function (r) {
      var k = cellStr(r[0]);
      if (k === "Meta_Semanal_Min") meta = toNum(r[1]) || meta;
      if (k === "Almuerzo_Estandar_Min") almuerzo = toNum(r[1]) || almuerzo;
      if (k === "Zona_Horaria" && cellStr(r[1])) TZ = cellStr(r[1]);
    });
  } catch (e) {}
  return { metaSemanal: meta, almuerzo: almuerzo, jornada: jornada };
}

function buscarUsuarioPorPin(pin) {
  pin = String(pin || "").trim();
  var rows = leerTabla("Tbl_Usuarios", 1, 5);
  for (var i = 0; i < rows.length; i++) {
    var nombre = cellStr(rows[i][0]);
    var p = cellStr(rows[i][1]);
    var activo = cellStr(rows[i][2]).toLowerCase() !== "no";
    if (nombre && p === pin && activo) {
      return {
        nombre: nombre,
        admin: esSi(rows[i][3]),
      };
    }
  }
  return null;
}

function asegurarColumnaTickets() {
  var s = sh("Tbl_Tickets");
  if (cellStr(s.getRange(1, 8).getValue()).toLowerCase() !== "estado") {
    s.getRange(1, 8).setValue("Estado");
  }
  if (cellStr(s.getRange(1, 9).getValue()).toLowerCase() !== "observaciones") {
    s.getRange(1, 9).setValue("Observaciones");
  }
}

function normalizarNumero(n) {
  var s = String(n || "").replace(/^#/, "").replace(/\s+/g, "").trim();
  var digits = s.replace(/\D/g, "");
  if (digits.length >= 3 && digits.length >= s.replace(/[.,]/g, "").length) return digits;
  return s.toLowerCase();
}

function nombreCasoExistente(numero) {
  var n = normalizarNumero(numero);
  if (!n) return "";
  var rows = leerTabla("Tbl_Tickets", 1, 9);
  var nombre = "";
  for (var i = 0; i < rows.length; i++) {
    if (normalizarNumero(rows[i][3]) === n && cellStr(rows[i][4])) {
      nombre = cellStr(rows[i][4]);
    }
  }
  return nombre;
}

function totalMinutosCaso(numero) {
  var n = normalizarNumero(numero);
  var total = 0;
  leerTabla("Tbl_Tickets", 1, 9).forEach(function (r) {
    if (normalizarNumero(r[3]) === n) total += toNum(r[5]);
  });
  return total;
}

function getDashboardData() {
  asegurarColumnaTickets();
  var usuarios = [];
  leerTabla("Tbl_Usuarios", 1, 5).forEach(function (r) {
    if (!cellStr(r[0])) return;
    usuarios.push({
      nombre: cellStr(r[0]),
      activo: cellStr(r[2]).toLowerCase() !== "no",
      admin: esSi(r[3]),
    });
  });

  var tipos = [];
  leerTabla("Tbl_Tipos", 1, 6).forEach(function (r) {
    if (!cellStr(r[0]) || !cellStr(r[1])) return;
    tipos.push({
      nombre: cellStr(r[0]),
      clase: cellStr(r[1]),
      requiereNumero: esSi(r[2]),
      requiereAsunto: cellStr(r[3]).toLowerCase() !== "no",
      sistema: esSi(r[4]),
      activo: cellStr(r[5]).toLowerCase() !== "no",
    });
  });

  var tickets = [];
  leerTabla("Tbl_Tickets", 1, 9).forEach(function (r) {
    if (!cellStr(r[1]) && !toNum(r[5])) return;
    var est = cellStr(r[7]);
    var numero = typeof r[3] === "number" ? String(Math.round(r[3])) : cellStr(r[3]);
    tickets.push({
      id: toNum(r[0]),
      fecha: cellStr(r[1]),
      usuario: cellStr(r[2]),
      numero: numero,
      caso: cellStr(r[4]),
      minutos: toNum(r[5]),
      hora: cellTime(r[6]),
      estado: est.toLowerCase() === "cerrado" ? "Cerrado" : "Abierto",
      observaciones: cellStr(r[8]),
    });
  });

  var actividades = [];
  leerTabla("Tbl_Actividades", 1, 7).forEach(function (r) {
    if (!cellStr(r[1]) && !toNum(r[5])) return;
    actividades.push({
      id: toNum(r[0]),
      fecha: cellStr(r[1]),
      usuario: cellStr(r[2]),
      tipo: cellStr(r[3]),
      asunto: cellStr(r[4]),
      minutos: toNum(r[5]),
      hora: cellTime(r[6]),
    });
  });

  return {
    generatedAt: new Date().toISOString(),
    usuarios: usuarios,
    tipos: tipos,
    config: leerConfig(),
    tickets: tickets,
    actividades: actividades,
  };
}

function nextId() {
  return Number(Utilities.formatDate(new Date(), TZ, "yyMMddHHmmss"));
}

function registrar(payload) {
  var user = buscarUsuarioPorPin(payload.pin);
  if (!user) return { ok: false, mensaje: "PIN no reconocido." };
  var minutos = toNum(payload.minutos);
  if (minutos <= 0) return { ok: false, mensaje: "Minutos inválidos." };

  var now = new Date();
  var fecha = Utilities.formatDate(now, TZ, "yyyy-MM-dd");
  var hora = Utilities.formatDate(now, TZ, "HH:mm");
  var id = nextId();
  var tipo = String(payload.tipoActividad || "").trim();

  if (tipo === "Ticket") {
    asegurarColumnaTickets();
    var numero = normalizarNumero(payload.numeroTicket);
    if (!numero) return { ok: false, mensaje: "Indica el número de ticket." };
    var estado = String(payload.estado || "Abierto").trim();
    if (estado.toLowerCase() === "cerrado") estado = "Cerrado";
    else estado = "Abierto";
    var nombreCaso = String(payload.nombreCaso || "").trim() || nombreCasoExistente(numero) || "Sin nombre";
    var observaciones = String(payload.observaciones || "").trim();
    sh("Tbl_Tickets").appendRow([
      id,
      fecha,
      user.nombre,
      numero,
      nombreCaso,
      minutos,
      hora,
      estado,
      observaciones,
    ]);
    var total = totalMinutosCaso(numero);
    return {
      ok: true,
      usuario: user.nombre,
      mensaje:
        "Guardado como " +
        user.nombre +
        " (" +
        minutos +
        " min) · caso #" +
        numero +
        " " +
        estado +
        ". Total " +
        total +
        " min.",
    };
  } else {
    sh("Tbl_Actividades").appendRow([
      id,
      fecha,
      user.nombre,
      tipo || "Pausa",
      payload.asunto || "",
      minutos,
      hora,
    ]);
  }

  return {
    ok: true,
    usuario: user.nombre,
    mensaje: "Guardado como " + user.nombre + " (" + minutos + " min).",
  };
}

function crearTipo(payload) {
  var user = buscarUsuarioPorPin(payload.pin);
  if (!user || !user.admin) {
    return { ok: false, mensaje: "Solo el usuario admin puede crear tipos." };
  }
  var nombre = String(payload.nombre || "").trim();
  var clase = String(payload.clase || "Gestion").trim();
  if (!nombre) return { ok: false, mensaje: "Indica un nombre." };

  var existentes = leerTabla("Tbl_Tipos", 1, 1);
  for (var i = 0; i < existentes.length; i++) {
    if (cellStr(existentes[i][0]).toLowerCase() === nombre.toLowerCase()) {
      return { ok: false, mensaje: "Ese tipo ya existe." };
    }
  }

  sh("Tbl_Tipos").appendRow([nombre, clase, "No", "Sí", "No", "Sí"]);
  return { ok: true, mensaje: "Tipo “" + nombre + "” creado." };
}

function siNo(v) {
  if (v === true || v === 1 || v === "1") return "Sí";
  var s = cellStr(v).toLowerCase();
  if (s === "sí" || s === "si" || s === "true" || s === "on") return "Sí";
  return "No";
}

function filaPorClave(sheetName, col, valor, asNum) {
  var s = sh(sheetName);
  var last = s.getLastRow();
  if (last < 2) return -1;
  var vals = s.getRange(2, col, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (asNum) {
      if (cellStr(vals[i][0]) !== "" && toNum(vals[i][0]) === toNum(valor)) return i + 2;
    } else if (cellStr(vals[i][0]).toLowerCase() === cellStr(valor).toLowerCase()) {
      return i + 2;
    }
  }
  return -1;
}

function adminsActivos(exceptoNombre) {
  var n = 0;
  leerTabla("Tbl_Usuarios", 1, 5).forEach(function (r) {
    if (!cellStr(r[0])) return;
    if (exceptoNombre && cellStr(r[0]).toLowerCase() === cellStr(exceptoNombre).toLowerCase()) return;
    if (cellStr(r[2]).toLowerCase() !== "no" && esSi(r[3])) n++;
  });
  return n;
}

function recalcMetaSemanal() {
  var sum = 0;
  leerTabla("Tbl_Jornada", 1, 5).forEach(function (r) {
    if (cellStr(r[4]).toLowerCase() !== "no") sum += toNum(r[2]);
  });
  var row = filaPorClave("Tbl_Config", 1, "Meta_Semanal_Min", false);
  if (row > 0) sh("Tbl_Config").getRange(row, 2).setValue(sum);
  return sum;
}

function listarAdmin() {
  asegurarColumnaTickets();
  var usuarios = [];
  leerTabla("Tbl_Usuarios", 1, 5).forEach(function (r) {
    if (!cellStr(r[0])) return;
    usuarios.push({
      nombre: cellStr(r[0]),
      pin: cellStr(r[1]),
      activo: cellStr(r[2]).toLowerCase() !== "no",
      admin: esSi(r[3]),
      notas: cellStr(r[4]),
    });
  });
  var tipos = [];
  leerTabla("Tbl_Tipos", 1, 6).forEach(function (r) {
    if (!cellStr(r[0])) return;
    tipos.push({
      nombre: cellStr(r[0]),
      clase: cellStr(r[1]) || "Gestion",
      requiereNumero: esSi(r[2]),
      requiereAsunto: cellStr(r[3]).toLowerCase() !== "no",
      sistema: esSi(r[4]),
      activo: cellStr(r[5]).toLowerCase() !== "no",
    });
  });
  var jornada = [];
  leerTabla("Tbl_Jornada", 1, 5).forEach(function (r) {
    jornada.push({
      dia: cellStr(r[0]),
      codigo: toNum(r[1]),
      minutos: toNum(r[2]),
      horas: toNum(r[3]),
      activo: cellStr(r[4]).toLowerCase() !== "no",
    });
  });
  var config = [];
  var sCfg = sh("Tbl_Config");
  var lastCfg = sCfg.getLastRow();
  if (lastCfg >= 2) {
    sCfg.getRange(2, 1, lastCfg - 1, 4).getValues().forEach(function (r) {
      if (!cellStr(r[0])) return;
      config.push({
        parametro: cellStr(r[0]),
        valor: cellStr(r[1]),
        unidad: cellStr(r[2]),
        descripcion: cellStr(r[3]),
      });
    });
  }
  var dash = getDashboardData();
  return {
    ok: true,
    usuarios: usuarios,
    tipos: tipos,
    tickets: dash.tickets,
    actividades: dash.actividades,
    jornada: jornada,
    config: config,
  };
}

function adminUsuarios(accion, d) {
  var s = sh("Tbl_Usuarios");
  var nombre = cellStr(d.nombre);
  var clave = cellStr(d.clave || d.nombreOriginal || nombre);
  if (accion === "borrar") {
    var rowDel = filaPorClave("Tbl_Usuarios", 1, clave, false);
    if (rowDel < 0) return { ok: false, mensaje: "Usuario no encontrado." };
    if (adminsActivos(clave) < 1 && esSi(s.getRange(rowDel, 4).getValue())) {
      return { ok: false, mensaje: "No puedes borrar al último admin." };
    }
    s.deleteRow(rowDel);
    return { ok: true, mensaje: "Usuario eliminado. Los registros viejos conservan el nombre." };
  }
  if (accion !== "guardar") return { ok: false, mensaje: "Acción no válida." };
  if (!nombre) return { ok: false, mensaje: "Indica el nombre de usuario." };
  var pin = cellStr(d.pin);
  if (!pin) return { ok: false, mensaje: "Indica el PIN." };
  var row = clave ? filaPorClave("Tbl_Usuarios", 1, clave, false) : -1;
  var rows = leerTabla("Tbl_Usuarios", 1, 5);
  for (var i = 0; i < rows.length; i++) {
    var sheetRow = i + 2;
    if (sheetRow === row) continue;
    if (cellStr(rows[i][0]).toLowerCase() === nombre.toLowerCase()) {
      return { ok: false, mensaje: "Ese usuario ya existe." };
    }
    if (cellStr(rows[i][1]) === pin) {
      return { ok: false, mensaje: "Ese PIN ya está asignado." };
    }
  }
  var activo = siNo(d.activo);
  var esAdmin = siNo(d.admin);
  if (row > 0 && esAdmin === "No" && adminsActivos(clave) < 1 && esSi(s.getRange(row, 4).getValue())) {
    return { ok: false, mensaje: "Debe quedar al menos un admin activo." };
  }
  if (row > 0 && activo === "No" && esSi(s.getRange(row, 4).getValue()) && adminsActivos(clave) < 1) {
    return { ok: false, mensaje: "No puedes desactivar al último admin." };
  }
  var valores = [nombre, pin, activo, esAdmin, cellStr(d.notas)];
  if (row > 0) s.getRange(row, 1, 1, 5).setValues([valores]);
  else s.appendRow(valores);
  return { ok: true, mensaje: "Usuario guardado." };
}

function adminTipos(accion, d) {
  var s = sh("Tbl_Tipos");
  var nombre = cellStr(d.nombre);
  var clave = cellStr(d.clave || d.nombreOriginal || nombre);
  var row = clave ? filaPorClave("Tbl_Tipos", 1, clave, false) : -1;
  if (accion === "borrar") {
    if (row < 0) return { ok: false, mensaje: "Tipo no encontrado." };
    if (esSi(s.getRange(row, 5).getValue())) {
      return { ok: false, mensaje: "Los tipos de sistema no se borran. Puedes desactivarlos." };
    }
    s.deleteRow(row);
    return { ok: true, mensaje: "Tipo eliminado." };
  }
  if (accion !== "guardar") return { ok: false, mensaje: "Acción no válida." };
  if (!nombre) return { ok: false, mensaje: "Indica el nombre del tipo." };
  var rows = leerTabla("Tbl_Tipos", 1, 1);
  for (var i = 0; i < rows.length; i++) {
    if (i + 2 === row) continue;
    if (cellStr(rows[i][0]).toLowerCase() === nombre.toLowerCase()) {
      return { ok: false, mensaje: "Ese tipo ya existe." };
    }
  }
  var clase = cellStr(d.clase) || "Gestion";
  if (clase.toLowerCase() === "pausa") clase = "Pausa";
  else clase = "Gestion";
  var sistema = row > 0 ? siNo(s.getRange(row, 5).getValue()) : "No";
  var valores = [
    nombre,
    clase,
    siNo(d.requiereNumero),
    siNo(d.requiereAsunto !== false && d.requiereAsunto !== "No"),
    sistema,
    siNo(d.activo !== false && d.activo !== "No"),
  ];
  if (row > 0) s.getRange(row, 1, 1, 6).setValues([valores]);
  else s.appendRow(valores);
  return { ok: true, mensaje: "Tipo guardado." };
}

function adminTickets(accion, d) {
  asegurarColumnaTickets();
  var s = sh("Tbl_Tickets");
  var id = toNum(d.id);
  var row = id ? filaPorClave("Tbl_Tickets", 1, id, true) : -1;
  if (accion === "borrar") {
    if (row < 0) return { ok: false, mensaje: "Registro de ticket no encontrado." };
    s.deleteRow(row);
    return { ok: true, mensaje: "Registro de ticket eliminado." };
  }
  if (accion !== "guardar") return { ok: false, mensaje: "Acción no válida." };
  var minutos = toNum(d.minutos);
  if (minutos <= 0) return { ok: false, mensaje: "Minutos inválidos." };
  var numero = normalizarNumero(d.numero || d.numeroTicket);
  var estado = cellStr(d.estado).toLowerCase() === "cerrado" ? "Cerrado" : "Abierto";
  var valores = [
    id || nextId(),
    cellStr(d.fecha),
    cellStr(d.usuario),
    numero,
    cellStr(d.caso || d.nombreCaso),
    minutos,
    cellStr(d.hora).substring(0, 5),
    estado,
    cellStr(d.observaciones),
  ];
  if (!valores[1]) return { ok: false, mensaje: "Indica la fecha (YYYY-MM-DD)." };
  if (!valores[2]) return { ok: false, mensaje: "Indica el usuario." };
  if (row > 0) s.getRange(row, 1, 1, 9).setValues([valores]);
  else s.appendRow(valores);
  return { ok: true, mensaje: "Ticket guardado." };
}

function adminActividades(accion, d) {
  var s = sh("Tbl_Actividades");
  var id = toNum(d.id);
  var row = id ? filaPorClave("Tbl_Actividades", 1, id, true) : -1;
  if (accion === "borrar") {
    if (row < 0) return { ok: false, mensaje: "Registro no encontrado." };
    s.deleteRow(row);
    return { ok: true, mensaje: "Actividad eliminada." };
  }
  if (accion !== "guardar") return { ok: false, mensaje: "Acción no válida." };
  var minutos = toNum(d.minutos);
  if (minutos <= 0) return { ok: false, mensaje: "Minutos inválidos." };
  var valores = [
    id || nextId(),
    cellStr(d.fecha),
    cellStr(d.usuario),
    cellStr(d.tipo) || "Pausa",
    cellStr(d.asunto),
    minutos,
    cellStr(d.hora).substring(0, 5),
  ];
  if (!valores[1]) return { ok: false, mensaje: "Indica la fecha (YYYY-MM-DD)." };
  if (!valores[2]) return { ok: false, mensaje: "Indica el usuario." };
  if (row > 0) s.getRange(row, 1, 1, 7).setValues([valores]);
  else s.appendRow(valores);
  return { ok: true, mensaje: "Actividad guardada." };
}

function adminJornada(accion, d) {
  if (accion !== "guardar") return { ok: false, mensaje: "La jornada se edita, no se borra." };
  var codigo = toNum(d.codigo);
  var row = filaPorClave("Tbl_Jornada", 2, codigo, true);
  if (row < 0) return { ok: false, mensaje: "Día no encontrado." };
  var minutos = Math.max(0, toNum(d.minutos));
  var horas = Math.round((minutos / 60) * 100) / 100;
  sh("Tbl_Jornada").getRange(row, 1, 1, 5).setValues([[
    cellStr(d.dia) || sh("Tbl_Jornada").getRange(row, 1).getValue(),
    codigo,
    minutos,
    horas,
    siNo(d.activo),
  ]]);
  var meta = recalcMetaSemanal();
  return { ok: true, mensaje: "Jornada actualizada. Meta semanal = " + meta + " min." };
}

function adminConfig(accion, d) {
  var s = sh("Tbl_Config");
  var parametro = cellStr(d.parametro);
  var clave = cellStr(d.clave || d.parametroOriginal || parametro);
  var row = clave ? filaPorClave("Tbl_Config", 1, clave, false) : -1;
  if (accion === "borrar") {
    if (row < 0) return { ok: false, mensaje: "Parámetro no encontrado." };
    var p = cellStr(s.getRange(row, 1).getValue());
    if (p === "Zona_Horaria" || p === "Meta_Semanal_Min") {
      return { ok: false, mensaje: "Ese parámetro no se borra. Puedes editar su valor." };
    }
    s.deleteRow(row);
    return { ok: true, mensaje: "Parámetro eliminado." };
  }
  if (accion !== "guardar") return { ok: false, mensaje: "Acción no válida." };
  if (!parametro) return { ok: false, mensaje: "Indica el nombre del parámetro." };
  var valores = [parametro, cellStr(d.valor), cellStr(d.unidad), cellStr(d.descripcion)];
  if (row > 0) s.getRange(row, 1, 1, 4).setValues([valores]);
  else s.appendRow(valores);
  return { ok: true, mensaje: "Configuración guardada." };
}

/**
 * Administración del Sheet desde el /exec.
 * payload: { pin, accion: "listar"|"guardar"|"borrar", tabla, datos }
 */
function adminOperar(payload) {
  payload = payload || {};
  var user = buscarUsuarioPorPin(payload.pin);
  if (!user || !user.admin) {
    return { ok: false, mensaje: "Solo el PIN admin puede administrar el Sheet." };
  }
  var accion = String(payload.accion || "listar").toLowerCase();
  if (accion === "listar") return listarAdmin();
  var tabla = String(payload.tabla || "").toLowerCase();
  var d = payload.datos || {};
  var res;
  if (tabla === "usuarios") res = adminUsuarios(accion, d);
  else if (tabla === "tipos") res = adminTipos(accion, d);
  else if (tabla === "tickets") res = adminTickets(accion, d);
  else if (tabla === "actividades") res = adminActividades(accion, d);
  else if (tabla === "jornada") res = adminJornada(accion, d);
  else if (tabla === "config") res = adminConfig(accion, d);
  else return { ok: false, mensaje: "Tabla no reconocida." };
  if (!res.ok) return res;
  var out = listarAdmin();
  out.mensaje = res.mensaje;
  return out;
}
