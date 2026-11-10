# Registro de Tiempos — Control de Gestión y Jornada

Sistema independiente de control de tiempos y gestión de tickets desarrollado en **Python** con base de datos local **SQLite**, reportes nativos en **Excel (.xlsx)**, sistema de roles jerárquicos y privacidad estricta de credenciales.

---

## 🚀 Inicio Rápido

### 1. Iniciar la aplicación
Haz doble clic en:
* `iniciar.bat`

O ejecuta en tu terminal:
```bash
python app.py
```

### 2. Acceso Web
Abre tu navegador en:
👉 **[http://127.0.0.1:5000](http://127.0.0.1:5000)**

---

## 👥 Roles del Sistema y Permisos

| Rol | Alcance y Permisos |
| :--- | :--- |
| **Administrador** | **Control Total:** Puede gestionar y editar usuarios, tipos de actividad, jornadas laborales, parámetros de configuración y modificar/eliminar cualquier registro de tickets y actividades del equipo. |
| **Ingeniero** | **Gestión Técnica y Corrección:** Puede registrar tiempos y, además, tiene acceso exclusivo al módulo **"Corregir Tiempos"** para modificar los minutos, fechas, detalles o notas de **sus propias actividades** en caso de haberse equivocado. |
| **Técnico** | **Registro Estándar:** Puede registrar sus tiempos diarios mediante PIN y consultar el avance de la jornada en el dashboard (sin permisos de edición de registros históricos). |

---

## 🔐 Usuarios y PINs Iniciales (Totalmente Privados)

| Usuario | PIN Inicial | Rol Asignado |
| :--- | :--- | :--- |
| **Brayan** | `2811` | **Administrador** |
| **Johan** | `6060` | **Ingeniero** |

> 🔒 **Privacidad de PINs**:
> * Los PINs nunca se exponen en texto plano en la interfaz ni en las respuestas del API. En las tablas se muestran enmascarados como `••••`.
> * Todos los campos de entrada de PIN utilizan formato de contraseña oculta (`type="password"`).

---

## ✏️ Edición y Corrección de Registros

1. **Corrección de Tiempos para Ingenieros**:
   * Mediante el botón **"Corregir Tiempos"** en la barra superior.
   * El ingeniero introduce su PIN personal y el sistema despliega el historial de sus actividades con un botón **"Editar"** en cada fila.
   * Permite ajustar minutos invertidos, fecha, hora, número de ticket, asunto y observaciones con guardado instantáneo.
2. **Edición Administrativa**:
   * En el panel de **Administración del Sistema** (requiere PIN admin), el administrador puede hacer clic en **"Editar"** en:
     * **Usuarios**: Modificar nombre, rol, notas y activar/desactivar (permite cambiar o conservar el PIN actual).
     * **Tipos de Actividad**: Modificar nombre, clase, exigencia de número de ticket o asunto.
     * **Tickets y Actividades**: Ajustar tiempos o detalles de cualquier miembro del equipo.

---

## 📊 Exportación a Excel (.xlsx)

* Botón **"Exportar Excel"** en la barra superior.
* Filtros interactivos por **Técnico** (Equipo completo o individual) y **Rango de Fechas** (Desde / Hasta).
* Tiempos calculados y formateados estrictamente en **minutos**.
* Hojas incluidas: *Tickets Gestionados*, *Pausas y Actividades* y *Resumen Consolidado por Técnico*.
