"""
Servidor Flask y API REST para Registro de Tiempos
Maneja autenticación por PIN, roles (Administrador, Ingeniero, Técnico),
almacenamiento SQLite, edición de registros, administración segura y exportación a Excel.
"""

import os
from datetime import datetime, timezone, timedelta
from flask import Flask, render_template, request, jsonify, send_file
from database import get_connection, init_db
from export_service import generar_reporte_excel

app = Flask(__name__)

# Asegurar que la base de datos esté lista
init_db()

# Zona horaria Colombia (UTC-5)
BOGOTA_TZ = timezone(timedelta(hours=-5))

def ahora_bogota():
    return datetime.now(BOGOTA_TZ)

def buscar_usuario_por_pin(pin):
    pin = str(pin or "").strip()
    if not pin:
        return None
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, nombre, pin, rol, activo, admin FROM usuarios WHERE pin = ?", (pin,))
    row = cursor.fetchone()
    conn.close()
    if row and row["activo"].lower() in ["sí", "si", "true", "1"]:
        rol = row["rol"] or ("Administrador" if row["admin"] in ["Sí", "si", "true", "1"] else "Técnico")
        es_admin = rol == "Administrador" or (row["admin"] in ["Sí", "si", "true", "1"])
        es_ingeniero = es_admin or (rol == "Ingeniero")
        return {
            "id": row["id"],
            "nombre": row["nombre"],
            "rol": rol,
            "admin": es_admin,
            "es_ingeniero": es_ingeniero
        }
    return None

def normalizar_numero(n):
    s = str(n or "").replace("#", "").strip()
    digits = "".join(filter(str.isdigit, s))
    if len(digits) >= 3 and len(digits) >= len(s.replace(".", "").replace(",", "")):
        return digits
    return s.lower()

# ----------------------------------------------------
# RUTAS DE PÁGINA
# ----------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")

# ----------------------------------------------------
# ENDPOINT: DASHBOARD (PÚBLICO / SIN EXPONER PINES)
# ----------------------------------------------------
@app.route("/api/dashboard", methods=["GET"])
def get_dashboard_data():
    conn = get_connection()
    cursor = conn.cursor()

    # Usuarios (NO se retorna el PIN por seguridad)
    cursor.execute("SELECT id, nombre, rol, activo, admin FROM usuarios")
    usuarios = [{
        "id": r["id"],
        "nombre": r["nombre"],
        "rol": r["rol"] or ("Administrador" if r["admin"] in ["Sí", "si", "true", "1"] else "Técnico"),
        "activo": r["activo"].lower() in ["sí", "si", "true", "1"],
        "admin": (r["rol"] == "Administrador") or (r["admin"].lower() in ["sí", "si", "true", "1"])
    } for r in cursor.fetchall()]

    # Tipos
    cursor.execute("SELECT id, nombre, clase, requiere_numero, requiere_asunto, sistema, activo FROM tipos")
    tipos = [{
        "id": r["id"],
        "nombre": r["nombre"],
        "clase": r["clase"],
        "requiereNumero": r["requiere_numero"].lower() in ["sí", "si", "true", "1"],
        "requiereAsunto": r["requiere_asunto"].lower() not in ["no", "false", "0"],
        "sistema": r["sistema"].lower() in ["sí", "si", "true", "1"],
        "activo": r["activo"].lower() not in ["no", "false", "0"]
    } for r in cursor.fetchall()]

    # Jornada y Config
    jornada_dict = {}
    cursor.execute("SELECT codigo_dia, minutos_laborales FROM jornada WHERE activo = 'Sí'")
    for r in cursor.fetchall():
        jornada_dict[r["codigo_dia"]] = r["minutos_laborales"]

    config_dict = {"metaSemanal": 2490, "almuerzo": 60, "jornada": jornada_dict}
    cursor.execute("SELECT parametro, valor FROM config")
    for r in cursor.fetchall():
        p = r["parametro"]
        v = r["valor"]
        if p == "Meta_Semanal_Min":
            config_dict["metaSemanal"] = int(v) if v.isdigit() else 2490
        elif p == "Almuerzo_Estandar_Min":
            config_dict["almuerzo"] = int(v) if v.isdigit() else 60

    # Tickets
    cursor.execute("""
        SELECT id, fecha, usuario, numero, caso, minutos, hora, estado, observaciones
        FROM tickets ORDER BY fecha DESC, hora DESC
    """)
    tickets = [{
        "id": r["id"],
        "fecha": r["fecha"],
        "usuario": r["usuario"],
        "numero": r["numero"],
        "caso": r["caso"] or "Sin nombre",
        "minutos": r["minutos"],
        "hora": r["hora"] or "",
        "estado": "Cerrado" if (r["estado"] or "").lower() == "cerrado" else "Abierto",
        "observaciones": r["observaciones"] or ""
    } for r in cursor.fetchall()]

    # Actividades
    cursor.execute("""
        SELECT id, fecha, usuario, tipo, asunto, minutos, hora
        FROM actividades ORDER BY fecha DESC, hora DESC
    """)
    actividades = [{
        "id": r["id"],
        "fecha": r["fecha"],
        "usuario": r["usuario"],
        "tipo": r["tipo"],
        "asunto": r["asunto"] or "",
        "minutos": r["minutos"],
        "hora": r["hora"] or ""
    } for r in cursor.fetchall()]

    conn.close()

    return jsonify({
        "generatedAt": ahora_bogota().isoformat(),
        "usuarios": usuarios,
        "tipos": tipos,
        "config": config_dict,
        "tickets": tickets,
        "actividades": actividades
    })

