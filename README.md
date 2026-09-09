# Plataforma SaaS de agendamiento y CRM

Proyecto de la asignatura **Desarrollo de Software Seguro** — UNIMINUTO.

Plataforma web multitenant que centraliza la reserva de turnos y la
gestión de relaciones con el cliente para varios prestadores de
servicio, con aislamiento estricto entre empresas.

## Arquitectura

| Capa | Tecnología |
|---|---|
| Base de datos | PostgreSQL 15 con Row Level Security |
| Backend | Node.js + Express (API REST) |
| Frontend | HTML, CSS y JavaScript sin framework |
| Despliegue | OpenShift (contenedores) |

## Controles de seguridad implementados

- **Autenticación JWT** con access token de vida corta (15 min) en
  memoria y refresh token en cookie `httpOnly`, con rotación y
  detección de reuso.
- **Aislamiento multitenant por RLS**: las políticas de PostgreSQL
  filtran por empresa aunque el código olvide el `WHERE`.
- **RBAC con ámbito**: además del permiso, se verifica que el recurso
  esté dentro de las sedes asignadas a la persona.
- **Módulos contratables**: los permisos de un módulo no contratado no
  llegan al token.
- **Consultas parametrizadas** en el 100% de las operaciones.
- **Validación de entrada con zod** en body, query y parámetros de ruta.
- **Bitácora de autenticación** con registro de quién restableció la
  contraseña de quién.
- **Contraseñas con bcrypt** (coste 12) y respuesta de tiempo constante
  para evitar enumeración de usuarios.

## Estructura

```
sql/        Scripts de base de datos, en orden de ejecución
backend/    API REST — src/{routes,controllers,services,validators,middleware}
frontend/   Interfaz web
```

## Poner en marcha en local

```bash
# 1. Base de datos: ejecutar los scripts de sql/ en orden

# 2. Backend
cd backend
npm install
cp .env.example .env      # editar DATABASE_URL y JWT_SECRET
npm run dev

# 3. Frontend: abrir con Live Server en http://localhost:5500
```

## Despliegue

Ver `DESPLIEGUE_openshift_github.md`.

## Cuentas de prueba

Contraseña para todas: `Demo#2026Segura`

| Correo | Rol |
|---|---|
| super@plataforma.co | Administrador de plataforma |
| laura@spademo.co | Administradora de empresa |
| carlos@barberianorte.co | Administrador de empresa |
| ana@correo.com | Empleada en una empresa, clienta en otra |
