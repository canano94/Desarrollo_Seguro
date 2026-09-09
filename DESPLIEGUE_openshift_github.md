# Despliegue en OpenShift desde GitHub

Tu profesor tiene razón: desplegar desde un repositorio es mejor que
subir carpetas con `oc start-build --from-dir`.

**Por qué:** con `--from-dir` subes lo que tengas en tu máquina en ese
momento, y nadie puede reproducir el despliegue sin tu computador. Desde
GitHub, el clúster construye a partir de un commit identificable: si algo
falla, sabes exactamente qué código está corriendo, y tu compañero puede
desplegar sin ti. Es la diferencia entre "funciona en mi máquina" y un
proceso repetible.

---

## PARTE 0 — Preparar el repositorio

### 0.1 Estructura esperada

```
Desarrollo_Seguro/
  .gitignore
  README.md
  sql/
    03_schema_v2_empresas_membresias.sql
    04_funciones_admin_plataforma.sql
    05_reset_password_admin.sql
    06_rol_prestador_ambito.sql
    07_editor_roles.sql
    08_numeracion_casos.sql
    09_casos_ambito_prestador.sql
    10_ajustes_finales.sql
  backend/
    Dockerfile
    .dockerignore
    package.json
    src/
  frontend/
    Dockerfile
    nginx.conf
    env-entrypoint.sh
    *.html
    css/  js/
```

### 0.2 El `.gitignore` (CRÍTICO)

Antes del primer commit, verifica que exista en la raíz:

```
node_modules/
.env
.env.local
frontend/env.js
*.log
oc.exe
respaldo_*.sql
```

**El `.env` nunca va a Git.** Contiene la contraseña de la base y el
`JWT_SECRET`. Si lo subes, no basta con borrarlo después: queda en el
historial del repositorio para siempre y hay que rotar ambos secretos.

`frontend/env.js` también se ignora porque lo genera el contenedor al
arrancar; el que tienes en local apunta a `localhost`.

### 0.3 Subir el proyecto

```powershell
cd C:\ProyectosU\Desarrollo_Seguro
git init
git add .
git status          # REVISA que no aparezca .env ni node_modules
git commit -m "Plataforma SaaS de agendamiento y CRM"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/TU-REPO.git
git push -u origin main
```

El `git status` antes del commit no es opcional. Es el último momento
para darte cuenta de que un secreto se estaba colando.

---

## PARTE 1 — Base de datos

Si ya la tienes desplegada, salta a la Parte 2.

```powershell
oc login --token=... --server=https://api.rm1.0a51.p1.openshiftapps.com:6443
oc project canano94-dev

oc new-app --image-stream=postgresql:15-el9 `
  --name=postgresql `
  -e POSTGRESQL_USER=api_agendamiento `
  -e POSTGRESQL_PASSWORD='TuClaveSegura2026' `
  -e POSTGRESQL_DATABASE=agendamiento_crm `
  -e POSTGRESQL_ADMIN_PASSWORD='OtraClaveAdmin2026'

oc set volume deployment/postgresql --add `
  --name=postgresql-data --type=pvc --claim-size=2Gi `
  --mount-path=/var/lib/pgsql/data