# ----------------------------------------------------
# ENDPOINT: REGISTRAR TIEMPO
# ----------------------------------------------------
@app.route("/api/registro", methods=["POST"])
def registrar():
    data = request.get_json() or {}
    pin = data.get("pin")
    user = buscar_usuario_por_pin(pin)
    if not user:
        return jsonify({"ok": False, "mensaje": "PIN no reconocido o usuario inactivo."}), 400

    try:
        minutos = int(data.get("minutos", 0))
    except (ValueError, TypeError):
        minutos = 0

    if minutos <= 0:
        return jsonify({"ok": False, "mensaje": "Minutos inválidos."}), 400

    now = ahora_bogota()
    fecha = now.strftime("%Y-%m-%d")
    hora = now.strftime("%H:%M")
    tipo = str(data.get("tipoActividad") or "Ticket").strip()

    conn = get_connection()
    cursor = conn.cursor()

    if tipo.lower() == "ticket":
        numero = normalizar_numero(data.get("numeroTicket"))
        if not numero:
            conn.close()
            return jsonify({"ok": False, "mensaje": "Indica el número de ticket."}), 400

        estado = "Cerrado" if str(data.get("estado", "")).lower() == "cerrado" else "Abierto"
        nombre_caso = str(data.get("nombreCaso") or "").strip()
        
        if not nombre_caso:
            cursor.execute("SELECT caso FROM tickets WHERE numero = ? AND caso != '' ORDER BY id DESC LIMIT 1", (numero,))
            prev = cursor.fetchone()
            nombre_caso = prev["caso"] if prev else "Sin nombre"

        observaciones = str(data.get("observaciones") or "").strip()

        cursor.execute("""
            INSERT INTO tickets (fecha, usuario, numero, caso, minutos, hora, estado, observaciones)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (fecha, user["nombre"], numero, nombre_caso, minutos, hora, estado, observaciones))
        conn.commit()

        cursor.execute("SELECT SUM(minutos) as total FROM tickets WHERE numero = ?", (numero,))
        tot_row = cursor.fetchone()
        total_min = tot_row["total"] or minutos
        conn.close()

        return jsonify({
            "ok": True,
            "usuario": user["nombre"],
            "mensaje": f"Guardado como {user['nombre']} ({minutos} min) · caso #{numero} {estado}. Total acumulado: {total_min} min."
        })
    else:
        asunto = str(data.get("asunto") or "").strip()
        cursor.execute("""
            INSERT INTO actividades (fecha, usuario, tipo, asunto, minutos, hora)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (fecha, user["nombre"], tipo, asunto, minutos, hora))
        conn.commit()
        conn.close()

        return jsonify({
            "ok": True,
            "usuario": user["nombre"],
            "mensaje": f"Guardado como {user['nombre']} ({minutos} min en {tipo})."
        })

