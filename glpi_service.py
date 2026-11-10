"""
Módulo de Integración con GLPI (Mesa de Ayuda / ITIL)
Fase 2: Conectores y endpoints preparados para sincronización con la API REST de GLPI.
"""

import os
import requests

GLPI_API_URL = os.getenv("GLPI_API_URL", "https://glpi.tuempresa.com/apirest.php")
GLPI_APP_TOKEN = os.getenv("GLPI_APP_TOKEN", "")
GLPI_USER_TOKEN = os.getenv("GLPI_USER_TOKEN", "")

class GLPIService:
    def __init__(self, base_url=None, app_token=None, user_token=None):
        self.base_url = (base_url or GLPI_API_URL).rstrip("/")
        self.app_token = app_token or GLPI_APP_TOKEN
        self.user_token = user_token or GLPI_USER_TOKEN
        self.session_token = None

    def init_session(self):
        """Inicia sesión en la API de GLPI y almacena el session_token."""
        if not self.app_token or not self.user_token:
            return {"ok": False, "mensaje": "Tokens de GLPI no configurados aún."}

        headers = {
            "App-Token": self.app_token,
            "Authorization": f"user_token {self.user_token}",
            "Content-Type": "application/json"
        }
        try:
            res = requests.get(f"{self.base_url}/initSession", headers=headers, timeout=10)
            if res.status_code == 200:
                data = res.json()
                self.session_token = data.get("session_token")
                return {"ok": True, "session_token": self.session_token}
            return {"ok": False, "mensaje": f"Error GLPI: {res.status_code} - {res.text}"}
        except Exception as e:
            return {"ok": False, "mensaje": f"Error de conexión con GLPI: {str(e)}"}

    def buscar_ticket(self, ticket_id):
        """Consulta datos de un ticket en GLPI (asunto, estado, solicitante)."""
        # Preparado para activación en Fase 2
        return {"ok": True, "ticket_id": ticket_id, "estado": "Pendiente de configuración"}

    def crear_tarea_tiempo(self, ticket_id, minutos, descripcion, usuario):
        """Crea una tarea técnica en GLPI registrando el tiempo invertido."""
        # Preparado para activación en Fase 2
        return {"ok": True, "mensaje": "Módulo listo para vincular tareas en GLPI."}
