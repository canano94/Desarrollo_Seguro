import { conEmpresa } from '../db/pool.js';
import { AppError } from '../utils/errors.js';

/**
 * TODO en este archivo corre dentro de conEmpresa(), igual que agenda.
 * Eso significa que RLS filtra por empresa automáticamente y verás
 * consultas sin "WHERE id_empresa": no es un olvido, es el motor.
 *
 * DECISIÓN DE DISEÑO: los equipos NO se filtran por ámbito de prestador.
 */

// ================================================================== //
// EQUIPOS                                                             //
// ================================================================== //

/**
 * @param alcance 'propios'  -> CLIENTE: solo los que radicó
 *                'asignados'-> EMPLEADO: solo los que le asignaron
 *                'ambito'   -> PRESTADOR: los de SUS sedes
 *                'todos'    -> ADMIN_EMPRESA: toda la empresa
 */

export async function listarEquipos (idEmpresa, ambito = []){
    return conEmpresa(idEmpresa, async(cliente) => {
        const { rows } = await cliente.query(
            `SELECT 
            e.id_equipo, 
            e.tipo, 
            e.marca, 
            e.ultimo_mantenimiento,
            u.nombre,
            u.id_usuario

            FROM app.equipos e
            LEFT JOIN app.equipo_cliente eu ON e.id_equipo = eu.id_equipo
            LEFT JOIN app.usuarios u ON eu.id_cliente = u.id_usuario

            WHERE e.id_prestador = ANY($1::uuid[])
            ORDER BY e.creado_en DESC

            LIMIT 200`,
        [ ambito],
    );

    return rows.map((e) => ({
        IDEquipo: e.id_equipo,
        tipo: e.tipo,
        marca: e.marca,
        NombreCliente: e.nombre,
        IDCliente: e.id_usuario,
        ultimoMantenimiento: e.ultimo_mantenimiento,
    }))

});
}

/** Detalle de un equipo, con su información completa. */

export async function detalleEquipo (idEmpresa, idEquipo){
    return conEmpresa(idEmpresa, async(cliente) => {
        const { rows } = await cliente.query(
            `SELECT 
            e.id_equipo, 
            e.id_prestador,
            e.qr_token,
            e.tipo, 
            e.marca, 
            e.modelo,
            e.numero_serie,
            e.tipo_alimen,
            e.ubicacion,
            e.fecha_instalacion,
            e.ultimo_mantenimiento,
            e.proxima_fecha_mantenimiento,
            e.activo,
            e.creado_en as creadoEquipo,
            u.nombre,
            u.id_usuario,
            eu.fecha_desde,
            eu.fecha_hasta,
            eu.creado_en as asignadoel


            FROM app.equipos e
            LEFT JOIN app.equipo_cliente eu ON e.id_equipo = eu.id_equipo
            LEFT JOIN app.usuarios u ON eu.id_cliente = u.id_usuario

            WHERE e.id_equipo = $1`,
        [idEquipo],
    );
    // Si el equipo es de otra empresa, RLS lo ocultó y no llega nada.
    if (rows.length === 0) {
      throw new AppError(404, 'EQUIPO_NO_ENCONTRADO', 'Este quipo no existe.');
    }

    const e =  rows[0];

    const equipo = {
        idEquipo: e.id_equipo, 
        idPrestado: e.id_prestador,
        idQr:e.qr_token,
        tipo: e.tipo, 
        marca: e.marca, 
        modelo: e.modelo,
        numeroSerie: e.numero_serie,
        tipoAlimentacion: e.tipo_alimen,
        ubicacion: e.ubicacion,
        fechaInstalacion: e.fecha_instalacion,
        ultimoMantenimiento: e.ultimo_mantenimiento,
        proximoMantenimiento: e.proxima_fecha_mantenimiento,
        estado: e.activo,
        fechaCreacion: e.creadoEquipo,
        clientes: rows.map((r) => ({
            nombreCliente: r.nombre,
            idCliente: r.id_usuario,
            fechaAsignacion: r.fecha_desde,
            fechaRetiro: r.fecha_hasta,
            fechaCreacioncliente: r.asignadoel
        })),
    };
    
    return equipo;

});
}

/**Crear Equipo */

export async function crearEquipo(idEmpresa, idMembresia, datos) {
    return conEmpresa(idEmpresa, async (cliente) => {
        try {
            await cliente.query('BEGIN');
                const { rows } = await cliente.query(
                `INSERT INTO app.equipos 
                (id_prestador,
                tipo,
                marca,
                modelo,
                numero_serie,
                tipo_alimen,
                ubicacion,
                fecha_instalacion,
                activo)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING id_equipo`,
                [
                    datos.idPrestador,
                    datos.tipo,
                    datos.marca,
                    datos.modelo,
                    datos.numeroSerie,
                    datos.tipoAlimentacion,
                    datos.ubicacion,
                    datos.fechaInstalacion,
                    datos.activo,
                ],
            ); 
                const resultado = { idEquipo: rows[0].id_equipo };
            

            if (datos.idCliente) {
                    const { rows: rowsCliente } = await cliente.query(
                    `INSERT INTO app.equipo_cliente
                    (id_equipo,
                    id_cliente)
                    VALUES ($1, $2)
                    RETURNING id`,
                    [
                        rows[0].id_equipo,
                        datos.idCliente,
                    ],
                ); 
 
                resultado.idAsignacion = rowsCliente[0].id;

            }
            await cliente.query('COMMIT');
        
         return resultado;
            
        } catch (error) {
            await cliente.query('ROLLBACK');
            throw new AppError(500, 'ERROR_CREAR_EQUIPO', 'Error al crear el equipo.');
        }
    });

}