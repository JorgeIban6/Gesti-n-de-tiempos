"""
Módulo de Base de Datos SQLite para Registro de Tiempos
Maneja la inicialización de tablas, conexiones, roles y datos semilla.
"""

import sqlite3
import os

DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "registro_tiempos.db")

def get_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_connection()
    cursor = conn.cursor()

    # Tabla Usuarios con columna de Rol (Administrador, Ingeniero, Técnico)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL UNIQUE,
            pin TEXT NOT NULL,
            rol TEXT DEFAULT 'Técnico',
            activo TEXT DEFAULT 'Sí',
            admin TEXT DEFAULT 'No',
            notas TEXT
        )
    """)

    # Migración en caso de que la tabla ya existiera sin la columna 'rol'
    cursor.execute("PRAGMA table_info(usuarios)")
    cols = [r["name"] for r in cursor.fetchall()]
    if "rol" not in cols:
        cursor.execute("ALTER TABLE usuarios ADD COLUMN rol TEXT DEFAULT 'Técnico'")
        cursor.execute("UPDATE usuarios SET rol = 'Administrador' WHERE admin IN ('Sí', 'si', 'true', '1')")

    # Tabla Tipos de Actividad
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tipos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL UNIQUE,
            clase TEXT DEFAULT 'Gestion',
            requiere_numero TEXT DEFAULT 'No',
            requiere_asunto TEXT DEFAULT 'Sí',
            sistema TEXT DEFAULT 'No',
            activo TEXT DEFAULT 'Sí'
        )
    """)

    # Tabla Tickets
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha TEXT NOT NULL,
            usuario TEXT NOT NULL,
            numero TEXT NOT NULL,
            caso TEXT,
            minutos INTEGER NOT NULL,
            hora TEXT,
            estado TEXT DEFAULT 'Abierto',
            observaciones TEXT,
            creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Tabla Actividades (Pausas, reuniones, etc.)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS actividades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha TEXT NOT NULL,
            usuario TEXT NOT NULL,
            tipo TEXT NOT NULL,
            asunto TEXT,
            minutos INTEGER NOT NULL,
            hora TEXT,
            creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Tabla Jornada Laboral
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS jornada (
            dia_semana TEXT NOT NULL,
            codigo_dia INTEGER PRIMARY KEY,
            minutos_laborales INTEGER NOT NULL,
            horas_equivalentes REAL NOT NULL,
            activo TEXT DEFAULT 'Sí'
        )
    """)

    # Tabla Configuración
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS config (
            parametro TEXT PRIMARY KEY,
            valor TEXT NOT NULL,
            unidad TEXT,
            descripcion TEXT
        )
    """)

    # Poblar datos semilla si las tablas están vacías
    # 1. Usuarios iniciales con roles definidos
    cursor.execute("SELECT COUNT(*) FROM usuarios")
    if cursor.fetchone()[0] == 0:
        cursor.executemany("""
            INSERT INTO usuarios (nombre, pin, rol, activo, admin, notas)
            VALUES (?, ?, ?, ?, ?, ?)
        """, [
            ("Brayan", "2811", "Administrador", "Sí", "Sí", "Administrador total del sistema"),
            ("Johan", "6060", "Ingeniero", "Sí", "No", "Ingeniero de soporte (puede corregir sus tiempos)"),
        ])
    else:
        # Asegurar que Johan sea Ingeniero y Brayan Administrador
        cursor.execute("UPDATE usuarios SET rol = 'Administrador', admin = 'Sí' WHERE LOWER(nombre) = 'brayan'")
        cursor.execute("UPDATE usuarios SET rol = 'Ingeniero' WHERE LOWER(nombre) = 'johan'")

    # 2. Tipos de actividad iniciales
    cursor.execute("SELECT COUNT(*) FROM tipos")
    if cursor.fetchone()[0] == 0:
        cursor.executemany("""
            INSERT INTO tipos (nombre, clase, requiere_numero, requiere_asunto, sistema, activo)
            VALUES (?, ?, ?, ?, ?, ?)
        """, [
            ("Ticket", "Gestion", "Sí", "Sí", "Sí", "Sí"),
            ("Pausa", "Pausa", "No", "Sí", "Sí", "Sí"),
            ("Reunión", "Gestion", "No", "Sí", "Sí", "Sí"),
        ])

    # 3. Jornada laboral (Colombia: L-J 8.5h=510m, V 7.5h=450m)
    cursor.execute("SELECT COUNT(*) FROM jornada")
    if cursor.fetchone()[0] == 0:
        cursor.executemany("""
            INSERT INTO jornada (dia_semana, codigo_dia, minutos_laborales, horas_equivalentes, activo)
            VALUES (?, ?, ?, ?, ?)
        """, [
            ("Lunes", 1, 510, 8.5, "Sí"),
            ("Martes", 2, 510, 8.5, "Sí"),
            ("Miércoles", 3, 510, 8.5, "Sí"),
            ("Jueves", 4, 510, 8.5, "Sí"),
            ("Viernes", 5, 450, 7.5, "Sí"),
            ("Sábado", 6, 0, 0, "No"),
            ("Domingo", 7, 0, 0, "No"),
        ])

    # 4. Parámetros de Configuración
    cursor.execute("SELECT COUNT(*) FROM config")
    if cursor.fetchone()[0] == 0:
        cursor.executemany("""
            INSERT INTO config (parametro, valor, unidad, descripcion)
            VALUES (?, ?, ?, ?)
        """, [
            ("Almuerzo_Estandar_Min", "60", "minutos", "Almuerzo descontado por defecto"),
            ("Meta_Semanal_Min", "2490", "minutos", "Meta semanal Colombia (510×4 + 450)"),
            ("Umbral_Alerta_Deficit", "30", "minutos", "Alerta si el déficit diario supera N minutos"),
            ("Zona_Horaria", "America/Bogota", "IANA", "Zona horaria Colombia UTC-5"),
        ])

    conn.commit()
    conn.close()

if __name__ == "__main__":
    init_db()
    print("Base de datos actualizada con roles en:", DB_FILE)
