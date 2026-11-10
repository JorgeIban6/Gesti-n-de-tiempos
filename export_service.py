"""
Servicio de Exportación a Excel (.xlsx) para Registro de Tiempos
Genera reportes filtrados por técnico y rango de fechas con duraciones en minutos.
"""

import io
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from database import get_connection

def generar_reporte_excel(usuario=None, fecha_inicio=None, fecha_fin=None):
    """
    Genera un archivo Excel en memoria (BytesIO) con:
    1. Hoja de Tickets Gestionados (tiempos en minutos)
    2. Hoja de Otras Actividades y Pausas (tiempos en minutos)
    3. Hoja de Resumen Consolidado por Técnico
    """
    conn = get_connection()
    cursor = conn.cursor()

    # Construir filtros para Tickets
    query_tickets = "SELECT id, fecha, hora, usuario, numero, caso, estado, minutos, observaciones FROM tickets WHERE 1=1"
    params_tickets = []
    if usuario and usuario != "__all__":
        query_tickets += " AND LOWER(usuario) = LOWER(?)"
        params_tickets.append(usuario)
    if fecha_inicio:
        query_tickets += " AND fecha >= ?"
        params_tickets.append(fecha_inicio)
    if fecha_fin:
        query_tickets += " AND fecha <= ?"
        params_tickets.append(fecha_fin)
    query_tickets += " ORDER BY fecha DESC, hora DESC"
    cursor.execute(query_tickets, params_tickets)
    tickets_rows = cursor.fetchall()

    # Construir filtros para Actividades
    query_act = "SELECT id, fecha, hora, usuario, tipo, asunto, minutos FROM actividades WHERE 1=1"
    params_act = []
    if usuario and usuario != "__all__":
        query_act += " AND LOWER(usuario) = LOWER(?)"
        params_act.append(usuario)
    if fecha_inicio:
        query_act += " AND fecha >= ?"
        params_act.append(fecha_inicio)
    if fecha_fin:
        query_act += " AND fecha <= ?"
        params_act.append(fecha_fin)
    query_act += " ORDER BY fecha DESC, hora DESC"
    cursor.execute(query_act, params_act)
    act_rows = cursor.fetchall()

    conn.close()

    # Crear Libro de Excel
    wb = Workbook()

    # Estilos compartidos
    header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid") # Dark Slate
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    title_font = Font(name="Calibri", size=14, bold=True, color="0F172A")
    meta_font = Font(name="Calibri", size=10, italic=True, color="475569")
    total_font = Font(name="Calibri", size=11, bold=True, color="0F172A")
    total_fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")

    thin_border = Border(
        left=Side(style='thin', color='CBD5E1'),
        right=Side(style='thin', color='CBD5E1'),
        top=Side(style='thin', color='CBD5E1'),
        bottom=Side(style='thin', color='CBD5E1')
    )
    total_border = Border(
        top=Side(style='thin', color='0F172A'),
        bottom=Side(style='double', color='0F172A')
    )

    # ----------------------------------------------------
    # HOJA 1: Tickets Gestionados
    # ----------------------------------------------------
    ws_tickets = wb.active
    ws_tickets.title = "Tickets Gestionados"
    ws_tickets.views.sheetView[0].showGridLines = True

    # Metadatos del reporte
    ws_tickets["A1"] = "REPORTE DE TICKETS GESTIONADOS"
    ws_tickets["A1"].font = title_font
    filtro_txt = f"Filtros: Técnico: {usuario if usuario and usuario != '__all__' else 'Equipo Completo'} | Rango: {fecha_inicio or 'Inicio'} al {fecha_fin or 'Hoy'}"
    ws_tickets["A2"] = filtro_txt
    ws_tickets["A2"].font = meta_font

    headers_tickets = [
        "ID", "Fecha", "Hora", "Técnico", "Nº Ticket", "Nombre del Caso", "Estado", "Minutos Invertidos", "Observaciones"
    ]
    for col_idx, h in enumerate(headers_tickets, 1):
        cell = ws_tickets.cell(row=4, column=col_idx, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center" if col_idx in [1, 2, 3, 5, 7, 8] else "left", vertical="center")

    curr_row = 5
    for r in tickets_rows:
        ws_tickets.cell(row=curr_row, column=1, value=r["id"]).alignment = Alignment(horizontal="center")
        ws_tickets.cell(row=curr_row, column=2, value=r["fecha"]).alignment = Alignment(horizontal="center")
        ws_tickets.cell(row=curr_row, column=3, value=r["hora"]).alignment = Alignment(horizontal="center")
        ws_tickets.cell(row=curr_row, column=4, value=r["usuario"])
        ws_tickets.cell(row=curr_row, column=5, value=r["numero"]).alignment = Alignment(horizontal="center")
        ws_tickets.cell(row=curr_row, column=6, value=r["caso"])
        ws_tickets.cell(row=curr_row, column=7, value=r["estado"]).alignment = Alignment(horizontal="center")
        cell_min = ws_tickets.cell(row=curr_row, column=8, value=int(r["minutos"]))
        cell_min.alignment = Alignment(horizontal="right")
        cell_min.number_format = '#,##0'
        ws_tickets.cell(row=curr_row, column=9, value=r["observaciones"])

        for col_idx in range(1, 10):
            ws_tickets.cell(row=curr_row, column=col_idx).border = thin_border
        curr_row += 1

    # Fila de Totales para Tickets
    if tickets_rows:
        ws_tickets.cell(row=curr_row, column=7, value="TOTAL MINUTOS:").font = total_font
        ws_tickets.cell(row=curr_row, column=7).alignment = Alignment(horizontal="right")
        tot_cell = ws_tickets.cell(row=curr_row, column=8, value=f"=SUM(H5:H{curr_row-1})")
        tot_cell.font = total_font
        tot_cell.fill = total_fill
        tot_cell.alignment = Alignment(horizontal="right")
        tot_cell.number_format = '#,##0'
        for col_idx in range(1, 10):
            ws_tickets.cell(row=curr_row, column=col_idx).border = total_border

    # ----------------------------------------------------
    # HOJA 2: Otras Actividades y Pausas
    # ----------------------------------------------------
    ws_act = wb.create_sheet(title="Pausas y Actividades")
    ws_act.views.sheetView[0].showGridLines = True

    ws_act["A1"] = "REPORTE DE OTRAS ACTIVIDADES Y PAUSAS"
    ws_act["A1"].font = title_font
    ws_act["A2"] = filtro_txt
    ws_act["A2"].font = meta_font

    headers_act = ["ID", "Fecha", "Hora", "Técnico", "Tipo de Actividad", "Asunto / Detalle", "Minutos Invertidos"]
    for col_idx, h in enumerate(headers_act, 1):
        cell = ws_act.cell(row=4, column=col_idx, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center" if col_idx in [1, 2, 3, 5, 7] else "left", vertical="center")

    curr_row_act = 5
    for r in act_rows:
        ws_act.cell(row=curr_row_act, column=1, value=r["id"]).alignment = Alignment(horizontal="center")
        ws_act.cell(row=curr_row_act, column=2, value=r["fecha"]).alignment = Alignment(horizontal="center")
        ws_act.cell(row=curr_row_act, column=3, value=r["hora"]).alignment = Alignment(horizontal="center")
        ws_act.cell(row=curr_row_act, column=4, value=r["usuario"])
        ws_act.cell(row=curr_row_act, column=5, value=r["tipo"]).alignment = Alignment(horizontal="center")
        ws_act.cell(row=curr_row_act, column=6, value=r["asunto"])
        cell_min = ws_act.cell(row=curr_row_act, column=7, value=int(r["minutos"]))
        cell_min.alignment = Alignment(horizontal="right")
        cell_min.number_format = '#,##0'

        for col_idx in range(1, 8):
            ws_act.cell(row=curr_row_act, column=col_idx).border = thin_border
        curr_row_act += 1

    if act_rows:
        ws_act.cell(row=curr_row_act, column=6, value="TOTAL MINUTOS:").font = total_font
        ws_act.cell(row=curr_row_act, column=6).alignment = Alignment(horizontal="right")
        tot_cell = ws_act.cell(row=curr_row_act, column=7, value=f"=SUM(G5:G{curr_row_act-1})")
        tot_cell.font = total_font
        tot_cell.fill = total_fill
        tot_cell.alignment = Alignment(horizontal="right")
        tot_cell.number_format = '#,##0'
        for col_idx in range(1, 8):
            ws_act.cell(row=curr_row_act, column=col_idx).border = total_border

    # ----------------------------------------------------
    # HOJA 3: Resumen Consolidado por Técnico
    # ----------------------------------------------------
    ws_res = wb.create_sheet(title="Resumen Consolidado")
    ws_res.views.sheetView[0].showGridLines = True

    ws_res["A1"] = "RESUMEN CONSOLIDADO POR TÉCNICO"
    ws_res["A1"].font = title_font
    ws_res["A2"] = filtro_txt
    ws_res["A2"].font = meta_font

    headers_res = [
        "Técnico", "Cant. Tickets", "Minutos en Tickets", "Minutos en Pausas/Otras", "Total Minutos Gestión", "Horas Equivalentes"
    ]
    for col_idx, h in enumerate(headers_res, 1):
        cell = ws_res.cell(row=4, column=col_idx, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center" if col_idx > 1 else "left", vertical="center")

    # Agrupar estadísticas por técnico
    tecnicos_stats = {}
    for r in tickets_rows:
        u = r["usuario"]
        if u not in tecnicos_stats:
            tecnicos_stats[u] = {"tickets_count": 0, "tickets_min": 0, "act_min": 0}
        tecnicos_stats[u]["tickets_count"] += 1
        tecnicos_stats[u]["tickets_min"] += int(r["minutos"])

    for r in act_rows:
        u = r["usuario"]
        if u not in tecnicos_stats:
            tecnicos_stats[u] = {"tickets_count": 0, "tickets_min": 0, "act_min": 0}
        tecnicos_stats[u]["act_min"] += int(r["minutos"])

    curr_res = 5
    for u, st in sorted(tecnicos_stats.items()):
        ws_res.cell(row=curr_res, column=1, value=u)
        ws_res.cell(row=curr_res, column=2, value=st["tickets_count"]).alignment = Alignment(horizontal="center")
        
        c3 = ws_res.cell(row=curr_res, column=3, value=st["tickets_min"])
        c3.alignment = Alignment(horizontal="right")
        c3.number_format = '#,##0'

        c4 = ws_res.cell(row=curr_res, column=4, value=st["act_min"])
        c4.alignment = Alignment(horizontal="right")
        c4.number_format = '#,##0'

        c5 = ws_res.cell(row=curr_res, column=5, value=f"=C{curr_res}+D{curr_res}")
        c5.alignment = Alignment(horizontal="right")
        c5.font = Font(name="Calibri", bold=True)
        c5.number_format = '#,##0'

        c6 = ws_res.cell(row=curr_res, column=6, value=f"=E{curr_res}/60")
        c6.alignment = Alignment(horizontal="right")
        c6.number_format = '0.00'

        for col_idx in range(1, 7):
            ws_res.cell(row=curr_res, column=col_idx).border = thin_border
        curr_res += 1

    if tecnicos_stats:
        ws_res.cell(row=curr_res, column=1, value="TOTALES:").font = total_font
        ws_res.cell(row=curr_res, column=2, value=f"=SUM(B5:B{curr_res-1})").font = total_font
        ws_res.cell(row=curr_res, column=2).alignment = Alignment(horizontal="center")
        ws_res.cell(row=curr_res, column=3, value=f"=SUM(C5:C{curr_res-1})").font = total_font
        ws_res.cell(row=curr_res, column=3).alignment = Alignment(horizontal="right")
        ws_res.cell(row=curr_res, column=4, value=f"=SUM(D5:D{curr_res-1})").font = total_font
        ws_res.cell(row=curr_res, column=4).alignment = Alignment(horizontal="right")
        ws_res.cell(row=curr_res, column=5, value=f"=SUM(E5:E{curr_res-1})").font = total_font
        ws_res.cell(row=curr_res, column=5).alignment = Alignment(horizontal="right")
        ws_res.cell(row=curr_res, column=6, value=f"=SUM(F5:F{curr_res-1})").font = total_font
        ws_res.cell(row=curr_res, column=6).alignment = Alignment(horizontal="right")

        for col_idx in range(1, 7):
            ws_res.cell(row=curr_res, column=col_idx).fill = total_fill
            ws_res.cell(row=curr_res, column=col_idx).border = total_border

    # Ajuste automático del ancho de columnas para todas las hojas
    for ws in [ws_tickets, ws_act, ws_res]:
        for col in ws.columns:
            max_len = 0
            col_letter = get_column_letter(col[0].column)
            for cell in col:
                # Omitir títulos largos de fila 1 y 2 para el cálculo del ancho
                if cell.row in [1, 2]:
                    continue
                val_str = str(cell.value or '')
                if len(val_str) > max_len:
                    max_len = len(val_str)
            ws.column_dimensions[col_letter].width = max(max_len + 4, 12)

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    return output