# ----------------------------------------------------
# ENDPOINT: MIS REGISTROS (PARA INGENIEROS Y ADMINS)
# Permite a los ingenieros consultar sus actividades para corregirlas
# ----------------------------------------------------
@app.route("/api/mis-registros", methods=["POST"])
def mis_registros():
    data = request.get_json() or {}
    pin = data.get("pin")
    user = buscar_usuario_por_pin(pin)
    if not user:
        return jsonify({"ok": False, "mensaje": "PIN no reconocido o usuario inactivo."}), 401

    if not user["es_ingeniero"]:
        return jsonify({
            "ok": False,
            "mensaje": f"El rol actual de '{user['nombre']}' es {user['rol']}. Solo usuarios con rol Ingeniero o Administrador pueden corregir tiempos."
        }), 403

    conn = get_connection()
    cursor = conn.cursor()

    if user["admin"]:
        cursor.execute("""
            SELECT id, fecha, usuario, numero, caso, minutos, hora, estado, observaciones
            FROM tickets ORDER BY fecha DESC, hora DESC LIMIT 100
        """)
        tickets = [dict(r) for r in cursor.fetchall()]
        cursor.execute("""
            SELECT id, fecha, usuario, tipo, asunto, minutos, hora
            FROM actividades ORDER BY fecha DESC, hora DESC LIMIT 100
        """)
        actividades = [dict(r) for r in cursor.fetchall()]
    else:
        cursor.execute("""
            SELECT id, fecha, usuario, numero, caso, minutos, hora, estado, observaciones
            FROM tickets WHERE LOWER(usuario) = LOWER(?) ORDER BY fecha DESC, hora DESC LIMIT 100
        """, (user["nombre"],))
        tickets = [dict(r) for r in cursor.fetchall()]
        cursor.execute("""
            SELECT id, fecha, usuario, tipo, asunto, minutos, hora
            FROM actividades WHERE LOWER(usuario) = LOWER(?) ORDER BY fecha DESC, hora DESC LIMIT 100
        """, (user["nombre"],))
        actividades = [dict(r) for r in cursor.fetchall()]

    conn.close()

    return jsonify({
        "ok": True,
        "usuario": user["nombre"],
        "rol": user["rol"],
        "es_admin": user["admin"],
        "tickets": tickets,
        "actividades": actividades
    })