```

Espera a que el pod esté `1/1 Running` y guarda su nombre:

```powershell
oc get pods
$pg = "postgresql-XXXXX"
```

### 1.1 Extensiones

```powershell
oc exec $pg -- psql -U api_agendamiento -d agendamiento_crm -c "CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS btree_gist;"
```

> Las extensiones **no viajan en un `pg_dump`**: hay que crearlas aparte.
> Fue uno de los tropiezos del primer despliegue.

### 1.2 Los scripts, en orden

Antes de empezar, para que las tildes no se corrompan:

```powershell
$OutputEncoding = [System.Text.Encoding]::UTF8
cd sql
```

```powershell
type 03_schema_v2_empresas_membresias.sql | oc exec -i $pg -- psql -U api_agendamiento -d agendamiento_crm
type 04_funciones_admin_plataforma.sql    | oc exec -i $pg -- psql -U api_agendamiento -d agendamiento_crm
type 05_reset_password_admin.sql          | oc exec -i $pg -- psql -U api_agendamiento -d agendamiento_crm
type 06_rol_prestador_ambito.sql          | oc exec -i $pg -- psql -U api_agendamiento -d agendamiento_crm
type 07_editor_roles.sql                  | oc exec -i $pg -- psql -U api_agendamiento -d agendamiento_crm
type 08_numeracion_casos.sql              | oc exec -i $pg -- psql -U api_agendamiento -d agendamiento_crm
type 09_casos_ambito_prestador.sql        | oc exec -i $pg -- psql -U api_agendamiento -d agendamiento_crm
type 10_ajustes_finales.sql               | oc exec -i $pg -- psql -U api_agendamiento -d agendamiento_crm
```

### 1.3 Datos semilla con contexto de empresa

El script 03 inserta empresas y usuarios, pero **falla al insertar
membresías, prestadores y módulos**: esas tablas tienen Row Level
Security y `psql` no fija `app.id_empresa`. Es la política funcionando
como debe.

```powershell
oc exec -i $pg -- psql -U api_agendamiento -d agendamiento_crm -c "SET app.id_empresa = 'a0000000-0000-0000-0000-000000000001'; INSERT INTO app.empresa_modulos (id_empresa, id_modulo) SELECT 'a0000000-0000-0000-0000-000000000001', id_modulo FROM app.modulos ON CONFLICT DO NOTHING; INSERT INTO app.prestadores (id_prestador, id_empresa, nombre) VALUES ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Sede Chapinero'), ('b0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','Sede Usaquen') ON CONFLICT DO NOTHING; INSERT INTO app.membresias (id_membresia, id_usuario, id_empresa, cargo) VALUES ('d0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','Directora'), ('d0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000001','Terapeuta') ON CONFLICT DO NOTHING;"
```

```powershell
oc exec -i $pg -- psql -U api_agendamiento -d agendamiento_crm -c "SET app.id_empresa = 'a0000000-0000-0000-0000-000000000002'; INSERT INTO app.empresa_modulos (id_empresa, id_modulo) SELECT 'a0000000-0000-0000-0000-000000000002', id_modulo FROM app.modulos WHERE codigo = 'AGENDA' ON CONFLICT DO NOTHING; INSERT INTO app.prestadores (id_prestador, id_empresa, nombre) VALUES ('b0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000002','Barberia Norte') ON CONFLICT DO NOTHING; INSERT INTO app.membresias (id_membresia, id_usuario, id_empresa, cargo) VALUES ('d0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000002','Propietario'), ('d0000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000002',NULL) ON CONFLICT DO NOTHING;"
```

```powershell
oc exec -i $pg -- psql -U api_agendamiento -d agendamiento_crm -c "INSERT INTO app.membresia_roles (id_membresia, id_rol) SELECT m.id_membresia, r.id_rol FROM (VALUES ('d0000000-0000-0000-0000-000000000001'::uuid,'ADMIN_EMPRESA'),('d0000000-0000-0000-0000-000000000002'::uuid,'ADMIN_EMPRESA'),('d0000000-0000-0000-0000-000000000003'::uuid,'EMPLEADO'),('d0000000-0000-0000-0000-000000000004'::uuid,'CLIENTE')) AS m(id_membresia, rol) JOIN app.roles r ON r.codigo = m.rol ON CONFLICT DO NOTHING;"
```

### 1.4 Separar el dueño del usuario de la aplicación

**Este paso es obligatorio** y fue el hallazgo más interesante del
primer despliegue.

`FORCE ROW LEVEL SECURITY` aplica la política incluso al dueño de la
tabla. Si `api_agendamiento` es a la vez dueño y usuario de la API, las
funciones `SECURITY DEFINER` quedan atrapadas por su propia política y
devuelven vacío. La solución es que las tablas pertenezcan a `postgres`:

```powershell
oc exec $pg -- psql -U postgres -d agendamiento_crm -c "REASSIGN OWNED BY api_agendamiento TO postgres;"
```

Al cambiar el dueño se pierden los permisos, así que hay que devolverlos:

```powershell
oc exec $pg -- psql -U postgres -d agendamiento_crm -c "GRANT USAGE ON SCHEMA app TO api_agendamiento; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO api_agendamiento; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO api_agendamiento; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO api_agendamiento; ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO api_agendamiento;"
```

### 1.5 Verificación

```powershell
oc exec $pg -- psql -U api_agendamiento -d agendamiento_crm -c "SELECT empresa_slug, roles, modulos FROM app.fn_membresias_de_usuario('c0000000-0000-0000-0000-000000000004');"
```

Deben salir **dos filas** (Ana pertenece a dos empresas). Si sale vacío,
falta el paso 1.4.

---

## PARTE 2 — Backend desde GitHub

### 2.1 Secretos y configuración

Nunca en la imagen ni en el repositorio: van en objetos de OpenShift.

```powershell
oc create secret generic backend-secrets `
  --from-literal=DATABASE_URL="postgresql://api_agendamiento:TuClaveSegura2026@postgresql:5432/agendamiento_crm" `
  --from-literal=JWT_SECRET="PEGA-AQUI-UN-SECRETO-LARGO"
```

Genera el secreto con:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

> `postgresql` en la URL es el nombre del **Service**, no una IP. Dentro
> del clúster los pods se encuentran por nombre: las IPs cambian en cada
> reinicio.

```powershell
oc create configmap backend-config `
  --from-literal=NODE_ENV=production `
  --from-literal=JWT_ISSUER=agendamiento-crm `
  --from-literal=JWT_AUDIENCE=agendamiento-crm-web `
  --from-literal=ACCESS_TOKEN_TTL=15m `
  --from-literal=REFRESH_TTL_DAYS=7 `
  --from-literal=CORS_ORIGIN=https://pendiente
