// src/examples/ai-server.ts
import express from "express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { generateWebApp, runtime } from "./ai-app-generator";
import { createLogger } from "../lib/core/logging";

const app = express();
const PORT = process.env.PORT || 3000;
const logger = createLogger({ component: "AIServer" });

// Middleware para parsear JSON
app.use(express.json());

// Configurar Bull Board para monitoreo
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

// Función para configurar Bull Board
async function setupBullBoard() {
  try {
    // El runtime ya está configurado en ai-app-generator.ts, solo necesitamos iniciarlo
    await runtime.start();

    // Obtener todas las colas del runtime usando getQueues()
    const queues = runtime.getQueues();

    logger.info(`Configurando Bull Board con ${queues.length} colas`);

    // Crear adaptadores para cada cola
    const queueAdapters = queues.map((queue) => new BullMQAdapter(queue));

    // Configurar Bull Board
    createBullBoard({
      queues: queueAdapters,
      serverAdapter,
    });

    logger.info("Bull Board configurado exitosamente");
  } catch (error) {
    logger.error("Error configurando Bull Board", error);
    throw error;
  }
}

// === RUTAS DE LA API ===

// Ruta principal
app.get("/", (req: express.Request, res: express.Response) => {
  res.json({
    message: "Sistema de Generación de Apps con IA",
    version: "1.0.0",
    endpoints: {
      generate: "POST /api/generate",
      status: "GET /api/status",
      monitoring: "GET /admin/queues",
    },
    features: [
      "Análisis automático de requisitos",
      "Generación paralela de componentes",
      "Control de calidad automático",
      "Documentación completa",
      "Configuración de despliegue",
    ],
  });
});

// Ruta para generar aplicaciones usando el runtime compartido
app.post(
  "/api/generate",
  async (req: express.Request, res: express.Response) => {
    try {
      const { userRequest } = req.body;

      if (!userRequest || typeof userRequest !== "string") {
        return res.status(400).json({
          error:
            "Se requiere el campo userRequest con la descripción de la aplicación",
          example: {
            userRequest:
              "Quiero crear una tienda online con carrito de compras y panel de administración",
          },
        });
      }

      logger.info("Nueva solicitud de generación de app", { userRequest });

      // Usar la función generateWebApp que ya maneja todo internamente
      const result = await generateWebApp(userRequest);

      if (result.success) {
        logger.info("Aplicación generada exitosamente", {
          qualityScore: result.state.qualityScore,
          componentsCount: result.state.components?.length,
          endpointsCount: result.state.apiEndpoints?.length,
        });

        res.json({
          success: true,
          message: "Aplicación generada exitosamente",
          data: {
            qualityScore: result.state.qualityScore,
            requirements: result.state.requirements,
            components: result.state.components,
            apiEndpoints: result.state.apiEndpoints,
            database: result.state.database,
            documentation: result.state.documentation,
            deploymentConfig: result.state.deploymentConfig,
            generatedApp: result.state.generatedApp,
          },
          metadata: {
            executionTime: result.executionTime,
            timestamp: new Date().toISOString(),
          },
        });
      } else {
        logger.error("Error generando aplicación", result.error);

        res.status(500).json({
          success: false,
          error: "Error generando la aplicación",
          details: result.error?.message,
          metadata: {
            executionTime: result.executionTime,
            timestamp: new Date().toISOString(),
          },
        });
      }
    } catch (error) {
      logger.error("Error interno del servidor", error);

      res.status(500).json({
        success: false,
        error: "Error interno del servidor",
        details: error instanceof Error ? error.message : "Error desconocido",
      });
    }
  }
);