# ----------------------------------------------------
# ENDPOINT: EDITAR REGISTRO (INGENIEROS Y ADMINS)
# Permite modificar tiempos y detalles de una actividad/ticket
# ----------------------------------------------------
@app.route("/api/editar-registro", methods=["POST"])
def editar_registro():
    payload = request.get_json() or {}
    pin = payload.get("pin")
    user = buscar_usuario_por_pin(pin)
    if not user:
        return jsonify({"ok": False, "mensaje": "PIN no reconocido o usuario inactivo."}), 401

    if not user["es_ingeniero"]:
        return jsonify({"ok": False, "mensaje": "No tienes permisos para modificar tiempos."}), 403

    tipo = str(payload.get("tipo") or "").lower() # 'ticket' o 'actividad'
    rid = payload.get("id")
    datos = payload.get("datos") or {}

    if not rid:
        return jsonify({"ok": False, "mensaje": "ID de registro no especificado."}), 400

    conn = get_connection()
    cursor = conn.cursor()

    if tipo == "ticket":
        cursor.execute("SELECT usuario FROM tickets WHERE id = ?", (rid,))
        row = cursor.fetchone()
        if not row:
            conn.close()
            return jsonify({"ok": False, "mensaje": "Ticket no encontrado."}), 404

        # Ingeniero solo puede editar sus propios tickets
        if not user["admin"] and row["usuario"].lower() != user["nombre"].lower():
            conn.close()
            return jsonify({"ok": False, "mensaje": "Solo puedes editar tus propios tickets."}), 403

        minutos = int(datos.get("minutos") or 0)
        if minutos <= 0:
            conn.close()
            return jsonify({"ok": False, "mensaje": "Los minutos deben ser mayores a 0."}), 400

        fecha = str(datos.get("fecha") or ahora_bogota().strftime("%Y-%m-%d"))
        hora = str(datos.get("hora") or ahora_bogota().strftime("%H:%M"))[:5]
        numero = normalizar_numero(datos.get("numero") or datos.get("numeroTicket"))
        caso = str(datos.get("caso") or datos.get("nombreCaso") or "Sin nombre")
        estado = "Cerrado" if str(datos.get("estado")).lower() == "cerrado" else "Abierto"
        obs = str(datos.get("observaciones") or "")

        cursor.execute("""
            UPDATE tickets SET fecha=?, numero=?, caso=?, minutos=?, hora=?, estado=?, observaciones=?
            WHERE id=?
        """, (fecha, numero, caso, minutos, hora, estado, obs, rid))
        conn.commit()
        conn.close()

        return jsonify({
            "ok": True,
            "mensaje": f"Ticket #{numero} actualizado con éxito ({minutos} min)."
        })

    elif tipo == "actividad":
        cursor.execute("SELECT usuario FROM actividades WHERE id = ?", (rid,))
        row = cursor.fetchone()
        if not row:
            conn.close()
            return jsonify({"ok": False, "mensaje": "Actividad no encontrada."}), 404

        if not user["admin"] and row["usuario"].lower() != user["nombre"].lower():
            conn.close()
            return jsonify({"ok": False, "mensaje": "Solo puedes editar tus propias actividades."}), 403

        minutos = int(datos.get("minutos") or 0)
        if minutos <= 0:
            conn.close()
            return jsonify({"ok": False, "mensaje": "Los minutos deben ser mayores a 0."}), 400

        fecha = str(datos.get("fecha") or ahora_bogota().strftime("%Y-%m-%d"))
        hora = str(datos.get("hora") or ahora_bogota().strftime("%H:%M"))[:5]
        tipo_act = str(datos.get("tipo") or "Pausa")
        asunto = str(datos.get("asunto") or "")

        cursor.execute("""
            UPDATE actividades SET fecha=?, tipo=?, asunto=?, minutos=?, hora=?
            WHERE id=?
        """, (fecha, tipo_act, asunto, minutos, hora, rid))
        conn.commit()
        conn.close()

        return jsonify({
            "ok": True,
            "mensaje": f"Actividad ({tipo_act}) actualizada con éxito ({minutos} min)."
        })

    conn.close()
    return jsonify({"ok": False, "mensaje": "Tipo de registro no válido."}), 400

