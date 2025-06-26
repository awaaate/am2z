import express from "express";
import path from "path";
import fs from "fs/promises";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { generateLandingPage, runtime } from "./landing-page-generator";
import { createLogger } from "../lib/core/logging";

const app = express();
const PORT = process.env.PORT || 3001;
const logger = createLogger({ component: "LandingPageServer" });

// Directorio para almacenar las landing pages generadas
const GENERATED_DIR = path.join(process.cwd(), "generated");

// Middleware para parsear JSON
app.use(express.json());

// Servir archivos estáticos del directorio generated
app.use("/generated", express.static(GENERATED_DIR));

// Configurar Bull Board para monitoreo
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

// Función para configurar Bull Board
async function setupBullBoard() {
  try {
    await runtime.start();
    const queues = runtime.getQueues();
    logger.info(`Configurando Bull Board con ${queues.length} colas`);

    const queueAdapters = queues.map((queue) => new BullMQAdapter(queue));

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

// Función para crear el directorio de archivos generados
async function ensureGeneratedDir() {
  try {
    await fs.access(GENERATED_DIR);
  } catch {
    await fs.mkdir(GENERATED_DIR, { recursive: true });
    logger.info(`Directorio ${GENERATED_DIR} creado`);
  }
}

// Función para generar nombre único de archivo
function generateFileName(userRequest: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const sanitizedRequest = userRequest
    .substring(0, 50)
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();

  return `landing-${sanitizedRequest}-${timestamp}.html`;
}

// === RUTAS DE LA API ===

// Ruta principal
app.get("/", (req: express.Request, res: express.Response) => {
  res.json({
    message: "Generador de Landing Pages con IA",
    version: "1.0.0",
    endpoints: {
      generate: "POST /api/generate",
      serve: "GET /generated/{filename}",
      status: "GET /api/status",
      monitoring: "GET /admin/queues",
    },
    features: [
      "Análisis automático de requisitos de marketing",
      "Generación paralela de secciones (Hero, Features, Testimonials, Pricing)",
      "Sistema de diseño cohesivo con TailwindCSS",
      "Optimización SEO y performance automática",
      "HTML production-ready responsive",
      "Control de calidad integral",
    ],
  });
});

// Ruta para generar landing pages
app.post(
  "/api/generate",
  async (req: express.Request, res: express.Response) => {
    try {
      const { userRequest } = req.body;

      if (!userRequest || typeof userRequest !== "string") {
        return res.status(400).json({
          error:
            "Se requiere el campo userRequest con la descripción de la landing page",
          example: {
            userRequest:
              "Necesito una landing page para mi startup de IA que automatiza servicio al cliente. Target: CTOs de empresas medianas. Objetivo: demos gratuitas.",
          },
        });
      }

      logger.info("Nueva solicitud de generación de landing page", {
        userRequest,
      });

      // Generar la landing page
      const result = await generateLandingPage(userRequest);

      if (result.success && result.state.finalHTML) {
        // Generar nombre único del archivo
        const fileName = generateFileName(userRequest);
        const filePath = path.join(GENERATED_DIR, fileName);

        // Guardar el HTML en el archivo
        await fs.writeFile(filePath, result.state.finalHTML, "utf-8");

        // URL pública del archivo generado
        const publicUrl = `/generated/${fileName}`;
        const fullUrl = `${req.protocol}://${req.get("host")}${publicUrl}`;

        logger.info("Landing page generada y guardada exitosamente", {
          fileName,
          qualityScore: result.state.qualityScore,
          htmlSize: result.state.finalHTML.length,
        });

        res.json({
          success: true,
          message: "Landing page generada exitosamente",
          data: {
            fileName,
            publicUrl,
            fullUrl,
            qualityScore: result.state.qualityScore,
            requirements: result.state.requirements,
            sections: {
              hero: result.state.heroSection,
              features: result.state.featuresSection,
              testimonials: result.state.testimonials,
              pricing: result.state.pricingSection,
            },
            design: result.state.designSystem,
            seo: result.state.seoData,
            performance: result.state.performanceOptimizations,
          },
          metadata: {
            executionTime: result.executionTime,
            htmlSize: result.state.finalHTML.length,
            timestamp: new Date().toISOString(),
          },
        });
      } else {
        logger.error("Error generando landing page", result.error);

        res.status(500).json({
          success: false,
          error: "Error generando la landing page",
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

// Ruta para listar archivos generados
app.get("/api/files", async (req: express.Request, res: express.Response) => {
  try {
    const files = await fs.readdir(GENERATED_DIR);
    const htmlFiles = files.filter((file) => file.endsWith(".html"));

    const fileDetails = await Promise.all(
      htmlFiles.map(async (file) => {
        const filePath = path.join(GENERATED_DIR, file);
        const stats = await fs.stat(filePath);

        return {
          name: file,
          url: `/generated/${file}`,
          fullUrl: `${req.protocol}://${req.get("host")}/generated/${file}`,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
        };
      })
    );

    // Ordenar por fecha de creación (más recientes primero)
    fileDetails.sort((a, b) => b.created.getTime() - a.created.getTime());

    res.json({
      success: true,
      files: fileDetails,
      totalFiles: fileDetails.length,
      totalSize: fileDetails.reduce((sum, file) => sum + file.size, 0),
    });
  } catch (error) {
    logger.error("Error listando archivos", error);

    res.status(500).json({
      success: false,
      error: "Error obteniendo lista de archivos",
      details: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

// Ruta para obtener el estado del sistema
app.get("/api/status", async (req: express.Request, res: express.Response) => {
  try {
    const stats = await runtime.getStats();

    // Información del directorio de archivos generados
    let generatedFilesInfo = { count: 0, totalSize: 0 };
    try {
      const files = await fs.readdir(GENERATED_DIR);
      const htmlFiles = files.filter((file) => file.endsWith(".html"));

      const sizes = await Promise.all(
        htmlFiles.map(async (file) => {
          const filePath = path.join(GENERATED_DIR, file);
          const stats = await fs.stat(filePath);
          return stats.size;
        })
      );

      generatedFilesInfo = {
        count: htmlFiles.length,
        totalSize: sizes.reduce((sum, size) => sum + size, 0),
      };
    } catch (error) {
      logger.warn("Error obteniendo info de archivos generados", error);
    }

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
        generatedFiles: generatedFilesInfo,
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
      analyzer: "Analiza requisitos y determina estrategia de marketing",
      parallel: "Generación simultánea de contenido y diseño",
      optimizer: "Optimizaciones SEO y performance en cadena",
      assembler: "Ensamblaje del HTML final production-ready",
      quality: "Control de calidad y auditoría integral",
    },
    totalProcessors: processorInfo.length,
  });
});

// Ruta para limpiar archivos antiguos (opcional)
app.delete(
  "/api/cleanup",
  async (req: express.Request, res: express.Response) => {
    try {
      const { olderThanDays = 7 } = req.query;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - Number(olderThanDays));

      const files = await fs.readdir(GENERATED_DIR);
      const htmlFiles = files.filter((file) => file.endsWith(".html"));

      let deletedCount = 0;
      let deletedSize = 0;

      for (const file of htmlFiles) {
        const filePath = path.join(GENERATED_DIR, file);
        const stats = await fs.stat(filePath);

        if (stats.birthtime < cutoffDate) {
          deletedSize += stats.size;
          await fs.unlink(filePath);
          deletedCount++;
        }
      }

      logger.info(`Limpieza completada: ${deletedCount} archivos eliminados`);

      res.json({
        success: true,
        message: `Limpieza completada`,
        deleted: {
          count: deletedCount,
          size: deletedSize,
        },
        cutoffDate: cutoffDate.toISOString(),
      });
    } catch (error) {
      logger.error("Error en limpieza de archivos", error);

      res.status(500).json({
        success: false,
        error: "Error realizando limpieza",
        details: error instanceof Error ? error.message : "Error desconocido",
      });
    }
  }
);

// Montar Bull Board
app.use("/admin/queues", serverAdapter.getRouter());

// Middleware de manejo de errores
app.use(
  (
    error: Error,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    logger.error("Error no manejado en la aplicación", error);

    res.status(500).json({
      success: false,
      error: "Error interno del servidor",
      details:
        process.env.NODE_ENV === "development"
          ? error.message
          : "Error interno",
    });
  }
);

// Manejo de rutas no encontradas
app.use((req: express.Request, res: express.Response) => {
  res.status(404).json({
    error: "Ruta no encontrada",
    message: `La ruta ${req.method} ${req.originalUrl} no existe`,
    availableRoutes: [
      "GET /",
      "POST /api/generate",
      "GET /api/files",
      "GET /api/status",
      "GET /api/processors",
      "GET /api/queues",
      "DELETE /api/cleanup",
      "GET /generated/{filename}",
      "GET /admin/queues",
    ],
  });
});

// Función para iniciar el servidor
async function startServer() {
  try {
    logger.info("Iniciando servidor generador de landing pages...");

    // Crear directorio para archivos generados
    await ensureGeneratedDir();

    // Limpiar colas y configurar monitoring
    await runtime.cleanAllQueues();
    await setupBullBoard();

    // Iniciar el servidor
    const server = app.listen(PORT, () => {
      logger.info(`🚀 Servidor iniciado en puerto ${PORT}`);
      logger.info(`📊 Monitor de colas: http://localhost:${PORT}/admin/queues`);
      logger.info(`🔗 API: http://localhost:${PORT}/api`);
      logger.info(`📁 Archivos generados: http://localhost:${PORT}/generated/`);

      console.log("\n=== GENERADOR DE LANDING PAGES CON IA ===");
      console.log(`🌐 Servidor: http://localhost:${PORT}`);
      console.log(
        `📊 Monitor Bull Board: http://localhost:${PORT}/admin/queues`
      );
      console.log(`📚 Estado del sistema: http://localhost:${PORT}/api/status`);
      console.log(
        `🔧 Info procesadores: http://localhost:${PORT}/api/processors`
      );
      console.log(`📋 Archivos generados: http://localhost:${PORT}/api/files`);
      console.log(`📁 Ver landing pages: http://localhost:${PORT}/generated/`);
      console.log(
        "\n📝 Para generar una landing page, haz POST a /api/generate con:"
      );
      console.log(
        JSON.stringify(
          {
            userRequest:
              "Necesito una landing page para mi startup de IA que automatiza servicio al cliente. Target: CTOs de empresas medianas. Objetivo: demos gratuitas.",
          },
          null,
          2
        )
      );
      console.log("\n💡 Ejemplo con curl:");
      console.log(`curl -X POST http://localhost:${PORT}/api/generate \\`);
      console.log(`  -H "Content-Type: application/json" \\`);
      console.log(
        `  -d '{"userRequest": "Landing page para agencia de marketing digital"}'`
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