// Ruta para obtener el estado del sistema usando el runtime compartido
app.get("/api/status", async (req: express.Request, res: express.Response) => {
  try {
    const stats = await runtime.getStats();

    res.json({
      status: "online",
      system: {
        uptime: stats.uptime,
        registeredProcessors: stats.registeredProcessors,
        jobs: {
          running: stats.runningJobs,
          completed: stats.completedJobs,
          failed: stats.failedJobs,
        },
      },
      queues: stats.queueStats || {},
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Error obteniendo estado del sistema", error);

    res.status(500).json({
      status: "error",
      error: "No se pudo obtener el estado del sistema",
      details: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

// Ruta para obtener información detallada de las colas
app.get("/api/queues", async (req: express.Request, res: express.Response) => {
  try {
    const queues = runtime.getQueues();

    const queueDetails = await Promise.all(
      queues.map(async (queue) => {
        const counts = await queue.getJobCounts();
        return {
          name: queue.name,
          counts,
          isPaused: await queue.isPaused(),
        };
      })
    );

    res.json({
      queues: queueDetails,
      totalQueues: queues.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Error obteniendo información de colas", error);

    res.status(500).json({
      status: "error",
      error: "No se pudo obtener información de las colas",
      details: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

// Ruta para obtener información sobre los procesadores
app.get("/api/processors", (req: express.Request, res: express.Response) => {
  const processorInfo = runtime.getProcessors().map((p) => ({
    name: p.name,
    description: p.config.description,
    config: p.config,
  }));

  res.json({
    processors: processorInfo,
    patterns: {
      orchestrator: "Coordinador principal que planifica y dirige el proceso",
      parallel:
        "Procesadores que ejecutan tareas en paralelo para mayor eficiencia",
      sequential:
        "Procesadores que ejecutan tareas en secuencia con dependencias",
      validator: "Procesadores que validan y aseguran la calidad",
      finalizer: "Procesadores que ensamblan el resultado final",
      workflow: "Composición de múltiples procesadores en un flujo específico",
    },
    totalProcessors: processorInfo.length,
  });
});

// Montar Bull Board
app.use("/admin/queues", serverAdapter.getRouter());

// Middleware de manejo de errores
app.use((error: Error, req: express.Request, res: express.Response) => {
  logger.error("Error no manejado en la aplicación", error);

  res.status(500).json({
    success: false,
    error: "Error interno del servidor",
    details:
      process.env.NODE_ENV === "development" ? error.message : "Error interno",
  });
});

// Manejo de rutas no encontradas
app.use((req: express.Request, res: express.Response) => {
  res.status(404).json({
    error: "Ruta no encontrada",
    message: `La ruta ${req.method} ${req.originalUrl} no existe`,
    availableRoutes: [
      "GET /",
      "POST /api/generate",
      "GET /api/status",
      "GET /api/processors",
      "GET /api/queues",
      "GET /admin/queues",
    ],
  });
});

// Función para iniciar el servidor
async function startServer() {
  try {
    logger.info("Iniciando servidor de generación de apps con IA...");

    await runtime.cleanAllQueues();
    // Configurar Bull Board
    await setupBullBoard();

    // Iniciar el servidor
    const server = app.listen(PORT, () => {
      logger.info(`🚀 Servidor iniciado en puerto ${PORT}`);
      logger.info(`📊 Monitor de colas: http://localhost:${PORT}/admin/queues`);
      logger.info(`🔗 API: http://localhost:${PORT}/api`);

      console.log("\n=== SISTEMA DE GENERACIÓN DE APPS CON IA ===");
      console.log(`🌐 Servidor: http://localhost:${PORT}`);
      console.log(
        `📊 Monitor Bull Board: http://localhost:${PORT}/admin/queues`
      );
      console.log(`📚 Estado del sistema: http://localhost:${PORT}/api/status`);
      console.log(
        `🔧 Info procesadores: http://localhost:${PORT}/api/processors`
      );
      console.log(`📋 Info colas: http://localhost:${PORT}/api/queues`);
      console.log("\n📝 Para generar una app, haz POST a /api/generate con:");
      console.log(
        JSON.stringify(
          {
            userRequest: "Descripción de tu aplicación...",
          },
          null,
          2
        )
      );
    });

    // Manejo de cierre graceful
    const gracefulShutdown = async (signal: string) => {
      logger.info(`Señal ${signal} recibida, cerrando servidor...`);

      server.close(async () => {
        try {
          await runtime.stop();
          logger.info("Servidor cerrado exitosamente");
          process.exit(0);
        } catch (error) {
          logger.error("Error cerrando el servidor", error);
          process.exit(1);
        }
      });
    };

    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  } catch (error) {
    logger.error("Error iniciando el servidor", error);
    process.exit(1);
  }
}

// Iniciar el servidor si este archivo se ejecuta directamente
if (import.meta.main) {
  startServer();
}

export { app, startServer };