# ----------------------------------------------------
# ENDPOINT: ADMINISTRACIÓN COMPLETA (SOLO ADMINS)
# Permite modificar usuarios, tipos, jornada, config, etc.
# NUNCA expone los pines en texto plano.
# ----------------------------------------------------
@app.route("/api/admin", methods=["POST"])
def admin_operar():
    payload = request.get_json() or {}
    pin = payload.get("pin")
    user = buscar_usuario_por_pin(pin)
    if not user or not user["admin"]:
        return jsonify({"ok": False, "mensaje": "Solo el PIN de administrador puede realizar estas operaciones."}), 403

    accion = str(payload.get("accion") or "listar").lower()
    tabla = str(payload.get("tabla") or "").lower()
    d = payload.get("datos") or {}

    conn = get_connection()
    cursor = conn.cursor()

    if accion == "guardar":
        if tabla == "usuarios":
            nombre = str(d.get("nombre") or "").strip()
            upin = str(d.get("pin") or "").strip()
            rol = str(d.get("rol") or "Técnico").strip()
            if rol not in ["Administrador", "Ingeniero", "Técnico"]:
                rol = "Técnico"

            activo = "Sí" if str(d.get("activo", "Sí")).lower() in ["sí", "si", "true", "on", "1"] else "No"
            admin = "Sí" if rol == "Administrador" else "No"
            notas = str(d.get("notas") or "")
            uid = d.get("id")

            if uid:
                # Si no se pasó un nuevo PIN (o se pasó enmascarado), NO sobreescribir el existente
                if not upin or upin in ["••••", "****", ""]:
                    cursor.execute("""
                        UPDATE usuarios SET nombre=?, rol=?, activo=?, admin=?, notas=? WHERE id=?
                    """, (nombre, rol, activo, admin, notas, uid))
                else:
                    cursor.execute("""
                        UPDATE usuarios SET nombre=?, pin=?, rol=?, activo=?, admin=?, notas=? WHERE id=?
                    """, (nombre, upin, rol, activo, admin, notas, uid))
            else:
                if not upin or upin in ["••••", "****"]:
                    conn.close()
                    return jsonify({"ok": False, "mensaje": "El PIN es obligatorio para crear un nuevo usuario."}), 400
                cursor.execute("""
                    INSERT INTO usuarios (nombre, pin, rol, activo, admin, notas) VALUES (?, ?, ?, ?, ?, ?)
                """, (nombre, upin, rol, activo, admin, notas))
            conn.commit()

        elif tabla == "tipos":
            nombre = str(d.get("nombre") or "").strip()
            clase = "Pausa" if str(d.get("clase") or "").lower() == "pausa" else "Gestion"
            req_num = "Sí" if str(d.get("requiereNumero")).lower() in ["sí", "si", "true", "1"] else "No"
            req_asu = "No" if str(d.get("requiereAsunto")).lower() in ["no", "false", "0"] else "Sí"
            activo = "No" if str(d.get("activo")).lower() in ["no", "false", "0"] else "Sí"
            tid = d.get("id")

            if tid:
                cursor.execute("""
                    UPDATE tipos SET nombre=?, clase=?, requiere_numero=?, requiere_asunto=?, activo=? WHERE id=?
                """, (nombre, clase, req_num, req_asu, activo, tid))
            else:
                cursor.execute("""
                    INSERT INTO tipos (nombre, clase, requiere_numero, requiere_asunto, sistema, activo)
                    VALUES (?, ?, ?, ?, 'No', ?)
                """, (nombre, clase, req_num, req_asu, activo))
            conn.commit()

        elif tabla == "tickets":
            tid = d.get("id")
            fecha = str(d.get("fecha") or "").strip()
            usuario = str(d.get("usuario") or "").strip()
            numero = normalizar_numero(d.get("numero") or d.get("numeroTicket"))
            caso = str(d.get("caso") or d.get("nombreCaso") or "")
            minutos = int(d.get("minutos") or 0)
            hora = str(d.get("hora") or "")[:5]
            estado = "Cerrado" if str(d.get("estado")).lower() == "cerrado" else "Abierto"
            obs = str(d.get("observaciones") or "")

            if tid:
                cursor.execute("""
                    UPDATE tickets SET fecha=?, usuario=?, numero=?, caso=?, minutos=?, hora=?, estado=?, observaciones=? WHERE id=?
                """, (fecha, usuario, numero, caso, minutos, hora, estado, obs, tid))
            else:
                cursor.execute("""
                    INSERT INTO tickets (fecha, usuario, numero, caso, minutos, hora, estado, observaciones)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (fecha, usuario, numero, caso, minutos, hora, estado, obs))
            conn.commit()

        elif tabla == "actividades":
            aid = d.get("id")
            fecha = str(d.get("fecha") or "").strip()
            usuario = str(d.get("usuario") or "").strip()
            tipo_act = str(d.get("tipo") or "Pausa")
            asunto = str(d.get("asunto") or "")
            minutos = int(d.get("minutos") or 0)
            hora = str(d.get("hora") or "")[:5]

            if aid:
                cursor.execute("""
                    UPDATE actividades SET fecha=?, usuario=?, tipo=?, asunto=?, minutos=?, hora=? WHERE id=?
                """, (fecha, usuario, tipo_act, asunto, minutos, hora, aid))
            else:
                cursor.execute("""
                    INSERT INTO actividades (fecha, usuario, tipo, asunto, minutos, hora)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (fecha, usuario, tipo_act, asunto, minutos, hora))
            conn.commit()

        elif tabla == "jornada":
            codigo = int(d.get("codigo", 0))
            minutos = max(0, int(d.get("minutos", 0)))
            horas = round(minutos / 60.0, 2)
            activo = "Sí" if str(d.get("activo")).lower() in ["sí", "si", "true", "1"] else "No"
            cursor.execute("""
                UPDATE jornada SET minutos_laborales=?, horas_equivalentes=?, activo=? WHERE codigo_dia=?
            """, (minutos, horas, activo, codigo))
            
            cursor.execute("SELECT SUM(minutos_laborales) as tot FROM jornada WHERE activo = 'Sí'")
            meta_calc = cursor.fetchone()["tot"] or 0
            cursor.execute("UPDATE config SET valor=? WHERE parametro='Meta_Semanal_Min'", (str(meta_calc),))
            conn.commit()

        elif tabla == "config":
            parametro = str(d.get("parametro") or "").strip()
            valor = str(d.get("valor") or "").strip()
            unidad = str(d.get("unidad") or "")
            desc = str(d.get("descripcion") or "")
            cursor.execute("""
                INSERT OR REPLACE INTO config (parametro, valor, unidad, descripcion)
                VALUES (?, ?, ?, ?)
            """, (parametro, valor, unidad, desc))
            conn.commit()

    elif accion == "borrar":
        record_id = d.get("id") or d.get("codigo") or d.get("parametro")
        if tabla == "usuarios" and record_id:
            cursor.execute("DELETE FROM usuarios WHERE id = ?", (record_id,))
        elif tabla == "tipos" and record_id:
            cursor.execute("DELETE FROM tipos WHERE id = ? AND sistema != 'Sí'", (record_id,))
        elif tabla == "tickets" and record_id:
            cursor.execute("DELETE FROM tickets WHERE id = ?", (record_id,))
        elif tabla == "actividades" and record_id:
            cursor.execute("DELETE FROM actividades WHERE id = ?", (record_id,))
        elif tabla == "config" and record_id:
            cursor.execute("DELETE FROM config WHERE parametro = ? AND parametro NOT IN ('Meta_Semanal_Min', 'Zona_Horaria')", (record_id,))
        conn.commit()

    # Obtener estado actualizado completo para admin (PIN SIEMPRE ENMASCARADO)
    cursor.execute("SELECT id, nombre, rol, activo, admin, notas FROM usuarios")
    admin_usuarios = [{
        "id": r["id"],
        "nombre": r["nombre"],
        "rol": r["rol"] or ("Administrador" if r["admin"] in ["Sí", "si", "true", "1"] else "Técnico"),
        "pin": "••••",
        "pin_masked": True,
        "activo": r["activo"],
        "admin": r["admin"],
        "notas": r["notas"]
    } for r in cursor.fetchall()]

    cursor.execute("SELECT id, nombre, clase, requiere_numero, requiere_asunto, sistema, activo FROM tipos")
    admin_tipos = [dict(r) for r in cursor.fetchall()]

    cursor.execute("SELECT dia_semana as dia, codigo_dia as codigo, minutos_laborales as minutos, horas_equivalentes as horas, activo FROM jornada")
    admin_jornada = [dict(r) for r in cursor.fetchall()]

    cursor.execute("SELECT parametro, valor, unidad, descripcion FROM config")
    admin_config = [dict(r) for r in cursor.fetchall()]

    cursor.execute("SELECT id, fecha, usuario, numero, caso, minutos, hora, estado, observaciones FROM tickets ORDER BY fecha DESC, hora DESC")
    admin_tickets = [dict(r) for r in cursor.fetchall()]

    cursor.execute("SELECT id, fecha, usuario, tipo, asunto, minutos, hora FROM actividades ORDER BY fecha DESC, hora DESC")
    admin_actividades = [dict(r) for r in cursor.fetchall()]

    conn.close()

    return jsonify({
        "ok": True,
        "mensaje": "Operación completada con éxito.",
        "usuarios": admin_usuarios,
        "tipos": admin_tipos,
        "jornada": admin_jornada,
        "config": admin_config,
        "tickets": admin_tickets,
        "actividades": admin_actividades
    })

# ----------------------------------------------------
# ENDPOINT: EXPORTAR A EXCEL (.XLSX)
# ----------------------------------------------------
@app.route("/api/export/excel", methods=["GET"])
def exportar_excel():
    usuario = request.args.get("usuario", "__all__")
    fecha_inicio = request.args.get("fecha_inicio", "")
    fecha_fin = request.args.get("fecha_fin", "")

    excel_buffer = generar_reporte_excel(usuario, fecha_inicio, fecha_fin)

    stamp = ahora_bogota().strftime("%Y%m%d_%H%M%S")
    tec_suffix = "Equipo" if usuario in ["__all__", "", None] else usuario.replace(" ", "_")
    filename = f"Registro_Tiempos_{tec_suffix}_{stamp}.xlsx"

    return send_file(
        excel_buffer,
        as_attachment=True,
        download_name=filename,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"Iniciando Registro de Tiempos en el puerto {port}...")
    app.run(host="0.0.0.0", port=port, debug=False)