```

`CORS_ORIGIN` se corrige en el paso 4.2, cuando se conozca la URL real
del frontend.

### 2.2 Crear la aplicación desde el repositorio

```powershell
oc new-app https://github.com/TU-USUARIO/TU-REPO.git `
  --context-dir=backend `
  --name=backend `
  --strategy=docker
```

`--context-dir=backend` le dice que el `Dockerfile` está en esa
subcarpeta, no en la raíz. Sin eso no lo encuentra.

```powershell
oc set env deployment/backend --from=secret/backend-secrets
oc set env deployment/backend --from=configmap/backend-config

oc expose service backend --port=3000
oc get route backend
```

Anota la URL que devuelve. Pruébala:

```powershell
curl https://LA-URL-DEL-BACKEND/api/health
```

---

## PARTE 3 — Frontend desde GitHub

```powershell
oc new-app https://github.com/TU-USUARIO/TU-REPO.git `
  --context-dir=frontend `
  --name=frontend `
  --strategy=docker

oc set env deployment/frontend API_URL="https://LA-URL-DEL-BACKEND"

oc expose service frontend --port=8080
oc get route frontend
```

`API_URL` es una variable del **contenedor**, no de la construcción.
`env-entrypoint.sh` la lee al arrancar y genera `env.js` con la URL
correcta. Así la misma imagen sirve para desarrollo y producción sin
reconstruir nada.

---

## PARTE 4 — Cerrar el círculo

### 4.1 Verificar

```powershell
oc get pods       # los tres en 1/1 Running
oc get routes     # las dos URLs públicas
oc logs deployment/backend --tail=30
```

### 4.2 Corregir CORS

Con la URL real del frontend:

```powershell
oc set env deployment/backend CORS_ORIGIN="https://LA-URL-DEL-FRONTEND"
```

Cambiar una variable reinicia el pod automáticamente. **Sin este paso el
login falla**: el navegador bloquea la cookie del refresh token si el
origen no coincide exactamente.

### 4.3 Probar

Abre la URL del frontend y entra con `laura@spademo.co` /
`Demo#2026Segura`.

Si el login responde pero la sesión no persiste, revisa `CORS_ORIGIN`
(sin barra final) y que la URL sea `https`.

---

## PARTE 5 — Actualizar después de un cambio

Aquí está la ventaja de GitHub:

```powershell
git add .
git commit -m "Descripción del cambio"
git push

oc start-build backend --follow
oc start-build frontend --follow
```

OpenShift clona el repositorio, construye la imagen y reemplaza los pods
de forma progresiva. No hay caída del servicio durante la actualización.

### Despliegue automático (opcional)

Se puede configurar un webhook para que cada `git push` dispare la
construcción sola:

```powershell
oc describe bc/backend | Select-String "Webhook"
```

Esa URL se pega en GitHub → Settings → Webhooks. Es el primer paso hacia
una integración continua, y vale mencionarlo en el informe aunque no lo
implementes.

---

## Diferencias entre local y OpenShift

| En tu máquina | En OpenShift |
|---|---|
| `NODE_ENV=development` | `production` — activa `secure: true` en la cookie, así que exige HTTPS |
| `localhost:3000` y `:5500` | URLs de Route, siempre HTTPS |
| Un proceso con `npm run dev` | Deployment que puede escalar a varias réplicas |
| pgAdmin directo | `oc port-forward postgresql-XXXX 5433:5432` y conectas a `localhost:5433` |
| `.env` en disco | Secret y ConfigMap de OpenShift |

---

## Para el informe: hallazgos del despliegue

Tres problemas reales que aparecieron y cómo se resolvieron:

1. **Deriva de versiones.** Se desarrolló contra PostgreSQL 17 y la
   plantilla por defecto de OpenShift traía la 10 — siete versiones
   mayores de diferencia. Un `pg_dump` de una versión nueva no se
   restaura en una vieja. Se fijó explícitamente `postgresql:15-el9`.

2. **Las extensiones no viajan en el dump.** `pg_dump` asume que
   `citext`, `pgcrypto` y `btree_gist` ya están instaladas en el
   destino. Sin ellas, ninguna tabla que las use puede crearse.

3. **`FORCE ROW LEVEL SECURITY` obliga a separar el dueño del usuario
   de la aplicación.** La política aplica incluso al propietario de la
   tabla, así que las funciones `SECURITY DEFINER` quedaban atrapadas
   por su propia política. Es el hallazgo más valioso: demuestra que el
   aislamiento multitenant no es decorativo, porque bloqueó al propio
   desarrollador hasta separar correctamente los roles de base de datos.

Además, el clúster escaló el despliegue a cero réplicas por inactividad
sin que se perdiera un solo dato: el PVC sobrevive independientemente
del pod. Esa separación entre cómputo efímero y almacenamiento
persistente es lo que permite reiniciar contenedores sin consecuencias.
